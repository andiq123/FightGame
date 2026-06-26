import { POSE } from '../entities/fighter.js';
import { TD, opp } from './config.js';
import { spawnHitParticles } from '../services/particleSystem.js';
import { createRagdoll, updateRagdoll } from '../engine/ragdoll.js';
import { getRagdollOriginY } from '../core/coordinates.js';
import { COMBAT } from '../config/constants.js';

// Stamina-gated evasion: a gassed creep can't weave. 0…1 multiplier on dodge.
export function evasion(f) {
  const r = (f.stamina ?? 1) / (f.maxStamina || 1);
  return r <= 0.05 ? 0.03 : r >= 0.2 ? 1 : 0.03 + (r - 0.05) / 0.15 * 0.97;
}

// Throw a creep into a physics ragdoll on a hard hit. `unbreakable` trait + a
// short grace after getting up prevent chain-ragdolling to death.
export function ragdollKnockback(world, unit, fromX, vx, vy, now) {
  if (!unit || unit.hp <= 0 || unit.traits?.unbreakable) return false;
  if (unit.staggerRagdoll || unit.status.active('stagger', now)) return false;
  if (now < (unit.lastStaggerEndAt || 0) + 900) return false;
  unit.vx = Math.max(-1300, Math.min(1300, vx));
  unit.vy = Math.min(unit.vy, vy);
  unit.status.set('stagger', now + COMBAT.STAGGER_DURATION_MS);
  unit.currentAttack = null;
  unit.pose = POSE.stagger;
  unit.staggerRagdoll = createRagdoll(unit.x, getRagdollOriginY(unit), unit.facing, unit.vx, unit.vy, fromX, false, now);
  return true;
}

export function tickRagdolls(world, dt, now) {
  const obs = world.obstacles || [];
  for (const c of world.creeps) if (c.staggerRagdoll) updateRagdoll(c.staggerRagdoll, dt, now, obs);
}

// Simple gravity + ground clamp + stage bounds.
export function integrate(f, dt) {
  if (f.staggerRagdoll) return;
  f.vy += TD.GRAVITY * dt;
  f.y += f.vy * dt;
  if (f.y >= 0) { f.y = 0; if (f.vy > 0) f.vy = 0; }
  f.x += f.vx * dt;
  const lim = TD.STAGE_HALF - 40;
  if (f.x < -lim) { f.x = -lim; f.vx = 0; }
  if (f.x > lim) { f.x = lim; f.vx = 0; }
}

function addHit(world, x, y, dmg, opts = {}) {
  world.hitEffects.push({ x, y, t: 0, dmg, heavy: !!opts.heavy, crit: false, counter: false });
  spawnHitParticles(world.particles, x, y, !!opts.heavy, world.rng);
  world.screenShake = Math.min(26, world.screenShake + (opts.heavy ? 14 : 6));
}

// Every creep's active melee against enemy creeps (once per attack per victim).
// Damage comes from the attacker's own dmg pool; the hitbox only times/positions
// the blow and supplies knockback. Traits: untouchable dodges, perfectStrike
// ignores that dodge, seriousPunch turns a heavy hit near-lethal.
export function resolveCreepAttacks(world, now) {
  for (const c of world.creeps) {
    if (c.hp <= 0) continue;
    const hb = c.getAttackHitbox?.(now);
    if (!hb) continue;
    if (!c._hitSet || c._hitAtkId !== c.currentAttack.started) {
      c._hitSet = new Set();
      c._hitAtkId = c.currentAttack.started;
    }
    for (const o of world.creeps) {
      if (o.team === c.team || o.hp <= 0 || c._hitSet.has(o.id)) continue;
      const half = (o.attackRange * 0.5) + hb.w * 0.5 + 18 * (o.scale || 1);
      if (Math.abs(o.x - hb.x) > half) continue;
      if (o.y < -160) continue;
      c._hitSet.add(o.id);
      if (o.traits?.untouchable && !c.traits?.perfectStrike && world.rng() < 0.99 * evasion(o)) {
        world.hitEffects.push({ x: o.x, y: TD.GROUND_Y + o.y - 70, t: 0, dmg: 0, block: true });
        continue;
      }
      const heavy = hb.knockback > 45;
      let dmg = Math.round(c.dmg * (heavy ? 1.3 : 1));
      if (c.traits?.seriousPunch && heavy) dmg = Math.round(dmg * 3.2);
      const dealt = o.takeDamage(dmg, heavy, c.x, now);
      const size = o.scale || 1;
      o.vx += c.facing * hb.knockback * 6;
      if (hb.kickLaunch || hb.knockdown) o.vy = -260;
      o.pose = POSE.hit; o.poseTime = 0;
      o.currentAttack = null;
      o.status.set('stun', now + (heavy ? 320 : 130));
      const hard = (c.scale || 1) >= 1.3 || dmg >= 60;
      if (hard && ragdollKnockback(world, o, c.x, c.facing * (470 + 210 * (c.scale || 1)), -280, now)) {
        world.screenShake = Math.min(40, world.screenShake + 12);
      }
      addHit(world, o.x, TD.GROUND_Y + o.y - 70 * size, dealt, { heavy });
      if (o.hp <= 0) killCreep(world, o, c.team, now);
    }
  }
}

// Apply creeps' attacks against the enemy base during the active hit window.
export function resolveCreepVsBase(world, now) {
  for (const c of world.creeps) {
    if (c.hp <= 0 || !c._pendingBaseHit) continue;
    const a = c.currentAttack;
    if (!a) { c._pendingBaseHit = false; continue; }
    const elapsed = now - a.started;
    if (elapsed < a.data.duration * 0.3 || elapsed > a.data.duration * 0.72) continue;
    c._pendingBaseHit = false;
    const base = world.bases[opp(c.team)];
    const edge = base.x - c.dir * (base.w / 2);
    if (base.hp > 0 && Math.abs(c.x - edge) <= TD.BASE_RANGE + c.attackRange) {
      base.hp = Math.max(0, base.hp - c.baseDmg);
      addHit(world, edge, TD.GROUND_Y - 120, c.baseDmg, { heavy: true });
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
  spawnHitParticles(world.particles, c.x, TD.GROUND_Y + c.y - 60, true, world.rng);
}

export function reapCreeps(world, now) {
  // Deaths from sources that skip killCreep (DoT, base arrows w/o credit) go to
  // the opposing team.
  for (const c of world.creeps) if (c.hp <= 0 && !c._credited) killCreep(world, c, opp(c.team), now);
  world.creeps = world.creeps.filter(c => !c._dead);
}

// Keep same-lane creeps from stacking into a blob.
export function separateCreeps(world) {
  const cs = world.creeps;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    if (a.hp <= 0 || a.y < -20) continue;
    for (let j = i + 1; j < cs.length; j++) {
      const b = cs[j];
      if (b.hp <= 0 || b.y < -20) continue;
      const minGap = 34 * (a.scale || 1) + 34 * (b.scale || 1);
      const dx = b.x - a.x;
      const d = Math.abs(dx);
      if (d < minGap) {
        const push = (minGap - d) * 0.5;
        const dir = d > 0.001 ? (dx > 0 ? 1 : -1) : 1;
        a.x -= dir * push;
        b.x += dir * push;
      }
    }
  }
}
