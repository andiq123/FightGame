import { Fighter, POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { buildTraits } from '../config/traits.js';
import { getAIStats, clampStat, statT } from '../config/stats.js';
import { TD, TEAM_COLOR, TEAM_CAPE } from './config.js';

let _idSeq = 1;

// Weighted random pick from [{...,weight}] entries.
function weightedPick(list, rng) {
  const total = list.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of list) { r -= e.weight; if (r <= 0) return e; }
  return list[list.length - 1];
}

// Roll a random trait subset for a creep — count from TRAIT_COUNT_WEIGHTS, ids
// from the weighted TRAIT_POOL (no duplicates). 'caped' is added cosmetically.
function rollTraits(rng, cape) {
  const counts = TD.TRAIT_COUNT_WEIGHTS;
  const n = weightedPick(counts.map((weight, id) => ({ id, weight })), rng).id;
  const pool = [...TD.TRAIT_POOL];
  const ids = [];
  for (let i = 0; i < n && pool.length; i++) {
    const pick = weightedPick(pool, rng);
    ids.push(pick.id);
    pool.splice(pool.indexOf(pick), 1);
  }
  if (cape) ids.push('caped');
  return ids;
}

// Build one creep for a team. Reuses the shared Fighter body (animation + hit
// resolution) with a compact team brain in td/ai.js. Stats jitter per spawn so
// every Grunt/Brute/etc. is a little different — the battle never repeats.
export function createCreep(team, typeKey, level, rng) {
  const def = TD.CREEPS[typeKey];
  const dir = team === 'L' ? 1 : -1;
  const baseX = team === 'L' ? -TD.BASE_X : TD.BASE_X;

  // Per-spawn stat jitter, plus a gentle climb with the battle's `level`.
  const ji = (n) => Math.round(n + (rng() - 0.5) * 4 + level * 0.6);
  const power = clampStat(ji(def.power));
  const intel = clampStat(ji(def.int));
  const hpFac = 1 + (power - def.power) * 0.06;

  const c = new Fighter(_idSeq++, TEAM_COLOR[team], baseX + dir * 130, dir);
  c.setStats({ power, intelligence: intel });
  c.damageTakenMult = 1;                                   // HP pool stays honest
  c.maxHp = c.hp = Math.round(def.hp * hpFac * (0.9 + rng() * 0.25));
  c.dmg = Math.round(def.dmg * hpFac * (0.9 + rng() * 0.3));
  c.baseDmg = Math.round(c.dmg * 2.2);                     // creeps hit the undefended base hard
  c.atkCdMs = Math.round(def.atkCdMs * (1 - statT(intel) * 0.4));
  c.reward = def.reward;
  c.attackRange = def.range;
  c.moveSpeed = def.speed * (0.9 + rng() * 0.25);
  c.scale = def.scale;
  c.aggro = 420 + intel * 22;                              // smarter = engages wider
  c.ranged = def.ranged || null;
  if (c.ranged) c.rangedDmg = Math.round(c.ranged.damage * hpFac);

  const { traits, style } = buildTraits(rollTraits(rng, def.cape));
  c.traits = traits;
  c.style = style;
  c.capeColor = style === 'caped' ? TEAM_CAPE[team] : null;
  c.ai = getAIStats(intel);

  c.team = team;
  c.dir = dir;
  c.role = def.role;
  c.typeKey = typeKey;
  c.groundY = 0;
  c.nextAtkAt = 0;
  c.maxStamina = 200;
  c.stamina = c.maxStamina;
  return c;
}

export { POSE, ATTACK };
