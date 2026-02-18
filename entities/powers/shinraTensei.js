import { registerPower } from './registry.js';
import { POSE } from '../fighter.js';
import { applyKnockback } from '../../engine/physics.js';
import { createRagdoll } from '../../engine/ragdoll.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';
import { getRagdollOriginY } from '../../core/coordinates.js';
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
  target.stunUntil = Math.max(target.stunUntil, now + 200);
  target.hitFlashUntil = now + 220;
  target.hitLastDmg = dmg;
  target.currentAttack = null;
  target.pose = POSE.stagger;
  target.staggerUntil = now + COMBAT.STAGGER_DURATION_MS;
  target.staggerRagdoll = createRagdoll(target.x, getRagdollOriginY(target), target.facing, target.vx, target.vy, caster.x, false);
  hitEffects.push(createHitEffect(target.x, { dmg, shinra: true, block: blocking }));
}

registerPower('shinraTensei', {
  name: 'Shinra Tensei',
  cooldown: 8000,
  tip: 'Almighty Push – exploding circle repulse, ragdoll, deflects projectiles'
}, {
  score: ({ dist, inboundThreat, oppAttacking, fighter, defense, rng, cannotEvade, cornered }) => {
    if (dist > REPULSE_RANGE) return 0;
    if (!fighter.canUsePower('shinraTensei')) return 0;
    let s = 0;
    if (cannotEvade) s += 90;
    if (!fighter.hasStamina(26) && oppAttacking && dist < REPULSE_RANGE) s += 50;
    if (cornered && dist < 90) s += 45;
    if (inboundThreat && inboundThreat.timeToImpact * 1000 < 400) s += 70;
    if (dist < 80 && dist > 35) s += 55;
    if (oppAttacking && dist < 70) s += 40;
    s += defense * 30 + rng() * 25;
    return s;
  },
  execute: ({ fighter, opponent, hitEffects, clones }) => {
    const now = performance.now();
    const centerX = fighter.x;
    fighter.shinraTenseiUntil = now + REPULSE_DEFLECT_MS;
    hitEffects.push(createHitEffect(centerX, { shinra: true, shinraCircle: true, radius: REPULSE_RANGE }));
    const oppDist = Math.abs(opponent.x - centerX);
    if (oppDist <= REPULSE_RANGE) {
      const blocking = opponent.blockUntil > now || opponent.blockLowUntil > now;
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
