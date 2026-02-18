import { Fighter, POSE } from './entities/fighter.js';
import { POWERS } from './entities/powers.js';
import { getSpawnEffect, getValidPowerIds } from './entities/powers/index.js';
import { updatePhysics, applyKnockback, GROUND_Y, ARENA_BOUNDS } from './engine/physics.js';
import { resolveCombat, decayCombos, checkCloneHit } from './engine/combat.js';
import { tickProjectiles, processProjectileHits } from './engine/projectileSystem.js';
import { HP, ARENA, AI, CLONE, EFFECT_DURATION, COMBAT, COMBAT_EXTRA, RENDER, PHYSICS } from './config/constants.js';
import { createHitEffect } from './core/hitEffectFactory.js';
import { getCloneDissolveY, getRagdollOriginY, getHitEffectY } from './core/coordinates.js';
import { spawnHitParticles, spawnCloneDissolve, spawnHealParticles, spawnFireballLaunch, spawnClonePoof, spawnShinraTensei, spawnLightningCutter, spawnTeleportDeparture, spawnTeleportArrival, tickParticles } from './services/particleSystem.js';
import { updateHUD, getFighterDomId } from './services/hud.js';
import { drawStickman, drawBackground, drawHitEffect, drawDamageNumber, drawParticles, drawProjectiles, drawClones, drawTeleportEffect } from './engine/renderer.js';
import { createRagdoll, updateRagdoll, drawRagdoll } from './engine/ragdoll.js';
import { executeAI } from './ai/behavior.js';
import { INTELLIGENCE_LEVELS, getAIStats, loadSettings, saveSettings } from './ai/presets.js';
import { secureRandom } from './utils.js';

const MAX_HIT_EFFECT_T = (h) => h.heal ? EFFECT_DURATION.HEAL : (h.shinra || h.lightning || h.fire) ? EFFECT_DURATION.SKILL : h.clash ? EFFECT_DURATION.CLASH : EFFECT_DURATION.HIT;

const canvas = document.getElementById('canvas');
const ctx = canvas?.getContext('2d');
const hudEls = {
  hp1: document.getElementById('hp1'),
  hp2: document.getElementById('hp2'),
  stam1: document.getElementById('stam1'),
  stam2: document.getElementById('stam2'),
  rounds: document.getElementById('rounds'),
  combo1: document.getElementById('combo1'),
  combo2: document.getElementById('combo2')
};
const matchOverEl = document.getElementById('matchOver');
const countdownEl = document.getElementById('countdown');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const quickStartBtn = document.getElementById('quickStartBtn');
const quickResetBtn = document.getElementById('quickResetBtn');

let fighter1, fighter2;
let clones = [];
let skillFeed = [];
let running = false;
let lastTime = 0;
let gameSpeed = 1;
let hitEffects = [];
let particles = [];
let projectiles = [];
let screenShake = 0;
let hitZoom = 1;
let intelligence1 = 48;
let intelligence2 = 48;
let aiTick1 = 0;
let aiTick2 = 0;
let roundState = 'fighting';
let roundCountdown = 0;
let roundWinner = 0;
let ragdollPhase = 0;
let activeRagdolls = [];
let pendingRoundEnd = null;
let hitStopRemaining = 0;
let koSlowMo = 0;
let roundHistory = [];
let smoothCamX = 0;
const MAX_ROUNDS = 3;
const CAMERA_SMOOTH = 5.5;
const HIT_STOP_MS = PHYSICS.HIT_STOP_MS ?? 22;

function getFighterHealth(fighterIndex) {
  const inp = document.getElementById(getFighterDomId(fighterIndex, 'hpSet'));
  const v = parseInt(inp?.value || HP.DEFAULT, 10);
  return isNaN(v) ? HP.DEFAULT : Math.max(HP.MIN, Math.min(HP.MAX, v));
}

function createFighters() {
  const hp1 = getFighterHealth(0);
  const hp2 = getFighterHealth(1);
  fighter1 = new Fighter(0, '#3db8d4', -ARENA.START_OFFSET, 1, hp1);
  fighter2 = new Fighter(1, '#e85c5c', ARENA.START_OFFSET, -1, hp2);
  fighter1.setPowers([]);
  fighter2.setPowers([]);
  syncPowersFromUI();
}

function syncPowersFromUI() {
  const p1 = [...document.querySelectorAll('#powers1 .power-btn.selected')].map(b => b.dataset.power);
  const p2 = [...document.querySelectorAll('#powers2 .power-btn.selected')].map(b => b.dataset.power);
  fighter1.setPowers(p1);
  fighter2.setPowers(p2);
}

function syncStatsFromUI(fighterIndex) {
  const inp = document.getElementById(getFighterDomId(fighterIndex, 'intelligence'));
  const v = parseInt(inp?.value, 10);
  const val = isNaN(v) ? 48 : Math.max(0, Math.min(100, v));
  if (fighterIndex === 0) intelligence1 = val;
  else intelligence2 = val;
}

function getSettings() {
  const p1 = [...document.querySelectorAll('#powers1 .power-btn.selected')].map(b => b.dataset.power);
  const p2 = [...document.querySelectorAll('#powers2 .power-btn.selected')].map(b => b.dataset.power);
  return {
    hp1: getFighterHealth(0), hp2: getFighterHealth(1),
    intelligence1, intelligence2,
    powers1: p1, powers2: p2,
    gameSpeed
  };
}

function snapIntelligence(v) {
  return INTELLIGENCE_LEVELS.map(l => l.value).reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
}

function applySettings(s) {
  intelligence1 = s.intelligence1 ?? 48;
  intelligence2 = s.intelligence2 ?? 48;
  intelligence1 = snapIntelligence(intelligence1);
  intelligence2 = snapIntelligence(intelligence2);
  gameSpeed = s.gameSpeed;
  [0, 1].forEach(i => {
    const hpInp = document.getElementById(getFighterDomId(i, 'hpSet'));
    const intInp = document.getElementById(getFighterDomId(i, 'intelligence'));
    if (hpInp) hpInp.value = i === 0 ? s.hp1 : s.hp2;
    if (intInp) intInp.value = String(i === 0 ? intelligence1 : intelligence2);
  });
  document.querySelectorAll('.speed-control button').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.speed) === s.gameSpeed);
  });
  document.querySelectorAll('.quick-speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.speed) === s.gameSpeed);
  });
  const validPowers = getValidPowerIds();
  const p1 = (s.powers1 || []).filter(k => validPowers.includes(k));
  const p2 = (s.powers2 || []).filter(k => validPowers.includes(k));
  document.querySelectorAll('#powers1 .power-btn').forEach(btn => {
    btn.classList.toggle('selected', p1.includes(btn.dataset.power));
  });
  document.querySelectorAll('#powers2 .power-btn').forEach(btn => {
    btn.classList.toggle('selected', p2.includes(btn.dataset.power));
  });
  updatePowerCount();
}

function buildPowerButtons(containerId) {
  const wrap = document.getElementById(containerId)?.closest('.powers');
  const container = document.getElementById(containerId);
  if (!container) return;
  const countEl = wrap?.querySelector('.power-count');
  container.innerHTML = '';
  Object.entries(POWERS).forEach(([id, p]) => {
    const btn = document.createElement('button');
    btn.className = 'power-btn';
    btn.dataset.power = id;
    btn.title = p.tip || p.name;
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      const c = btn.closest('.power-btns');
      const sel = c?.querySelectorAll('.power-btn.selected');
      if (btn.classList.contains('selected')) btn.classList.remove('selected');
      else if (sel && sel.length < 4) btn.classList.add('selected');
      if (running) syncPowersFromUI();
      updatePowerCount();
      persistSettings();
    });
    container.appendChild(btn);
  });
  updatePowerCount();
}

function updatePowerCount() {
  document.querySelectorAll('.powers').forEach((wrap, i) => {
    const sel = wrap.querySelectorAll('.power-btn.selected');
    const countEl = wrap.querySelector('.power-count');
    if (countEl) countEl.textContent = `(${sel.length}/4)`;
  });
}

function persistSettings() {
  saveSettings(getSettings());
}

function initUI() {
  const saved = loadSettings();
  intelligence1 = saved.intelligence1 ?? 48;
  intelligence2 = saved.intelligence2 ?? 48;
  gameSpeed = saved.gameSpeed;
  buildPowerButtons('powers1');
  buildPowerButtons('powers2');
  applySettings(saved);
  const toggle1 = document.getElementById('controlsToggle1');
  const toggle2 = document.getElementById('controlsToggle2');
  const panel1 = document.getElementById('controlsPanel1');
  const panel2 = document.getElementById('controlsPanel2');
  const openPanel = (panel, toggle, otherPanel, otherToggle) => {
    otherPanel?.classList.remove('visible');
    otherToggle?.classList.remove('active');
    panel?.classList.add('visible');
    toggle?.classList.add('active');
  };
  const closePanel = (panel, toggle) => {
    panel?.classList.remove('visible');
    toggle?.classList.remove('active');
  };
  toggle1?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel1?.classList.contains('visible')) closePanel(panel1, toggle1);
    else openPanel(panel1, toggle1, panel2, toggle2);
  });
  toggle2?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel2?.classList.contains('visible')) closePanel(panel2, toggle2);
    else openPanel(panel2, toggle2, panel1, toggle1);
  });
  document.addEventListener('click', (e) => {
    if (panel1?.classList.contains('visible') && !panel1.contains(e.target) && !toggle1?.contains(e.target)) closePanel(panel1, toggle1);
    if (panel2?.classList.contains('visible') && !panel2.contains(e.target) && !toggle2?.contains(e.target)) closePanel(panel2, toggle2);
  });
  document.getElementById('intelligence1')?.addEventListener('change', () => { syncStatsFromUI(0); persistSettings(); });
  document.getElementById('intelligence2')?.addEventListener('change', () => { syncStatsFromUI(1); persistSettings(); });
  document.querySelectorAll('.speed-control button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-control button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gameSpeed = parseFloat(btn.dataset.speed);
      persistSettings();
    });
  });
  document.getElementById('hpSet1')?.addEventListener('input', () => {
    const inp = document.getElementById('hpSet1');
    if (inp) {
      const v = parseInt(inp.value, 10);
      if (!isNaN(v)) inp.value = Math.max(HP.MIN, Math.min(HP.MAX, v));
      persistSettings();
    }
  });
  document.getElementById('hpSet2')?.addEventListener('input', () => {
    const inp = document.getElementById('hpSet2');
    if (inp) {
      const v = parseInt(inp.value, 10);
      if (!isNaN(v)) inp.value = Math.max(HP.MIN, Math.min(HP.MAX, v));
      persistSettings();
    }
  });
  quickStartBtn?.addEventListener('click', () => startBtn?.click());
  quickResetBtn?.addEventListener('click', () => resetBtn?.click());
  document.getElementById('startBtn2')?.addEventListener('click', () => startBtn?.click());
  document.getElementById('resetBtn2')?.addEventListener('click', () => resetBtn?.click());
  document.querySelectorAll('.quick-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quick-speed-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.speed-control button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const speed = parseFloat(btn.dataset.speed);
      gameSpeed = speed;
      persistSettings();
      document.querySelectorAll(`.speed-control button[data-speed="${speed}"]`).forEach(b => b.classList.add('active'));
    });
  });
  document.querySelectorAll('.speed-control button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quick-speed-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.speed-control button').forEach(b => b.classList.remove('active'));
      const speed = parseFloat(btn.dataset.speed);
      gameSpeed = speed;
      persistSettings();
      document.querySelectorAll(`.quick-speed-btn[data-speed="${speed}"]`).forEach(b => b.classList.add('active'));
      document.querySelectorAll(`.speed-control button[data-speed="${speed}"]`).forEach(b => b.classList.add('active'));
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); if (!running) startBtn?.click(); }
    if (e.code === 'Escape') { e.preventDefault(); resetBtn?.click(); }
  });
}


const SPAWN_EFFECTS = {
  heal: (f) => spawnHealParticles(particles, f, secureRandom),
  fireball: (f) => spawnFireballLaunch(particles, f, secureRandom),
  clone: (f) => spawnClonePoof(particles, f, secureRandom),
  shinra: (f) => spawnShinraTensei(particles, f, secureRandom),
  lightning: (f) => spawnLightningCutter(particles, f, secureRandom)
};

function updateRoundState(now, scaledDt) {
  if (roundState !== 'countdown') return;
  roundCountdown -= scaledDt;
  if (roundCountdown <= 0) {
    roundState = 'fighting';
    countdownEl?.classList.remove('visible');
    fighter1.maxHp = getFighterHealth(0);
    fighter2.maxHp = getFighterHealth(1);
    fighter1.resetForRound(-ARENA.START_OFFSET, 1);
    fighter2.resetForRound(ARENA.START_OFFSET, -1);
    smoothCamX = getCameraX();
  }
}

function update(dt) {
  const now = performance.now();
  if (hitStopRemaining > 0) {
    hitStopRemaining -= dt * 1000;
    hitEffects = hitEffects.filter(h => { h.t += dt; return h.t < MAX_HIT_EFFECT_T(h); });
    particles = tickParticles(particles, dt);
    screenShake *= 0.92;
    if (screenShake < 0.5) screenShake = 0;
    hitZoom = hitZoom * (RENDER.ZOOM_DECAY ?? 0.92) + (1 - (RENDER.ZOOM_DECAY ?? 0.92));
    if (fighter1 && fighter2) {
      updateSmoothCamera(dt * gameSpeed);
      updateHUD(fighter1, fighter2, hudEls, MAX_ROUNDS, skillFeed);
    }
    return;
  }
  const scaledDt = dt * gameSpeed;
  if (roundState === 'countdown') {
    updateRoundState(now, scaledDt);
    if (fighter1 && fighter2) updateSmoothCamera(scaledDt);
    return;
  }
  if (!running || !fighter1 || !fighter2) return;
  if (ragdollPhase > 0) {
    if (koSlowMo > 0) koSlowMo -= dt;
    const slowMult = koSlowMo > 0 ? 0.28 : 1;
    const ragdollDt = scaledDt * slowMult;
    ragdollPhase -= ragdollDt;
    activeRagdolls.forEach(r => updateRagdoll(r.ragdoll, ragdollDt));
    if (ragdollPhase <= 0) applyPendingRoundEnd();
    hitEffects = hitEffects.filter(h => { h.t += dt; return h.t < MAX_HIT_EFFECT_T(h); });
    particles = tickParticles(particles, dt);
    screenShake *= 0.91;
    if (screenShake < 0.5) screenShake = 0;
    hitZoom = hitZoom * (RENDER.ZOOM_DECAY ?? 0.92) + (1 - (RENDER.ZOOM_DECAY ?? 0.92));
    if (hitZoom > 0.998) hitZoom = 1;
    updateSmoothCamera(scaledDt);
    updateHUD(fighter1, fighter2, hudEls, MAX_ROUNDS, skillFeed);
    return;
  }
  syncStatsFromUI(0);
  syncStatsFromUI(1);
  fighter1.update(scaledDt, now);
  fighter2.update(scaledDt, now);
  decayCombos(fighter1, fighter2, now);
  const cloneHitByF1 = checkCloneHit(fighter1, clones, 1, now);
  const cloneHitByF2 = checkCloneHit(fighter2, clones, 0, now);
  if (cloneHitByF1) {
    spawnCloneDissolve(particles, cloneHitByF1.x, getCloneDissolveY(), secureRandom);
    clones = clones.filter(c => c !== cloneHitByF1);
  }
  if (cloneHitByF2) {
    spawnCloneDissolve(particles, cloneHitByF2.x, getCloneDissolveY(), secureRandom);
    clones = clones.filter(c => c !== cloneHitByF2);
  }
  resolveCombat(fighter1, fighter2, now, hitEffects, cloneHitByF1, cloneHitByF2);
  hitEffects.forEach(h => {
    if (h.dmg > 0 && !h.fire) spawnHitParticles(particles, h.x, h.y, h.heavy, secureRandom);
    if (h.shinra && h.t < 0.01) { spawnHitParticles(particles, h.x, h.y, true, secureRandom); screenShake = Math.min(10, screenShake + (RENDER.SHAKE_SKILL ?? 6)); }
    if (h.lightning && h.t < 0.01 && !h.block) { spawnHitParticles(particles, h.x, h.y, true, secureRandom); screenShake = Math.min(8, screenShake + (RENDER.SHAKE_SKILL ?? 6)); }
    if (h.fire && h.t < 0.01) spawnHitParticles(particles, h.x, h.y, true, secureRandom);
    if (h.t < 0.01) {
      if (h.counter) { screenShake = Math.min(7, screenShake + (RENDER.SHAKE_COUNTER ?? 4)); hitZoom = Math.min(hitZoom, RENDER.ZOOM_HEAVY ?? 0.96); hitStopRemaining = Math.max(hitStopRemaining, HIT_STOP_MS); }
      else if (h.heavy) { screenShake = Math.min(7, screenShake + (RENDER.SHAKE_HEAVY ?? 5)); hitZoom = Math.min(hitZoom, RENDER.ZOOM_HEAVY ?? 0.96); hitStopRemaining = Math.max(hitStopRemaining, HIT_STOP_MS); }
      else if (h.dmg > 0 && !h.shinra && !h.lightning) screenShake = Math.min(5, screenShake + (RENDER.SHAKE_LIGHT ?? 2.5));
    }
  });
  tickProjectiles(projectiles, scaledDt);
  aiTick1 += scaledDt;
  aiTick2 += scaledDt;
  const fighters = [fighter1, fighter2];
  const aiStats = [getAIStats(intelligence1), getAIStats(intelligence2)];
  const aiTicks = [aiTick1, aiTick2];
  const reactTimes = fighters.map((_, i) => (AI.REACT_BASE_MS + (100 - aiStats[i].reaction) * AI.REACT_SCALE) / 1000);
  [0, 1].forEach(i => {
    if (aiTicks[i] >= reactTimes[i] && fighters[i].staggerUntil <= now) {
      aiTicks[i] = 0;
      const opponent = fighters[1 - i];
      const act = executeAI(fighters[i], opponent, aiStats[i], now, secureRandom, hitEffects, projectiles, clones);
      if (act?.type === 'power' && act.powerId) {
        skillFeed.unshift({ fighterId: i, powerId: act.powerId, at: now });
        if (skillFeed.length > 4) skillFeed.pop();
        const spawnKey = getSpawnEffect(act.powerId);
        if (SPAWN_EFFECTS[spawnKey]) SPAWN_EFFECTS[spawnKey](fighters[i]);
      }
    }
  });
  aiTick1 = aiTicks[0];
  aiTick2 = aiTicks[1];
  if (fighter1.staggerUntil <= now) updatePhysics(fighter1, scaledDt, now);
  if (fighter2.staggerUntil <= now) updatePhysics(fighter2, scaledDt, now);
  [fighter1, fighter2].forEach(f => {
    if (f.pose === POSE.teleport) {
      if (!f.teleportEffectSpawned) {
        spawnTeleportDeparture(particles, f, secureRandom);
        f.teleportEffectSpawned = true;
      }
    } else if (f.teleportEffectSpawned) {
      spawnTeleportArrival(particles, f.x, getHitEffectY(), f.color, secureRandom);
      f.teleportEffectSpawned = false;
    }
  });
  updateSmoothCamera(scaledDt);
  fighter1.x = Math.max(-ARENA_BOUNDS, Math.min(ARENA_BOUNDS, fighter1.x));
  fighter2.x = Math.max(-ARENA_BOUNDS, Math.min(ARENA_BOUNDS, fighter2.x));
  if (Math.abs(fighter1.x - fighter2.x) < COMBAT_EXTRA.FIGHTER_OVERLAP_DIST) {
    const push = (fighter1.x < fighter2.x ? -1 : 1) * COMBAT_EXTRA.FIGHTER_OVERLAP_PUSH;
    fighter1.vx += push;
    fighter2.vx -= push;
  }
  const projResult = processProjectileHits(projectiles, fighter1, fighter2, clones, hitEffects, particles, now, scaledDt, secureRandom);
  projectiles = projResult.projectiles;
  clones = clones.filter(c => !projResult.hitClones.has(c));
  clones = clones.filter(c => {
    if (c.dissolveAt != null && now >= c.dissolveAt) {
      spawnCloneDissolve(particles, c.x, getCloneDissolveY(), secureRandom);
      return false;
    }
    const target = c.targetId === 0 ? fighter1 : fighter2;
    c.facing = c.x < target.x ? 1 : -1;
    const dist = Math.abs(c.x - target.x) || 0.01;
    const windupActive = c.attackWindupAt && now - c.attackWindupAt < CLONE.WINDUP_MS;
    const chaseSpeed = dist < 150 ? 480 : 400;
    c.vx = windupActive ? 0 : (target.x - c.x) / dist * chaseSpeed;
    c.vx = Math.max(-500, Math.min(500, c.vx));
    c.x += c.vx * scaledDt;
    c.x = Math.max(-ARENA_BOUNDS + 25, Math.min(ARENA_BOUNDS - 25, c.x));
    const newDist = Math.abs(c.x - target.x);
    const inRange = newDist < CLONE.HIT_RADIUS;
    const canHit = now - c.lastHitAt >= CLONE.HIT_COOLDOWN_MS;
    if (inRange && !c.attackWindupAt) c.attackWindupAt = now;
    if (!inRange) c.attackWindupAt = 0;
    const windupDone = c.attackWindupAt && now - c.attackWindupAt >= CLONE.WINDUP_MS;
    if (inRange && canHit && windupDone) {
      target.hp = Math.max(0, target.hp - c.damage);
      target.lastHitAt = now;
      target.hitsTakenLast5Sec = (target.hitsTakenLast5Sec || 0) + 1;
      (c.ownerId === 0 ? fighter1 : fighter2).damageDealt += c.damage;
      target.stunUntil = now + c.stun;
      target.hitFlashUntil = now + 140;
      target.hitLastDmg = c.damage;
      target.pose = POSE.hit;
      hitEffects.push(createHitEffect(target.x, { dmg: c.damage }));
      c.lastHitAt = now;
      c.attackPoseUntil = now + 200;
      c.attackWindupAt = 0;
    }
    if (now - c.createdAt >= CLONE.DURATION_MS) {
      spawnCloneDissolve(particles, c.x, getCloneDissolveY(), secureRandom);
      return false;
    }
    return true;
  });
  hitEffects = hitEffects.filter(h => { h.t += dt; return h.t < MAX_HIT_EFFECT_T(h); });
  particles = tickParticles(particles, dt);
  screenShake *= 0.92;
  if (screenShake < 0.25) screenShake = 0;
  hitZoom = hitZoom * (RENDER.ZOOM_DECAY ?? 0.92) + (1 - (RENDER.ZOOM_DECAY ?? 0.92));
  if (hitZoom > 0.998) hitZoom = 1;
  updateHUD(fighter1, fighter2, hudEls, MAX_ROUNDS, skillFeed);
  if (fighter1.hp <= 0 || fighter2.hp <= 0) {
    koSlowMo = 0.4;
    const rw = fighter1.hp <= 0 ? 2 : 1;
    roundHistory.push(rw);
    const loser = fighter1.hp <= 0 ? fighter1 : fighter2;
    const rd = createRagdoll(loser.x, getRagdollOriginY(loser), loser.facing, loser.vx, loser.vy);
    activeRagdolls = [{ ragdoll: rd, color: loser.color }];
    ragdollPhase = 1.8;
    pendingRoundEnd = { roundWinner: rw, winner: fighter1.hp <= 0 ? fighter2 : fighter1 };
    return;
  }
}

function applyPendingRoundEnd() {
  if (!pendingRoundEnd) return;
  const { roundWinner: rw, winner } = pendingRoundEnd;
  roundWinner = rw;
  winner.roundsWon++;
  activeRagdolls = [];
  pendingRoundEnd = null;
  projectiles = [];
  clones = [];
  if (winner.roundsWon >= 2) {
    running = false;
    startBtn && (startBtn.textContent = 'Start');
    startBtn && (startBtn.disabled = false);
    const d1 = fighter1.damageDealt || 0;
    const d2 = fighter2.damageDealt || 0;
    const roundsText = roundHistory.length ? roundHistory.map((rw, i) => `R${i + 1}: P${rw}`).join(' · ') : '';
    matchOverEl.innerHTML = `<div class="match-over-inner"><div class="match-over-title">Fighter ${roundWinner} Wins!</div><div class="match-over-sub">Best of 3</div><div class="match-over-rounds">${roundsText}</div><div class="match-over-stats">P1: ${Math.round(d1)} dmg · P2: ${Math.round(d2)} dmg</div><button type="button" class="match-over-replay" id="matchOverReplay">Replay</button></div>`;
    matchOverEl.classList.add('visible');
    document.getElementById('matchOverReplay')?.addEventListener('click', () => startBtn?.click());
  } else {
    roundState = 'countdown';
    roundCountdown = 2.5;
    fighter1.maxHp = getFighterHealth(0);
    fighter2.maxHp = getFighterHealth(1);
    if (countdownEl) {
      countdownEl.textContent = `Round ${winner.roundsWon + 1}`;
      countdownEl.classList.add('visible');
    }
    setTimeout(() => {
      countdownEl.textContent = '3';
      setTimeout(() => { countdownEl.textContent = '2'; }, 500);
      setTimeout(() => { countdownEl.textContent = '1'; }, 1000);
      setTimeout(() => { countdownEl.textContent = 'FIGHT!'; }, 1500);
    }, 200);
  }
}

const LOGICAL_WIDTH = 2400;
const LOGICAL_HEIGHT = 600;

function resizeCanvas() {
  if (!canvas) return;
  const container = canvas.parentElement;
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function getCameraX() {
  const viewHalf = LOGICAL_WIDTH / 2;
  if (ragdollPhase > 0 && activeRagdolls.length > 0 && pendingRoundEnd) {
    const standing = pendingRoundEnd.roundWinner === 1 ? fighter2 : fighter1;
    return Math.max(-ARENA_BOUNDS + viewHalf, Math.min(ARENA_BOUNDS - viewHalf, standing.x));
  }
  const mid = (fighter1.x + fighter2.x) / 2;
  return Math.max(-ARENA_BOUNDS + viewHalf, Math.min(ARENA_BOUNDS - viewHalf, mid));
}

function updateSmoothCamera(dt) {
  if (!fighter1 || !fighter2) return;
  const target = getCameraX();
  const t = Math.min(1, CAMERA_SMOOTH * dt * (gameSpeed || 1));
  smoothCamX += (target - smoothCamX) * t;
}

function render() {
  if (!ctx || !fighter1 || !fighter2 || !canvas) return;
  const now = performance.now();
  resizeCanvas();
  const camX = smoothCamX;
  const sx = canvas.width / LOGICAL_WIDTH;
  const sy = canvas.height / LOGICAL_HEIGHT;
  const centerX = LOGICAL_WIDTH / 2;
  const countdownZoom = roundState === 'countdown' ? 1 + 0.06 * Math.max(0, roundCountdown / 2.5) : 1;
  const zoom = hitZoom * countdownZoom;
  const shakeX = (secureRandom() - 0.5) * screenShake;
  const shakeY = (secureRandom() - 0.5) * screenShake;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  ctx.scale(sx, sy);
  ctx.translate(centerX - camX + shakeX / sx, shakeY / sy);
  drawBackground(ctx, LOGICAL_WIDTH, LOGICAL_HEIGHT, camX);
  ctx.restore();
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  ctx.scale(sx, sy);
  ctx.translate(centerX - camX + shakeX / sx, shakeY / sy);
  const groundY = GROUND_Y;
  if (ragdollPhase > 0 && activeRagdolls.length > 0) {
    const loserId = pendingRoundEnd?.roundWinner === 1 ? 0 : 1;
    if (loserId === 0) {
      drawRagdoll(ctx, activeRagdolls[0].ragdoll, activeRagdolls[0].color);
      drawTeleportEffect(ctx, fighter2, GROUND_Y, now);
      drawStickman(ctx, fighter2, GROUND_Y, now);
    } else {
      drawTeleportEffect(ctx, fighter1, GROUND_Y, now);
      drawStickman(ctx, fighter1, GROUND_Y, now);
      drawRagdoll(ctx, activeRagdolls[0].ragdoll, activeRagdolls[0].color);
    }
  } else {
    if (fighter1.staggerRagdoll) drawRagdoll(ctx, fighter1.staggerRagdoll, fighter1.color);
    else {
      drawTeleportEffect(ctx, fighter1, groundY, now);
      drawStickman(ctx, fighter1, groundY, now);
    }
    if (fighter2.staggerRagdoll) drawRagdoll(ctx, fighter2.staggerRagdoll, fighter2.color);
    else {
      drawTeleportEffect(ctx, fighter2, groundY, now);
      drawStickman(ctx, fighter2, groundY, now);
    }
  }
  drawProjectiles(ctx, projectiles, groundY, now);
  drawClones(ctx, clones, groundY, now);
  drawParticles(ctx, particles);
  hitEffects.forEach(h => {
    drawHitEffect(ctx, h);
    if (h.dmg > 0) drawDamageNumber(ctx, h.x, h.y - 25, h.dmg, Math.max(0, 1 - h.t * 2.2), h.counter);
  });
  ctx.restore();
}

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

startBtn?.addEventListener('click', () => {
  if (running) return;
  matchOverEl?.classList.remove('visible');
  countdownEl?.classList.remove('visible');
  matchOverEl && (matchOverEl.innerHTML = '');
  ragdollPhase = 0;
  activeRagdolls = [];
  pendingRoundEnd = null;
  roundHistory = [];
  hitStopRemaining = 0;
  koSlowMo = 0;
  projectiles = [];
  clones = [];
  skillFeed = [];
  createFighters();
  fighter1.roundsWon = 0;
  fighter2.roundsWon = 0;
  syncPowersFromUI();
  fighter1.maxHp = getFighterHealth(0);
  fighter2.maxHp = getFighterHealth(1);
  fighter1.resetForRound(-ARENA.START_OFFSET, 1);
  fighter2.resetForRound(ARENA.START_OFFSET, -1);
  smoothCamX = getCameraX();
  running = true;
  roundState = 'fighting';
  roundCountdown = 0;
  hitEffects = [];
  particles = [];
  projectiles = [];
  clones = [];
  screenShake = 0;
  hitZoom = 1;
  startBtn.textContent = 'Running...';
  startBtn.disabled = true;
  quickStartBtn && (quickStartBtn.textContent = 'Running...');
  quickStartBtn && (quickStartBtn.disabled = true);
  hudEls.rounds && (hudEls.rounds.textContent = '0 - 0 | R1/3');
});

resetBtn?.addEventListener('click', () => {
  running = false;
  roundState = 'fighting';
  ragdollPhase = 0;
  activeRagdolls = [];
  pendingRoundEnd = null;
  roundHistory = [];
  hitStopRemaining = 0;
  koSlowMo = 0;
  matchOverEl?.classList.remove('visible');
  countdownEl?.classList.remove('visible');
  createFighters();
  if (hudEls.hp1) hudEls.hp1.style.width = '100%';
  if (hudEls.hp2) hudEls.hp2.style.width = '100%';
  if (hudEls.stam1) hudEls.stam1.style.width = '100%';
  if (hudEls.stam2) hudEls.stam2.style.width = '100%';
  startBtn && (startBtn.textContent = 'Start');
  startBtn && (startBtn.disabled = false);
  quickStartBtn && (quickStartBtn.textContent = 'Start');
  quickStartBtn && (quickStartBtn.disabled = false);
  hudEls.rounds && (hudEls.rounds.textContent = '0 - 0 | R1/3');
});

initUI();
createFighters();
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
lastTime = performance.now();
requestAnimationFrame(gameLoop);
