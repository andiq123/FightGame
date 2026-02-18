import { POSE } from '../entities/fighter.js';
import { applyKnockback } from './physics.js';
import { createRagdoll } from './ragdoll.js';
import { createHitEffect } from '../core/hitEffectFactory.js';
import { getHitEffectY, getCloneDissolveY, getRagdollOriginY } from '../core/coordinates.js';
import { spawnHitParticles, spawnCloneDissolve } from '../services/particleSystem.js';
import { ARENA_BOUNDS } from './physics.js';
import { COMBAT, PROJECTILE } from '../config/constants.js';

function getProjectileHitRadius(p) {
  return p.type === 'fireball' ? PROJECTILE.FIREBALL_HIT_RADIUS : PROJECTILE.HIT_RADIUS;
}

function segmentOverlapsInterval(segMin, segMax, center, radius) {
  return segMin <= center + radius && segMax >= center - radius;
}

export function tickProjectiles(projectiles, scaledDt) {
  projectiles.forEach(p => { p.x += p.vx * scaledDt; });
}

export function processProjectileHits(projectiles, fighter1, fighter2, clones, hitEffects, particles, now, scaledDt, rng) {
  const hitClones = new Set();
  const filtered = projectiles.filter(p => {
    const prevX = p.x - p.vx * scaledDt;
    const targetFighter = p.ownerId === 0 ? fighter2 : fighter1;
    const attacker = p.ownerId === 0 ? fighter1 : fighter2;
    const oppId = p.ownerId === 0 ? 1 : 0;
    const hitRadius = getProjectileHitRadius(p);
    const enemyClone = clones.find(c =>
      c.ownerId === oppId && (Math.abs(p.x - c.x) < hitRadius || (prevX - c.x) * (p.x - c.x) <= 0)
    );
    if (enemyClone) {
      hitClones.add(enemyClone);
      spawnCloneDissolve(particles, enemyClone.x, getCloneDissolveY(), rng);
      return false;
    }
    const segMin = Math.min(prevX, p.x);
    const segMax = Math.max(prevX, p.x);
    const hit = segmentOverlapsInterval(segMin, segMax, targetFighter.x, hitRadius);
    if (!hit) return Math.abs(p.x) < ARENA_BOUNDS + 80;
    if ((targetFighter.invincibleUntil || 0) > now) return Math.abs(p.x) < ARENA_BOUNDS + 80;
    const airborne = (targetFighter.y || 0) < -25;
    const blocking = targetFighter.blockUntil > now;
    if (targetFighter.shinraTenseiUntil > now) {
      spawnHitParticles(particles, targetFighter.x, getHitEffectY(), p.type === 'fireball', rng);
      hitEffects.push(createHitEffect(targetFighter.x, { shinraDeflect: true }));
      return false;
    }
    if (airborne) return Math.abs(p.x) < ARENA_BOUNDS + 80;
    let dmg = p.damage;
    if (blocking) dmg = Math.round(dmg * (p.heavy ? 0.5 : 0.2));
    targetFighter.hp = Math.max(0, targetFighter.hp - dmg);
    targetFighter.lastHitAt = now;
    targetFighter.hitsTakenLast5Sec = (targetFighter.hitsTakenLast5Sec || 0) + 1;
    attacker.damageDealt += dmg;
    targetFighter.stunUntil = now + (p.stun || 80);
    targetFighter.hitFlashUntil = now + (p.heavy ? 200 : 160);
    targetFighter.hitLastDmg = dmg;
    targetFighter.pose = blocking ? POSE.block : POSE.hit;
    const fromX = p.x - (p.vx > 0 ? 1 : -1) * 50;
    if (p.knockback && !blocking) applyKnockback(targetFighter, p.knockback, fromX, p.heavy);
    if (!blocking && p.heavy && targetFighter.staggerUntil <= now && targetFighter.hp > 0) {
      targetFighter.staggerUntil = now + COMBAT.STAGGER_DURATION_MS;
      targetFighter.currentAttack = null;
      targetFighter.pose = POSE.stagger;
      const fromX = p.x - (p.vx > 0 ? 1 : -1) * 60;
      targetFighter.staggerRagdoll = createRagdoll(
        targetFighter.x, getRagdollOriginY(targetFighter), targetFighter.facing, targetFighter.vx, targetFighter.vy, fromX, false
      );
    }
    hitEffects.push(createHitEffect(targetFighter.x, {
      dmg, fire: p.type === 'fireball', heavy: p.heavy, block: blocking
    }));
    spawnHitParticles(particles, targetFighter.x, getHitEffectY(), p.type === 'fireball', rng);
    return false;
  });
  return { projectiles: filtered, hitClones };
}
