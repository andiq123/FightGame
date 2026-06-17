// ─────────────────────────────────────────────────────────────────────────────
// Headless fight simulator — fast, stat-producing AI test harness.
//
// Runs the REAL game systems (AI, combat, physics) with no rendering, at max
// speed, and reports stats so the AI can be tuned with data instead of guesswork.
//
//   node sim/simulate.mjs                 # default matchup matrix
//   node sim/simulate.mjs 20v1            # one matchup, N matches
//   node sim/simulate.mjs 20v1 20v10 10v10 --matches 40 --power 6
//
// Each match runs in a FRESH child process. This is deliberate: the game clock is
// performance.now() and module-scoped state must start clean, exactly like a real
// page-load. Running many matches in one process skews skill/cooldown stats.
//
// Stats per matchup: win% (by F1, the first/"left" fighter), KO%, avg seconds,
// avg damage dealt/taken, avg skill casts (F1), distinct skills, max combo.
// ─────────────────────────────────────────────────────────────────────────────

import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

// Tunable defaults (override via CLI flags).
const DEFAULTS = {
  matches: 30,        // matches per matchup
  power: 6,           // power level for BOTH fighters (so intelligence is isolated)
  seconds: 90,        // max match length before it's called a timeout
  powers: 'all',      // 'all' = both equipped with every jutsu, 'none' = pure melee
  concurrency: 8,     // parallel child processes
};

// ── Child mode: run exactly ONE match and print a JSON stat line ──────────────
if (process.argv.includes('--match')) {
  await runOneMatch();
} else {
  await runSuite();
}

async function runOneMatch() {
  // The game clock IS performance.now(); stub it to a controlled monotonic clock
  // BEFORE importing any game module so score()/status timing is consistent.
  let CLOCK = 1000;
  globalThis.performance = { now: () => CLOCK };

  const cfg = JSON.parse(process.env.SIM_CFG);
  const { Fighter } = await import(path.join(ROOT, 'entities/fighter.js'));
  const { AISystem } = await import(path.join(ROOT, 'engine/systems/AISystem.js'));
  const { CombatSystem } = await import(path.join(ROOT, 'engine/systems/CombatSystem.js'));
  const { PhysicsSystem } = await import(path.join(ROOT, 'engine/systems/PhysicsSystem.js'));
  const { World } = await import(path.join(ROOT, 'engine/core/World.js'));
  const { getValidPowerIds, getSpawnEffect } = await import(path.join(ROOT, 'entities/powers/index.js'));

  const rng = Math.random;
  const ALL = getValidPowerIds();
  const powerSet = cfg.powers === 'none' ? [] : ALL;

  const w = new World();
  w.roundState = 'fighting';
  const f1 = new Fighter(0, '#f00', -280, 1);
  f1.setStats({ power: cfg.power, intelligence: cfg.ia });
  f1.setPowers([...powerSet]);
  const f2 = new Fighter(1, '#00f', 280, -1);
  f2.setStats({ power: cfg.power, intelligence: cfg.ib });
  f2.setPowers([...powerSet]);
  w.fighter1 = f1; w.fighter2 = f2; w.fighters = [f1, f2];

  const ai = new AISystem(), cs = new CombatSystem(), ps = new PhysicsSystem();
  const dt = 1 / 60;

  // Instrument F1: skill casts, distinct skills, max combo.
  let casts = 0; const distinct = new Set(); let maxCombo = 0;
  const useP = f1.usePower.bind(f1);
  f1.usePower = (id, t) => { const ok = useP(id, t); if (ok) { casts++; distinct.add(id); } return ok; };

  const maxFrames = cfg.seconds * 60;
  let frames = 0;
  for (let i = 0; i < maxFrames; i++) {
    CLOCK += dt * 1000;
    const now = CLOCK;
    // Honor slow-mo exactly like game.js so timing matches the real loop.
    const inSlow = w.slowMoRemaining > 0;
    if (inSlow) w.slowMoRemaining -= dt * 1000;
    if (w.slowMoRemaining <= 0) w.slowMoZoom = 1;
    const sdt = dt * (inSlow ? 0.3 : 1);
    f1.update(sdt, now); f2.update(sdt, now);
    ai.update(w, sdt, now, rng, ALL, {}, getSpawnEffect);
    cs.update(w, sdt, now, rng);
    ps.update(w, sdt, now, rng);
    maxCombo = Math.max(maxCombo, f1.comboCount, f2.comboCount);
    w.hitEffects.length = 0; w.particles.length = 0;
    frames++;
    if (f1.hp <= 0 || f2.hp <= 0) break;
  }

  const ko = (f1.hp <= 0 || f2.hp <= 0) ? 1 : 0;
  // Winner (1=F1, 2=F2, 0=exact draw) = KO winner, or on timeout whoever has more
  // HP — like a real round timer, so win% stays meaningful when a dominant fighter
  // can't quite finish in time.
  const winner = f1.hp === f2.hp ? 0 : (f1.hp > f2.hp ? 1 : 2);
  const f1Won = winner === 1 ? 1 : 0;
  const result = {
    ko, f1Won,
    sec: frames / 60,
    f1DmgTaken: Math.round(f1.maxHp - f1.hp),
    f2DmgTaken: Math.round(f2.maxHp - f2.hp),
    winner,
    casts, distinct: distinct.size, maxCombo,
    nan: (!Number.isFinite(f1.x) || !Number.isFinite(f2.hp)) ? 1 : 0,
    cfg,
  };
  process.stdout.write(JSON.stringify(result));
}

// ── Parent mode: parse matchups, spawn children, aggregate, print table ───────
function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = { ...DEFAULTS, matchups: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--matches') cfg.matches = +args[++i];
    else if (a === '--power') cfg.power = +args[++i];
    else if (a === '--seconds') cfg.seconds = +args[++i];
    else if (a === '--powers') cfg.powers = args[++i];
    else if (a === '--concurrency') cfg.concurrency = +args[++i];
    else if (/^\d+v\d+$/.test(a)) { const [ia, ib] = a.split('v').map(Number); cfg.matchups.push([ia, ib]); }
  }
  if (!cfg.matchups.length) cfg.matchups = [[20, 1], [20, 5], [20, 10], [15, 5], [10, 5], [10, 10], [20, 20]];
  return cfg;
}

function runChild(cfg) {
  return new Promise((resolve) => {
    const child = fork(__filename, ['--match'], {
      env: { ...process.env, SIM_CFG: JSON.stringify(cfg) },
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve(null); } });
  });
}

async function pool(tasks, concurrency) {
  const results = []; let idx = 0;
  async function worker() { while (idx < tasks.length) { const me = idx++; results[me] = await tasks[me](); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function runSuite() {
  const cfg = parseArgs();
  const t0 = Date.now();
  console.log(`\nFight simulation — power ${cfg.power}, powers:${cfg.powers}, ${cfg.matches} matches/matchup, max ${cfg.seconds}s`);
  console.log('(each matchup run on BOTH sides to cancel positional bias; win% is the HIGHER-intelligence fighter)\n');
  console.log('matchup        higher win%   KO%   avgSec   strong dmgTaken   weak dmgTaken   casts(strong)   distinct');
  console.log('─'.repeat(108));

  for (const [ia, ib] of cfg.matchups) {
    const half = Math.max(1, Math.round(cfg.matches / 2));
    // Run half with ia on the left, half with ia on the right — cancels any
    // left/right positional advantage so the result reflects intelligence only.
    const tasks = [];
    for (let i = 0; i < half; i++) tasks.push(() => runChild({ ia, ib, power: cfg.power, seconds: cfg.seconds, powers: cfg.powers, strongIsF1: ia >= ib }));
    for (let i = 0; i < half; i++) tasks.push(() => runChild({ ia: ib, ib: ia, power: cfg.power, seconds: cfg.seconds, powers: cfg.powers, strongIsF1: ib >= ia }));
    const res = (await pool(tasks, cfg.concurrency)).filter(Boolean);
    const n = res.length || 1;
    // Map each match's F1-centric stats onto strong/weak using strongIsF1.
    let strongWins = 0, ko = 0, sec = 0, strongDmg = 0, weakDmg = 0, casts = 0, distinct = 0, nan = 0;
    for (const r of res) {
      const sIsF1 = r.cfg.strongIsF1;
      ko += r.ko; sec += r.sec; nan += r.nan;
      const strongWon = (r.winner === 1 && sIsF1) || (r.winner === 2 && !sIsF1);
      strongWins += strongWon ? 1 : 0;
      strongDmg += sIsF1 ? r.f1DmgTaken : r.f2DmgTaken;
      weakDmg += sIsF1 ? r.f2DmgTaken : r.f1DmgTaken;
      // 'casts'/'distinct' are always measured on F1; report them for the strong side when it's F1.
      if (sIsF1) { casts += r.casts; distinct += r.distinct; }
    }
    const strongF1 = res.filter(r => r.cfg.strongIsF1).length || 1;
    const hi = Math.max(ia, ib), lo = Math.min(ia, ib);
    const row = [
      `int${hi} v int${lo}`.padEnd(13),
      `${Math.round(strongWins / n * 100)}%`.padStart(10),
      `${Math.round(ko / n * 100)}%`.padStart(6),
      (sec / n).toFixed(0).padStart(7),
      (strongDmg / n).toFixed(0).padStart(15),
      (weakDmg / n).toFixed(0).padStart(14),
      (casts / strongF1).toFixed(1).padStart(13),
      (distinct / strongF1).toFixed(1).padStart(10),
    ].join(' ');
    console.log(row + (nan ? `   ⚠ ${nan} NaN` : ''));
  }
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}
