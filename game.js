import { Fighter } from './entities/fighter.js';
import { ARENA, RENDER, EFFECT_DURATION } from './config/constants.js';
import { tickParticles, spawnHealParticles, spawnFireballLaunch, spawnClonePoof, spawnShinraTensei, spawnLightningCutter, spawnEarthDust, spawnVortex, spawnFrost, spawnDragonFire, spawnSpectralTrail, spawnDashDust, spawnLandingDust } from './services/particleSystem.js';
import { updateHUD } from './services/hud.js';
import { World } from './engine/core/World.js';
import { Viewport } from './engine/view/Viewport.js';
import { loadSettings, saveSettings } from './ai/presets.js';
import { STAT, clampStat } from './config/stats.js';
import { spawnRandomObstacle, ENV } from './config/environment.js';
import { secureRandom } from './utils.js';
import { getRagdollOriginY } from './core/coordinates.js';
import { createRagdoll, updateRagdoll } from './engine/ragdoll.js';
import { getSpawnEffect } from './entities/powers/index.js';
import { POWERS } from './entities/powers.js';

import { CombatSystem } from './engine/systems/CombatSystem.js';
import { PhysicsSystem } from './engine/systems/PhysicsSystem.js';
import { AISystem } from './engine/systems/AISystem.js';
import { AZURE_ASSASSIN } from './ai/monsters.js';
import { UIManager } from './services/UIManager.js';

// 1. Initialization
const world = new World();
const canvas = document.getElementById('canvas');
const viewport = new Viewport(canvas);

// Systems
const combatSystem = new CombatSystem();
const physicsSystem = new PhysicsSystem();
const aiSystem = new AISystem();

// UI Elements & State
const hudEls = {
  hp1: document.getElementById('hp1'),
  hp2: document.getElementById('hp2'),
  stam1: document.getElementById('stam1'),
  stam2: document.getElementById('stam2'),
  rounds: document.getElementById('rounds'),
  statusIcons1: document.getElementById('statusIcons1'),
  statusIcons2: document.getElementById('statusIcons2'),
  aiState1: document.getElementById('aiState1'),
  aiState2: document.getElementById('aiState2'),
  aiLevel1: document.getElementById('hudAiLevel1'),
  health1: document.getElementById('hudHealth1'),
  health2: document.getElementById('hudHealth2'),
};
const matchOverEl = document.getElementById('matchOver');
const countdownEl = document.getElementById('countdown');

let lastTime = 0;
// Two 1–20 levels per fighter (see config/stats.js): power drives HP/damage/
// defense, intelligence drives the AI brain. Both hero and monster are editable.
const STAT_KEYS = ['power', 'intelligence'];
const heroStats = { power: STAT.DEFAULT, intelligence: STAT.DEFAULT };
const monsterStats = { power: AZURE_ASSASSIN.power, intelligence: AZURE_ASSASSIN.intelligence };
let running = false;
let skillFeed = [];
let koSlowMo = 0;
let lastObstacleSpawnAt = 0;
let uiManager;

const MAX_ROUNDS = 3;
const CAMERA_SMOOTH = 7.5;
const MAX_HIT_EFFECT_T = (h) => h.heal ? EFFECT_DURATION.HEAL : (h.shinra || h.lightning || h.fire) ? EFFECT_DURATION.SKILL : h.clash ? EFFECT_DURATION.CLASH : EFFECT_DURATION.HIT;

const SPAWN_EFFECTS = {
  heal: (f) => spawnHealParticles(world.particles, f, secureRandom),
  fireball: (f) => spawnFireballLaunch(world.particles, f, secureRandom),
  clone: (f) => spawnClonePoof(world.particles, f, secureRandom),
  earth: (f) => spawnEarthDust(world.particles, f.x + f.facing * 85, 810, secureRandom),
  ice: (f) => spawnFrost(world.particles, f.x + f.facing * 60, 810, secureRandom),
  spectral: (f) => spawnSpectralTrail(world.particles, f.x, 810, secureRandom)
};

// 2. Helper Functions
function getSelectedPowerIds(containerId) {
  return [...document.querySelectorAll(`#${containerId} .power-btn.selected`)].map(b => b.dataset.power);
}

// Both fighters share one slider convention: <key>1 = hero, <key>2 = monster.
const statsFor = (suffix) => (suffix === 1 ? heroStats : monsterStats);

// Read the Power/Intelligence sliders for one fighter into its stats object.
function readStatsFromUI(suffix) {
  const stats = statsFor(suffix);
  STAT_KEYS.forEach(key => {
    const el = document.getElementById(`${key}${suffix}`);
    if (el) stats[key] = clampStat(el.value, stats[key]);
  });
  updateStatHud(suffix);
}

// Push a stats object back onto its sliders + value labels.
function applyStatsToUI(suffix) {
  const stats = statsFor(suffix);
  STAT_KEYS.forEach(key => {
    const slider = document.getElementById(`${key}${suffix}`);
    const valEl = document.getElementById(`${key}Val${suffix}`);
    if (slider) slider.value = stats[key];
    if (valEl) valEl.textContent = stats[key];
  });
  updateStatHud(suffix);
}

function updateStatHud(suffix) {
  const stats = statsFor(suffix);
  const lvlEl = document.getElementById(`hudLevel${suffix}`);
  if (lvlEl) lvlEl.textContent = `PWR ${stats.power}`;
  const intEl = document.getElementById(`hudAiLevel${suffix}`);
  if (intEl) intEl.textContent = `INT ${stats.intelligence}`;
  const fighter = suffix === 1 ? world.fighter1 : world.fighter2;
  if (fighter) fighter.setStats(stats);
}

function syncPowersFromUI() {
  const p1 = getSelectedPowerIds('powers1');
  const p2 = getSelectedPowerIds('powers2');
  if (world.fighter1) world.fighter1.setPowers(p1);
  if (world.fighter2) world.fighter2.setPowers(p2);
}

function persistSettings() {
  saveSettings({
    power: heroStats.power,
    intelligence: heroStats.intelligence,
    monsterPower: monsterStats.power,
    monsterIntelligence: monsterStats.intelligence,
    gameSpeed: world.gameSpeed || 1,
    powers1: getSelectedPowerIds('powers1'),
    monsterPowers: getSelectedPowerIds('powers2'),
  });
}

function getCameraX() {
  if (!world.fighter1) return 0;
  if (!world.fighter2) return world.fighter1.x;
  return (world.fighter1.x + world.fighter2.x) / 2;
}

function updateSmoothCamera(dt) {
  const targetX = getCameraX();
  world.smoothCamX += (targetX - world.smoothCamX) * dt * CAMERA_SMOOTH;
  world.smoothCamX = Math.max(-ARENA.BOUNDS + 480, Math.min(ARENA.BOUNDS - 480, world.smoothCamX));

  // Dynamic zoom: tighten when fighters are close for dramatic close-ups
  if (world.fighter1 && world.fighter2) {
    const dist = Math.abs(world.fighter1.x - world.fighter2.x);
    const targetZoom = dist < 150 ? 1.06 : dist < 300 ? 1.03 : 1.0;
    world.dynamicZoom = world.dynamicZoom || 1.0;
    world.dynamicZoom += (targetZoom - world.dynamicZoom) * dt * 3.5;
  }
}

function updateRoundState(now, dt) {
  if (world.roundState !== 'countdown') return;
  world.roundCountdown -= dt;
  if (world.roundCountdown <= 0) {
    world.roundState = 'fighting';
    countdownEl?.classList.remove('visible');
    world.fighter1?.resetForRound(-ARENA.START_OFFSET, 1);
    world.fighter2?.resetForRound(ARENA.START_OFFSET, -1);
    world.smoothCamX = getCameraX();
  }
}

function handleRoundEndTransition(now, dt) {
  koSlowMo = 0.4;
  const rw = world.fighter1.hp <= 0 ? 2 : 1;
  world.roundHistory.push(rw);
  const loser = world.fighter1.hp <= 0 ? world.fighter1 : world.fighter2;
  const winner = world.fighter1.hp <= 0 ? world.fighter2 : world.fighter1;
  const rd = createRagdoll(loser.x, getRagdollOriginY(loser), loser.facing, loser.vx, loser.vy, null, false, now, Math.max(0.016, dt));
  world.activeRagdolls = [{ ragdoll: rd, color: loser.color }];
  // Stop winner
  winner.vx = 0;
  winner.vy = 0;
  loser.poseHistory = [];
  loser.attackTrail = [];
  world.ragdollPhase = 1.8;
  world.pendingRoundEnd = { roundWinner: rw, winner: winner };
}

function handleRagdollPhase(world, dt, scaledDt, now) {
  if (koSlowMo > 0) koSlowMo -= dt;
  const slowMult = koSlowMo > 0 ? 0.28 : 1;
  const ragdollDt = scaledDt * slowMult;

  world.ragdollPhase -= ragdollDt;
  world.activeRagdolls.forEach(r => updateRagdoll(r.ragdoll, ragdollDt, now));

  // Sync loser position for camera/HUD/effects
  const loser = world.pendingRoundEnd?.roundWinner === 1 ? world.fighter2 : world.fighter1;
  if (loser && world.activeRagdolls[0]) {
    const pelvis = world.activeRagdolls[0].ragdoll.points[2];
    loser.x = pelvis.x;
    loser.y = pelvis.y - 810;
    const safeDt = Math.max(0.001, ragdollDt);
    loser.vx = (pelvis.x - pelvis.prevX) / safeDt;
    loser.vy = (pelvis.y - pelvis.prevY) / safeDt;
  }

  if (world.ragdollPhase <= 0) applyPendingRoundEnd();

  world.hitEffects = world.hitEffects.filter(h => { h.t += dt; return h.t < MAX_HIT_EFFECT_T(h); });
  world.particles = tickParticles(world.particles, dt);
  world.screenShake *= 0.91;
  updateSmoothCamera(scaledDt);
  updateHUD(world.fighter1, world.fighter2, hudEls, MAX_ROUNDS, skillFeed);
}

function applyPendingRoundEnd() {
  const { roundWinner, winner } = world.pendingRoundEnd;
  world.pendingRoundEnd = null;
  world.projectiles = [];
  world.clones = [];

  if (winner.roundsWon >= 2) {
    running = false;
    const d1 = world.fighter1.damageDealt || 0;
    const roundsText = world.roundHistory.map((rw, i) => `R${i + 1}: ${rw === 1 ? 'Hero' : AZURE_ASSASSIN.name}`).join(' · ');
    matchOverEl.innerHTML = `<div class="match-over-inner"><div class="match-over-title">${roundWinner === 1 ? 'Hero' : AZURE_ASSASSIN.name} Victory!</div><div class="match-over-sub">Best of 3</div><div class="match-over-rounds">${roundsText}</div><div class="match-over-stats">Total Damage: ${Math.round(d1)}</div><button type="button" class="match-over-replay" id="matchOverReplay">Back to Setup</button></div>`;
    matchOverEl.classList.add('visible');
    document.getElementById('matchOverReplay')?.addEventListener('click', () => fullReset());
  } else {
    world.roundState = 'countdown';
    world.roundCountdown = 2.5;
    if (countdownEl) {
      countdownEl.textContent = 'ROUND ' + (world.roundHistory.length + 1);
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

function createFighters() {
  const color1 = document.getElementById('color1')?.value || '#3db8d4';

  world.fighter1 = new Fighter(0, color1, -ARENA.START_OFFSET, 1);
  world.fighter1.setStats(heroStats);

  // Initialize Monster (power/intelligence overridable, other traits fixed)
  const m = AZURE_ASSASSIN;
  world.fighter2 = new Fighter(1, m.color, ARENA.START_OFFSET, -1);
  world.fighter2.setPowers(getSelectedPowerIds('powers2'));
  world.fighter2.setStats(monsterStats);
  world.fighter2.passives = m.passives || [];
  world.fighter2.scale = m.scale || 1;

  world.fighters = [world.fighter1, world.fighter2];

  updateStatHud(1);
  updateStatHud(2);
  syncPowersFromUI();
}

function applySettings(settings) {
  heroStats.power = clampStat(settings.power, heroStats.power);
  heroStats.intelligence = clampStat(settings.intelligence, heroStats.intelligence);
  monsterStats.power = clampStat(settings.monsterPower, AZURE_ASSASSIN.power);
  monsterStats.intelligence = clampStat(settings.monsterIntelligence, AZURE_ASSASSIN.intelligence);
  applyStatsToUI(1);
  applyStatsToUI(2);
  world.gameSpeed = settings.gameSpeed || 1;

  uiManager?.buildPowerButtons('powers1', POWERS, settings.powers1, (wrap) => {
    if (running) syncPowersFromUI();
    uiManager.updatePowerCount(wrap);
    persistSettings();
  });
  uiManager?.buildPowerButtons('powers2', POWERS, settings.monsterPowers || AZURE_ASSASSIN.powers, (wrap) => {
    if (running) syncPowersFromUI();
    uiManager.updatePowerCount(wrap);
    persistSettings();
  });

  const speedEl = document.getElementById('gameSpeed');
  if (speedEl) speedEl.value = settings.gameSpeed || 1;

  const passivesEl = document.getElementById('monsterPassives');
  if (passivesEl) passivesEl.textContent = (AZURE_ASSASSIN.passives || []).join(', ') || 'none';
}

function initUI() {
  uiManager = new UIManager({
    onHeroConfirmed: () => {
      readStatsFromUI(1);
      persistSettings();
    },
    onStart: () => {
      if (running) return;
      readStatsFromUI(1);
      readStatsFromUI(2);
      persistSettings();
      matchOverEl?.classList.remove('visible');
      countdownEl?.classList.remove('visible');
      world.clearTransientState();
      world.roundHistory = [];
      skillFeed = [];
      lastObstacleSpawnAt = performance.now(); // first obstacle ~MIN_SPAWN_GAP later
      createFighters();
      running = true;
      world.roundState = 'fighting';
    },
    onReset: () => fullReset(),
    onSettingsChange: () => persistSettings(),
    onStatChange: (suffix) => { readStatsFromUI(suffix); persistSettings(); },
    onSpeedChange: (speed) => {
      world.gameSpeed = speed;
      uiManager.updateSpeedUI(speed);
      persistSettings();
    }
  });
  const saved = loadSettings();
  applySettings(saved);

  uiManager.showInitialFlow();
  uiManager.updateSpeedUI(world.gameSpeed);
}

function fullReset() {
  running = false;
  world.reset();
  matchOverEl?.classList.remove('visible');
  countdownEl?.classList.remove('visible');
  if (hudEls.rounds) hudEls.rounds.textContent = '0 - 0 | R1/3';
  uiManager.showInitialFlow();
  const saved = loadSettings();
  applySettings(saved);
  uiManager.updateSpeedUI(saved.gameSpeed);
}


// Periodically drop a fresh random obstacle into the arena (smart placement +
// count cap live in spawnRandomObstacle / ENV).
function maybeSpawnEnvironment(now) {
  if (world.roundState !== 'fighting') return;
  if (now - lastObstacleSpawnAt < ENV.MIN_SPAWN_GAP_MS) return;
  lastObstacleSpawnAt = now;
  if (secureRandom() > ENV.SPAWN_CHANCE) return;
  const o = spawnRandomObstacle(world, secureRandom, now);
  if (o) spawnEarthDust(world.particles, o.x, 810, secureRandom); // dust puff as it rises
}

// 3. Main Loop
function update(dt) {
  const now = performance.now();

  if (world.hitStopRemaining > 0) {
    world.hitStopRemaining = Math.max(0, world.hitStopRemaining - dt * 1000);
    world.hitEffects = world.hitEffects.filter(h => { h.t += dt; return h.t < MAX_HIT_EFFECT_T(h); });
    world.particles = tickParticles(world.particles, dt);
    world.screenShake *= 0.92;
    if (world.screenShake < 0.5) world.screenShake = 0;
    return;
  }

  const scaledDt = dt * world.gameSpeed;
  if (world.roundState === 'countdown') {
    updateRoundState(now, scaledDt);
    if (world.fighter1 && world.fighter2) updateSmoothCamera(scaledDt);
    return;
  }
  if (!running || !world.fighter1 || !world.fighter2) return;

  if (world.ragdollPhase > 0) {
    handleRagdollPhase(world, dt, scaledDt, now);
    return;
  }

  // Simulation

  world.fighter1.update(scaledDt, now);
  world.fighter2.update(scaledDt, now);

  // Movement Visuals
  [world.fighter1, world.fighter2].forEach(f => {
    if (f.needsDashDust) {
      spawnDashDust(world.particles, f.x, 810, f.facing, secureRandom);
      f.needsDashDust = false;
    }
    if (f.needsLandingDust) {
      spawnLandingDust(world.particles, f.x, 810, 100, secureRandom);
      f.needsLandingDust = false;
    }
  });

  aiSystem.update(world, dt, now, secureRandom, skillFeed, SPAWN_EFFECTS, getSpawnEffect);
  combatSystem.update(world, dt, now, secureRandom);
  physicsSystem.update(world, dt, now, secureRandom);
  maybeSpawnEnvironment(now);

  // Effects & HUD
  world.particles = tickParticles(world.particles, dt);
  world.hitEffects.forEach(h => { h.t += dt; });
  world.hitEffects = world.hitEffects.filter(h => h.t < MAX_HIT_EFFECT_T(h));
  world.screenShake *= 0.88;
  if (world.screenShake < 0.5) world.screenShake = 0;
  world.hitZoom = world.hitZoom * (RENDER.ZOOM_DECAY ?? 0.92) + (1 - (RENDER.ZOOM_DECAY ?? 0.92));
  if (world.hitZoom > 0.998) world.hitZoom = 1;

  updateSmoothCamera(scaledDt);
  updateHUD(world.fighter1, world.fighter2, hudEls, MAX_ROUNDS, skillFeed);

  if (world.fighter1.hp <= 0 || world.fighter2.hp <= 0) {
    handleRoundEndTransition(now, scaledDt);
  }
}

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;
  update(dt);
  viewport.render(world, performance.now());
  requestAnimationFrame(gameLoop);
}

// 4. Initialization Start
initUI();
window.addEventListener('resize', () => viewport.resize());
lastTime = performance.now();
requestAnimationFrame(gameLoop);
