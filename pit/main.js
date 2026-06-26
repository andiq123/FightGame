import { PIT, TEAM_LABEL } from './config.js';
import { resetArena } from './spawn.js';
import { updatePitFighter } from './ai.js';
import { PitViewport } from './render.js';
import { aliveByX } from '../td/spatial.js';
import {
  integrate, resolveCreepAttacks, reapCreeps, separateCreeps, tickRagdolls,
} from '../td/combat.js';
import { tickParticles, spawnHitParticles } from '../services/particleSystem.js';
import { secureRandom } from '../utils.js';
import { resumeAudio, startMusic, toggleMute } from '../services/audio.js';

const canvas = document.getElementById('canvas');
const viewport = new PitViewport(canvas);
const overlay = document.getElementById('overlay');

let world = null;
let running = false;
let lastTime = performance.now();
let gameSpeed = 1;

function newWorld() {
  const rng = secureRandom;
  const w = {
    rng,
    creeps: [],
    particles: [],
    hitEffects: [],
    screenShake: 0,
    over: null,
    time: 0,
    _aliveByX: [],
    bases: {
      L: { team: 'L', gold: 0, hp: 1, maxHp: 1, kills: 0 },
      R: { team: 'R', gold: 0, hp: 1, maxHp: 1, kills: 0 },
    },
  };
  resetArena(w, rng);
  return w;
}

function start() {
  world = newWorld();
  world.over = null;
  running = true;
  overlay?.classList.add('hidden');
  if (overlay) overlay.querySelector('p').textContent = 'Four vs four in a torch-lit sand bowl. No bases, no gold — last team standing.';
  resumeAudio();
  startMusic();
}

function clampArena(c) {
  const lim = PIT.ARENA_HALF;
  if (c.x < -lim) { c.x = -lim; c.vx *= 0.2; }
  if (c.x > lim) { c.x = lim; c.vx *= 0.2; }
}

function update(dt, now) {
  if (world.over) { decayEffects(dt); return; }

  world.time += dt;
  aliveByX(world.creeps, world._aliveByX);

  tickRagdolls(world, dt, now);
  for (const c of world.creeps) {
    if (c.hp <= 0) continue;
    updatePitFighter(c, world, dt, now);
    c.update(dt, now);
    integrate(c, dt, now);
    clampArena(c);
  }
  separateCreeps(world);
  resolveCreepAttacks(world, now);
  reapCreeps(world, now);

  const l = world.creeps.filter(c => c.team === 'L' && c.hp > 0).length;
  const r = world.creeps.filter(c => c.team === 'R' && c.hp > 0).length;
  if (!l || !r) {
    world.over = !l && !r ? null : l ? 'L' : 'R';
    if (world.over && overlay) {
      overlay.querySelector('p').textContent = `${TEAM_LABEL[world.over]} takes the pit. Enter for another round.`;
      overlay.classList.remove('hidden');
      running = false;
    }
  }

  decayEffects(dt);
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
  if (fx.length > 40) fx.splice(0, fx.length - 40);
  world.screenShake *= 0.88;
  if (world.screenShake < 0.5) world.screenShake = 0;
}

function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  if (running && world) {
    for (let i = 0; i < gameSpeed; i++) update(dt, performance.now());
  }
  if (world) viewport.render(world, performance.now());
  requestAnimationFrame(loop);
}

overlay?.querySelector('.ov-btn')?.addEventListener('click', start);
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') toggleMute();
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!running || world?.over) start();
  }
  if (e.key === '2') gameSpeed = 2;
  if (e.key === '3') gameSpeed = 3;
  if (e.key === '1') gameSpeed = 1;
});

requestAnimationFrame(loop);
