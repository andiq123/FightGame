import { getDistance } from './physics.js';

export function castRay(fighter, opponent) {
  const dist = getDistance(fighter, opponent);
  const dx = opponent.x - fighter.x;
  const facingOpponent = (fighter.facing > 0 && dx > 0) || (fighter.facing < 0 && dx < 0);
  return { dist, hit: true, blocked: false, facingOpponent };
}
