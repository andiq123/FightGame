import { POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { statT } from '../config/stats.js';
import { castCreepBolt } from './projectiles.js';
import { TD, opp } from './config.js';

// One brain for every creep. Fighters hunt the nearest enemy creep in aggro
// range, else march on the enemy base; casters kite and shoot. Miners shuttle a
// safe patch near home and flee when threatened (their gold is earned passively
// in td/spawner.js by counting the living). Traits flavour the behaviour.
const HEAVY = (c) => ((c.scale || 1) > 1.2 ? ATTACK.axeKick : ATTACK.cross);

// Nearest living enemy creep to a creep (or to any x for a given team).
export function nearestEnemy(world, c) { return nearestEnemyCreep(world, c.team, c.x); }
export function nearestEnemyCreep(world, team, x) {
  let best = null, bd = Infinity;
  for (const o of world.creeps) {
    if (o.hp <= 0 || o.team === team) continue;
    const d = Math.abs(o.x - x);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

export function updateCreep(c, world, dt, now) {
  if (c.hp <= 0 || c.staggerRagdoll) return;
  if (c.role === 'miner') return updateMiner(c, world, dt, now);

  const foe = nearestEnemy(world, c);
  const enemyBase = world.bases[opp(c.team)];
  const baseEdge = enemyBase.x - c.dir * (enemyBase.w / 2);
  const range = c.attackRange;
  const foeDist = foe ? Math.abs(foe.x - c.x) : Infinity;
  const useRanged = !!c.ranged;

  let mode, targetX, goalX, stopDist, rangedTarget = null;
  if (foe && foeDist <= c.aggro) {
    targetX = foe.x;
    if (useRanged && foeDist > range * 1.15) {
      mode = 'shoot'; rangedTarget = foe;
      const side = Math.sign(c.x - foe.x) || -c.dir;
      goalX = foe.x + side * c.ranged.range * 0.65; stopDist = c.ranged.range;
    } else {
      mode = 'melee'; c._meleeFoe = foe.id;
      const side = Math.sign(c.x - foe.x) || -c.dir;
      goalX = foe.x + side * range * 0.55; stopDist = range;
    }
  } else {
    mode = 'base'; targetX = baseEdge;
    goalX = baseEdge - c.dir * (useRanged ? c.ranged.range * 0.5 : range * 0.5);
    stopDist = useRanged ? c.ranged.range : range;
  }

  c.facing = Math.sign(targetX - c.x) || c.dir;
  const dist = Math.abs(c.x - targetX);
  const tooClose = mode === 'shoot' && dist < c.ranged.range * 0.4;
  const arrived = !tooClose && dist <= stopDist;

  // Blink trait: teleport to close a wide gap instead of jogging.
  if (c.traits?.blink && !arrived && dist > 360 && c.canAct(now) && now >= (c._blinkAt || 0)) {
    c.x = targetX - c.facing * stopDist * 0.6; c.vx = 0; c._blinkAt = now + 1600; c.needsDashDust = true;
  }

  if ((!arrived || tooClose) && c.canAct(now)) {
    const sp = Math.sign(goalX - c.x) * c.moveSpeed;
    const accel = c.traits?.athletic ? 9000 : 3600;
    c.vx += Math.sign(sp - c.vx) * accel * dt;
    if (Math.sign(sp) === Math.sign(c.vx) && Math.abs(c.vx) > Math.abs(sp)) c.vx = sp;
    if (c.onGround()) c.pose = POSE.walk;
    maybeAthleticMove(c, world, Math.sign(goalX - c.x), dist, now);
  } else if (c.canAct(now)) {
    c.vx *= 0.8;
    if (c.onGround() && c.pose !== POSE.punch && c.pose !== POSE.kick) c.pose = POSE.idle;
    if (now >= c.nextAtkAt) {
      const lazy = c.traits?.chill && world.rng() > 0.45; // Chill: strikes only now and then
      if (!lazy) {
        c.nextAtkAt = now + c.atkCdMs;
        if (mode === 'shoot') { c.pose = POSE.punch; c.poseTime = 0; castCreepBolt(world, c, rangedTarget, now); }
        else if (mode === 'melee') { c.startAttack(HEAVY(c), now); c._pendingHit = c._meleeFoe; }
        else if (Math.abs(c.x - baseEdge) <= TD.BASE_RANGE + range) { c.startAttack(HEAVY(c), now); c._pendingBaseHit = true; }
      }
    }
  }
}

// Miner: work a safe patch out from home, flee back when an enemy closes. Income
// itself is passive (counted in the economy), so survival is the whole job.
function updateMiner(c, world, dt, now) {
  const home = world.bases[c.team];
  const mineX = home.x + c.dir * 380;
  const foe = nearestEnemy(world, c);
  const threat = foe && Math.abs(foe.x - c.x) < 520;
  const goalX = threat ? home.x + c.dir * 90 : mineX;
  c.facing = threat ? (Math.sign(foe.x - c.x) || c.dir) : c.dir;

  if (!c.canAct(now)) return;
  if (Math.abs(goalX - c.x) > 20) {
    const sp = Math.sign(goalX - c.x) * c.moveSpeed * (threat ? 1.3 : 0.7);
    c.vx += Math.sign(sp - c.vx) * 4200 * dt;
    if (Math.sign(sp) === Math.sign(c.vx) && Math.abs(c.vx) > Math.abs(sp)) c.vx = sp;
    if (c.onGround()) c.pose = POSE.walk;
  } else {
    c.vx *= 0.8;
    if (c.onGround()) {
      c.pose = POSE.idle;
      if (!threat && now >= (c._mineAt || 0)) { c._mineAt = now + 700; c.vy = -120; c.needsDashDust = true; } // "mining" hop
    }
  }
}

// Athletic flourishes — leaps, lunges, point-blank jukes — so the advance reads
// dynamic, not a flat march. Smarter creeps do them more; every velocity jitters.
function maybeAthleticMove(c, world, dir, dist, now) {
  if (!c.onGround()) return;
  const M = TD.MOVE;
  const smart = statT(c.intelligence || 5);
  const big = (c.scale || 1) > 1.4;
  const r = world.rng;

  if (dist < M.jukeGap && now >= (c._jukeAt || 0) && r() < 0.013 + 0.05 * smart) {
    c._jukeAt = now + M.jukeCdMs;
    const back = r() < 0.62 ? -1 : 1;
    c.vx = back * dir * M.jukeVx * (0.7 + r() * 0.6);
    c.vy = M.jukeVy * (0.55 + r() * 0.6);
    c.pose = POSE.jump; c.needsDashDust = true; return;
  }
  if (big) {
    if (dist > M.bruteLeapGapMin && dist < M.bruteLeapGapMax && now >= (c._jumpAt || 0) && r() < 0.006 + 0.02 * smart) {
      c._jumpAt = now + M.bruteLeapCdMs;
      c.vy = M.bruteLeapVy * (0.85 + r() * 0.4);
      c.vx = dir * M.bruteLeapVx * (0.85 + r() * 0.5);
      c.pose = POSE.jump; c.needsDashDust = true;
    }
    return;
  }
  if (dist > M.jumpGapMin && dist < M.jumpGapMax && now >= (c._jumpAt || 0) && r() < 0.014 + 0.05 * smart) {
    c._jumpAt = now + M.jumpCdMs;
    c.vy = M.jumpVy * (0.8 + r() * 0.5);
    c.vx = dir * M.jumpVx * (0.8 + r() * 0.6);
    c.pose = POSE.jump; c.needsDashDust = true;
  } else if (dist < M.lungeGap && now >= (c._lungeAt || 0) && r() < 0.012 + 0.045 * smart) {
    c._lungeAt = now + M.lungeCdMs;
    c.vx = dir * M.lungeVx * (0.85 + r() * 0.5);
    c.needsDashDust = true;
  }
}
