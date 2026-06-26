import { TD } from './config.js';
import { createBase } from './towers.js';
import { updateCreep, nearestEnemyCreep } from './ai.js';
import {
  integrate, resolveCreepAttacks, resolveCreepVsBase,
  reapCreeps, separateCreeps, tickRagdolls,
} from './combat.js';
import { updateProjectiles, fireBaseArrow } from './projectiles.js';
import { runEconomy } from './spawner.js';
import { TDViewport, LOGICAL_WIDTH } from './render.js';
import { tickParticles, spawnLandingDust, spawnDashDust } from '../services/particleSystem.js';
import { secureRandom } from '../utils.js';
import { resumeAudio, startMusic, stopMusic, playSfx, toggleMute } from '../services/audio.js';

const canvas = document.getElementById('canvas');
const viewport = new TDViewport(canvas);

let running = false;
let world = null;
let lastTime = performance.now();

function newWorld() {
  return {
    rng: secureRandom,
    creeps: [],
    bases: { L: createBase('L'), R: createBase('R') },
    particles: [],
    projectiles: [],
    hitEffects: [],
    camX: 0,
    zoom: 1,
    screenShake: 0,
    slowMo: 0,
    over: null,        // winning team 'L' | 'R' | 'draw' once decided
    time: 0,
    level: 0,          // slow global ramp so battles escalate and resolve
  };
}

function start() {
  world = newWorld();
  if (import.meta.env?.DEV) window.__td = world;
  running = true;
  hideOverlay();
  resumeAudio();
  startMusic();
}

// ── Game speed (same sub-step model as before) ───────────────────────────────
const SPEEDS = [1, 2, 3];
let gameSpeed = 1;
let gameClock = performance.now();
export function getGameSpeed() { return gameSpeed; }
function cycleSpeed() { gameSpeed = SPEEDS[(SPEEDS.indexOf(gameSpeed) + 1) % SPEEDS.length]; syncSpeedBtn(); }
function setSpeed(n) { if (SPEEDS.includes(n)) { gameSpeed = n; syncSpeedBtn(); } }

function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  if (running && world) {
    for (let i = 0; i < gameSpeed; i++) { gameClock += dt * 1000; update(dt, gameClock); }
  } else {
    gameClock += dt * 1000;
  }
  if (world) viewport.render(world, gameClock);
  requestAnimationFrame(loop);
}

function update(dt, now) {
  if (world.over) { decayEffects(dt); return; }

  const slow = world.slowMo > 0 ? 0.35 : 1;
  if (world.slowMo > 0) world.slowMo -= dt * 1000;
  const sdt = dt * slow;

  world.time += dt;
  world.level = Math.floor(world.time / 30); // every 30s the next creeps get a touch stronger

  tickRagdolls(world, sdt, now);
  runEconomy(world, dt, now);

  for (const c of world.creeps) {
    if (c.hp <= 0) continue;
    const wasAir = c.y < -6;
    updateCreep(c, world, sdt, now);
    c.update(sdt, now);
    integrate(c, sdt);
    if (c.needsDashDust) { spawnDashDust(world.particles, c.x, TD.GROUND_Y, c.facing, world.rng); c.needsDashDust = false; }
    if (wasAir && c.y >= -1) spawnLandingDust(world.particles, c.x, TD.GROUND_Y, 90, world.rng);
  }
  separateCreeps(world);

  fireBases(now);
  updateProjectiles(world, sdt, now);

  resolveCreepAttacks(world, now);
  resolveCreepVsBase(world, now);
  reapCreeps(world, now);

  observeAudio(now);
  decayEffects(dt);
  updateCamera(dt);
  updateHUD();
  checkEnd();
}

// Both bases auto-fire arrows at the nearest enemy creep in range.
function fireBases(now) {
  const F = TD.BASE_FIRE;
  for (const team of ['L', 'R']) {
    const base = world.bases[team];
    if (base.hp <= 0 || now < (base.nextFireAt || 0)) continue;
    const tgt = nearestEnemyCreep(world, team, base.x);
    if (!tgt || Math.abs(tgt.x - base.x) > F.range) continue;
    base.nextFireAt = now + F.cooldownMs;
    fireBaseArrow(world, base, tgt, now);
  }
}

function observeAudio(now) {
  for (const h of world.hitEffects) {
    if (h._sfx) continue;
    h._sfx = true;
    if (h.dmg > 0 || h.heavy) playSfx(h.heavy ? 'hitHeavy' : 'hit');
  }
  for (const c of world.creeps) {
    const atkId = c.currentAttack ? c.currentAttack.started : 0;
    if (atkId && c._swingSfxId !== atkId) { c._swingSfxId = atkId; playSfx('swing'); }
  }
}

function decayEffects(dt) {
  world.particles = tickParticles(world.particles, dt);
  world.hitEffects = world.hitEffects.filter(h => { h.t += dt; return h.t < 0.9; });
  world.screenShake *= 0.88;
  if (world.screenShake < 0.5) world.screenShake = 0;
}

const camClamp = (x) => { const lim = TD.STAGE_HALF - 760; return Math.max(-lim, Math.min(lim, x)); };

// Free camera: drift to the centre of mass of the fighting, draggable by the player.
function updateCamera(dt) {
  const now = performance.now();
  if (camDragging) return;
  if (Math.abs(camVel) > 0.4 || now < camManualUntil) {
    world.camX = camClamp(world.camX + camVel);
    camVel *= 0.88;
    if (Math.abs(camVel) < 0.4) camVel = 0;
    return;
  }
  let sum = 0, n = 0;
  for (const c of world.creeps) if (c.hp > 0 && c.role !== 'miner') { sum += c.x; n++; }
  const target = n ? sum / n : 0;
  if (Math.abs(target - world.camX) > 50) {
    world.camX += (target - world.camX) * Math.min(1, dt * TD.CAMERA_SMOOTH * 0.7);
  }
  world.camX = camClamp(world.camX);
}

function checkEnd() {
  const L = world.bases.L.hp, R = world.bases.R.hp;
  if (L > 0 && R > 0) return;
  endGame(L <= 0 && R <= 0 ? 'draw' : L <= 0 ? 'R' : 'L');
}

function endGame(result) {
  if (world.over) return;
  world.over = result;
  running = false;
  stopMusic();
  playSfx(result === 'draw' ? 'ko' : 'skill');
  showOverlay(result);
}

// ── HUD ──────────────────────────────────────────────────────────────────────
const els = {
  hpL: document.getElementById('hpL'), hpR: document.getElementById('hpR'),
  hpLVal: document.getElementById('hpLVal'), hpRVal: document.getElementById('hpRVal'),
  goldL: document.getElementById('goldL'), goldR: document.getElementById('goldR'),
  killsL: document.getElementById('killsL'), killsR: document.getElementById('killsR'),
  countL: document.getElementById('countL'), countR: document.getElementById('countR'),
  announce: document.getElementById('announce'),
  speedBtn: document.getElementById('speedBtn'),
};

function syncSpeedBtn() {
  if (!els.speedBtn) return;
  els.speedBtn.textContent = (gameSpeed > 1 ? '⏩ ' : '▶ ') + gameSpeed + '×';
  els.speedBtn.classList.toggle('boosted', gameSpeed > 1);
}

function teamCount(team) { let n = 0; for (const c of world.creeps) if (c.hp > 0 && c.team === team) n++; return n; }

function updateHUD() {
  const L = world.bases.L, R = world.bases.R;
  if (els.hpL) els.hpL.style.width = `${100 * Math.max(0, L.hp) / L.maxHp}%`;
  if (els.hpR) els.hpR.style.width = `${100 * Math.max(0, R.hp) / R.maxHp}%`;
  if (els.hpLVal) els.hpLVal.textContent = Math.ceil(Math.max(0, L.hp));
  if (els.hpRVal) els.hpRVal.textContent = Math.ceil(Math.max(0, R.hp));
  if (els.goldL) els.goldL.textContent = Math.floor(L.gold);
  if (els.goldR) els.goldR.textContent = Math.floor(R.gold);
  if (els.killsL) els.killsL.textContent = L.kills;
  if (els.killsR) els.killsR.textContent = R.kills;
  if (els.countL) els.countL.textContent = teamCount('L');
  if (els.countR) els.countR.textContent = teamCount('R');
}

// ── Overlay ──────────────────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
function showOverlay(result) {
  const title = !result ? 'STICK WARS'
    : result === 'draw' ? 'MUTUAL DESTRUCTION'
    : (result === 'L' ? 'BLUE WINS' : 'RED WINS');
  const sub = result
    ? `${world.bases.L.kills} vs ${world.bases.R.kills} kills · ${Math.floor(world.time)}s`
    : 'Two AI bases. Endless gold. Watch them fight.';
  overlay.querySelector('.ov-title').textContent = title;
  overlay.querySelector('.ov-sub').textContent = sub;
  overlay.querySelector('.ov-btn').textContent = result ? 'Battle Again' : 'Start Battle';
  overlay.classList.add('visible');
}
function hideOverlay() { overlay.classList.remove('visible'); }
overlay.querySelector('.ov-btn').addEventListener('click', start);

// ── Input ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') toggleMute();
  if (e.key === ' ') { e.preventDefault(); cycleSpeed(); }
  if (e.key === '1') setSpeed(1);
  if (e.key === '2') setSpeed(2);
  if (e.key === '3') setSpeed(3);
});
els.speedBtn && els.speedBtn.addEventListener('click', cycleSpeed);
syncSpeedBtn();
window.addEventListener('resize', () => viewport.resize());

// ── Free camera: drag to pan ──────────────────────────────────────────────────
let camDragging = false, camLastX = 0, camVel = 0, camManualUntil = 0, camMoved = false;
const worldPerPx = () => LOGICAL_WIDTH / (window.innerWidth * ((world && world.zoom) || 1));
function camPanStart(clientX) { camDragging = true; camLastX = clientX; camVel = 0; camMoved = false; }
function camPanMove(clientX) {
  if (!camDragging || !world) return;
  const dxPx = clientX - camLastX;
  if (Math.abs(dxPx) > 1) camMoved = true;
  const dxWorld = dxPx * worldPerPx();
  camLastX = clientX;
  world.camX = camClamp(world.camX - dxWorld);
  camVel = camVel * 0.5 - dxWorld * 0.5;
  camVel = Math.max(-90, Math.min(90, camVel));
}
function camPanEnd() {
  if (!camDragging) return;
  camDragging = false;
  if (camMoved) camManualUntil = performance.now() + 3500;
  else camVel = 0;
}
canvas.addEventListener('pointerdown', (e) => camPanStart(e.clientX));
window.addEventListener('pointermove', (e) => camPanMove(e.clientX));
window.addEventListener('pointerup', camPanEnd);
window.addEventListener('pointercancel', camPanEnd);

// Boot
world = newWorld();
showOverlay(null);
requestAnimationFrame(loop);
