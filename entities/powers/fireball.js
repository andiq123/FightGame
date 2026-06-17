import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('fireball', {
  name: 'Fireball',
  cooldown: 8000,
  staminaCost: 24,
  tip: 'Heavy projectile, ragdoll on hit'
}, {
  score: ({ eyeDist, opponent, stats, rng, canSeeOpponent, oppHpCritical, hpLow, spacing }) => {
    if (!canSeeOpponent) return 0;      // needs line-of-sight
    if (eyeDist < 90) return 0;         // too close — use melee
    if (eyeDist < 120) return 10;       // discouraged at close range

    const intelligence = stats.reaction / 100;
    const aggression = stats.aggression / 100;
    const space = (spacing || 50) / 100;
    let s = 60 + aggression * 20 + space * 25;

    // Sweet spot: mid-to-long range (projectile travels well)
    if (eyeDist >= 130 && eyeDist <= 280) s += 50 + intelligence * 30;
    if (eyeDist > 280 && eyeDist <= 450) s += 35 + intelligence * 20;
    if (eyeDist > 450) s += 20; // Very far — still worth it

    // Punish openings
    if (opponent.status.active('stagger', performance.now())) s += 55;
    if (opponent.status.active('recovery', performance.now())) s += 40;
    if (opponent.pose === 'block') s += 25; // Chip through block

    // Pressure opponent who is healing
    if (opponent.status.active('healEffect', performance.now())) s += 65;

    // Finish them off
    if (oppHpCritical && eyeDist > 100) s += 45;

    // Attrition: don't double up on fire when already burning
    if (opponent.status.active('burning', performance.now())) s -= 25;

    // AI is losing — play it safe at range
    if (hpLow && eyeDist > 200) s += 20;

    return s + rng() * 20;
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
