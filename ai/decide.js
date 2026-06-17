import { ATTACK, ATTACK_POWER_PUNCH, GRAB, COMBO_CHAINS } from '../entities/attacks.js';
import { AI, FIGHTER, SHARINGAN } from '../config/constants.js';
import { shouldPrioritizeRecovery, filterAffordableAttacks } from './staminaStrategy.js';
import { pickPower, recordJutsuUse, CATEGORY } from './skills.js';
import { evadeProjectile } from './evasion.js';

// ─────────────────────────────────────────────────────────────────────────────
// AI decision orchestration.
//
// One pass per decision tick over a flat, priority-ordered list of considerations;
// the first that returns an action wins. Concerns are kept separate:
//   - perception/sensing      → ai/context.js
//   - skill categorization    → ai/skills.js (pickPower by category/tag)
//   - projectile evasion      → ai/evasion.js
//   - basic combat + movement → here
// Every power scores itself (each power's score(ctx)); tactics here are readable
// rules. Everything is gated by `ctx.skill` (0…1 from intelligence).
// ─────────────────────────────────────────────────────────────────────────────

export { pickPower, recordJutsuUse };
const C = CATEGORY;

const GCD_MS = 700;

// Effective skill for execution gates. Raising skill to a power widens the gap
// between mid levels (e.g. 5 vs 10) so every intelligence step is decisive.
function execSkill(ctx) {
  return Math.pow(ctx.skill, 1.4);
}

// Attach a HUD/label hint to an action without extra bookkeeping.
function as(action, label) {
  if (action) action.aiLabel = label;
  return action;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function getNextComboAttack(fighter, rng) {
  const n = fighter.comboCount;
  if (n === 0 || fighter.lastLandingAttackType == null) return null;
  const last = fighter.lastLandingAttackType;
  const candidates = COMBO_CHAINS
    .filter(chain => chain.length > n && chain[n - 1] === last)
    .map(chain => chain[n]);
  return candidates.length ? pick(candidates, rng) : null;
}

function shouldRun(ctx, threshold = AI.PREFERRED_DIST_MAX) {
  if (ctx.tired || ctx.staminaLow) return false;
  if ((ctx.staminaRatio ?? 0) < 0.28) return false;
  return ctx.dist > threshold || ctx.oppStaggered || ctx.oppRecovering || ctx.oppHpCritical || ctx.isNightmare;
}

function buildAttackPool(ctx) {
  const { fighter, tired, aggression, rng, isNightmare, frameAdvantage } = ctx;
  const comboNext = getNextComboAttack(fighter, rng);

  // Guaranteed combo continuation when we have frame advantage.
  if (fighter.comboCount >= 1 && comboNext != null && frameAdvantage >= 0) {
    const c = filterAffordableAttacks(ctx, [comboNext], ctx.staminaLow ? 12 : 0);
    if (c.length) return c;
  }

  let pool;
  if (tired && !ctx.hasSharingan) {
    pool = [ATTACK.jab, ATTACK.lowKick, ATTACK.frontKick];
  } else {
    pool = [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, ATTACK.lowKick];
    if (aggression > 0.3 || ctx.hasSharingan) pool.push(ATTACK.hook, ATTACK.uppercut);
    if (aggression > 0.5 || isNightmare || ctx.hasSharingan) pool.push(ATTACK.highKick, ATTACK.spinningKick);
    if (ctx.opponent.stamina < 40) pool.unshift(ATTACK.lowKick);
    if (ctx.oppFrozen) pool.push(ATTACK_POWER_PUNCH, ATTACK.spinningKick);
    if (ctx.oppBlockingALot && aggression > 0.4) pool.unshift(GRAB);
    // Sharingan confidence: lead with committed heavy hitters.
    if (ctx.hasSharingan) pool.unshift(ATTACK.hook, ATTACK.uppercut, ATTACK_POWER_PUNCH);
    if (comboNext != null) pool.unshift(comboNext);
  }
  return filterAffordableAttacks(ctx, pool, ctx.staminaLow ? 14 : 0);
}

// ── Considerations (priority order) ─────────────────────────────────────────
// (evadeProjectile lives in ai/evasion.js and is first in the list below.)

function emergencyDefense(ctx) {
  const { oppAttacking, oppHeavyWindup, oppHitbox, dist, fighter, rng } = ctx;
  if (!(oppAttacking || oppHeavyWindup) || dist > AI.COMBAT_ENTER) return null;
  // Sharingan: don't flinch — eat the hit, warp behind, and punish. Stay aggressive.
  if (ctx.hasSharingan) return null;

  const heavy = oppHeavyWindup || (oppHitbox?.damage >= 12);
  const skill = ctx.skill;
  const reaction = skill;

  // Reacting to an attack is the core skill check, and it scales with raw skill so
  // even a few intelligence levels noticeably improve defense. A maxed fighter
  // blocks/dodges almost everything; a novice barely reacts at all.
  const reactChance = heavy ? 0.16 + skill * 0.84 : 0.03 + skill * 0.95;
  if (rng() > reactChance) return null;

  const power = pickPower(ctx, {
    tags: ['defense'],
    threshold: heavy ? 40 : 60,
    emergency: heavy
  });
  if (power && (power !== 'earthWall' || dist > 95)) return as({ type: 'power', powerId: power }, 'defending');

  if (fighter.onGround() && ctx.canAffordDodge && rng() < 0.2 + reaction * 0.45) {
    return as({ type: 'dodge', dir: -ctx.faceToward() }, 'defending');
  }
  const highIncoming = oppHitbox?.high !== false;
  return as({ type: 'block', duration: heavy ? 340 : 240, low: !highIncoming }, 'defending');
}

function punishOpening(ctx) {
  const { oppStaggered, oppGettingUp, oppRecovering, oppJustWhiffed, dist, inRange, rng } = ctx;
  const opening = oppStaggered || oppJustWhiffed || (oppGettingUp && dist < 160) || (oppRecovering && dist < 165);
  if (!opening || ctx.tired) return null;

  // Capitalizing on an opening is a skill: low intelligence lets punishes slip.
  if (rng() > 0.22 + ctx.skill * 0.78) return null;

  const power = pickPower(ctx, {
    categories: [C.MELEE_BURST, C.PROJECTILE, C.CONTROL],
    threshold: ctx.oppHpCritical ? 34 : 48,
    finisher: ctx.oppHpCritical
  });
  if (power) return as({ type: 'power', powerId: power }, 'punishing');

  if (!inRange) return as({ type: 'move', dir: ctx.faceToward(), run: true, commitMs: 420 }, 'punishing');

  const heavies = filterAffordableAttacks(ctx, [ATTACK.cross, ATTACK.uppercut, ATTACK.hook, ATTACK.highKick, ATTACK_POWER_PUNCH], ctx.staminaLow ? 12 : 0);
  if (heavies.length) return as({ type: 'attack', attack: pick(heavies, rng) }, 'punishing');
  return null;
}

function recoverStamina(ctx) {
  // Sharingan confidence: keep pressing unless genuinely exhausted.
  if (ctx.hasSharingan && !ctx.staminaCritical) return null;
  if (!shouldPrioritizeRecovery(ctx)) return null;
  if (ctx.dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330) || ctx.isSafe) return as({ type: 'recover' }, 'recharging');
  return as({ type: 'move', dir: -ctx.faceToward(), run: false, commitMs: 600 }, 'retreating');
}

// Is there a safe window to commit to a (cast-locked) recovery skill?
// Safe = no incoming threat, and the opponent can't punish the cast.
function isSafeToHeal(ctx) {
  if (ctx.inboundThreat || ctx.oppAttacking || ctx.oppHeavyWindup) return false;
  if (ctx.isSafe) return true;                                   // behind own wall
  if (ctx.dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330)) return true; // far enough to cast
  if ((ctx.oppStaggered || ctx.oppGettingUp) && ctx.dist > 200) return true; // opponent down & away
  return false;
}

// Proactive recovery: heal when hurt AND safe — not only at death's door. A
// smart fighter values its HP and takes safe windows to top up; a dumb one
// rarely bothers. Selects any RECOVERY-category skill (future-proof).
function recoverHealth(ctx) {
  if (ctx.hasSharingan) return null; // protected & aggressive — don't stop to heal
  if (!ctx.hpLow && !ctx.hpCritical) return null;
  if (!isSafeToHeal(ctx)) return null;
  const { fighter, now } = ctx;
  if (fighter.lastGlobalSkillAt && now - fighter.lastGlobalSkillAt < GCD_MS) return null;
  // Eagerness: always at critical, otherwise scales with intelligence.
  const eager = ctx.hpCritical ? 0.95 : 0.45 + ctx.skill * 0.5;
  if (ctx.rng() > eager) return null;
  const power = pickPower(ctx, {
    categories: [C.RECOVERY],
    threshold: 22,
    emergency: ctx.hpCritical,
    allowRepeat: true
  });
  if (power) return as({ type: 'power', powerId: power }, 'recharging');
  return null;
}

// Last-ditch survival when critically hurt and NOT safe enough to heal: use a
// defensive escape (wall / teleport / clone), then create space.
function survive(ctx) {
  if (!ctx.hpCritical) return null;
  if (ctx.hasSharingan) return null; // counter-warp protects us — keep attacking, don't flee
  const power = pickPower(ctx, { tags: ['defense'], threshold: 34, emergency: true, allowRepeat: true });
  if (power) return as({ type: 'power', powerId: power }, 'defending');
  if (ctx.dist < 200) return as({ type: 'move', dir: -ctx.faceToward(), run: true, commitMs: 500 }, 'retreating');
  return null;
}

function antiAir(ctx) {
  const { opponent, fighter, dist, rng } = ctx;
  if (opponent.onGround() || (opponent.vy || 0) >= 0) return null; // only catch a rising jump-in
  if (dist > AI.ATTACK_RANGE + 20 || !fighter.hasStamina(10)) return null;
  if (rng() > 0.35 + ctx.defense * 0.4) return null;
  const aa = filterAffordableAttacks(ctx, [ATTACK.uppercut, ATTACK.highKick], 0);
  if (aa.length) return as({ type: 'attack', attack: aa[0] }, 'combat');
  return null;
}

// COUNTER: clone jutsu. A clone is a one-hit decoy — recognizing that and going
// to pop it (instead of being baited/chipped by it) is knowledge that scales with
// intelligence. A low-IQ fighter doesn't know and lets clones harass it.
function counterClone(ctx) {
  const { nearestEnemyClone, cloneDist, dist, fighter } = ctx;
  if (!nearestEnemyClone) return null;
  if (ctx.rng() > 0.12 + ctx.skill * 0.88) return null; // awareness scales with intelligence
  if (cloneDist > 240) return null;                      // not worth diverting for a far decoy
  const dir = ctx.faceTowardClone(nearestEnemyClone);
  if (cloneDist <= AI.ATTACK_RANGE && fighter.hasStamina(6)) return as({ type: 'attack', attack: ATTACK.jab }, 'combat'); // pop it
  if (cloneDist < dist + 30) return as({ type: 'move', dir, run: true }, 'approaching');
  return null;
}

// COUNTER: heal jutsu. A healing opponent is wide open — smart fighters punish it
// hard (interrupt at range or rush in); weak ones let the heal go off.
function counterHeal(ctx) {
  if (!ctx.oppHealing) return null;
  if (ctx.rng() > 0.1 + ctx.skill * 0.9) return null;
  const power = pickPower(ctx, { categories: [C.PROJECTILE, C.MELEE_BURST, C.CONTROL], threshold: 28, finisher: true });
  if (power) return as({ type: 'power', powerId: power }, 'punishing');
  if (ctx.inRange && ctx.fighter.hasStamina(8)) {
    const pool = filterAffordableAttacks(ctx, [ATTACK.cross, ATTACK.hook, ATTACK.uppercut], 0);
    if (pool.length) return as({ type: 'attack', attack: pick(pool, ctx.rng) }, 'punishing');
  }
  return as({ type: 'move', dir: ctx.faceToward(), run: true, commitMs: 300 }, 'punishing');
}

// Sharingan offensive pursuit: while active, blink onto a distant or fleeing
// opponent (repeatedly, on a short cooldown) to keep the pressure relentless.
function sharinganPursue(ctx) {
  if (!ctx.hasSharingan) return null;
  const { fighter, opponent, dist, now } = ctx;
  if (fighter.status.active('sharinganPursueCd', now)) return null;
  const fleeing = Math.abs(opponent.vx || 0) > (SHARINGAN.PURSUE_FLEE_VX ?? 180)
    && Math.sign(opponent.vx || 0) === Math.sign(opponent.x - fighter.x); // running away from us
  if (dist > (SHARINGAN.PURSUE_RANGE ?? 130) || fleeing) {
    return as({ type: 'sharinganWarp' }, 'pressuring');
  }
  return null;
}

function useOffensivePower(ctx) {
  const { dist, rng, isNightmare } = ctx;
  // Sharingan: don't zone from afar — close the gap and brawl.
  if (ctx.hasSharingan && dist > 130) return null;
  // Pick the skill class that fits the gap: zone from afar, burst up close, or
  // teleport in to close distance. Each power still self-scores within the class.
  const categories = dist > 180
    ? [C.PROJECTILE, C.CONTROL]
    : dist < 120
      ? [C.MELEE_BURST, C.MOVEMENT, C.SETUP]
      : null; // any category — let scoring decide in the mid-range
  const power = pickPower(ctx, { categories, threshold: isNightmare ? 44 : 56 });
  // Smart fighters use jutsu at the right moment; weak ones rarely do. A
  // sharingan-confident fighter commits to its openings freely.
  if (power && (isNightmare || ctx.hasSharingan || rng() < 0.35 + execSkill(ctx) * 0.6)) return as({ type: 'power', powerId: power }, 'combat');
  return null;
}

function closeOrAttack(ctx) {
  const { inRange, fighter, dist, tired } = ctx;
  const toward = ctx.faceToward();
  const confident = ctx.hasSharingan; // protected → press the attack, never back off

  if (!confident && (tired || (fighter.stamina < 15 && dist < 110))) {
    return as({ type: 'move', dir: -toward, run: false, commitMs: 400 }, 'retreating');
  }
  if (inRange && fighter.hasStamina(8)) {
    // Low intelligence sometimes mistimes the hit — but a confident fighter commits.
    if (!confident && ctx.rng() < 0.3 * (1 - execSkill(ctx))) return as({ type: 'move', dir: toward, run: false, commitMs: 140 }, 'approaching');
    const pool = buildAttackPool(ctx);
    if (pool.length) return as({ type: 'attack', attack: pick(pool, ctx.rng) }, 'combat');
  }
  if (!inRange) {
    // Confident → close the gap eagerly: slide in from mid-range, else sprint.
    if (confident && dist > 100 && dist < 240 && fighter.onGround() && ctx.canAffordSlide && ctx.rng() < 0.4) {
      return as({ type: 'slide', dir: toward }, 'pressuring');
    }
    const run = confident || shouldRun(ctx);
    return as({ type: 'move', dir: toward, run, commitMs: run ? 560 : 380 }, confident ? 'pressuring' : 'approaching');
  }
  return as({ type: 'move', dir: toward, run: false, commitMs: 240 }, 'pressuring');
}

const CONSIDERATIONS = [
  evadeProjectile,
  emergencyDefense,
  punishOpening,
  counterHeal,
  counterClone,
  sharinganPursue, // blink onto a fleeing/distant foe while sharingan is up
  recoverHealth,   // heal proactively when hurt & safe
  recoverStamina,
  survive,         // desperate escape when critical & unsafe
  antiAir,
  useOffensivePower,
  closeOrAttack
];

// A wall can't be walked through. If a move heads into a near wall, a smart
// fighter vaults over it (jump) or redirects; a dumb one may still bonk into it.
function avoidWall(ctx, action) {
  if (action?.type !== 'move') return action;
  const fighter = ctx.fighter;
  if (!fighter.onGround()) return action; // already mid-vault — don't fight the jump
  const obs = ctx.nearestObstacle;
  if (!obs || action.dir !== obs.dir || obs.d > 95) return action;

  // Awareness of the obstacle scales with intelligence.
  if (ctx.rng() > 0.25 + ctx.skill * 0.7) return action;

  if (fighter.hasStamina(FIGHTER.JUMP_STAMINA ?? 14)) {
    return { type: 'jump', wallVault: true, dir: obs.dir, aiLabel: action.aiLabel || 'approaching' };
  }
  return { ...action, dir: -action.dir }; // can't jump → don't push into it, go around
}

export function decideAction(ctx) {
  for (const consider of CONSIDERATIONS) {
    const action = consider(ctx);
    if (action) return avoidWall(ctx, action);
  }
  return avoidWall(ctx, as({ type: 'move', dir: ctx.faceToward(), run: false }, 'approaching'));
}

// Should the AI interrupt a committed move to re-decide right now?
export function hasUrgentInterrupt(ctx) {
  return !!(ctx.inboundThreat
    || ((ctx.oppAttacking || ctx.oppHeavyWindup) && ctx.dist <= AI.COMBAT_ENTER)
    || ctx.oppStaggered
    || ctx.oppJustWhiffed);
}
