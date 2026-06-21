import { createMonster } from './units.js';
import { TD } from './config.js';

// Wave director: emits monsters over time, waits a breather, then escalates.
export function createWaveState() {
  return {
    wave: 0,
    phase: 'breather',     // 'breather' | 'spawning'
    timer: 1500,           // ms until next action
    toSpawn: [],           // queue of type keys for the current wave
    spawnTimer: 0,
  };
}

// Roll a random wave event (from wave 2 on) to keep runs surprising.
function rollEvent(n, world) {
  if (n < 2 || world.rng() >= TD.EVENT_CHANCE) return null;
  return TD.EVENTS[Math.floor(world.rng() * TD.EVENTS.length)];
}

// Compose a wave: chaff dominates early, with casters, brutes and elite
// warlords mixing in as waves climb — so the threat diversifies over time.
function buildWave(n, event) {
  const list = [];
  const mul = event?.countMul || 1;
  const grunts = Math.round((3 + Math.floor(n * 1.2)) * mul);
  const runners = Math.round((1 + Math.floor(n * 0.8)) * mul) + (event?.addRunner || 0);
  const shamans = n >= 2 ? Math.floor(n / 2) : 0;
  const brutes = n >= 3 ? Math.floor((n - 1) / 2) : 0;
  const warlords = (n >= 4 ? Math.floor((n - 2) / 3) : 0) + (event?.addWarlord || 0);

  const push = (key, k) => { for (let i = 0; i < k; i++) list.push(key); };
  push('runner', runners);
  push('grunt', grunts);
  push('shaman', shamans);
  push('brute', brutes);
  push('warlord', warlords);

  // Interleave so types arrive mixed, not in blocks (deterministic shuffle by
  // index parity to keep it varied without Math.random).
  list.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const mixed = [];
  while (list.length) {
    const step = Math.max(1, Math.floor(list.length / 3));
    mixed.push(list.splice(0, 1)[0]);
    if (list.length > step) mixed.push(list.splice(step, 1)[0]);
  }
  return mixed;
}
const ORDER = ['runner', 'grunt', 'shaman', 'brute', 'warlord'];

export function updateWaves(world, ws, dt, now) {
  const dtMs = dt * 1000;

  if (ws.phase === 'breather') {
    ws.timer -= dtMs;
    if (ws.timer <= 0) {
      ws.wave += 1;
      const event = rollEvent(ws.wave, world);
      world.waveEvent = event;
      ws.toSpawn = buildWave(ws.wave, event);
      ws.phase = 'spawning';
      ws.spawnTimer = 0;
      world.announce = { text: event ? event.name : `WAVE ${ws.wave}`, until: now + (event ? 2400 : 1800), big: !!event };
    }
    return;
  }

  if (ws.phase === 'spawning') {
    ws.spawnTimer -= dtMs;
    if (ws.spawnTimer <= 0 && ws.toSpawn.length) {
      const key = ws.toSpawn.shift();
      const m = createMonster(key, ws.wave);
      // Stagger spawn height a touch so they don't perfectly overlap.
      m.x = TD.ENEMY_TOWER_X - 120 - Math.floor(world.rng() * 80);
      world.monsters.push(m);
      ws.spawnTimer = TD.WAVE.spawnGapMs;
    }
    if (!ws.toSpawn.length && world.monsters.every(m => m.hp <= 0)) {
      // Wave cleared → take a breather and roll straight into the next wave. The
      // shop never pauses the game; the hero auto-buys upgrades on its own (main
      // loop), and the player can pop the panel open any time.
      world.waveEvent = null;
      ws.phase = 'breather';
      ws.timer = TD.WAVE.breatherMs;
      world.announce = { text: `WAVE ${ws.wave} CLEARED`, until: now + 2000 };
    }
    return;
  }
}
