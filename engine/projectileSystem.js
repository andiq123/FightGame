import { POSE } from '../entities/fighter.js';
import { applyKnockback } from './physics.js';
import { createRagdoll } from './ragdoll.js';
import { createHitEffect } from '../core/hitEffectFactory.js';
import { getHitEffectY, getCloneDissolveY, getRagdollOriginY } from '../core/coordinates.js';
import { spawnHitParticles, spawnCloneDissolve } from '../services/particleSystem.js';
import { ARENA_BOUNDS } from './physics.js';
import { COMBAT, PROJECTILE } from '../config/constants.js';
import { trySharinganCounter } from './combat.js';

function getProjectileHitRadius(p) {
  return p.type === 'fireball' ? PROJECTILE.FIREBALL_HIT_RADIUS : PROJECTILE.HIT_RADIUS;
}

function getProjectileY(p) {
  return p.y || 0;
}

function segmentOverlapsInterval(segMin, segMax, center, radius) {
  return segMin <= center + radius && segMax >= center - radius;
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 0.0001) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return { x: ax + abx * t, y: ay + aby * t };
}

function sweptProjectilesCollide(a, b, scaledDt) {
  if (a.ownerId === b.ownerId) return false;

  const ax0 = a.x - (a.vx || 0) * scaledDt;
  const ay0 = getProjectileY(a) - (a.vy || 0) * scaledDt;
  const ax1 = a.x;
  const ay1 = getProjectileY(a);
  const bx0 = b.x - (b.vx || 0) * scaledDt;
  const by0 = getProjectileY(b) - (b.vy || 0) * scaledDt;
  const bx1 = b.x;
  const by1 = getProjectileY(b);

  const radius = getProjectileHitRadius(a) + getProjectileHitRadius(b);
  const rel0x = ax0 - bx0;
  const rel0y = ay0 - by0;
  const rel1x = ax1 - bx1;
  const rel1y = ay1 - by1;
  const closest = closestPointOnSegment(0, 0, rel0x, rel0y, rel1x, rel1y);
  return closest.x * closest.x + closest.y * closest.y <= radius * radius;
}

function findProjectileClashes(projectiles, hitEffects, particles, scaledDt, rng) {
  const canceled = new Set();

  for (let i = 0; i < projectiles.length; i++) {
    const a = projectiles[i];
    if (canceled.has(a)) continue;
    for (let j = i + 1; j < projectiles.length; j++) {
      const b = projectiles[j];
      if (canceled.has(b) || !sweptProjectilesCollide(a, b, scaledDt)) continue;

      canceled.add(a);
      canceled.add(b);
      const x = (a.x + b.x) / 2;
      const y = (getProjectileY(a) + getProjectileY(b)) / 2;
      const heavy = a.heavy || b.heavy || a.type === 'fireball' || b.type === 'fireball';
      spawnHitParticles(particles, x, y, heavy, rng);
      hitEffects.push(createHitEffect(x, { y: getHitEffectY(y) - 15, clash: true, heavy }));
      break;
    }
  }

  return canceled;
}

function getProjectileObstacleHit(p, prevX, prevY, obstacles, hitRadius) {
  if (!obstacles?.length) return null;

  const segMinX = Math.min(prevX, p.x);
  const segMaxX = Math.max(prevX, p.x);
  const segMinY = Math.min(prevY, p.y || 0);
  const segMaxY = Math.max(prevY, p.y || 0);

  return obstacles.find(o => {
    if (o.blocksProjectiles === false) return false;
    if (o.ownerId === p.ownerId) return false;

    const halfW = (o.width || 0) / 2 + hitRadius * 0.35;
    const left = o.x - halfW;
    const right = o.x + halfW;
    if (segMaxX < left || segMinX > right) return false;

    const bottom = (o.y || 0) + hitRadius;
    const top = (o.y || 0) - (o.height || 0) - hitRadius;
    return segMinY <= bottom && segMaxY >= top;
  }) || null;
}

export function tickProjectiles(projectiles, scaledDt) {
  projectiles.forEach(p => {
    p.x += (p.vx || 0) * scaledDt;
    p.y += (p.vy || 0) * scaledDt;
  });
}

export function processProjectileHits(projectiles, fighter1, fighter2, clones, hitEffects, particles, now, scaledDt, rng, obstacles = []) {
  const hitClones = new Set();
  const clashCanceled = findProjectileClashes(projectiles, hitEffects, particles, scaledDt, rng);
  const filtered = projectiles.filter(p => {
    if (clashCanceled.has(p)) return false;

    const prevX = p.x - (p.vx || 0) * scaledDt;
    const prevY = getProjectileY(p) - (p.vy || 0) * scaledDt;
    const targetFighter = p.ownerId === 0 ? fighter2 : fighter1;
    const attacker = p.ownerId === 0 ? fighter1 : fighter2;
    const oppId = p.ownerId === 0 ? 1 : 0;
    const hitRadius = getProjectileHitRadius(p);

    // Earth Wall and other protective obstacles intercept enemy projectiles before they reach fighters.
    const hitObstacle = getProjectileObstacleHit(p, prevX, prevY, obstacles, hitRadius);
    if (hitObstacle) {
      const impactX = Math.max(hitObstacle.x - hitObstacle.width / 2, Math.min(hitObstacle.x + hitObstacle.width / 2, p.x));
      spawnHitParticles(particles, impactX, (p.y || 0), p.type === 'fireball', rng);
      hitEffects.push(createHitEffect(impactX, { y: getHitEffectY(0), block: true, heavy: p.heavy }));
      return false;
    }

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
      // Height-based evasion: a successful duck/jump is a full evade, not a chip block.
      // These must run before any block/damage logic so the projectile keeps flying.
      const projectileIsHigh = p.high !== false; // fireball/shuriken/flameShower are HIGH; iceSpikes is LOW
      // Rule A — duck under a HIGH projectile: crouch-block (blockLow) lets it pass over.
      if (projectileIsHigh && targetFighter.status.active('blockLow', now)) {
        return Math.abs(p.x) < ARENA_BOUNDS + 150; // whiff: no hit, keep traveling
      }
      // Rule B — jump over a LOW projectile: airborne fighter lets it pass under.
      if (!projectileIsHigh && !targetFighter.onGround()) {
        return Math.abs(p.x) < ARENA_BOUNDS + 150; // whiff: no hit, keep traveling
      }

      if (targetFighter.status.active('invincible', now)) return Math.abs(p.x) < ARENA_BOUNDS + 150;

      // Sharingan: warp behind the attacker instead of taking the projectile.
      if (trySharinganCounter(targetFighter, attacker, now, hitEffects)) return false;

      const blocking = targetFighter.status.active('block', now);
      if (targetFighter.status.active('shinraTensei', now)) {
        spawnHitParticles(particles, targetFighter.x, (p.y || 0), p.type === 'fireball', rng);
        hitEffects.push(createHitEffect(targetFighter.x, { shinraDeflect: true }));
        return false;
      }

      let dmg = Math.round(p.damage * (attacker?.powerMult ?? 1)); // Power attribute scales skill damage
      if (blocking) dmg = Math.round(dmg * (p.heavy ? 0.5 : 0.2));

      const fromX = p.x - ((p.vx || 0) > 0 ? 1 : -1) * 50;
      targetFighter.takeDamage(dmg, p.heavy === true, fromX, now);
      attacker.damageDealt += dmg;
      targetFighter.status.set('stun', now + (p.stun || 80));
      targetFighter.status.set('hitFlash', now + (p.heavy ? 200 : 160));
      targetFighter.hitLastDmg = dmg;
      targetFighter.hitFromX = fromX;
      targetFighter.pose = blocking ? POSE.block : POSE.hit;
      if (!blocking) targetFighter.poseTime = 0;

      if (p.type === 'fireball' && !blocking) {
        targetFighter.status.set('burning', now + 4000);
      }

      if (p.knockback && !blocking) applyKnockback(targetFighter, p.knockback, fromX, p.heavy, false, false, now);

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
