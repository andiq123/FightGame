import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('fireball', {
  name: 'Fireball',
  cooldown: 12000,
  tip: 'Heavy projectile, ragdoll on hit'
}, {
  score: ({ dist, oppAttacking, stats, rng, canSeeOpponent }) => {
    if (dist <= 80 || dist >= 280 || oppAttacking) return 0;
    const risk = stats.riskTolerance / 100;
    let s = 70 + risk * 35 + rng() * 20;
    if (canSeeOpponent) s += 35;
    if (dist >= 120 && dist <= 220) s += 25;
    return s;
  },
  execute: ({ fighter, opponent, projectiles }) => {
    const dir = fighter.x < opponent.x ? 1 : -1;
    projectiles.push({
      x: fighter.x + dir * 55,
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
