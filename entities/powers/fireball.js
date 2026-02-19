import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('fireball', {
  name: 'Fireball',
  cooldown: 12000,
  tip: 'Heavy projectile, ragdoll on hit'
}, {
  score: ({ dist, opponent, stats, rng, canSeeOpponent, idealShurikenRange, spacing }) => {
    const intelligence = stats.reaction / 100;
    // Environment Check: Don't shoot at walls
    if (!canSeeOpponent) return 0;

    // Discipline at close range
    if (dist < 90) return 0;
    if (dist < 120 && intelligence > 0.5) return 15;

    const aggression = stats.aggression / 100;
    const space = (spacing || 50) / 100;
    let s = 75 + aggression * 20 + space * 30 + rng() * 20;

    // Range Prioritization
    if (dist >= 300) s += 60; // Extreme range priority
    if (dist >= 130 && dist <= 280) s += 45 + (intelligence * 30);

    if (opponent.staggerUntil > 0) s += 50;
    if (opponent.staggerUntil > 0) s += 50;
    // canSeeOpponent is already required above, so just specific bonus for clear shot? 
    // actually, canSeeOpponent is binary, so if we are here it fits.
    s += 35; // Base bonus for having LoS
    if (idealShurikenRange) s += 40;

    // Tactical: Attrition check
    if (opponent.status.active('burning', performance.now())) s -= 30;

    return s;
  },
  execute: ({ fighter, opponent, projectiles }) => {
    const dir = fighter.x < opponent.x ? 1 : -1;
    projectiles.push({
      x: fighter.x + dir * 55,
      y: fighter.y,
      vx: dir * 380,
      damage: SKILL_DAMAGE.FIREBALL,
      stun: 280,
      knockback: 125,
      heavy: true,
      high: true,
      ownerId: fighter.id,
      type: 'fireball',
      createdAt: performance.now()
    });
    return true;
  },
  spawnEffect: 'fireball'
});
