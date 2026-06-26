import { TD, battlePhase } from './config.js';
import { aliveByX } from './spatial.js';
import { createBase } from './towers.js';
import { updateCreep } from './ai.js';
import {
  integrate, resolveCreepAttacks, resolveCreepVsBase,
  reapCreeps, separateCreeps, tickRagdolls, tickGrapples, tickAirBalance, tickBowler, tickFlyerLandings,
} from './combat.js';
import { updateProjectiles } from './projectiles.js';
import { runEconomy, refreshBaseHud } from './spawner.js';
import { initEvents, tickEvents } from './events.js';
import { tickBaseDefense } from './skills.js';
import { initGoldNodes } from './gold.js';
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
  const rng = secureRandom;
  const w = {
    rng,
    creeps: [],
    bases: { L: createBase('L', rng), R: createBase('R', rng) },
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
    activeBuffs: { L: {}, R: {} },
    eventLog: [],
  };
  initEvents(w);
  initGoldNodes(w);
  w._announce = announce;
  return w;
}

function start() {
  world = newWorld();
  world.camManual = false;
  camVel = 0;
  if (import.meta.env?.DEV) window.__td = world;
  running = true;
  hideOverlay();
  syncAutoCamBtn();
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
  aliveByX(world.creeps, world._aliveByX || (world._aliveByX = []));

  tickEvents(world, dt);
  tickRagdolls(world, sdt, now);
  runEconomy(world, dt, now);

  for (const c of world.creeps) {
    if (c.hp <= 0) continue;
    const wasAir = c.y < -6;
    updateCreep(c, world, sdt, now);
    c.update(sdt, now);
    integrate(c, sdt, now);
    if (c.needsDashDust) { spawnDashDust(world.particles, c.x, TD.GROUND_Y, c.facing, world.rng); c.needsDashDust = false; }
    if (wasAir && c.y >= -1) spawnLandingDust(world.particles, c.x, TD.GROUND_Y, 90, world.rng);
  }
  tickGrapples(world, now);
  tickFlyerLandings(world, now);
  tickAirBalance(world, sdt, now);
  tickBowler(world, now);
  separateCreeps(world);

  tickBaseDefense(world, now);
  updateProjectiles(world, sdt, now);

  resolveCreepAttacks(world, now);
  resolveCreepVsBase(world, now);
  reapCreeps(world, now);

  observeAudio(now);
  decayEffects(dt);
  updateCamera(dt, now);
  if (!world._hudAt || now - world._hudAt > 100) { updateHUD(); world._hudAt = now; }
  checkEnd();
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
  tickParticles(world.particles, dt);
  let n = 0;
  const fx = world.hitEffects;
  for (let i = 0; i < fx.length; i++) {
    fx[i].t += dt;
    if (fx[i].t < 0.9) fx[n++] = fx[i];
  }
  fx.length = n;
  if (fx.length > 48) fx.splice(0, fx.length - 48);
  world.screenShake *= 0.88;
  if (world.screenShake < 0.5) world.screenShake = 0;
}

const CAM_HALF = LOGICAL_WIDTH / 2;

function camClamp(x, zoom = 1) {
  const half = CAM_HALF / Math.max(0.75, zoom);
  // ponytail: old lim (STAGE_HALF - CAM_HALF) stranded base sieges on screen edges
  const lim = TD.STAGE_HALF - half * 0.1;
  return Math.max(-lim, Math.min(lim, x));
}

// Frame the hottest fight cluster — not a global average that sits in empty mid-lane.
function fightFrame(world) {
  const cs = world._aliveByX?.length
    ? world._aliveByX.filter(c => c.role !== 'miner')
    : world.creeps.filter(c => c.hp > 0 && c.role !== 'miner');
  if (!cs.length) return { x: 0, spread: 1100 };

  let best = null, bestScore = 0;
  for (const c of cs) {
    let score = 0, minX = c.x, maxX = c.x;
    for (const o of cs) {
      if (o.team === c.team) continue;
      const d = Math.abs(o.x - c.x);
      if (d > 720) continue;
      score += 1.2 + (720 - d) / 420;
      minX = Math.min(minX, o.x, c.x);
      maxX = Math.max(maxX, o.x, c.x);
    }
    if (score > bestScore) {
      bestScore = score;
      best = { minX, maxX, x: (minX + maxX) * 0.5, spread: maxX - minX + (TD.CAMERA_FRAME_PAD ?? 380) };
    }
  }
  if (best) return best;

  let minX = cs[0].x, maxX = cs[0].x;
  for (const c of cs) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); }
  return { x: (minX + maxX) * 0.5, spread: Math.max(520, maxX - minX + 520) };
}

function updateCamera(dt, now) {
  if (camDragging) return;
  const zoom = world.zoom || 1;
  if (Math.abs(camVel) > 0.4) {
    world.camX = camClamp(world.camX + camVel, zoom);
    camVel *= 0.88;
    if (Math.abs(camVel) < 0.4) camVel = 0;
    return;
  }
  if (world.camManual) return;

  const frame = fightFrame(world);
  world._camFocus = frame.x;
  world._camSpread = frame.spread;
  let target = frame.x;
  const peek = world.camPeek;
  if (peek && world.time < peek.until) {
    const blend = 0.4 * (peek.until - world.time) / (peek.dur || 2.6);
    target = target * (1 - blend) + peek.x * blend;
  } else if (peek) world.camPeek = null;

  const targetZoom = Math.min(
    TD.CAMERA_ZOOM_MAX ?? 1.26,
    Math.max(TD.CAMERA_ZOOM_MIN ?? 0.78, (LOGICAL_WIDTH * 0.82) / frame.spread),
  );
  world.zoom = (world.zoom || 1) + (targetZoom - (world.zoom || 1)) * Math.min(1, dt * 10);

  const dist = Math.abs(target - world.camX);
  const chase = dist > 520 ? (TD.CAMERA_SMOOTH ?? 9) * 2.2 : (TD.CAMERA_SMOOTH ?? 9);
  world.camX += (target - world.camX) * Math.min(1, dt * chase);
  world.camX = camClamp(world.camX, world.zoom || 1);
}

function checkEnd() {
  const L = world.bases.L.hp, R = world.bases.R.hp;
  if (L <= 0 || R <= 0) {
    endGame(L <= 0 && R <= 0 ? 'draw' : L <= 0 ? 'R' : 'L');
  }
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
  modeL: document.getElementById('modeL'), modeR: document.getElementById('modeR'),
  planL: document.getElementById('planL'), planR: document.getElementById('planR'),
  lastL: document.getElementById('lastL'), lastR: document.getElementById('lastR'),
  picksL: document.getElementById('picksL'), picksR: document.getElementById('picksR'),
  ticker: document.getElementById('eventTicker'),
  announce: document.getElementById('announce'),
  speedBtn: document.getElementById('speedBtn'),
  autoCamBtn: document.getElementById('autoCamBtn'),
};

let announceTimer = 0;
function announce(text, ms = 2400) {
  if (!els.announce) return;
  els.announce.textContent = text;
  els.announce.classList.add('show');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => els.announce.classList.remove('show'), ms);
}

function syncSpeedBtn() {
  if (!els.speedBtn) return;
  els.speedBtn.textContent = (gameSpeed > 1 ? '⏩ ' : '▶ ') + gameSpeed + '×';
  els.speedBtn.classList.toggle('boosted', gameSpeed > 1);
}

function syncAutoCamBtn() {
  if (!els.autoCamBtn || !world) return;
  els.autoCamBtn.hidden = !world.camManual;
  els.autoCamBtn.classList.toggle('cam-manual', world.camManual);
}

function enableAutoCam() {
  if (!world) return;
  world.camManual = false;
  camVel = 0;
  syncAutoCamBtn();
}

function teamCount(team) { let n = 0; for (const c of world.creeps) if (c.hp > 0 && c.team === team) n++; return n; }

const MODE_CLASS = { DEFEND: 'mode-def', BUILD: 'mode-build', PUSH: 'mode-push', GROW: 'mode-grow', BANK: 'mode-bank', BROKE: 'mode-broke', FULL: 'mode-full', DOWN: 'mode-down' };

function renderBaseHud(team, prefix) {
  refreshBaseHud(world, team, performance.now());
  const base = world.bases[team];
  const h = base.aiHud || {};
  const modeEl = els[`mode${prefix}`];
  const planEl = els[`plan${prefix}`];
  const lastEl = els[`last${prefix}`];
  const picksEl = els[`picks${prefix}`];
  if (modeEl) {
    modeEl.textContent = h.mode || '—';
    modeEl.className = 'aimode ' + (MODE_CLASS[h.mode] || '');
  }
  if (planEl) planEl.textContent = h.plan || '';
  if (lastEl) lastEl.textContent = h.last ? `Last: ${h.last}` : '';
  if (picksEl) {
    const picks = (h.top || []).map(p => `${p.name} ${p.pct}%`).join(' · ');
    picksEl.textContent = picks ? `Next roll: ${picks}` : (h.nextIn ? `Decide in ${h.nextIn}` : '');
  }
}

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
  renderBaseHud('L', 'L');
  renderBaseHud('R', 'R');
  if (els.ticker) {
    const phase = battlePhase(world.level || 0);
    const ev = world.eventLog?.length ? world.eventLog[world.eventLog.length - 1].text : '';
    els.ticker.textContent = ev ? `${phase} · ${ev}` : `${phase} · ${Math.floor(world.time)}s`;
  }
}

// ── Overlay ──────────────────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
function showOverlay(result) {
  const title = !result ? 'STICK WARS'
    : result === 'draw' ? 'MUTUAL DESTRUCTION'
    : (result === 'L' ? 'BLUE WINS' : 'RED WINS');
  const sub = result
    ? `${world.bases.L.kills} vs ${world.bases.R.kills} kills · ${Math.floor(world.time)}s`
    : 'Mine the lane. Counter-build. Events decide the rest.';
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
els.autoCamBtn && els.autoCamBtn.addEventListener('click', enableAutoCam);
syncSpeedBtn();
syncAutoCamBtn();
window.addEventListener('resize', () => viewport.resize());

// ── Free camera: drag to pan ──────────────────────────────────────────────────
let camDragging = false, camLastX = 0, camVel = 0, camMoved = false;
const worldPerPx = () => LOGICAL_WIDTH / (window.innerWidth * ((world && world.zoom) || 1));
function camPanStart(clientX) { camDragging = true; camLastX = clientX; camVel = 0; camMoved = false; }
function camPanMove(clientX) {
  if (!camDragging || !world) return;
  const dxPx = clientX - camLastX;
  if (Math.abs(dxPx) > 1) camMoved = true;
  const dxWorld = dxPx * worldPerPx();
  camLastX = clientX;
  world.camX = camClamp(world.camX - dxWorld, world.zoom || 1);
  camVel = camVel * 0.5 - dxWorld * 0.5;
  camVel = Math.max(-90, Math.min(90, camVel));
}
function camPanEnd() {
  if (!camDragging) return;
  camDragging = false;
  if (camMoved) {
    world.camManual = true;
    syncAutoCamBtn();
  } else camVel = 0;
}
canvas.addEventListener('pointerdown', (e) => camPanStart(e.clientX));
window.addEventListener('pointermove', (e) => camPanMove(e.clientX));
window.addEventListener('pointerup', camPanEnd);
window.addEventListener('pointercancel', camPanEnd);

// Boot
world = newWorld();
showOverlay(null);
requestAnimationFrame(loop);
