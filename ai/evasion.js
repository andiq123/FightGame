import { FIGHTER } from '../config/constants.js';
import { pickPower } from './skills.js';

// ─────────────────────────────────────────────────────────────────────────────
// Projectile evasion — one concern, intelligence-gated.
//
// Awareness of an incoming projectile, and picking the RIGHT answer for its
// height / timing / distance, is a skill. A maxed fighter reads it early and
// chooses optimally; a novice reacts late or not at all.
//
// Answer priority (best → fallback):
//   1. Teleport / wall through it   (spectralDash, earthWall — i-frames / wall)
//   2. Duck UNDER a high projectile  (low block)         — see projectileSystem height rules
//   3. Jump OVER a low projectile    (hop)
//   4. Sidestep dash                 (i-frames)
//   5. Block                         (chip fallback)
// ─────────────────────────────────────────────────────────────────────────────

const JUMP_STAMINA = FIGHTER.JUMP_STAMINA ?? 14;

export function evadeProjectile(ctx) {
  const threat = ctx.inboundThreat;
  const { fighter, rng, skill } = ctx;
  if (!threat || !fighter.canAct(ctx.now)) return null;
  // Sharingan: no need to dodge — let it hit and warp behind for the counter.
  if (ctx.hasSharingan) return null;

  // Awareness: how far ahead a fighter can read a projectile scales with skill.
  // A novice only notices it at the last instant (and often too late to move).
  const tMs = threat.timeToImpact * 1000;
  const readWindowMs = 120 + skill * 560;
  if (tMs > readWindowMs) return null;                 // hasn't registered the threat yet
  if (rng() > 0.2 + skill * 0.8) return null;          // sometimes fails to react at all

  const grounded = fighter.onGround();
  const tooLateToMove = tMs < 90;                      // only block / teleport left

  // 1. Premium answer: phase through it (teleport / repel / wall). Smartest pick.
  const evadePower = pickPower(ctx, {
    tags: ['evade'],
    threshold: threat.heavy ? 40 : 54,
    emergency: true
  });
  if (evadePower) return { type: 'power', powerId: evadePower, aiLabel: 'evadingProjectile' };

  if (grounded && !tooLateToMove) {
    if (threat.high) {
      // 2. Duck under a high projectile.
      if (rng() < 0.45 + skill * 0.5) return { type: 'block', duration: 340, low: true, aiLabel: 'evadingProjectile' };
    } else if (fighter.hasStamina(JUMP_STAMINA)) {
      // 3. Hop over a low projectile — leap aside (evade direction), not straight up.
      if (rng() < 0.45 + skill * 0.5) return { type: 'jump', dir: threat.evadeDir, aiLabel: 'evadingProjectile' };
    }
    // 4. Sidestep with i-frames.
    if (ctx.canAffordDodge && rng() < 0.3 + skill * 0.5) {
      return { type: 'dodge', dir: threat.evadeDir, aiLabel: 'evadingProjectile' };
    }
  }

  // 5. Fallback: block (duck if the shot is high so it whiffs instead of chips).
  return { type: 'block', duration: 380, low: threat.high, aiLabel: 'evadingProjectile' };
}
