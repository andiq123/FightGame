import { PROJECTILE } from '../config/constants.js';
import { bodyYSpan, bodyHalfW } from '../core/hitbox.js';

export function getInboundThreat(fighter, projectiles) {
  const targetId = fighter.id === 0 ? 1 : 0;
  const inbound = projectiles.filter(p => p.ownerId === targetId);
  let best = null;
  let bestT = Infinity;

  const span = bodyYSpan(fighter);
  const fighterTop = span.top;
  const hw = bodyHalfW(fighter);

  for (const p of inbound) {
    let t = Infinity;
    let dx = fighter.x - p.x;
    const hitRadius = p.type === 'fireball' ? PROJECTILE.FIREBALL_HIT_RADIUS : PROJECTILE.HIT_RADIUS;

    if (Math.abs(p.vx || 0) > Math.abs(p.vy || 0)) {
      // Horizontal threat
      if ((p.vx > 0 && dx < 0) || (p.vx < 0 && dx > 0)) continue;
      t = Math.abs(dx) / Math.abs(p.vx);
    } else {
      // Vertical threat
      const dy = fighterTop - (p.y || 0);
      if ((p.vy || 0) <= 0 || dy < 0) continue; // Moving up or already below head

      // Only a threat if X is close
      if (Math.abs(dx) > hitRadius + hw) continue;

      t = dy / Math.abs(p.vy);
    }

    if (t < bestT && t < 2) {
      bestT = t;
      const evadeDir = p.vx !== 0 ? (p.vx > 0 ? -1 : 1) : (dx > 0 ? -1 : 1);
      best = { timeToImpact: t, evadeDir, heavy: p.heavy || p.type === 'fireball', high: p.high !== false, projectile: p };
    }
  }
  return best;
}
