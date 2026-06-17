import { getDistance } from './physics.js';

// Line-of-sight check at roughly eye/chest height. A sufficiently TALL obstacle
// standing between the two fighters blocks vision (short crates/rocks don't), so
// the AI can't see — or shoot projectiles — through cover, and knows when it is
// hidden behind something.
const EYE_Y = -70; // chest height above the base (y grows downward; -70 ≈ chest)

export function castRay(fighter, opponent, obstacles = []) {
  const dist = getDistance(fighter, opponent);
  const dx = opponent.x - fighter.x;
  const facingOpponent = (fighter.facing > 0 && dx > 0) || (fighter.facing < 0 && dx < 0);

  const lo = Math.min(fighter.x, opponent.x);
  const hi = Math.max(fighter.x, opponent.x);
  let blocked = false;
  for (const o of obstacles) {
    const halfW = (o.width || 0) / 2;
    if (o.x + halfW < lo || o.x - halfW > hi) continue; // not between them
    if (-(o.height || 0) <= EYE_Y) { blocked = true; break; } // tall enough to break LoS
  }

  return { dist, hit: true, blocked, facingOpponent };
}
