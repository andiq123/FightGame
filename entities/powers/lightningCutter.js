import { registerPower } from './registry.js';
import { POSE } from '../fighter.js';
import { applyKnockback } from '../../engine/physics.js';
import { createRagdoll } from '../../engine/ragdoll.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';
import { getRagdollOriginY } from '../../core/coordinates.js';
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
  score: ({ dist, grabRange, inRange, oppStaggered, oppRecovering, fighter, aggression, rng }) => {
    if (dist > RANGE) return 0;
    if (!fighter.canUsePower('lightningCutter')) return 0;
    let s = 0;
    if (dist <= 70 && dist > 30) s += 65;
    if (oppStaggered) s += 50;
    if (oppRecovering) s += 35;
    s += aggression * 40 + rng() * 25;
    return s;
  },
  execute: ({ fighter, opponent, hitEffects }) => {
    const now = performance.now();
    const dist = Math.abs(fighter.x - opponent.x);
    if (dist > RANGE) return false;
    const blocking = opponent.blockUntil > now || opponent.blockLowUntil > now;
    const dmg = blocking ? Math.round(DAMAGE * 0.35) : DAMAGE;
    opponent.hp = Math.max(0, opponent.hp - dmg);
    opponent.lastHitAt = now;
    opponent.hitsTakenLast5Sec = (opponent.hitsTakenLast5Sec || 0) + 1;
    fighter.damageDealt += dmg;
    opponent.stunUntil = Math.max(opponent.stunUntil, now + (blocking ? STUN * 0.5 : STUN));
    opponent.hitFlashUntil = now + 180;
    opponent.hitLastDmg = dmg;
    const knockback = blocking ? KNOCKBACK * 0.35 : KNOCKBACK;
    applyKnockback(opponent, knockback, fighter.x, true);
    if (!blocking && opponent.staggerUntil <= now && opponent.hp > 0) {
      opponent.pose = POSE.stagger;
      opponent.staggerUntil = now + COMBAT.STAGGER_DURATION_MS;
      opponent.currentAttack = null;
      opponent.staggerRagdoll = createRagdoll(opponent.x, getRagdollOriginY(opponent), opponent.facing, opponent.vx, opponent.vy, fighter.x, false);
    } else {
      opponent.pose = POSE.hit;
    }
    hitEffects.push(createHitEffect(opponent.x, { dmg, lightning: true, block: blocking }));
    return true;
  },
  spawnEffect: 'lightning'
});
