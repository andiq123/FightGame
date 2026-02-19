import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('shuriken', {
  name: 'Shuriken',
  cooldown: 6000,
  tip: 'Spinning kunai, fast & metallic'
}, {
  score: ({ dist, opponent, stats, rng, canSeeOpponent, idealShurikenRange, spacing }) => {
    if (dist < 55) return 0;
    if (!canSeeOpponent) return 0;
    const aggression = stats.aggression / 100;
    const space = (spacing || 50) / 100;
    let s = 70 + aggression * 25 + space * 35 + rng() * 20;
    if (dist < 80) s -= 35;

    // Range Prioritization
    if (dist >= 300) s += 55; // Extreme range
    if (dist >= 120) s += 40;
    if (dist >= 130 && dist <= 280) s += 35;
    if (opponent.staggerUntil > 0) s += 45;
    if (opponent.staggerUntil > 0) s += 45;
    s += 35;
    if (idealShurikenRange) s += 30;
    return s;
  },
  execute: ({ fighter, opponent, projectiles }) => {
    const dir = fighter.x < opponent.x ? 1 : -1;
    projectiles.push({
      x: fighter.x + dir * 50,
      vx: dir * 480,
      damage: SKILL_DAMAGE.SHURIKEN,
      stun: 95,
      ownerId: fighter.id,
      type: 'shuriken',
      high: true
    });
    return true;
  }
});
