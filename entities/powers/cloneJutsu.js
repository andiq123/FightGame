import { registerPower } from './registry.js';
import { CLONE } from '../../config/constants.js';

registerPower('cloneJutsu', {
  name: 'Clone Jutsu',
  cooldown: 12000,
  staminaCost: 34,
  tip: 'Spectral clone chases & combos for 5s'
}, {
  score: ({ dist, oppAttacking, opponent, stats, rng, fighter, clones, hpLow }) => {
    // Prevent clone spam
    const myClones = (clones || []).filter(c => c.ownerId === fighter.id);
    if (myClones.length >= 2) return 0;

    // Anti-heal interrupt: opponent is healing, send a clone!
    if (opponent.status?.active('healEffect', performance.now())) return 95 + rng() * 15;

    // Low-HP distraction: create pressure cover while trying to escape/heal
    if (hpLow && myClones.length === 0 && dist > 80) {
      return 65 + rng() * 20;
    }

    if (dist >= 120 && dist <= 420) {
      const risk = stats.riskTolerance / 100;
      let s = 42 + risk * 24;
      if (opponent.vx && Math.abs(opponent.vx) < 70) s += 14;
      if (opponent.status.active('block', performance.now()) || opponent.status.active('blockLow', performance.now())) s += 20;
      return s + rng() * 18;
    }

    const inRange = dist <= 115;
    if ((inRange || (dist < 140 && dist > 50)) && oppAttacking) {
      const risk = stats.riskTolerance / 100;
      return 70 + risk * 25 + rng() * 20;
    }
    if (inRange || dist < 130) {
      const risk = stats.riskTolerance / 100;
      return 58 + risk * 32 + rng() * 22;
    }
    if (opponent.status.active('stagger', performance.now())) return 40;

    let finalScore = 0;
    if (fighter.archetype === 'assassin') finalScore += 40;
    return finalScore;
  },
  execute: ({ fighter, opponent, clones }) => {
    const dir = fighter.x < opponent.x ? 1 : -1;
    const targetId = fighter.id === 0 ? 1 : 0;
    const now = performance.now();
    clones.push({
      x: fighter.x + dir * 60,
      vx: dir * CLONE.CHASE_SPEED,
      facing: dir,
      targetId,
      ownerId: fighter.id,
      color: fighter.color,
      createdAt: now,
      hp: CLONE.HP,
      maxHp: CLONE.HP,
      lastHitAt: 0,
      lastTeleportAt: 0,
      comboStep: 0,
      damage: CLONE.DAMAGE,
      stun: 140
    });
    return true;
  },
  spawnEffect: 'clone'
});
