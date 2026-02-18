import { registerPower } from './registry.js';

registerPower('cloneJutsu', {
  name: 'Clone Jutsu',
  cooldown: 16000,
  duration: 3000,
  tip: 'Smoke poof spawn, clone chases & attacks 3s'
}, {
  score: ({ dist, oppAttacking, opponent, stats, rng }) => {
    const inRange = dist <= 115;
    if ((inRange || (dist < 140 && dist > 50)) && oppAttacking) {
      const risk = stats.riskTolerance / 100;
      return 70 + risk * 25 + rng() * 20;
    }
    if (inRange || dist < 130) {
      const risk = stats.riskTolerance / 100;
      return 58 + risk * 32 + rng() * 22;
    }
    if (opponent.staggerUntil > 0) return 40;
    return 0;
  },
  execute: ({ fighter, opponent, clones }) => {
    const dir = fighter.x < opponent.x ? 1 : -1;
    const targetId = fighter.id === 0 ? 1 : 0;
    const now = performance.now();
    clones.push({
      x: fighter.x + dir * 50,
      vx: dir * 420,
      facing: dir,
      targetId,
      ownerId: fighter.id,
      color: fighter.color,
      createdAt: now,
      spawnEffectUntil: now + 400,
      lastHitAt: 0,
      damage: 35,
      stun: 160
    });
    return true;
  },
  spawnEffect: 'clone'
});
