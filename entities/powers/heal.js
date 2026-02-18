import { registerPower } from './registry.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';

registerPower('heal', {
  name: 'Heal',
  cooldown: 20000,
  tip: 'Restore 20% HP, green aura'
}, {
  score: ({ fighter, rng }) => {
    const hpRatio = fighter.hp / fighter.maxHp;
    if (hpRatio < 0.3) return 98 + rng() * 12;
    if (hpRatio < 0.45) return 75 + rng() * 12;
    if (hpRatio < 0.6) return 45 + rng() * 12;
    return 0;
  },
  execute: ({ fighter, hitEffects }) => {
    const healAmt = Math.round(fighter.maxHp * 0.2);
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + healAmt);
    fighter.healEffectUntil = performance.now() + 1400;
    hitEffects.push(createHitEffect(fighter.x, { heal: healAmt }));
    return true;
  },
  spawnEffect: 'heal'
});
