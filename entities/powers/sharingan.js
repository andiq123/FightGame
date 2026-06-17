import { registerPower } from './registry.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';
import { getHitEffectY } from '../../core/coordinates.js';
import { SHARINGAN } from '../../config/constants.js';

registerPower('sharingan', {
  name: 'Sharingan',
  cooldown: 14000,
  staminaCost: 22,
  tip: 'Awaken red eyes (7s): a clean hit is negated — warp behind the attacker for a counter'
}, {
  score: ({ fighter, rng, oppAttacking, oppHeavyWindup, underPressure, hpLow, dist }) => {
    const now = performance.now();
    if (fighter.status.active('sharingan', now)) return 0; // don't re-cast while active
    let s = 0;
    if (oppAttacking || oppHeavyWindup) s += 72; // perfect moment to bait a counter
    if (underPressure) s += 46;
    if (hpLow) s += 26;
    if (dist < 150) s += 22;                       // close range — the warp-counter lands
    if (s <= 0) return 0;
    return s + rng() * 15;
  },
  execute: ({ fighter, hitEffects }) => {
    const now = performance.now();
    fighter.status.set('sharingan', now + SHARINGAN.DURATION_MS);
    fighter.status.clear('sharinganCd');
    hitEffects.push(createHitEffect(fighter.x, { y: getHitEffectY(fighter.y), sharingan: true }));
    return true;
  }
});
