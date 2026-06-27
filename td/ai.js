import { POSE } from '../entities/fighter.js';
import { ATTACK, GRAB } from '../entities/attacks.js';
import { statT } from '../config/stats.js';
import { castCreepBolt } from './projectiles.js';
import { TD, opp } from './config.js';
import { eachNear } from './spatial.js';
import { aggroMul } from './events.js';
import { tryCreepSkill } from './skills.js';
import { tryGiantRagdollGrab } from './combat.js';
import { nearestGoldNode, collectGold, depositMiner } from './gold.js';

// Fighters hunt enemies; miners haul gold (gold.js). Traits flavour behaviour.
import { moodMoveMul, moodAggroMul, moodAtkMul, confusedTactics } from './emote.js';

const HEAVY = (c) => ((c.scale || 1) > 1.2 ? ATTACK.axeKick : ATTACK.cross);
const isGiant = (c) => (c?.scale || 1) >= 1.85;
const atkCd = (c) => {
  let ms = c.atkCdMs * (TD.ATTACK_CD_MUL ?? 1.35);
  if (c.ranged) {
    ms *= TD.RANGED_CD_MUL ?? 1.85;
    if (c.flying) ms *= TD.FLY_RANGED_CD_MUL ?? 1.35;
  }
  return ms;
};

function pickFoe(world, c) {
  const mul = aggroMul(world);
  const range = c.aggro * mul;
  let best = null, bd = Infinity, miner = null, md = Infinity;
  const scan = (o) => {
    if (o.team === c.team) return;
    const d = Math.abs(o.x - c.x);
    if (d > range) return;
    if (o.role === 'miner') { if (d < md) { md = d; miner = o; } return; }
    if (d < bd) { bd = d; best = o; }
  };
  if (world._aliveByX) eachNear(world._aliveByX, c.x, range, scan);
  else for (const o of world.creeps) { if (o.hp <= 0 || o.team === c.team) continue; scan(o); }
  if (best) return best;
  const home = world.bases[c.team];
  if (miner && Math.abs(c.x - home.x) > 520) return miner;
  return null;
}

// Flyers snipe anything ahead on the lane, else the enemy base — no range cap.
function flyTarget(world, c) {
  const base = world.bases[opp(c.team)];
  const baseEdge = base.x - c.dir * (base.w / 2);
  let best = null, bd = Infinity;
  for (const o of world.creeps) {
    if (o.hp <= 0 || o.team === c.team || o.role === 'miner') continue;
    if ((o.x - c.x) * c.dir < -80) continue;
    const d = Math.abs(o.x - c.x);
    if (d < bd) { bd = d; best = o; }
  }
  return best || { x: baseEdge, y: 0 };
}

function updateFlying(c, world, dt, now) {
  const tgt = flyTarget(world, c);
  const foe = tgt.id ? tgt : null;
  if (foe && tryCreepSkill(c, world, foe, now)) return;

  const F = TD.FLY;
  const home = c.hoverY ?? -140;
  const hideY = Math.min(-340, home * (F.hideMul ?? 1.52));
  let threat = false;
  for (const o of world.creeps) {
    if (o.hp <= 0 || o.team === c.team || o.flying || o.role === 'miner') continue;
    if (Math.abs(o.x - c.x) < 500) { threat = true; break; }
  }
  c._flyStam = Math.min(F.staminaMax ?? 100, (c._flyStam ?? F.staminaMax) + dt * (F.cruiseRegen ?? 12));
  if (threat && c.canAct(now) && now >= (c._hideAt || 0) && world.rng() < 0.014 + dt * 1.8) {
    c._hideUntil = now + (F.hideMinMs ?? 1400) + world.rng() * 1400;
    c._hideAt = now + 3200;
  }
  const hiding = (c._hideUntil || 0) > now && (c._flyStam ?? 100) > 10;
  if (hiding) {
    c._hoverY = hideY;
    c._flyStam = Math.max(0, (c._flyStam ?? 100) - dt * (F.hideDrain ?? 34));
  } else {
    c._hoverY = home;
  }
  if ((c._flyStam ?? 100) < 8) {
    c._hideUntil = 0;
    c._hoverY = home;
    c._flyExhaustUntil = now + 1200;
  }
  if ((c._flyExhaustUntil || 0) > now) c._hoverY = home + 35;

  c.facing = Math.sign(tgt.x - c.x) || c.dir;
  if (c.canAct(now)) {
    const drift = c.x + c.dir * 120;
    const sp = Math.sign(drift - c.x) * c.moveSpeed * 0.4;
    c.vx += Math.sign(sp - c.vx) * 2400 * dt;
    if ((c._flyShootT || 0) > 0) {
      c._flyShootT = Math.max(0, c._flyShootT - dt);
      c.pose = POSE.punch;
    } else {
      c.pose = POSE.air;
    }
    if (now >= c.nextAtkAt && !(c.traits?.chill && !c.traits?.tireless && world.rng() > 0.42)) {
      c.nextAtkAt = now + atkCd(c) * moodAtkMul(c);
      c._flyShootT = 0.32; c.poseTime = 0;
      castCreepBolt(world, c, tgt, now);
    }
  }
}

// Nearest living enemy creep to a creep (or to any x for a given team).
export function nearestEnemy(world, c) { return nearestEnemyCreep(world, c.team, c.x); }
export function nearestEnemyCreep(world, team, x) {
  let best = null, bd = Infinity;
  let miner = null, md = Infinity;
  const scan = (o) => {
    if (o.team === team) return;
    const d = Math.abs(o.x - x);
    if (o.role === 'miner') { if (d < md) { md = d; miner = o; } return; }
    if (d < bd) { bd = d; best = o; }
  };
  if (world._aliveByX) eachNear(world._aliveByX, x, TD.STAGE_HALF, scan);
  else for (const o of world.creeps) { if (o.hp <= 0 || o.team === team) continue; scan(o); }
  return best ?? miner;
}

function syncGroundAirPose(c) {
  if (c.flying || c.staggerRagdoll || c.hp <= 0 || c._heldBy) return;
  if (c.onGround()) { c._antiAir = false; c._antiAirUntil = 0; c._airTime = 0; return; }
  if (c.pose === POSE.hit || c.pose === POSE.punch || c.pose === POSE.kick || c.currentAttack) return;
  c.pose = c.vy < -50 ? POSE.jump : POSE.air;
}

function maybeGrab(c, foe, world, now, reason) {
  const G = TD.GRAB ?? {};
  if (!foe || c.ranged || c.role === 'miner' || c._grabbing || c._heldBy) return false;
  if ((c.scale || 1) < (foe.scale || 1) * (G.scaleMin ?? 0.68)) return false;
  const giantSky = (c.scale || 1) >= 1.85 && foe.flying;
  const grabRange = (G.range ?? 94) + (giantSky ? 48 : 0);
  if (Math.abs(foe.x - c.x) > grabRange) return false;
  if (giantSky && Math.abs((foe.y || 0) - (c.y || 0)) > 340) return false;
  if (now < (c._grabAt || 0) || !c.canAct(now)) return false;
  let chance = (G.base ?? 0.032) + statT(c.intelligence || 5) * (G.smart ?? 0.05);
  if ((c.scale || 1) > 1.25) chance += G.big ?? 0.14;
  if (giantSky) { reason = 'antiAir'; chance += 0.58; }
  if (reason === 'antiAir' || reason === 'frustrated') chance += G.antiAir ?? 0.32;
  else chance += 0.06;
  if (world.rng() > chance) return false;
  c._grabAt = now + (G.cdMs ?? 1200);
  c.nextAtkAt = now + atkCd(c);
  c.startAttack(GRAB, now);
  return true;
}

function maybeAntiAirJump(c, foe, world, now) {
  if (!foe?.flying || c.flying || c.ranged || !c.onGround() || c._heldBy || c._grabbing) return false;
  if (Math.abs(foe.x - c.x) > 280) return false;
  if (now < (c._antiAirAt || 0) || !c.canAct(now)) return false;
  const smart = statT(c.intelligence || 5);
  if (world.rng() > 0.025 + smart * 0.1) return false;
  const M = TD.MOVE;
  const aimY = (foe.y || -200) - 20;
  const lift = Math.abs(aimY - (c.y || 0));
  c._antiAirAt = now + 1100;
  c._antiAirUntil = now + (M.antiAirMs ?? 920);
  c._airTime = 0;
  c.vy = -(M.antiAirVyBase ?? 720) - lift * (M.antiAirVyScale ?? 1.35);
  c.vx = Math.sign(foe.x - c.x || c.dir) * Math.min(520, Math.abs(foe.x - c.x) / 0.38);
  c.pose = POSE.jump;
  c.poseTime = 0;
  c.needsDashDust = true;
  return true;
}

function updateBowler(c, world, dt, now) {
  if (c._heldBy) return;
  const B = TD.BOWLER;
  const foe = pickFoe(world, c);
  const base = world.bases[opp(c.team)];
  const targetX = foe ? foe.x : (base.x - c.dir * (base.w / 2));
  c.facing = Math.sign(targetX - c.x) || c.dir;
  const dist = Math.abs(targetX - c.x);

  if (!c._bowlerJump && c.onGround() && c.canAct(now) && now >= (c._bowlLaunchAt || 0) && dist > 140 && dist < 1500) {
    const dir = Math.sign(targetX - c.x) || c.dir;
    c._bowlerJump = true;
    c._bowlLaunchAt = now + (B.jumpCdMs ?? 2100);
    c.vy = B.jumpVy ?? -400;
    c.vx = dir * Math.min(B.jumpVxMax ?? 960, dist / (B.jumpFlight ?? 0.78));
    c.pose = POSE.jump;
    c.poseTime = 0;
    c.needsDashDust = true;
    return;
  }

  if (c._bowlerJump || !c.onGround()) {
    c.pose = POSE.jump;
    const dir = Math.sign(targetX - c.x) || c.dir;
    c.vx += dir * 620 * dt;
    syncGroundAirPose(c);
    return;
  }

  const sp = Math.sign(targetX - c.x) * c.moveSpeed;
  c.vx += Math.sign(sp - c.vx) * 3000 * dt;
  c.pose = Math.abs(c.vx) > c.moveSpeed * 0.82 ? POSE.run : POSE.walk;
}

function finishFlyerGround(c, world, now) {
  if (!c.flying || !c._hoverOff || !c.onGround() || c.staggerRagdoll) return;
  if ((c._groundFightUntil || 0) > now) return;
  c._hoverOff = false;
  const F = TD.FLY ?? {};
  c._hideUntil = now + (F.reclimbHideMs ?? 900) + world.rng() * 700;
  c._hoverY = Math.min(-320, (c.hoverY ?? -140) * (F.hideMul ?? 1.52));
  c._flyStam = Math.max(10, (c._flyStam ?? 60) - 18);
}

export function updateCreep(c, world, dt, now) {
  if (c.hp <= 0 || c.staggerRagdoll || c._ragdollLaunch || c._heldBy) return;
  if (c.role === 'miner') return updateMiner(c, world, dt, now);
  if (isGiant(c) && tryGiantRagdollGrab(world, c, now)) return;
  if (c.role === 'bowler') { updateBowler(c, world, dt, now); return; }
  if (c.flying && c._hoverOff && !c.onGround()) return;
  if (c.flying && c.ranged && !c._hoverOff) { updateFlying(c, world, dt, now); return; }

  const foe = pickFoe(world, c);
  const enemyBase = world.bases[opp(c.team)];
  const baseEdge = enemyBase.x - c.dir * (enemyBase.w / 2);
  const range = c.attackRange;
  const aggro = c.aggro * aggroMul(world) * moodAggroMul(c);
  const foeDist = foe ? Math.abs(foe.x - c.x) : Infinity;
  const useRanged = !!c.ranged;

  const mood = moodMoveMul(c);
  const hpR = c.hp / c.maxHp;

  if (foe && foeDist <= aggro && tryCreepSkill(c, world, foe, now)) return;
  const giant = isGiant(c);
  const skyDy = giant ? 340 : 100;
  const cantReachSky = foe?.flying && !c.flying && !useRanged && Math.abs((foe.y || 0) - (c.y || 0)) > skyDy;

  let mode, targetX, goalX, stopDist, rangedTarget = null;
  if (foe && foeDist <= aggro) {
    targetX = foe.x;
    if (useRanged && foeDist > range * 1.15) {
      mode = 'shoot'; rangedTarget = foe;
      const side = Math.sign(c.x - foe.x) || -c.dir;
      goalX = foe.x + side * c.ranged.range * (c.flying ? 0.42 : 0.65); stopDist = c.ranged.range;
    } else {
      mode = 'melee';
      const side = Math.sign(c.x - foe.x) || -c.dir;
      const stop = giant && foe.flying ? Math.min(range, 82) : range * 0.55;
      goalX = foe.x + side * stop; stopDist = giant && foe.flying ? 88 : range;
    }
  } else {
    mode = 'base'; targetX = baseEdge;
    goalX = baseEdge - c.dir * (useRanged ? c.ranged.range * 0.5 : range * 0.5);
    stopDist = useRanged ? c.ranged.range : range;
  }
  if (c.emotion === 'scared' && hpR < 0.38 && foe && foeDist < aggro) {
    goalX = c.x - c.dir * Math.min(200, foeDist * 0.55);
  } else if (c.emotion === 'angry' && foe && foeDist < aggro) {
    goalX = foe.x - (Math.sign(foe.x - c.x) || c.dir) * stopDist * 0.25;
  }
  ({ mode, goalX, stopDist } = confusedTactics(c, world, now, { mode, goalX, stopDist, foe, range, useRanged }));

  c.facing = Math.sign(targetX - c.x) || c.dir;
  const dist = Math.abs(c.x - targetX);
  const tooClose = mode === 'shoot' && dist < c.ranged.range * 0.4;
  const arrived = !tooClose && dist <= stopDist;

  // Blink trait: short hop toward the fight — never blink onto the enemy base.
  if (c.traits?.blink && mode !== 'base' && foe && !arrived && c.canAct(now) && now >= (c._blinkAt || 0)) {
    const M = TD.MOVE ?? {};
    const gap = Math.abs(goalX - c.x);
    if (gap >= (M.blinkMinGap ?? 100) && gap <= (M.blinkMaxGap ?? 320)) {
      const dir = Math.sign(goalX - c.x) || c.facing;
      c.x += dir * (M.blinkHop ?? 130);
      c.vx = 0;
      c._blinkAt = now + (M.blinkCdMs ?? 1600);
      c.needsDashDust = true;
    }
  }

  if ((!arrived || tooClose) && c.canAct(now)) {
    if (cantReachSky && !giant) maybeAntiAirJump(c, foe, world, now);
    if (mode === 'melee' && foe && (dist < 100 || (giant && foe.flying && foeDist < 200))) {
      maybeGrab(c, foe, world, now, cantReachSky || (giant && foe.flying) ? 'antiAir' : 'random');
    }
    const sp = Math.sign(goalX - c.x) * c.moveSpeed * mood;
    const accel = c.traits?.athletic ? 9000 : 3600;
    c.vx += Math.sign(sp - c.vx) * accel * dt;
    if (Math.sign(sp) === Math.sign(c.vx) && Math.abs(c.vx) > Math.abs(sp)) c.vx = sp;
    if (c.flying && !c._hoverOff) c.pose = Math.abs(c.vx) > 40 ? POSE.air : POSE.idle;
    else if (c.onGround()) c.pose = Math.abs(c.vx) > c.moveSpeed * 0.82 ? POSE.run : POSE.walk;
    if (!c.flying || c._hoverOff) maybeAthleticMove(c, world, Math.sign(goalX - c.x), dist, now);
    syncGroundAirPose(c);
  } else if (c.canAct(now)) {
    c.vx *= 0.8;
    if (c.flying && !c._hoverOff) c.pose = POSE.idle;
    else if (c.onGround() && c.pose !== POSE.punch && c.pose !== POSE.kick && c.pose !== POSE.grab) c.pose = POSE.idle;
    if (now >= c.nextAtkAt) {
      const lazy = !c.traits?.tireless && c.traits?.chill && world.rng() > 0.38;
      if (!lazy) {
        c.nextAtkAt = now + atkCd(c) * moodAtkMul(c);
        if (mode === 'shoot') { c.pose = POSE.punch; c.poseTime = 0; castCreepBolt(world, c, rangedTarget, now); }
        else if (mode === 'melee') {
          const grabReason = cantReachSky ? 'antiAir' : 'random';
          if (!maybeGrab(c, foe, world, now, grabReason)) {
            const atk = (c._antiAirUntil || 0) > now ? ATTACK.uppercut
              : (c.emotion === 'angry' && world.rng() < 0.35 ? ATTACK.cross : HEAVY(c));
            c.startAttack(atk, now);
          }
        }
        else if (Math.abs(c.x - baseEdge) <= TD.BASE_RANGE + range) { c.startAttack(HEAVY(c), now); c._pendingBaseHit = true; }
      }
    }
  }
  syncGroundAirPose(c);
  finishFlyerGround(c, world, now);
}

// Miner: haul gold from lane veins, panic-run home when fighters get close.
function minerMove(c, goalX, dt, mul) {
  const sp = Math.sign(goalX - c.x) * c.moveSpeed * mul;
  c.vx += Math.sign(sp - c.vx) * 4400 * dt;
  if (Math.sign(sp) === Math.sign(c.vx) && Math.abs(c.vx) > Math.abs(sp)) c.vx = sp;
}

function updateMiner(c, world, dt, now) {
  const home = world.bases[c.team];
  const scareDist = TD.ECONOMY.scareDist ?? 500;
  const foe = nearestEnemy(world, c);
  const scared = foe && foe.role !== 'miner' && Math.abs(foe.x - c.x) < scareDist;
  c.carryMax = c.carryMax || TD.ECONOMY.minerCarryMax || 28;
  c.facing = scared ? (Math.sign(home.x - c.x) || c.dir) : c.dir;

  if (!c.canAct(now)) return;
  if (depositMiner(c, world)) { c.vx *= 0.4; c.pose = POSE.idle; return; }

  if (scared) {
    c._targetNode = null;
    minerMove(c, home.x + c.dir * 55, dt, 1.5);
    c.pose = POSE.run;
    return;
  }

  const full = (c.carry || 0) >= c.carryMax * 0.92;
  if (full) {
    minerMove(c, home.x + c.dir * 55, dt, 0.9);
    c.pose = POSE.walk;
    return;
  }

  let node = c._targetNode;
  if (!node || node.gold < 4) node = c._targetNode = nearestGoldNode(world, c);
  if (!node) {
    minerMove(c, home.x + c.dir * 120, dt, 0.5);
    c.pose = POSE.walk;
    return;
  }

  if (Math.abs(c.x - node.x) > 26) {
    minerMove(c, node.x, dt, 0.78);
    c.pose = POSE.walk;
    return;
  }

  c.vx *= 0.65;
  c.pose = POSE.idle;
  collectGold(c, node, dt);
  if ((c.carry || 0) >= c.carryMax * 0.92 || node.gold < 4) c._targetNode = null;
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
