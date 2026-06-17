// ─────────────────────────────────────────────────────────────────────────────
// Headless fight simulator — fast, stat-producing AI test harness.
//
// Runs the REAL game systems (AI, combat, physics) with no rendering, at max
// speed, and reports stats so the AI can be tuned with data instead of guesswork.
// Run `node sim/simulate.mjs --help` for full usage. Quick examples:
//
//   node sim/simulate.mjs                         # default intelligence matrix
//   node sim/simulate.mjs 20v1 15v10 10v5         # pick intelligence matchups
//   node sim/simulate.mjs 20v1 --power 8 --matches 40
//   node sim/simulate.mjs --charA oneStrike --charB assassin   # character vs character
//   node sim/simulate.mjs 1v18 --traitsA untouchable,perfectStrike,unbreakable
//
// Each match runs in a FRESH child process (the game clock is performance.now()
// and module state must start clean, like a page-load) and every matchup is run
// on BOTH sides to cancel the small left/right positional bias.
// ─────────────────────────────────────────────────────────────────────────────

import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

// Defaults — override any with the matching flag.
const DEFAULTS = {
  matches: 30,        // matches per matchup (split evenly across both sides)
  power: 6,           // power level for both fighters unless --powerA/--powerB given
  seconds: 90,        // max match length before it's a timeout (HP decides the win)
  powers: 'auto',     // jutsu loadout: 'all' | 'none' | 'auto' (char's own, else all)
  concurrency: 8,     // parallel child processes
};

const HELP = `
Fight simulator — usage
  node sim/simulate.mjs [matchups...] [flags]

MATCHUPS (positional, any number; default is a spread of intelligence gaps):
  AvB            intelligence A (left) vs intelligence B (right), e.g. 20v1

FLAGS:
  --matches N        matches per matchup            (default ${DEFAULTS.matches})
  --power N          power level for BOTH fighters  (default ${DEFAULTS.power})
  --powerA N         power for the LEFT fighter only
  --powerB N         power for the RIGHT fighter only
  --seconds N        match time limit               (default ${DEFAULTS.seconds})
  --powers MODE      jutsu: all | none | auto        (default ${DEFAULTS.powers})
  --charA <id>       make the LEFT fighter a roster character (assassin | oneStrike)
  --charB <id>       make the RIGHT fighter a roster character
  --traitsA a,b,c    attach traits to the LEFT fighter  (see config/traits.js ids)
  --traitsB a,b,c    attach traits to the RIGHT fighter
  --concurrency N    parallel processes             (default ${DEFAULTS.concurrency})
  --help             show this

Trait ids: untouchable, unbreakable, perfectStrike, seriousPunch, tireless,
           athletic, blink, chill, caped
Character ids: assassin, oneStrike

EXAMPLES:
  node sim/simulate.mjs                                   default matrix
  node sim/simulate.mjs 20v1 15v10 --matches 50           specific gaps, more samples
  node sim/simulate.mjs 10v10 --power 12                  even fight at high power
  node sim/simulate.mjs --charA oneStrike --charB assassin   the two characters clash
  node sim/simulate.mjs 1v20 --traitsA untouchable,perfectStrike   can a maxed-trait novice win?
`;

// ── Child mode: run exactly ONE match and print a JSON stat line ──────────────
if (process.argv.includes('--match')) {
  await runOneMatch();
} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
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
  const { buildTraits } = await import(path.join(ROOT, 'config/traits.js'));

  const rng = Math.random;
  const ALL = getValidPowerIds();

  function build(id, color, x, facing, side) {
    const f = new Fighter(id, color, x, facing);
    f.setStats({ power: side.power, intelligence: side.intelligence });
    const powers = side.powers === 'none' ? [] : side.powers === 'char' ? (side.charPowers || []) : ALL;
    f.setPowers([...powers]);
    const { traits, style } = buildTraits(side.traits || []);
    f.traits = traits;
    f.style = style;
    f.capeColor = style === 'caped' ? (side.cape || '#e23b3b') : null;
    f.passives = side.passives || [];
    return f;
  }

  const w = new World();
  w.roundState = 'fighting';
  const f1 = build(0, '#f00', -280, 1, cfg.a);
  const f2 = build(1, '#00f', 280, -1, cfg.b);
  w.fighter1 = f1; w.fighter2 = f2; w.fighters = [f1, f2];

  const ai = new AISystem(), cs = new CombatSystem(), ps = new PhysicsSystem();
  const dt = 1 / 60;

  let casts = 0; const distinct = new Set(); let maxCombo = 0;
  const useP = f1.usePower.bind(f1);
  f1.usePower = (id, t) => { const ok = useP(id, t); if (ok) { casts++; distinct.add(id); } return ok; };

  const maxFrames = cfg.seconds * 60;
  let frames = 0;
  for (let i = 0; i < maxFrames; i++) {
    CLOCK += dt * 1000;
    const now = CLOCK;
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
  const winner = f1.hp === f2.hp ? 0 : (f1.hp > f2.hp ? 1 : 2); // KO or higher-HP on timeout
  process.stdout.write(JSON.stringify({
    ko, winner,
    sec: frames / 60,
    f1DmgTaken: Math.round(f1.maxHp - f1.hp),
    f2DmgTaken: Math.round(f2.maxHp - f2.hp),
    casts, distinct: distinct.size, maxCombo,
    nan: (!Number.isFinite(f1.x) || !Number.isFinite(f2.hp)) ? 1 : 0,
    cfg,
  }));
}

// ── Parent mode ───────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = { ...DEFAULTS, ints: [], charA: null, charB: null, traitsA: null, traitsB: null, powerA: null, powerB: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--matches') cfg.matches = +args[++i];
    else if (a === '--power') cfg.power = +args[++i];
    else if (a === '--powerA') cfg.powerA = +args[++i];
    else if (a === '--powerB') cfg.powerB = +args[++i];
    else if (a === '--seconds') cfg.seconds = +args[++i];
    else if (a === '--powers') cfg.powers = args[++i];
    else if (a === '--charA') cfg.charA = args[++i];
    else if (a === '--charB') cfg.charB = args[++i];
    else if (a === '--traitsA') cfg.traitsA = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--traitsB') cfg.traitsB = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--concurrency') cfg.concurrency = +args[++i];
    else if (/^\d+v\d+$/.test(a)) cfg.ints.push(a.split('v').map(Number));
  }
  return cfg;
}

// A character's trait map → the id list buildTraits() expects ('style' → its value).
function charTraitIds(char) {
  if (!char?.traits) return [];
  return Object.entries(char.traits).flatMap(([k, v]) => (k === 'style' ? [v] : (v ? [k] : [])));
}

async function runSuite() {
  const cfg = parseArgs();
  const { getMonster } = await import(path.join(ROOT, 'ai/monsters.js'));

  // Resolve one side's full spec from: char defaults ⊕ positional int ⊕ flags.
  const resolveSide = (letter, posInt) => {
    const char = cfg['char' + letter] ? getMonster(cfg['char' + letter]) : null;
    const traits = cfg['traits' + letter] ?? (char ? charTraitIds(char) : []);
    const powers = cfg.powers !== 'auto' ? cfg.powers : (char ? 'char' : 'all');
    return {
      intelligence: posInt ?? char?.intelligence ?? 10,
      power: cfg['power' + letter] ?? cfg.power ?? char?.power ?? DEFAULTS.power,
      traits,
      powers,
      charPowers: char?.powers || [],
      passives: char?.passives || [],
      cape: char?.cape,
      label: char ? char.name : `int${posInt ?? '?'}`,
    };
  };

  // Build the matchup list. Character/trait flags → a single directed matchup;
  // otherwise the positional int matchups (or the default spread).
  let matchups;
  if (cfg.charA || cfg.charB || cfg.traitsA || cfg.traitsB) {
    const pos = cfg.ints[0] || [];
    matchups = [[resolveSide('A', pos[0]), resolveSide('B', pos[1])]];
  } else {
    const ints = cfg.ints.length ? cfg.ints : [[20, 1], [20, 5], [20, 10], [15, 5], [10, 5], [10, 10], [20, 20]];
    matchups = ints.map(([ia, ib]) => [resolveSide('A', ia), resolveSide('B', ib)]);
  }

  const t0 = Date.now();
  console.log(`\nFight simulation — ${cfg.matches} matches/matchup, max ${cfg.seconds}s, powers:${cfg.powers}`);
  console.log('(each matchup run on BOTH sides to cancel positional bias; win% is the LEFT fighter "A")\n');
  console.log('matchup                       A win%   KO%   avgSec   A dmgTaken   B dmgTaken   A casts');
  console.log('─'.repeat(96));

  for (const [a, b] of matchups) {
    const half = Math.max(1, Math.round(cfg.matches / 2));
    const tasks = [];
    // Half: A on the left (F1). Half: A on the right (F2) — cancels positional bias.
    for (let i = 0; i < half; i++) tasks.push(() => runChild({ a, b, seconds: cfg.seconds, aIsF1: true }));
    for (let i = 0; i < half; i++) tasks.push(() => runChild({ a: b, b: a, seconds: cfg.seconds, aIsF1: false }));
    const res = (await pool(tasks, cfg.concurrency)).filter(Boolean);
    const n = res.length || 1;

    let aWins = 0, ko = 0, sec = 0, aDmg = 0, bDmg = 0, casts = 0, castN = 0, nan = 0;
    for (const r of res) {
      const aIsF1 = r.cfg.aIsF1;
      ko += r.ko; sec += r.sec; nan += r.nan;
      if ((r.winner === 1 && aIsF1) || (r.winner === 2 && !aIsF1)) aWins++;
      aDmg += aIsF1 ? r.f1DmgTaken : r.f2DmgTaken;
      bDmg += aIsF1 ? r.f2DmgTaken : r.f1DmgTaken;
      if (aIsF1) { casts += r.casts; castN++; } // casts measured on F1 only
    }
    const row = [
      `${a.label} vs ${b.label}`.padEnd(29),
      `${Math.round(aWins / n * 100)}%`.padStart(6),
      `${Math.round(ko / n * 100)}%`.padStart(6),
      (sec / n).toFixed(0).padStart(7),
      (aDmg / n).toFixed(0).padStart(12),
      (bDmg / n).toFixed(0).padStart(12),
      (casts / (castN || 1)).toFixed(1).padStart(9),
    ].join(' ');
    console.log(row + (nan ? `   ⚠ ${nan} NaN` : ''));
  }
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
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
