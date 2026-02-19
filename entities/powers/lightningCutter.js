import { registerPower } from './registry.js';
import { POSE } from '../fighter.js';
import { applyKnockback } from '../../engine/physics.js';
import { createRagdoll } from '../../engine/ragdoll.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';
import { getRagdollOriginY, getHitEffectY } from '../../core/coordinates.js';
import { COMBAT, SKILL_DAMAGE } from '../../config/constants.js';

const RANGE = 100;
const DAMAGE = SKILL_DAMAGE.LIGHTNING_CUTTER;
const STUN = 200;
const KNOCKBACK = 360;

registerPower('lightningCutter', {
  name: 'Lightning Cutter',
  cooldown: 10000,
  tip: 'Short-range piercing thrust, 48 dmg'
}, {
  score: ({ dist, oppStaggered, oppRecovering, fighter, stats, rng, canSeeOpponent, hpCritical, oppBlocking }) => {
    const intelligence = stats.reaction / 100;
    if (dist > 95) return 0;
    if (!canSeeOpponent) return 0; // Cannot dash through walls
    if (!fighter.canUsePower('lightningCutter')) return 0;

    let s = 40;
    if (dist <= 85) s += 55;
    if (dist <= 60) s += 40;

    // Perfect punish windows
    if (oppStaggered) s += 60 + intelligence * 30;
    if (oppRecovering) s += 45 + intelligence * 20;

    // Lightning pierces block — great against turtles
    if (oppBlocking) s += 45;

    // Desperation: commit to damage when near death
    if (hpCritical) s += 40;

    s += (stats.aggression / 100) * 45 + rng() * 25;
    return s;
  },
  execute: ({ fighter, opponent, hitEffects }) => {
    const now = performance.now();
    const dist = Math.abs(fighter.x - opponent.x);
    if (dist > RANGE) return false;
    const blocking = opponent.status.active('block', now) || opponent.status.active('blockLow', now);
    const dmg = blocking ? Math.round(DAMAGE * 0.35) : DAMAGE;
    opponent.hp = Math.max(0, opponent.hp - dmg);
    opponent.lastHitAt = now;
    opponent.hitsTakenLast5Sec = (opponent.hitsTakenLast5Sec || 0) + 1;
    fighter.damageDealt += dmg;
    opponent.status.set('stun', now + (blocking ? STUN * 0.5 : STUN));
    opponent.status.set('hitFlash', now + 180);
    opponent.status.set('shocked', now + 5000); // 5 seconds of electricity
    opponent.hitLastDmg = dmg;
    const knockback = blocking ? KNOCKBACK * 0.35 : KNOCKBACK;
    applyKnockback(opponent, knockback, fighter.x, true);
    if (!blocking && !opponent.status.active('stagger', now) && opponent.hp > 0) {
      opponent.pose = POSE.stagger;
      opponent.status.set('stagger', now + COMBAT.STAGGER_DURATION_MS);
      opponent.currentAttack = null;
      opponent.staggerRagdoll = createRagdoll(opponent.x, getRagdollOriginY(opponent), opponent.facing, opponent.vx, opponent.vy, fighter.x, false);
    } else {
      opponent.pose = POSE.hit;
    }
    hitEffects.push(createHitEffect(opponent.x, { y: getHitEffectY(opponent.y), dmg, lightning: true, block: blocking }));

    // Cinematic lightning flash
    const world = fighter.world;
    if (world) {
      world.skyFocus = { type: 'shinra', intensity: 0.8, expiry: performance.now() + 150 };
      import('../../services/particleSystem.js').then(ps => {
        ps.spawnLightningCutter(world.particles, fighter, Math.random);
      });
    }

    return true;
  },
  spawnEffect: 'lightning'
});
