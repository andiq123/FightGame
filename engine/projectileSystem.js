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
  projectiles.forEach(p => {
    p.x += (p.vx || 0) * scaledDt;
    p.y += (p.vy || 0) * scaledDt;
  });
}

export function processProjectileHits(projectiles, fighter1, fighter2, clones, hitEffects, particles, now, scaledDt, rng) {
  const hitClones = new Set();
  const filtered = projectiles.filter(p => {
    const prevX = p.x - (p.vx || 0) * scaledDt;
    const prevY = (p.y || 0) - (p.vy || 0) * scaledDt;
    const targetFighter = p.ownerId === 0 ? fighter2 : fighter1;
    const attacker = p.ownerId === 0 ? fighter1 : fighter2;
    const oppId = p.ownerId === 0 ? 1 : 0;
    const hitRadius = getProjectileHitRadius(p);

    // 1. Clone Collision
    const enemyClone = clones.find(c =>
      c.ownerId === oppId && (Math.abs(p.x - c.x) < hitRadius || (prevX - c.x) * (p.x - c.x) <= 0) && Math.abs(p.y || 0) < 50
    );
    if (enemyClone) {
      hitClones.add(enemyClone);
      spawnCloneDissolve(particles, enemyClone.x, getCloneDissolveY(), rng);
      return false;
    }

    // 2. Fighter Collision (X & Y check)
    const segMinX = Math.min(prevX, p.x);
    const segMaxX = Math.max(prevX, p.x);
    const hitX = segmentOverlapsInterval(segMinX, segMaxX, targetFighter.x, hitRadius);

    // Check if Y is within fighter height (roughly -80 to 0)
    const fighterTop = (targetFighter.y || 0) - 85;
    const fighterBottom = (targetFighter.y || 0);
    const segMinY = Math.min(prevY, p.y || 0);
    const segMaxY = Math.max(prevY, p.y || 0);
    const hitY = segMinY <= fighterBottom && segMaxY >= fighterTop;

    if (hitX && hitY) {
      if (targetFighter.status.active('invincible', now)) return Math.abs(p.x) < ARENA_BOUNDS + 150;

      const blocking = targetFighter.status.active('block', now);
      if (targetFighter.status.active('shinraTensei', now)) {
        spawnHitParticles(particles, targetFighter.x, (p.y || 0), p.type === 'fireball', rng);
        hitEffects.push(createHitEffect(targetFighter.x, { shinraDeflect: true }));
        return false;
      }

      let dmg = p.damage;
      if (blocking) dmg = Math.round(dmg * (p.heavy ? 0.5 : 0.2));

      targetFighter.takeDamage(dmg, p.heavy === true, attacker.x, now);
      attacker.damageDealt += dmg;
      targetFighter.status.set('stun', now + (p.stun || 80));
      targetFighter.status.set('hitFlash', now + (p.heavy ? 200 : 160));
      targetFighter.hitLastDmg = dmg;
      targetFighter.pose = blocking ? POSE.block : POSE.hit;

      if (p.type === 'fireball' && !blocking) {
        targetFighter.status.set('burning', now + 4000);
      }

      const fromX = p.x - ((p.vx || 0) > 0 ? 1 : -1) * 50;
      if (p.knockback && !blocking) applyKnockback(targetFighter, p.knockback, fromX, p.heavy);

      if (!blocking && p.heavy && !targetFighter.status.active('stagger', now) && targetFighter.hp > 0) {
        targetFighter.status.set('stagger', now + COMBAT.STAGGER_DURATION_MS);
        targetFighter.currentAttack = null;
        targetFighter.pose = POSE.stagger;
        targetFighter.staggerRagdoll = createRagdoll(
          targetFighter.x, getRagdollOriginY(targetFighter), targetFighter.facing, targetFighter.vx, targetFighter.vy, fromX, false
        );
      }

      hitEffects.push(createHitEffect(targetFighter.x, {
        dmg, fire: p.type === 'fireball', heavy: p.heavy, block: blocking
      }));
      spawnHitParticles(particles, targetFighter.x, (p.y || 0), p.type === 'fireball', rng);
      return false;
    }

    // 3. Ground Collision for vertical projectiles
    if ((p.y || 0) > 0 && (p.vy || 0) > 0) {
      spawnHitParticles(particles, p.x, 0, p.type === 'fireball', rng);
      return false;
    }

    return Math.abs(p.x) < ARENA_BOUNDS + 150 && (p.y || 0) < 100;
  });
  return { projectiles: filtered, hitClones };
}
