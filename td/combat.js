import { POSE } from '../entities/fighter.js';
import { GRAB } from '../entities/attacks.js';
import { TD, opp } from './config.js';
import { spawnDeathPoof, spawnHitParticles } from '../services/particleSystem.js';
import { updateRagdoll, beginRagdollLaunch, commitRagdollLaunch } from '../engine/ragdoll.js';
import { meleeOverlapX } from '../core/hitbox.js';
import { COMBAT, PHYSICS } from '../config/constants.js';
import { applyGravity, applyAirDrag, integratePosition, clampToGround, applyFriction } from '../engine/physics.js';
import { aliveByX, eachNear, eachXPair } from './spatial.js';
import { dmgMulFor } from './events.js';

const perSecDamp = (factor, dt) => Math.pow(factor, dt * 60);
const slideCarry = (f) => f._ragdollLaunch || (f.pose === POSE.hit && (f.poseTime || 0) < 0.22);
// ponytail: scale threshold, not role string — giant creep is scale 1.92
const isGiant = (c) => (c?.scale || 1) >= 1.85;

// Stamina-gated evasion: a gassed creep can't weave. Tireless = always fresh.
export function evasion(f) {
  if (f.traits?.tireless) return 1;
  const r = (f.stamina ?? 1) / (f.maxStamina || 1);
  return r <= 0.05 ? 0.03 : r >= 0.2 ? 1 : 0.03 + (r - 0.05) / 0.15 * 0.97;
}

// Flyer knocked out of hover — fall, walk/fight, then reclimb high.
export function knockFlyerDown(unit, now, vx = 0, vy) {
  if (!unit?.flying || unit.traits?.unbreakable) return false;
  unit._hoverOff = true;
  unit._hideUntil = 0;
  if (vx) unit.vx = Math.max(-900, Math.min(900, unit.vx + vx));
  unit.vy = Math.max(unit.vy, vy ?? (TD.FLY?.knockVy ?? 130));
  return true;
}

function landGroundFight(f, now) {
  const F = TD.FLY ?? {};
  const extra = Math.max(0, (f._suppressedUntil || 0) - now);
  f._groundFightUntil = now + (F.groundMs ?? 3200) + extra;
  f._suppressedUntil = 0;
}

export function tickFlyerLandings(world, now) {
  const F = TD.FLY ?? {};
  for (const c of world.creeps) {
    if (!c._pendingLandRagdoll) continue;
    const vy = c._pendingLandRagdoll;
    c._pendingLandRagdoll = 0;
    const credit = c._crashCredit || opp(c.team);
    c._crashCredit = null;
    if (vy >= (F.landDmgVy ?? 140)) {
      const dmg = Math.round((vy - 100) * (F.landDmgScale ?? 0.22));
      const dealt = c.takeDamage(dmg, true, c.x, now);
      addHit(world, c.x, TD.GROUND_Y + c.y - 70 * (c.scale || 1), dealt, { heavy: true });
      if (c.hp <= 0) killCreep(world, c, credit, now);
    }
    if (vy < (F.landRagdollVy ?? 90) || world.rng() > (F.landRagdollChance ?? 0.62)) continue;
    ragdollKnockback(world, c, c.x - c.facing * 40, c.vx * 0.75, Math.max(vy * 0.5, 60), now);
  }
}

// Throw a creep into a physics ragdoll on a hard hit. `unbreakable` trait + a
// short grace after getting up prevent chain-ragdolling to death.
export function ragdollKnockback(world, unit, fromX, vx, vy, now, upward = false) {
  if (!unit || unit.hp <= 0 || (unit.flying && !unit._hoverOff) || unit.traits?.unbreakable) return false;
  if (unit.staggerRagdoll || unit._ragdollLaunch || unit.status.active('stagger', now)) return false;
  const grace = TD.RAGDOLL?.graceMs ?? 480;
  if (now < (unit.lastStaggerEndAt || 0) + grace) return false;
  return beginRagdollLaunch(unit, fromX, vx, vy, now, TD.RAGDOLL?.launchMs ?? 160, upward);
}

// Small hits on a giant only ragdoll after a burst in a short window.
function giantStackBlocks(unit, atkScale, now) {
  if (!isGiant(unit)) return false;
  const R = TD.RAGDOLL ?? {};
  if (atkScale >= (unit.scale || 1) * (R.giantAtkRatio ?? 0.72)) return false;
  const window = R.giantStackMs ?? 850;
  const need = R.giantStackHits ?? 4;
  let s = unit._ragdollStack;
  if (!s || now - s.t > window) s = unit._ragdollStack = { n: 0, t: now };
  s.n++;
  s.t = now;
  return s.n < need;
}

function finishRagdoll(unit, ok) {
  if (ok) unit._ragdollStack = null;
  return ok;
}

// Shared TD ragdoll gate — one place for melee, bolts, throws, slams.
export function tryTdRagdoll(world, unit, fromX, vx, vy, now, opts = {}) {
  if (giantStackBlocks(unit, opts.attackerScale ?? 1, now)) return false;
  const R = TD.RAGDOLL ?? {};
  if (opts.knockdown || opts.kickLaunch || opts.force) {
    return finishRagdoll(unit, ragdollKnockback(world, unit, fromX, vx, vy, now));
  }
  if ((unit.scale || 1) >= (R.scaleMin ?? 1.1) || (opts.dmg ?? 0) >= (R.dmgMin ?? 34)) {
    return finishRagdoll(unit, ragdollKnockback(world, unit, fromX, vx, vy, now));
  }
  if (opts.heavy && world.rng() < (R.heavyChance ?? 0.78)) {
    return finishRagdoll(unit, ragdollKnockback(world, unit, fromX, vx, vy, now));
  }
  if (world.rng() < (R.lightChance ?? 0.2)) {
    return finishRagdoll(unit, ragdollKnockback(world, unit, fromX, vx, vy * 0.9, now));
  }
  return false;
}

export function tickRagdolls(world, dt, now) {
  const obs = world.obstacles || [];
  for (const c of world.creeps) {
    commitRagdollLaunch(c, now, COMBAT.STAGGER_DURATION_MS);
    if (c.staggerRagdoll) updateRagdoll(c.staggerRagdoll, dt, now, obs, c.tdCreep ? 5 : undefined);
  }
}

function creepById(world, id) {
  return world.creeps.find(c => c.id === id);
}

// Vertical reach for melee — jumpers and anti-air leaps swat flyers.
export function meleeVerticalOk(c, o, now = 0) {
  const dy = Math.abs((o.y || 0) - (c.y || 0));
  let reach = 90 + 50 * (c.scale || 1);
  if (!c.onGround()) reach += 150 + Math.min(90, Math.abs(c.y || 0) * 0.45);
  if ((c._antiAirUntil || 0) > now) reach += 110;
  if (c.flying) reach += 50;
  if (o.flying && c.onGround() && (c._antiAirUntil || 0) <= now && !isGiant(c)) reach = 75;
  if (isGiant(c) && o.flying) reach = Math.max(reach, 120 + Math.abs(o.y || 0) * 0.55);
  return dy <= reach;
}

function startGrapple(world, c, o, now) {
  if (o._heldBy || c._grabbing || o.traits?.unbreakable) return false;
  if ((o.scale || 1) > (c.scale || 1) * (TD.GRAB?.maxScaleRatio ?? 1.55)) return false;
  if (Math.abs((o.y || 0) - (c.y || 0)) > 200 && !(c.onGround() && o.flying)) return false;
  c._grabbing = o.id;
  c._grabStarted = now;
  c.currentAttack = null;
  c.pose = POSE.grab;
  c.poseTime = 0;
  o._heldBy = c.id;
  o.currentAttack = null;
  o.vx = o.vy = 0;
  o.pose = POSE.hit;
  o.poseTime = 0;
  o.status.set('stun', now + 900);
  if (o.flying) o._hoverOff = true;
  return true;
}

function throwHeld(world, c, v, now) {
  c._grabbing = null;
  v._heldBy = null;
  c.pose = POSE.idle;
  const r = world.rng;
  const dir = c.facing;
  const pow = (c.scale || 1) * (c.dmg / 18);
  v.pose = POSE.hit;
  v.poseTime = 0;
  if (v.flying) {
    v._suppressedUntil = now + 2600;
    v._hoverOff = true;
  }
  const giant = isGiant(c);
  v.vx = dir * ((giant ? 560 : 420) + pow * (giant ? 48 : 35) + r() * (giant ? 200 : 140));
  v.vy = -((giant ? 240 : 150) + r() * (giant ? 260 : 200) + pow * (giant ? 22 : 16));
  v._crashCredit = c.team;
  if (TD.RAGDOLL?.throwAlways !== false) {
    tryTdRagdoll(world, v, c.x, v.vx, v.vy, now, { force: true, attackerScale: c.scale });
  }
  const dmg = Math.round(c.dmg * 0.9 * dmgMulFor(world, c.team));
  const dealt = v.takeDamage(dmg, true, c.x, now);
  v.status.set('stun', now + 440);
  addHit(world, v.x, TD.GROUND_Y + v.y - 70 * (v.scale || 1), dealt, { heavy: true });
  world.screenShake = Math.min(32, world.screenShake + 11);
  if (v.hp <= 0) killCreep(world, v, c.team, now);
}

export function tickGrapples(world, now) {
  for (const c of world.creeps) {
    if (!c._grabbing) continue;
    const v = creepById(world, c._grabbing);
    if (!v || v.hp <= 0 || v._heldBy !== c.id) { c._grabbing = null; continue; }
    const pinY = c.flying ? c.y - 30 : (v.flying ? Math.max(v.y, c.y - 90) : c.y - 10);
    v.x = c.x + c.facing * (32 + 16 * (v.scale || 1));
    v.y += (pinY - v.y) * 0.38;
    v.vx = v.vy = 0;
    c.vx *= 0.65;
    c.pose = POSE.grab;
    if (now - (c._grabStarted || now) >= 340) throwHeld(world, c, v, now);
  }
}

// High leaps — random balance fail → ragdoll tumble.
export function tickAirBalance(world, dt, now) {
  const M = TD.MOVE;
  for (const c of world.creeps) {
    if (c._heldBy || c.staggerRagdoll || c.hp <= 0) continue;
    if (c.flying && !c._hoverOff) continue;
    if (c.onGround()) { c._airTime = 0; continue; }
    if (c.traits?.unbreakable && c.role !== 'bowler') continue;
    c._airTime = (c._airTime || 0) + dt;
    const high = c.y <= (M.airWobbleY ?? -110);
    const falling = c.vy > 60;
    const bowling = c.role === 'bowler' && c._bowlerJump;
    if (!high && !bowling && !((c._antiAirUntil || 0) > now && c.y < -80)) continue;
    let chance = (M.airWobbleChance ?? 0.022) * dt * 60;
    if (c.traits?.athletic) chance *= 0.45;
    if (bowling) chance *= (TD.BOWLER?.wobbleMul ?? 3.4);
    if (falling && high) chance *= 1.6;
    if (c._airTime < 0.08 || world.rng() > chance) continue;
    if (bowling) c._bowling = true;
    ragdollKnockback(world, c, c.x - c.facing * 50, c.vx * 0.85, Math.max(c.vy, 100), now);
    c._bowlerJump = false;
    c._airTime = 0;
  }
}

// Bowler landing slam + ragdoll bowling hits.
export function tickBowler(world, now) {
  const B = TD.BOWLER;
  for (const c of world.creeps) {
    if (c.role !== 'bowler' || c.hp <= 0) continue;
    if (c._bowling && !c.staggerRagdoll) { c._bowling = false; c._bowlHits = null; }

    if (c._bowling && c.staggerRagdoll) {
      const spd = Math.hypot(c.vx, c.vy);
      if (spd < (B.minHitSpeed ?? 125)) continue;
      c._bowlHits = c._bowlHits || new Set();
      for (const o of world.creeps) {
        if (o.team === c.team || o.hp <= 0) continue;
        if (Math.abs(o.x - c.x) > 40 + 28 * (o.scale || 1)) continue;
        if (Math.abs((o.y || 0) - (c.y || 0)) > 95) continue;
        const key = o.id;
        if (c._bowlHits.has(key)) continue;
        c._bowlHits.add(key);
        const dmg = Math.round(((B.hitDmg ?? 26) + spd * (B.hitSpdScale ?? 0.075)) * dmgMulFor(world, c.team));
        const dealt = o.takeDamage(dmg, true, c.x, now);
        o.pose = POSE.hit; o.poseTime = 0;
        ragdollKnockback(world, o, c.x, Math.sign(o.x - c.x || c.facing) * (280 + spd * 0.25), -180, now);
        addHit(world, o.x, TD.GROUND_Y + o.y - 70 * (o.scale || 1), dealt, { heavy: true });
        if (o.hp <= 0) killCreep(world, o, c.team, now);
      }
      continue;
    }

    if (!c._bowlerJump || !c.onGround() || (c._slamVy || 0) < (B.minSlamVy ?? 150)) continue;
    const vy = c._slamVy;
    c._bowlerJump = false;
    c._slamVy = 0;
    for (const o of world.creeps) {
      if (o.team === c.team || o.hp <= 0) continue;
      if (Math.abs(o.x - c.x) > (B.slamRadius ?? 80) + 26 * (o.scale || 1)) continue;
      if (Math.abs((o.y || 0) - (c.y || 0)) > 100) continue;
      const dmg = Math.round((c.dmg * (B.slamDmgMul ?? 2.2) + vy * 0.085) * dmgMulFor(world, c.team));
      const dealt = o.takeDamage(dmg, true, c.x, now);
      o.pose = POSE.hit; o.poseTime = 0;
      ragdollKnockback(world, o, c.x, Math.sign(o.x - c.x || c.facing) * (380 + vy * 0.15), -240, now);
      addHit(world, o.x, TD.GROUND_Y + o.y - 70 * (o.scale || 1), dealt, { heavy: true });
      if (o.hp <= 0) killCreep(world, o, c.team, now);
    }
    addHit(world, c.x, TD.GROUND_Y - 40, Math.round(c.dmg * 0.5), { heavy: true });
    world.screenShake = Math.min(36, world.screenShake + 16);
    if (world.rng() < (B.selfTumble ?? 0.42) + vy * 0.00015) {
      c._bowling = true;
      ragdollKnockback(world, c, c.x, c.vx * 0.75, -100, now);
    }
  }
}

// Shared gravity / drag / friction from engine/physics.js — one model for TD + arena.
export function integrate(f, dt, now = 0) {
  if (f.staggerRagdoll || f._heldBy) return;
  const gy = f.groundY || 0;
  const lim = TD.STAGE_HALF - 40;
  const wall = () => {
    if (f.x < -lim) { f.x = -lim; f.vx *= PHYSICS.WALL_BOUNCE ?? 0.25; }
    if (f.x > lim) { f.x = lim; f.vx *= PHYSICS.WALL_BOUNCE ?? 0.25; }
  };
  const groundStep = (wasAirCheck = true) => {
    const wasAir = wasAirCheck && f.y < gy - 3;
    applyGravity(f, dt);
    applyAirDrag(f, dt);
    integratePosition(f, dt, now);
    if (wasAirCheck && f.y >= gy && wasAir && f.vy > 100 && now) {
      f.impactFrictionUntil = Math.max(f.impactFrictionUntil || 0, now + (PHYSICS.IMPACT_FRICTION_MS ?? 360));
    }
    clampToGround(f);
    if (f.onGround() && !slideCarry(f)) {
      f.vx *= perSecDamp(PHYSICS.FRICTION_GROUND ?? 0.9, dt);
      if (Math.abs(f.vx) <= (PHYSICS.VELOCITY_DEADZONE ?? 10)) f.vx = 0;
    }
    if (!slideCarry(f)) applyFriction(f, dt, now);
    wall();
  };

  if (f.flying && f._hoverOff) {
    if (!f.onGround()) {
      applyGravity(f, dt);
      applyAirDrag(f, dt);
      integratePosition(f, dt, now);
      if (f.y >= gy && f.vy > 0) f._pendingLandRagdoll = Math.max(f._pendingLandRagdoll || 0, f.vy);
      clampToGround(f);
      if (f.onGround() && !slideCarry(f)) {
        f.vx *= perSecDamp(PHYSICS.FRICTION_GROUND ?? 0.9, dt);
        landGroundFight(f, now);
      }
      if (!slideCarry(f)) applyFriction(f, dt, now);
      wall();
      return;
    }
    if ((f._groundFightUntil || 0) > now) {
      groundStep(false);
      return;
    }
    f._hoverOff = false;
  }

  if (f.flying) {
    const hover = f._hoverY ?? f.hoverY ?? -140;
    f.vy += (hover - f.y) * 5 * dt;
    f.y += f.vy * dt;
    f.vy *= 0.82;
    f.vx *= perSecDamp(PHYSICS.FRICTION_AIR ?? 0.994, dt);
    f.x += f.vx * dt;
    const lim = TD.STAGE_HALF - 40;
    if (f.x < -lim) { f.x = -lim; f.vx = 0; }
    if (f.x > lim) { f.x = lim; f.vx = 0; }
    return;
  }
  const wasAir = f.y < gy - 3;
  if (f.role === 'bowler' && f._bowlerJump && !f.onGround()) {
    applyGravity(f, dt);
    f.vx *= perSecDamp(0.997, dt);
    integratePosition(f, dt, now);
    if (f.y >= gy && wasAir && f.vy > 0) f._slamVy = Math.max(f._slamVy || 0, f.vy);
    clampToGround(f);
  } else {
    applyGravity(f, dt);
    applyAirDrag(f, dt);
    integratePosition(f, dt, now);
    if (f.y >= gy && wasAir && f.vy > 100 && now) {
      f.impactFrictionUntil = Math.max(f.impactFrictionUntil || 0, now + (PHYSICS.IMPACT_FRICTION_MS ?? 360));
    }
    clampToGround(f);
  }
  if (f.onGround() && !slideCarry(f)) {
    f.vx *= perSecDamp(PHYSICS.FRICTION_GROUND ?? 0.9, dt);
    if (Math.abs(f.vx) <= (PHYSICS.VELOCITY_DEADZONE ?? 10)) f.vx = 0;
  }
  if (!slideCarry(f)) applyFriction(f, dt, now);
  wall();
}

function addHit(world, x, y, dmg, opts = {}) {
  world.hitEffects.push({ x, y, t: 0, dmg, heavy: !!opts.heavy, crit: false, counter: false });
  if (world.hitEffects.length > 48) world.hitEffects.splice(0, world.hitEffects.length - 48);
  spawnHitParticles(world.particles, x, y, !!opts.heavy, world.rng);
  world.screenShake = Math.min(26, world.screenShake + (opts.heavy ? 14 : 6));
}

// Every creep's active melee against enemy creeps (once per attack per victim).
// Damage comes from the attacker's own dmg pool; the hitbox only times/positions
// the blow and supplies knockback. Traits: untouchable dodges, perfectStrike
// ignores that dodge, seriousPunch turns a heavy hit near-lethal.
export function resolveCreepAttacks(world, now) {
  const near = world._aliveByX || aliveByX(world.creeps);
  for (const c of world.creeps) {
    if (c.hp <= 0 || c.role === 'miner' || c.role === 'bowler') continue;
    const hb = c.getAttackHitbox?.(now);
    if (!hb) continue;
    if (!c._hitSet || c._hitAtkId !== c.currentAttack.started) {
      c._hitSet = new Set();
      c._hitAtkId = c.currentAttack.started;
    }
    const scanR = hb.w * 0.5 + 130;
    eachNear(near, hb.x, scanR, (o) => {
      if (o.team === c.team || c._hitSet.has(o.id)) return;
      if (!meleeOverlapX(hb, c, o)) return;
      if (!meleeVerticalOk(c, o, now)) return;
      c._hitSet.add(o.id);
      if (hb.type === GRAB) {
        if (startGrapple(world, c, o, now)) return;
      }
      if (o.traits?.untouchable && !c.traits?.perfectStrike && world.rng() < 0.99 * evasion(o)) {
        world.hitEffects.push({ x: o.x, y: TD.GROUND_Y + o.y - 70, t: 0, dmg: 0, block: true });
        return;
      }
      const heavy = hb.knockback > 45;
      let dmg = Math.round(c.dmg * (heavy ? 1.3 : 1) * dmgMulFor(world, c.team));
      if (c.traits?.seriousPunch && heavy) dmg = Math.round(dmg * 3.2);
      const dealt = o.takeDamage(dmg, heavy, c.x, now);
      const size = o.scale || 1;
      o.pose = POSE.hit; o.poseTime = 0;
      o.currentAttack = null;
      o.status.set('stun', now + (heavy ? 320 : 130));
      const push = TD.RAGDOLL?.pushMul ?? 1.22;
      const antiAir = o.flying && ((c._antiAirUntil || 0) > now || !c.onGround() || isGiant(c));
      if (antiAir && isGiant(c)) o._crashCredit = c.team;
      const kbX = c.facing * (540 + 220 * (c.scale || 1) + hb.knockback * 3) * push;
      const kbY = o.flying ? Math.max(140, 90 + hb.knockback * 1.2) : ((!o.flying && (hb.kickLaunch || hb.knockdown)) ? -320 : -240);
      const ragdolled = tryTdRagdoll(world, o, c.x, kbX, kbY, now, {
        heavy, dmg: dealt, knockdown: hb.knockdown || antiAir,
        kickLaunch: (hb.kickLaunch && !o.flying) || antiAir,
        attackerScale: c.scale,
      });
      if (ragdolled) world.screenShake = Math.min(40, world.screenShake + 12);
      else {
        o.vx += c.facing * hb.knockback * (heavy ? 9.5 : 6.5) * push;
        if (o.flying && (heavy || antiAir || dealt >= 22)) {
          knockFlyerDown(o, now, c.facing * (antiAir ? 360 : 240), antiAir ? 220 : 160);
        }
        if (!o.flying && (hb.kickLaunch || hb.knockdown)) o.vy = -280;
        if (!o.flying && heavy) {
          o.impactFrictionUntil = Math.max(o.impactFrictionUntil || 0, now + (PHYSICS.IMPACT_FRICTION_MS ?? 360));
        }
      }
      if (o.flying && ragdolled && (heavy || antiAir || dealt >= 22)) {
        knockFlyerDown(o, now, c.facing * (antiAir ? 360 : 240), antiAir ? 220 : 160);
      }
      addHit(world, o.x, TD.GROUND_Y + o.y - 70 * size, dealt, { heavy });
      if (o.hp <= 0) killCreep(world, o, c.team, now);
    });
  }
}

// Apply creeps' attacks against the enemy base during the active hit window.
export function resolveCreepVsBase(world, now) {
  for (const c of world.creeps) {
    if (c.hp <= 0 || c.role === 'miner' || !c._pendingBaseHit) continue;
    const a = c.currentAttack;
    if (!a) { c._pendingBaseHit = false; continue; }
    const elapsed = now - a.started;
    if (elapsed < a.data.duration * 0.3 || elapsed > a.data.duration * 0.72) continue;
    c._pendingBaseHit = false;
    const base = world.bases[opp(c.team)];
    const edge = base.x - c.dir * (base.w / 2);
    if (base.hp > 0 && Math.abs(c.x - edge) <= TD.BASE_RANGE + c.attackRange) {
      const dmg = Math.round(c.baseDmg * dmgMulFor(world, c.team));
      base.hp = Math.max(0, base.hp - dmg);
      addHit(world, edge, TD.GROUND_Y - 120, dmg, { heavy: true });
    }
  }
}

// Credit a death once to the killing team's purse + scoreboard.
export function killCreep(world, c, killerTeam, now) {
  c._dead = true;
  if (c._credited) return;
  c._credited = true;
  const b = world.bases[killerTeam];
  b.gold += Math.round((c.reward || 0) * TD.ECONOMY.killBountyMul);
  b.kills = (b.kills || 0) + 1;
  const y = TD.GROUND_Y + c.y - 55 * (c.scale || 1);
  spawnDeathPoof(world.particles, c.x, y, c.scale || 1, world.rng);
  if (world.hitEffects.length < 48) {
    world.hitEffects.push({ x: c.x, y, t: 0, death: true, color: c.color, dmg: 0, _sfx: true });
  }
}

export function reapCreeps(world, now) {
  // Deaths from sources that skip killCreep (DoT, base arrows w/o credit) go to
  // the opposing team.
  for (const c of world.creeps) if (c.hp <= 0 && !c._credited) killCreep(world, c, opp(c.team), now);
  world.creeps = world.creeps.filter(c => !c._dead);
}

// Keep same-lane creeps from stacking into a blob.
export function separateCreeps(world) {
  const sorted = world._aliveByX || aliveByX(world.creeps);
  eachXPair(sorted, 100, (a, b) => {
    if (a.flying !== b.flying) return;
    const aAir = a.flying && !a._hoverOff;
    const bAir = b.flying && !b._hoverOff;
    if (aAir !== bAir) return;
    const minGap = (aAir ? 44 : 34 * (a.scale || 1)) + (bAir ? 44 : 34 * (b.scale || 1));
    const dx = b.x - a.x;
    const d = Math.abs(dx);
    if (d >= minGap) return;
    const push = (minGap - d) * 0.5;
    const dir = d > 0.001 ? (dx > 0 ? 1 : -1) : 1;
    a.x -= dir * push;
    b.x += dir * push;
  });
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('combat.js')) {
  const f = { y: -80, vy: 0, vx: 400, groundY: 0, onGround() { return this.y >= (this.groundY || 0) - 3; }, impactFrictionUntil: 0 };
  for (let i = 0; i < 40; i++) integrate(f, 1 / 60, i * 16);
  console.assert(f.y === 0 && f.vy === 0, 'gravity lands on ground');
  console.assert(f.vx < 400, 'ground friction slows slide');
  console.assert(meleeVerticalOk({ y: -180, onGround() { return false; }, scale: 1, _antiAirUntil: 9999 }, { y: -240, flying: true }, 1000), 'anti-air reaches flyer');
  console.assert(meleeVerticalOk({ y: 0, onGround() { return true; }, scale: 1.92 }, { y: -220, flying: true }, 0), 'giant swats nearby flyer');
  const giant = { scale: 1.92, _ragdollStack: null };
  const R = TD.RAGDOLL ?? {};
  const now = 1000;
  console.assert(giantStackBlocks(giant, 0.88, now), 'one small hit does not ragdoll giant');
  console.assert(giantStackBlocks(giant, 0.88, now + 10), 'two');
  console.assert(giantStackBlocks(giant, 0.88, now + 20), 'three');
  console.assert(!giantStackBlocks(giant, 0.88, now + 30), 'fourth hit in window opens ragdoll');
  console.assert(!giantStackBlocks(giant, 1.55, now + 40), 'heavy attacker skips stack');
  console.assert((TD.RAGDOLL?.lightChance ?? 0) > 0.1, 'ragdoll light chance tuned');
  const fly = { flying: true, _hoverOff: true, y: -120, vy: 200, vx: 0, groundY: 0, onGround() { return this.y >= (this.groundY || 0) - 3; } };
  for (let i = 0; i < 80; i++) integrate(fly, 1 / 60, i * 16);
  console.assert(fly.onGround() && (fly._groundFightUntil || 0) > 0, 'knocked flyer lands and ground-fights');
  console.log('combat physics ok');
}
