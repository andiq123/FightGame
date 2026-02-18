import { PROJECTILE } from '../config/constants.js';

export function getInboundThreat(fighter, projectiles) {
  const targetId = fighter.id === 0 ? 1 : 0;
  const inbound = projectiles.filter(p => p.ownerId === targetId);
  let best = null;
  let bestT = Infinity;
  for (const p of inbound) {
    const dx = fighter.x - p.x;
    if ((p.vx > 0 && dx < 0) || (p.vx < 0 && dx > 0)) continue;
    const dist = Math.abs(dx);
    const speed = Math.abs(p.vx) || 1;
    const t = dist / speed;
    if (t < bestT && t < 2) {
      bestT = t;
      const hitRadius = p.type === 'fireball' ? PROJECTILE.FIREBALL_HIT_RADIUS : PROJECTILE.HIT_RADIUS;
      const evadeDir = p.vx > 0 ? -1 : 1;
      best = { timeToImpact: t, evadeDir, heavy: p.heavy || p.type === 'fireball', high: p.high !== false, projectile: p };
    }
  }
  return best;
}
