// Perception helpers — raycast line-of-sight + inbound-projectile threat
// detection, used by BOTH the hero and the enemies (symmetric senses). Adapted
// from the master AI's engine/raycast.js + engine/projectileThreat.js, simplified
// for the flat tower-defense lane.

const EYE_Y = -70; // chest height; a blocker this tall breaks line of sight

// Raycast along the ground lane between two x positions. Returns false only if a
// tall blocker stands between them (none in the base TD, but kept principled so
// vision/zoning is always validated, not assumed).
export function hasLineOfSight(ax, bx, blockers = []) {
  const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
  for (const o of blockers) {
    const hw = (o.width || 0) / 2;
    if (o.x + hw < lo || o.x - hw > hi) continue;
    if (-(o.height || 0) <= EYE_Y) return false;
  }
  return true;
}

// Cast the unit's "vision ray" at a target: distance, whether it's being faced,
// and whether the view is clear. One principled call instead of ad-hoc checks.
export function senseTarget(unit, target, blockers = []) {
  const dx = target.x - unit.x;
  return {
    dist: Math.abs(dx),
    dir: Math.sign(dx) || 1,
    facing: (unit.facing > 0 && dx > 0) || (unit.facing < 0 && dx < 0),
    clear: hasLineOfSight(unit.x, target.x, blockers),
  };
}

// Evading — weaving, sidestepping, dash-slipping — burns explosive stamina. As a
// fighter's gas runs out its ability to dodge collapses: below ~5% stamina it can
// barely move out of the way and simply EATS attacks and projectiles. Returns a
// 0…1 multiplier applied to every evade/dodge chance (melee and ranged alike).
export function evasionStaminaFactor(fighter) {
  const ratio = (fighter.stamina ?? 1) / (fighter.maxStamina || 1);
  if (ratio <= 0.05) return 0.03;                 // almost zero — exhausted, eats the hit
  if (ratio >= 0.20) return 1;                    // plenty of gas → full evasive ability
  return 0.03 + (ratio - 0.05) / 0.15 * 0.97;     // ramp 5%→20% stamina
}

// The most urgent projectile inbound on `unit` — a ray-vs-body test against every
// projectile whose `target` side matches. Returns time-to-impact and an evade
// direction, or null. `targetSide` is the projectile.target that can hit `unit`.
export function inboundProjectile(world, unit, targetSide) {
  let best = null, bestT = Infinity;
  for (const p of world.projectiles) {
    if (p.target !== targetSide) continue;
    if (p.hitIds && p.hitIds.has(unit.id)) continue;
    const dx = unit.x - p.x;
    if (Math.sign(dx) !== Math.sign(p.vx)) continue;          // flying away → no threat
    const t = Math.abs(dx) / (Math.abs(p.vx) || 1);           // ray time to reach the unit's x
    if (t < bestT && t < 1.4) {
      bestT = t;
      best = { t, dist: Math.abs(dx), evadeDir: -Math.sign(p.vx) || -1, projectile: p };
    }
  }
  return best;
}
