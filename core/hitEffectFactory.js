import { getHitEffectY } from './coordinates.js';

export function createHitEffect(x, options = {}) {
  return { x, y: getHitEffectY(), t: 0, dmg: 0, ...options };
}
