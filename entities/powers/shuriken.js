import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('shuriken', {
  name: 'Shuriken',
  cooldown: 6000,
  staminaCost: 16,
  tip: 'Spinning kunai, fast & metallic'
}, {
  score: ({ eyeDist, opponent, stats, rng, canSeeOpponent, oppHpCritical, hpLow, spacing }) => {
    if (!canSeeOpponent) return 0;
    if (eyeDist < 55) return 0;    // purely melee territory

    const intelligence = stats.reaction / 100;
    const aggression = stats.aggression / 100;
    const space = (spacing || 50) / 100;
    let s = 55 + aggression * 20 + space * 25;

    // Shuriken sweet spot: mid range (fast enough to catch dodgers)
    if (eyeDist >= 80 && eyeDist <= 200) s += 50 + intelligence * 25;
    if (eyeDist > 200 && eyeDist <= 350) s += 35 + intelligence * 15;
    if (eyeDist > 350) s += 15; // Far but still accurate
    if (eyeDist < 80) s -= 25;  // Discourage at close-ish range

    // Moving target: shuriken is fast, punishes lateral movers
    if (Math.abs(opponent.vx) > 80) s += 30;

    // Punish openings
    if (opponent.status.active('stagger', performance.now())) s += 55;
    if (opponent.status.active('recovery', performance.now())) s += 40;

    // Anti-heal: interrupt opponent heal with fast projectile
    if (opponent.status.active('healEffect', performance.now())) s += 60;

    // Finish them off
    if (oppHpCritical && eyeDist > 55) s += 40;

    // AI on the run — safe long-range poke
    if (hpLow && eyeDist > 180) s += 20;

    return s + rng() * 20;
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
