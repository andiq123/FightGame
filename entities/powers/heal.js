import { registerPower } from './registry.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';
import { getHitEffectY } from '../../core/coordinates.js';

registerPower('heal', {
  name: 'Heal',
  cooldown: 20000,
  staminaCost: 30,
  tip: 'Restore 20% HP, green aura'
}, {
  score: ({ fighter, rng, dist, oppAttacking, clones, hpLow }) => {
    const hpRatio = fighter.hp / fighter.maxHp;
    if (hpRatio >= 0.65) return 0;
    // Don't heal under direct pressure
    if (oppAttacking && dist < 100) return 5;
    // Penalize if enemy clones are nearby
    const enemyClones = (clones || []).filter(c => c.ownerId !== fighter.id);
    if (enemyClones.some(c => Math.abs(c.x - fighter.x) < 120)) return 8;

    let s = 0;
    if (hpRatio < 0.3) s = 98;
    else if (hpRatio < 0.45) s = 75;
    else s = 45;
    // Safety bonus: heal is smarter at range
    if (dist > 200) s += 20;
    // Extra bonus: when hpLow and safe from afar, commit to the heal
    if (hpLow && dist > 220) s += 25;
    return s + rng() * 12;
  },
  execute: ({ fighter, hitEffects }) => {
    const healAmt = Math.round(fighter.maxHp * 0.2);
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + healAmt);
    fighter.status.set('healEffect', performance.now() + 1400);
    hitEffects.push(createHitEffect(fighter.x, { y: getHitEffectY(fighter.y), heal: healAmt }));
    return true;
  },
  spawnEffect: 'heal'
});
