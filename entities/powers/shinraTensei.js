import { registerPower } from './registry.js';
import { POSE } from '../fighter.js';
import { applyKnockback } from '../../engine/physics.js';
import { createRagdoll } from '../../engine/ragdoll.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';
import { getRagdollOriginY, getHitEffectY } from '../../core/coordinates.js';
import { COMBAT, SKILL_DAMAGE } from '../../config/constants.js';

const REPULSE_KNOCKBACK = 420;
const REPULSE_RANGE = 145;
const REPULSE_DEFLECT_MS = 280;

function applyShinraToTarget(caster, target, now, hitEffects, blocking) {
  const dmg = blocking ? Math.round(SKILL_DAMAGE.SHINRA * 0.3) : SKILL_DAMAGE.SHINRA;
  target.hp = Math.max(0, target.hp - dmg);
  target.lastHitAt = now;
  target.hitsTakenLast5Sec = (target.hitsTakenLast5Sec || 0) + 1;
  caster.damageDealt += dmg;
  const knockback = blocking ? REPULSE_KNOCKBACK * 0.4 : REPULSE_KNOCKBACK;
  applyKnockback(target, knockback, caster.x, true);
  target.status.set('stun', now + (blocking ? 100 : 200));
  target.status.set('hitFlash', now + 220);
  target.hitLastDmg = dmg;
  target.hitFromX = caster.x;
  if (!target.status.active('stagger', now) && target.hp > 0) {
    target.pose = POSE.stagger;
    target.status.set('stagger', now + COMBAT.STAGGER_DURATION_MS);
    target.staggerRagdoll = createRagdoll(target.x, getRagdollOriginY(target), target.facing, target.vx, target.vy, caster.x, false);
  } else if (!target.status.active('stagger', now)) {
    target.pose = POSE.hit;
    target.poseTime = 0;
  }
  hitEffects.push(createHitEffect(target.x, { y: getHitEffectY(target.y), dmg, shinra: true, block: blocking }));
}

registerPower('shinraTensei', {
  name: 'Shinra Tensei',
  cooldown: 8000,
  tip: 'Almighty Push – exploding circle repulse, ragdoll, deflects projectiles'
}, {
  score: ({ dist, inboundThreat, oppAttacking, fighter, opponent, stats, rng, cannotEvade, cornered, oppStaggered, oppRecovering, obstacles, oppHpCritical, oppHealing }) => {
    const intelligence = stats.reaction / 100;
    if (dist > 125) return 0;
    if (!fighter.canUsePower('shinraTensei')) return 0;

    let s = 40;
    if (dist <= 85) s += 55;
    if (dist <= 60) s += 40;

    if (oppStaggered) s += 60 + (intelligence * 30);
    if (oppRecovering) s += 45 + (intelligence * 20);

    if (cannotEvade) s += 80;
    if (!fighter.hasStamina(30) && oppAttacking && dist < 100) s += 60;
    if (cornered && dist < 110) s += 50;

    // Blast them mid-heal to deny the recovery
    if (oppHealing && dist < 120) s += 70;

    // Environment: pinning against wall (shared for both normal and finish scenarios)
    const oppNearWall = (obstacles || []).some(o => Math.abs(opponent.x - o.x) < (o.width / 2 + 60));
    if (oppNearWall && dist < 100) {
      s += 45; // Normal wall-pin bonus
      if (oppHpCritical) s += 65; // Extra killzone bonus when finishing
    } else if (oppHpCritical && dist < 100) {
      s += 35; // Crit bonus even without a wall nearby
    }

    // Reactive use scaling with intelligence
    if (inboundThreat && inboundThreat.timeToImpact * 1000 < (300 + intelligence * 200)) {
      s += 60 + (intelligence * 40);
    }

    if (oppAttacking && dist < 80) s += 40 + (intelligence * 25);

    s += (stats.defense / 100) * 35 + rng() * 25;
    return s;
  },
  execute: ({ fighter, opponent, hitEffects, clones }) => {
    const now = performance.now();
    const centerX = fighter.x;
    fighter.status.set('shinraTensei', now + REPULSE_DEFLECT_MS);
    hitEffects.push(createHitEffect(centerX, { y: getHitEffectY(fighter.y), shinra: true, shinraCircle: true, radius: REPULSE_RANGE }));

    // Cinematic Shockwave & Flash
    const world = fighter.world; // Usually world is passed in ctx
    if (world) {
      world.screenShake = 15;
      world.skyFocus = { type: 'shinra', intensity: 1, expiry: now + 400 };
      import('../../services/particleSystem.js').then(ps => {
        ps.spawnShinraTensei(world.particles, fighter, Math.random); // Existing but now boosted
      });
    }
    const oppDist = Math.abs(opponent.x - centerX);
    if (oppDist <= REPULSE_RANGE) {
      const blocking = opponent.status.active('block', now) || opponent.status.active('blockLow', now);
      applyShinraToTarget(fighter, opponent, now, hitEffects, blocking);
    }
    const oppId = opponent.id === 0 ? 1 : 0;
    (clones || []).filter(c => c.ownerId === oppId && Math.abs(c.x - centerX) <= REPULSE_RANGE).forEach(clone => {
      clone.dissolveAt = now;
    });
    return true;
  },
  spawnEffect: 'shinra'
});
