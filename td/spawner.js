import { createCreep } from './units.js';
import { TD, opp } from './config.js';

// Each base earns gold (a baseline trickle + every living miner) and spends it
// on creeps. The choice is intelligent AND varied: when threatened it rushes
// cheap fast bodies; when safe it invests in miners and bigger units, and it
// sometimes banks gold for a power spike — so the two bases rarely play alike.
export function runEconomy(world, dt, now) {
  for (const team of ['L', 'R']) {
    const base = world.bases[team];
    if (base.hp <= 0) continue;
    const miners = countTeam(world, team, 'miner');
    base.gold += (TD.ECONOMY.passivePerSec + miners * TD.ECONOMY.minerPerSec) * dt;
    if (now >= (base.nextSpawnAt || 0)) {
      base.nextSpawnAt = now + TD.ECONOMY.decideEveryMs;
      maybeSpawn(world, base, team);
    }
  }
}

function countTeam(world, team, role) {
  let n = 0;
  for (const c of world.creeps) if (c.hp > 0 && c.team === team && (!role || c.role === role)) n++;
  return n;
}

function maybeSpawn(world, base, team) {
  const E = TD.ECONOMY;
  if (countTeam(world, team) >= E.maxAlive) return;

  const minersAlive = countTeam(world, team, 'miner');
  const enemyNear = world.creeps.some(c => c.hp > 0 && c.team !== team && Math.abs(c.x - base.x) < E.defendDist);
  const losing = base.hp < world.bases[opp(team)].hp * 0.7;
  const underThreat = enemyNear || losing;

  const opts = [];
  for (const [key, def] of Object.entries(TD.CREEPS)) {
    if (base.gold < def.cost) continue;
    let w = def.weight;
    if (key === 'miner') w = (underThreat || minersAlive >= E.targetMiners) ? 0.05 : Math.max(0.2, 3.5 - minersAlive);
    else if (underThreat) w *= def.cost <= 90 ? 2.2 : 0.7; // defend with cheap, fast bodies
    if (w > 0) opts.push({ key, def, w });
  }
  if (!opts.length) return;

  // Bank gold for a pricier unit sometimes (only when safe and one is still out of reach).
  const pricier = Object.values(TD.CREEPS).some(d => d.cost > base.gold);
  if (!underThreat && pricier && world.rng() < E.bankChance) return;

  const pick = weightedPick(opts, world.rng);
  base.gold -= pick.def.cost;
  const c = createCreep(team, pick.key, world.level || 0, world.rng);
  c.needsDashDust = true;
  world.creeps.push(c);
}

function weightedPick(list, rng) {
  const total = list.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  for (const e of list) { r -= e.w; if (r <= 0) return e; }
  return list[list.length - 1];
}
