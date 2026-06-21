import { TD } from './config.js';
import { createHero } from './units.js';
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
  if (import.meta.env?.DEV) window.__td = world; // dev-only inspection hook
  running = true;
  nextAutoBuyAt = 0;
  syncAutoBtn();
  hideOverlay();
  resumeAudio();
  startMusic();
}

// ── Main loop ────────────────────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  if (running && world) update(dt, performance.now());
  if (world) viewport.render(world, performance.now());
  requestAnimationFrame(loop);
}

// Dev-only deterministic stepper so the sim can be exercised in headless
// previews where requestAnimationFrame is throttled. No effect in production.
if (import.meta.env?.DEV) {
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
  fireTowers(now);
  updateProjectiles(world, sdt, now);

  // Combat resolution (skip the hero's offence while downed)
  if (!downed) {
    resolveHeroAttacks(world, now);
    resolveHeroVsEnemyTower(world, now);
  }
  resolveMonsterAttacks(world, now);
  reapDead(world);

  maybeAutoBuy(now);
  observeAudio(now);
  decayEffects(dt);
  updateCamera(dt);
  updateHUD(now);
  checkEnd();
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

function updateCamera(dt) {
  const target = world.hero.hp > 0 ? world.hero.x : world.playerTower.x;
  world.camX += (target - world.camX) * Math.min(1, dt * TD.CAMERA_SMOOTH);
  const lim = TD.STAGE_HALF - 760;
  world.camX = Math.max(-lim, Math.min(lim, world.camX));
}

function checkEnd() {
  if (world.enemyTower.hp <= 0) endGame('win');
  else if (world.playerTower.hp <= 0) endGame('lose');
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
};

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
});
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
