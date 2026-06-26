import { POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { eachNear } from '../td/spatial.js';
import { PIT } from './config.js';

const HEAVY = () => ATTACK.cross;

function pickFoe(world, c) {
  let best = null, bd = Infinity;
  const scan = (o) => {
    if (o.team === c.team) return;
    const d = Math.hypot(o.x - c.x, (o.y || 0) - (c.y || 0));
    if (d < bd) { bd = d; best = o; }
  };
  if (world._aliveByX) eachNear(world._aliveByX, c.x, PIT.ARENA_HALF, scan);
  else for (const o of world.creeps) { if (o.hp <= 0 || o.team === c.team) continue; scan(o); }
  return best;
}

export function updatePitFighter(c, world, dt, now) {
  if (c.hp <= 0 || c.staggerRagdoll || c._heldBy) return;
  const foe = pickFoe(world, c);
  c.facing = foe ? Math.sign(foe.x - c.x) || c.facing : c.facing;
  if (!foe) { c.vx *= 0.85; c.pose = POSE.idle; return; }

  const dist = Math.hypot(foe.x - c.x, (foe.y || 0) - (c.y || 0));
  const stop = c.attackRange * 0.62;
  if (dist > stop && c.canAct(now)) {
    const sp = Math.sign(foe.x - c.x) * c.moveSpeed;
    c.vx += Math.sign(sp - c.vx) * 4200 * dt;
    c.pose = Math.abs(c.vx) > c.moveSpeed * 0.75 ? POSE.run : POSE.walk;
  } else {
    c.vx *= 0.82;
    if (c.canAct(now) && now >= c.nextAtkAt) {
      c.nextAtkAt = now + c.atkCdMs;
      c.startAttack(HEAVY(), now);
      c.pose = POSE.punch;
    } else if (!c.currentAttack) c.pose = POSE.idle;
  }
}
