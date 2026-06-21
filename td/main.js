import { TD } from './config.js';
import { createHero, POSE } from './units.js';
import { createTower } from './towers.js';
import { createWaveState, updateWaves } from './waves.js';
import { updateHero, updateMonster, nearestMonster } from './ai.js';
import {
  integrate, resolveHeroAttacks, resolveMonsterAttacks,
  resolveHeroVsEnemyTower, reapDead, separateMonsters,
} from './combat.js';
import { castHeroSkill, updateProjectiles, fireTowerArrow } from './projectiles.js';
import { TDViewport } from './render.js';
import { initSetup, readLoadout } from './setup.js';
import { initShop, toggleShop, tickShop, hasAffordable, aiAutoBuy, openShop, isShopOpen } from './shop.js';
import { updateAllySpawning, updateAlly, resolveAllyAttacks, reapAllies } from './allies.js';
import { POWERS } from '../entities/powers.js';

const SKILL_LABEL = Object.fromEntries(
  (Array.isArray(POWERS) ? POWERS : Object.values(POWERS)).map(p => [p.id, p.name])
);
import { tickParticles, spawnLandingDust, spawnClonePoof, spawnHealParticles, spawnDashDust } from '../services/particleSystem.js';
import { secureRandom } from '../utils.js';
import { resumeAudio, startMusic, stopMusic, playSfx, toggleMute } from '../services/audio.js';

const HERO_RESPAWN_MS = 3500; // downed time before the hero rallies back at base

const canvas = document.getElementById('canvas');
const viewport = new TDViewport(canvas);

let running = false;
let world = null;
let lastTime = performance.now();

function newWorld() {
  return {
    rng: secureRandom,
    hero: createHero(readLoadout()),
    monsters: [],
    allies: [],
    musterEnergy: TD.ALLY.musterStart, // base "power" accumulating toward the next ally
    baseCharges: TD.BASE_AEGIS.charges, // hidden last-resort Aegis pulses left this run
    baseAegisCdUntil: 0,
    baseAegisFx: null,
    playerTower: createTower('player'),
    enemyTower: createTower('enemy'),
    particles: [],
    projectiles: [],
    hitEffects: [],
    waveState: createWaveState(),
    camX: 0,
    zoom: 1,
    screenShake: 0,
    slowMo: 0,
    kills: 0,
    gold: 0,
    announce: null,
    waveEvent: null,
    over: null,        // 'win' | 'lose'
    heroDownUntil: 0,
    autoBuy: true,     // hero spends its own gold automatically (default on)
    time: 0,
  };
}

function start() {
  world = newWorld();
  world.camX = world.hero.x; // open framed on the hero, then drift with the action
  if (import.meta.env?.DEV) window.__td = world; // dev-only inspection hook
  running = true;
  nextAutoBuyAt = 0;
  syncAutoBtn();
  hideOverlay();
  resumeAudio();
  startMusic();
}

// ── Game speed ───────────────────────────────────────────────────────────────
// Fast-forward by running N full physics sub-steps per rendered frame, each with
// a normal-sized dt — so collisions/timers stay stable at 2×/3× instead of
// ballooning dt (which would tunnel). All gameplay reads a VIRTUAL clock that we
// advance per sub-step, so cooldowns/decisions speed up in lockstep with motion.
const SPEEDS = [1, 2, 3];
let gameSpeed = 1;
let gameClock = performance.now();

export function getGameSpeed() { return gameSpeed; }
function cycleSpeed() {
  gameSpeed = SPEEDS[(SPEEDS.indexOf(gameSpeed) + 1) % SPEEDS.length];
  syncSpeedBtn();
}
function setSpeed(n) { if (SPEEDS.includes(n)) { gameSpeed = n; syncSpeedBtn(); } }

// ── Main loop ────────────────────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  if (running && world) {
    for (let i = 0; i < gameSpeed; i++) { gameClock += dt * 1000; update(dt, gameClock); }
  } else {
    gameClock += dt * 1000; // keep the clock moving while idle so timers don't jump on resume
  }
  if (world) viewport.render(world, gameClock);
  requestAnimationFrame(loop);
}

// Dev-only deterministic stepper so the sim can be exercised in headless
// previews where requestAnimationFrame is throttled. No effect in production.
if (import.meta.env?.DEV) {
  window.__clock = () => gameClock; // virtual game clock (advances faster at 2×/3×)
  let synthNow = performance.now();
  window.__tick = (frames = 1, dt = 0.016) => {
    for (let i = 0; i < frames; i++) { synthNow += dt * 1000; if (running && world) update(dt, synthNow); }
    if (world) viewport.render(world, synthNow);
    return world && { wave: world.waveState.wave, monsters: world.monsters.length, kills: world.kills };
  };
}

function update(dt, now) {
  if (world.over) { decayEffects(dt); return; }

  const slow = world.slowMo > 0 ? 0.35 : 1;
  if (world.slowMo > 0) world.slowMo -= dt * 1000;
  const sdt = dt * slow;

  updateWaves(world, world.waveState, dt, now);

  // Hero — fully autonomous. When downed, the base must hold on its own until
  // the hero rallies back.
  const downed = handleHeroDown(now);
  if (!downed) {
    const intent = updateHero(world.hero, world, sdt, now);
    if (intent.skill) {
      castHeroSkill(world, world.hero, intent.skill, now);
      playSfx(intent.skill.kind === 'heal' ? 'heal' : intent.skill.kind === 'buff' ? 'sharinganActivate' : 'projectile');
    }
    world.hero.update(sdt, now);
    integrate(world.hero, sdt);
    applyBaseHeal(sdt, now);
  }

  // Monsters
  for (const m of world.monsters) {
    if (m.hp <= 0) continue;
    const wasAir = m.y < -6;
    updateMonster(m, world, sdt, now);
    m.update(sdt, now);
    integrate(m, sdt);
    if (m.needsDashDust) { spawnDashDust(world.particles, m.x, TD.GROUND_Y, m.facing, world.rng); m.needsDashDust = false; }
    if (wasAir && m.y >= -1) spawnLandingDust(world.particles, m.x, TD.GROUND_Y, 90, world.rng); // leap landing
  }
  separateMonsters(world);

  // Allied reinforcements — mustered from the base, they march out and intercept
  // the enemy column (their kills credit the hero's gold).
  updateAllySpawning(world, dt, now);
  for (const a of world.allies) {
    if (a.hp <= 0) continue;
    const wasAir = a.y < -6;
    updateAlly(a, world, sdt, now);
    a.update(sdt, now);
    integrate(a, sdt);
    if (a.needsDashDust) { spawnDashDust(world.particles, a.x, TD.GROUND_Y, a.facing, world.rng); a.needsDashDust = false; }
    if (wasAir && a.y >= -1) spawnLandingDust(world.particles, a.x, TD.GROUND_Y, 90, world.rng);
  }

  fireTowers(now);
  updateProjectiles(world, sdt, now);

  // Combat resolution (skip the hero's offence while downed)
  if (!downed) {
    resolveHeroAttacks(world, now);
    resolveHeroVsEnemyTower(world, now);
  }
  resolveAllyAttacks(world, now);
  resolveMonsterAttacks(world, now);
  reapDead(world, now);
  reapAllies(world);

  maybeBaseAegis(now);
  maybeAutoBuy(now);
  observeAudio(now);
  decayEffects(dt);
  updateCamera(dt);
  updateHUD(now);
  checkEnd();
}

// Hidden Aegis Barrier: when the base is about to fall (HP under the threshold)
// and a charge remains, it unleashes a rising kinetic pulse — flinging every
// enemy far down the lane on a real ballistic arc (gravity finishes the throw)
// and surging the base back to 70%. A scarce lifeline that turns a near-death
// collapse into a dramatic comeback.
function maybeBaseAegis(now) {
  const B = TD.BASE_AEGIS;
  const pt = world.playerTower;
  if (pt.hp <= 0 || world.baseCharges <= 0) return;
  if (now < (world.baseAegisCdUntil || 0)) return;
  if (pt.hp > pt.maxHp * B.hpThreshold) return;

  world.baseCharges -= 1;
  world.baseAegisCdUntil = now + B.cooldownMs;
  pt.hp = Math.max(pt.hp, pt.maxHp * B.healTo); // structure surges back to 70%

  for (const m of world.monsters) {
    if (m.hp <= 0) continue;
    const dist = Math.abs(m.x - pt.x);
    const prox = 1 - Math.min(1, dist / 2600);          // closer = flung harder
    const boost = 1 + B.proximityBoost * prox;
    m.vx = Math.abs(B.pushVx) * boost;                  // hurled DOWN-lane, away from base
    m.vy = B.pushVy * boost;                            // launched up → ballistic arc
    m.status.set('stun', now + 700);
    m.currentAttack = null;
    m.pose = POSE.hit; m.poseTime = 0;
    if (B.damage) m.takeDamage(B.damage, true, pt.x, now);
  }
  reapDead(world, now); // any flung enemy that the chip damage finished credits gold

  world.slowMo = Math.max(world.slowMo, 260);
  world.screenShake = Math.min(44, world.screenShake + 32);
  world.baseAegisFx = { x: pt.x, startedAt: now, dur: 720 };
  world.announce = { text: 'AEGIS BARRIER', until: now + 1700, big: true };
  playSfx('skill');
}

// Continuous auto-buy: while enabled (the default), the hero keeps spending its
// own gold on whatever helps it most, throttled so it's not evaluated every
// frame. Turn it off in the shop panel to take full manual control.
let nextAutoBuyAt = 0;
function maybeAutoBuy(now) {
  if (!world.autoBuy || now < nextAutoBuyAt) return;
  nextAutoBuyAt = now + 1200;
  aiAutoBuy(world);
}

// Both towers auto-fire arrows at threats in range (classic TD): your base rains
// arrows on the nearest monster, the enemy keep snipes the hero.
function fireTowers(now) {
  const F = TD.TOWER_FIRE;
  shootTower(world.playerTower, nearestMonster(world, world.playerTower.x), 'monster', F.damage, now);
  const heroTarget = (world.hero.hp > 0 && !world.heroDownUntil) ? world.hero : null;
  shootTower(world.enemyTower, heroTarget, 'hero', F.damage * F.enemyDamageMul, now);
}
function shootTower(tower, target, side, dmg, now) {
  if (tower.hp <= 0 || !target || target.hp <= 0) return;
  if (Math.abs(target.x - tower.x) > TD.TOWER_FIRE.range) return;
  if (now < (tower.nextFireAt || 0)) return;
  tower.nextFireAt = now + TD.TOWER_FIRE.cooldownMs;
  const dir = Math.sign(target.x - tower.x) || 1;
  fireTowerArrow(world, tower.x + dir * (tower.w / 2), -(tower.h - 36), dir, side, Math.round(dmg), target.x, now);
}

// The base is a safe haven: while the hero is near it, it recovers HP and
// stamina (faster when actively sheltering/fleeing). Heal sparkles show it.
let lastHealFxAt = 0;
function applyBaseHeal(dt, now) {
  const h = world.hero;
  if (h.hp <= 0) return;
  const dist = Math.abs(h.x - world.playerTower.x);
  if (dist > TD.HERO.baseHealZone) return;
  if (h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + dt * TD.HERO.baseHealHpPerSec * h.maxHp);
  h.stamina = Math.min(h.maxStamina, h.stamina + dt * TD.HERO.baseHealStamPerSec);
  if (now - lastHealFxAt > 140 && h.hp < h.maxHp) {
    lastHealFxAt = now;
    spawnHealParticles(world.particles, h, world.rng);
  }
}

// Returns true while the hero is down (and not controllable). The hero only
// permanently fails the run if the BASE falls — otherwise they revive at base.
function handleHeroDown(now) {
  const h = world.hero;
  if (h.hp > 0) return false;
  if (!world.heroDownUntil) {
    world.heroDownUntil = now + HERO_RESPAWN_MS;
    spawnClonePoof(world.particles, h, world.rng);
    playSfx('ko');
    world.announce = { text: 'HERO DOWN — HOLD THE LINE', until: now + HERO_RESPAWN_MS };
  }
  if (now >= world.heroDownUntil) {
    world.heroDownUntil = 0;
    h.hp = h.maxHp;
    h.stamina = h.maxStamina;
    h.x = world.playerTower.x + 200;
    h.vx = h.vy = 0;
    h.status = h.status.constructor ? new (h.status.constructor)() : h.status;
    h.pose = 'idle';
    h.currentAttack = null;
    spawnLandingDust(world.particles, h.x, TD.GROUND_Y, 180, world.rng);
    return false;
  }
  return true;
}

// Drive combat sound effects off world state (swings, impacts, landings).
function observeAudio(now) {
  // New hit-effects → impact sounds.
  for (const h of world.hitEffects) {
    if (h._sfx) continue;
    h._sfx = true;
    playSfx(h.crit ? 'crit' : h.heavy ? 'hitHeavy' : 'hit');
  }
  // Attack swings + landings for the hero and every monster.
  const units = [world.hero, ...world.monsters];
  for (const f of units) {
    if (!f) continue;
    const atkId = f.currentAttack ? f.currentAttack.started : 0;
    if (atkId && f._swingSfxId !== atkId) { f._swingSfxId = atkId; playSfx('swing'); }
    const onG = f.onGround();
    if (f._prevOnGround && !onG && (f.vy || 0) < -250) playSfx('jump');
    if (!f._prevOnGround && onG) playSfx('land');
    f._prevOnGround = onG;
  }
}

function decayEffects(dt) {
  world.particles = tickParticles(world.particles, dt);
  world.hitEffects = world.hitEffects.filter(h => { h.t += dt; return h.t < 0.9; });
  world.screenShake *= 0.88;
  if (world.screenShake < 0.5) world.screenShake = 0;
}

// Free, battle-framing camera. Rather than rigidly glue to the hero, it drifts to
// the CENTRE of the action — a weighted average of the hero, the allies, and the
// enemies actually near the fight — so you see the whole engagement. The hero is
// weighted enough to stay in frame, but the view opens up toward wherever the
// fighting is. A soft deadzone keeps it from twitching on every little step.
function updateCamera(dt) {
  let target;
  if (world.hero.hp > 0) {
    let sum = world.hero.x * 1.5, n = 1.5; // hero stays in frame without dominating
    for (const a of world.allies) if (a.hp > 0) { sum += a.x; n++; }
    for (const m of world.monsters) {
      if (m.hp > 0 && Math.abs(m.x - world.hero.x) < 1600) { sum += m.x; n++; } // ignore distant spawns
    }
    target = sum / n;
    // Keep the hero comfortably on screen (view is ~960px each side): the camera
    // may lead toward the action, but never so far it loses our hero.
    const maxLead = 560;
    target = Math.max(world.hero.x - maxLead, Math.min(world.hero.x + maxLead, target));
  } else {
    target = world.playerTower.x; // hero down → watch the base hold the line
  }
  // Soft deadzone: don't chase tiny drifts, so the frame feels loose, not locked.
  if (Math.abs(target - world.camX) > 50) {
    world.camX += (target - world.camX) * Math.min(1, dt * TD.CAMERA_SMOOTH * 0.7);
  }
  const lim = TD.STAGE_HALF - 760;
  world.camX = Math.max(-lim, Math.min(lim, world.camX));
}

function checkEnd() {
  if (world.playerTower.hp <= 0) endGame('lose');           // base fell → defeat
  else if (world._survivedAll) endGame('win');              // outlasted all 20 waves → victory
  else if (world.enemyTower.hp <= 0) endGame('win');        // (or razed the fortress, if you can)
}

function endGame(result) {
  if (world.over) return;
  world.over = result;
  running = false;
  stopMusic();
  playSfx(result === 'win' ? 'skill' : 'ko');
  showOverlay(result);
}

// ── HUD ──────────────────────────────────────────────────────────────────────
const els = {
  baseHp: document.getElementById('baseHp'),
  baseHpVal: document.getElementById('baseHpVal'),
  aegisPips: document.getElementById('aegisPips'),
  enemyHp: document.getElementById('enemyHp'),
  enemyHpVal: document.getElementById('enemyHpVal'),
  heroHp: document.getElementById('heroHp'),
  heroStam: document.getElementById('heroStam'),
  wave: document.getElementById('waveNum'),
  kills: document.getElementById('killNum'),
  gold: document.getElementById('goldNum'),
  announce: document.getElementById('announce'),
  skills: document.getElementById('skills'),
  shopBtn: document.getElementById('shopBtn'),
  shopToast: document.getElementById('shopToast'),
  speedBtn: document.getElementById('speedBtn'),
};

function syncSpeedBtn() {
  if (!els.speedBtn) return;
  els.speedBtn.textContent = (gameSpeed > 1 ? '⏩ ' : '▶ ') + gameSpeed + '×';
  els.speedBtn.classList.toggle('boosted', gameSpeed > 1);
}

// Equipped-skill bar — rebuild when the kit changes (e.g. learned in the shop),
// and refresh each cooldown/availability every frame.
let skillSig = '';
function updateSkillsHud(now) {
  const h = world.hero;
  const skills = h.skills || [];
  const sig = skills.map(s => s.id).join(',');
  if (sig !== skillSig) {
    skillSig = sig;
    els.skills.innerHTML = '';
    for (const s of skills) {
      const d = document.createElement('div');
      d.className = 'skill';
      d.innerHTML = `<div class="sk-cd"></div><span class="sk-name">${SKILL_LABEL[s.id] || s.id}</span><span class="sk-timer"></span>`;
      els.skills.appendChild(d);
    }
  }
  const children = els.skills.children;
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i], d = children[i];
    if (!d) continue;
    const total = (s.cooldownMs || 1000) * (h.skillCooldownMult || 1);
    const rem = Math.min(total, Math.max(0, (h.powerCooldowns[s.id] || 0) - now)); // clamp guards clock skew
    d.querySelector('.sk-cd').style.height = `${Math.min(100, 100 * rem / total)}%`;
    const onCd = rem > 0;
    const ready = !onCd && h.stamina >= TD.HERO.skillStaminaCost && h.hp > 0;
    // Live cooldown countdown in seconds (1 decimal under 10s, whole above).
    const secs = rem / 1000;
    d.querySelector('.sk-timer').textContent = onCd ? (secs >= 10 ? Math.ceil(secs) + 's' : secs.toFixed(1) + 's') : '';
    d.classList.toggle('on-cd', onCd);
    d.classList.toggle('ready', ready);
    d.classList.toggle('charging', !ready);
  }
}

// Shop button + "upgrades available" nudge. The toast fires once each time the
// player crosses from "can't afford anything" to "can afford something" — a
// simple, non-nagging hint rather than a popup after every wave.
let wasAffordable = false;
let toastUntil = 0;
function updateShopHud(now) {
  // When auto-buy is on, the hero handles spending — no nagging. The nudge only
  // appears in manual mode, when the player actually needs to act.
  const manual = !world.autoBuy;
  const affordable = manual && hasAffordable(world);
  const open = isShopOpen();
  if (els.shopBtn) els.shopBtn.classList.toggle('has-deals', affordable && !open);
  if (affordable && !wasAffordable && !open) toastUntil = now + 3200;
  wasAffordable = affordable;
  if (els.shopToast) els.shopToast.classList.toggle('show', now < toastUntil);
}

function updateHUD(now) {
  const pt = world.playerTower, et = world.enemyTower, h = world.hero;
  if (els.baseHp) els.baseHp.style.width = `${100 * pt.hp / pt.maxHp}%`;
  if (els.baseHpVal) els.baseHpVal.textContent = Math.ceil(pt.hp);
  if (els.aegisPips) {
    const total = TD.BASE_AEGIS.charges, left = world.baseCharges;
    const sig = left + '/' + total;
    if (els.aegisPips._sig !== sig) {
      els.aegisPips._sig = sig;
      let s = '';
      for (let i = 0; i < total; i++) s += `<span class="pip${i < left ? '' : ' spent'}">⛨</span>`;
      els.aegisPips.innerHTML = s;
    }
  }
  if (els.enemyHp) els.enemyHp.style.width = `${100 * et.hp / et.maxHp}%`;
  if (els.enemyHpVal) els.enemyHpVal.textContent = Math.ceil(et.hp);
  if (els.heroHp) els.heroHp.style.width = `${100 * Math.max(0, h.hp) / h.maxHp}%`;
  if (els.heroStam) {
    els.heroStam.style.width = `${100 * Math.max(0, h.stamina) / h.maxStamina}%`;
    els.heroStam.style.opacity = h._winded ? '0.55' : '1';
  }
  if (els.wave) els.wave.textContent = world.waveState.wave;
  if (els.kills) els.kills.textContent = world.kills;
  if (els.gold) els.gold.textContent = world.gold;
  if (els.skills) updateSkillsHud(now);
  updateShopHud(now);
  tickShop(world); // keep the (non-pausing) panel live while it's open
  if (els.announce) {
    if (world.announce && now < world.announce.until) {
      els.announce.textContent = world.announce.text;
      els.announce.classList.add('show');
    } else {
      els.announce.classList.remove('show');
    }
  }
}

// ── Overlay ──────────────────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
function showOverlay(result) {
  const title = result === 'win' ? 'VICTORY' : result === 'lose' ? 'BASE LOST' : 'STICK DEFENSE';
  const sub = result === 'win'
    ? `Enemy keep destroyed! ${world.kills} kills.`
    : result === 'lose'
      ? `Survived ${world.waveState.wave} waves · ${world.kills} kills.`
      : 'Defend your base. Smash the enemy keep.';
  overlay.querySelector('.ov-title').textContent = title;
  overlay.querySelector('.ov-sub').textContent = sub;
  overlay.querySelector('.ov-btn').textContent = result ? 'Play Again' : 'Start';
  overlay.classList.add('visible');
}
function hideOverlay() { overlay.classList.remove('visible'); }

overlay.querySelector('.ov-btn').addEventListener('click', start);

// ── Input ────────────────────────────────────────────────────────────────────
// The hero is fully autonomous — the only key is mute.
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') toggleMute();
  if ((e.key === 'b' || e.key === 'B') && world && !world.over) toggleShop(world);
  if (e.key === ' ') { e.preventDefault(); cycleSpeed(); }   // Space cycles 1×→2×→3×
  if (e.key === '1') setSpeed(1);
  if (e.key === '2') setSpeed(2);
  if (e.key === '3') setSpeed(3);
});
els.speedBtn && els.speedBtn.addEventListener('click', cycleSpeed);
syncSpeedBtn();
window.addEventListener('resize', () => viewport.resize());

// Boot
initSetup();        // build the loadout chooser from the shared registries
initShop();         // the optional, non-pausing upgrade panel
// Shop toggle button (open/close any time). The "let hero choose" button spends
// gold the same way the hero does automatically between waves.
els.shopBtn && els.shopBtn.addEventListener('click', () => world && toggleShop(world));
const shopAutoBtn = document.getElementById('shopAuto');
function syncAutoBtn() {
  if (!shopAutoBtn || !world) return;
  shopAutoBtn.textContent = world.autoBuy ? '🤖 Auto-buy: ON' : '✋ Auto-buy: OFF';
  shopAutoBtn.classList.toggle('active', world.autoBuy);
}
shopAutoBtn && shopAutoBtn.addEventListener('click', () => {
  if (!world) return;
  world.autoBuy = !world.autoBuy;
  if (world.autoBuy) nextAutoBuyAt = 0; // buy immediately when re-enabled
  syncAutoBtn();
});
world = newWorld();
syncAutoBtn();
showOverlay(null);
requestAnimationFrame(loop);
