// Headless Stick Wars (TD) simulator — measures fairness + event impact.
//
//   node sim/simulate-td.mjs                  # default: 40 battles × 4 scenarios
//   node sim/simulate-td.mjs --matches 80
//   node sim/simulate-td.mjs --seconds 180 --seed 42
//
// Scenarios shuffle economy personalities and starting gold so neither base
// should dominate. Win% near 50/50 across many seeds = healthy randomness.

import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `
TD battle simulator
  node sim/simulate-td.mjs [flags]

FLAGS:
  --matches N     battles per scenario (default 40)
  --seconds N     max battle length in seconds (default 240)
  --seed N        RNG seed for reproducibility (default random)
  --help          show this
`;

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
  const cfg = { matches: 40, seconds: 240, seed: (Date.now() & 0xfffffff) >>> 0 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--matches') cfg.matches = +args[++i];
    else if (args[i] === '--seconds') cfg.seconds = +args[++i];
    else if (args[i] === '--seed') cfg.seed = +args[++i];
  }
  return cfg;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}

async function runOneBattle({ seconds, seed, scenario }) {
  let clock = 1000;
  globalThis.performance = { now: () => clock };

  const rng = makeRng(seed);
  const { TD } = await import(path.join(ROOT, 'td/config.js'));
  const { createBase } = await import(path.join(ROOT, 'td/towers.js'));
  const { runEconomy } = await import(path.join(ROOT, 'td/spawner.js'));
  const { updateCreep } = await import(path.join(ROOT, 'td/ai.js'));
  const { initEvents, tickEvents } = await import(path.join(ROOT, 'td/events.js'));
  const { initGoldNodes } = await import(path.join(ROOT, 'td/gold.js'));
  const { aliveByX } = await import(path.join(ROOT, 'td/spatial.js'));
  const {
    integrate, resolveCreepAttacks, resolveCreepVsBase, reapCreeps, separateCreeps, tickRagdolls, tickGrapples, tickAirBalance, tickBowler,
  } = await import(path.join(ROOT, 'td/combat.js'));
  const { updateProjectiles } = await import(path.join(ROOT, 'td/projectiles.js'));
  const { tickBaseDefense } = await import(path.join(ROOT, 'td/skills.js'));

  const world = {
    rng,
    creeps: [],
    bases: { L: createBase('L', rng), R: createBase('R', rng) },
    particles: [], projectiles: [], hitEffects: [],
    camX: 0, zoom: 1, screenShake: 0, slowMo: 0,
    over: null, time: 0, level: 0,
    _announce: () => {},
  };
  initEvents(world);
  initGoldNodes(world);

  if (scenario === 'goldSkewL') world.bases.L.gold += 120;
  if (scenario === 'goldSkewR') world.bases.R.gold += 120;
  if (scenario === 'aggressiveL') world.bases.L.personality.aggression = 1.6;
  if (scenario === 'aggressiveR') world.bases.R.personality.aggression = 1.6;
  if (scenario === 'aggressiveR') world.bases.R.personality.aggression = 1.6;

  const dt = 1 / 60;
  const maxFrames = seconds * 60;
  let events = 0;
  const startEvents = world.nextEventAt;

  for (let f = 0; f < maxFrames && !world.over; f++) {
    clock += dt * 1000;
    const now = clock;
    const slow = world.slowMo > 0 ? 0.35 : 1;
    if (world.slowMo > 0) world.slowMo -= dt * 1000;
    const sdt = dt * slow;

    world.time += dt;
    world.level = Math.floor(world.time / 30);
    aliveByX(world.creeps, world._aliveByX || (world._aliveByX = []));
    const prevNext = world.nextEventAt;
    tickEvents(world, dt);
    if (world.nextEventAt !== prevNext && world.time >= startEvents) events++;

    tickRagdolls(world, sdt, now);
    runEconomy(world, dt, now);

    for (const c of world.creeps) {
      if (c.hp <= 0) continue;
      updateCreep(c, world, sdt, now);
      c.update(sdt, now);
      integrate(c, sdt, now);
    }
    tickGrapples(world, now);
    tickAirBalance(world, sdt, now);
    tickBowler(world, now);
    separateCreeps(world);

    tickBaseDefense(world, now);

    updateProjectiles(world, sdt, now);
    resolveCreepAttacks(world, now);
    resolveCreepVsBase(world, now);
    reapCreeps(world, now);

    const L = world.bases.L.hp, R = world.bases.R.hp;
    if (L <= 0 || R <= 0) {
      world.over = L <= 0 && R <= 0 ? 'draw' : L <= 0 ? 'R' : 'L';
    }
  }

  if (!world.over) {
    const L = world.bases.L.hp, R = world.bases.R.hp;
    world.over = L === R ? 'draw' : L > R ? 'L' : 'R';
  }

  const bosses = world.creeps.filter(c => c.role === 'boss').length;
  return {
    winner: world.over,
    sec: world.time,
    killsL: world.bases.L.kills,
    killsR: world.bases.R.kills,
    events,
    bosses,
    hpL: world.bases.L.hp,
    hpR: world.bases.R.hp,
  };
}

async function main() {
  const cfg = parseArgs();
  const scenarios = ['balanced', 'goldSkewL', 'goldSkewR', 'aggressiveL', 'aggressiveR'];

  console.log(`\nTD simulation — ${cfg.matches} battles/scenario, max ${cfg.seconds}s, seed ${cfg.seed}\n`);
  console.log('scenario          L win%  R win%  draw%  avgSec  avgEvents  avgBosses');
  console.log('─'.repeat(72));

  for (const scenario of scenarios) {
    let lW = 0, rW = 0, dW = 0, sec = 0, ev = 0, boss = 0;
    for (let i = 0; i < cfg.matches; i++) {
      const seed = (cfg.seed + i * 9973 + scenario.charCodeAt(0) * 131) >>> 0;
      const r = await runOneBattle({ seconds: cfg.seconds, seed, scenario });
      if (r.winner === 'L') lW++;
      else if (r.winner === 'R') rW++;
      else dW++;
      sec += r.sec; ev += r.events; boss += r.bosses;
    }
    const n = cfg.matches;
    const row = [
      scenario.padEnd(18),
      `${Math.round(lW / n * 100)}%`.padStart(6),
      `${Math.round(rW / n * 100)}%`.padStart(7),
      `${Math.round(dW / n * 100)}%`.padStart(7),
      (sec / n).toFixed(0).padStart(7),
      (ev / n).toFixed(1).padStart(10),
      (boss / n).toFixed(2).padStart(11),
    ].join(' ');
    console.log(row);
  }
  console.log('\nHealthy target: L/R win% within ~40–60% on balanced scenario.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
