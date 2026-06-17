import { ATTACK, ATTACK_POWER_PUNCH, GRAB, COMBO_CHAINS } from '../entities/attacks.js';
import { AI } from '../config/constants.js';
import { scorePower } from '../entities/powers/index.js';
import {
  scorePowerWithBudget,
  canUsePowerWithBudget,
  shouldPrioritizeRecovery,
  filterAffordableAttacks
} from './staminaStrategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// Single utility-based AI decider.
//
// One pass per decision tick. A flat, priority-ordered list of "considerations"
// is evaluated top to bottom; the first one that returns an action wins. There
// is no separate state machine, strategy layer, or jutsu plan-queue fighting
// over the result — every power scores itself (see each power's `score(ctx)`),
// and tactics live here as readable rules.
// ─────────────────────────────────────────────────────────────────────────────

const GCD_MS = 700;

// Effective skill for execution gates. Raising skill to a power widens the gap
// between mid levels (e.g. 5 vs 10) so every intelligence step is decisive,
// while leaving the extremes (0 and 1) anchored.
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

// Pick the best affordable power for the situation. Each power scores itself;
// we only add a stamina-budget gate, the global cooldown, and a repeat penalty.
export function pickPower(ctx, { allowed = null, threshold = 50, emergency = false, finisher = false, allowRepeat = false } = {}) {
  const { fighter, now } = ctx;
  if (!fighter.powers?.length) return null;
  if (!emergency && fighter.lastGlobalSkillAt && now - fighter.lastGlobalSkillAt < GCD_MS) return null;

  let best = null;
  let bestScore = threshold;
  for (const pid of fighter.powers) {
    if (allowed && !allowed.includes(pid)) continue;
    const base = scorePower(pid, ctx);          // power's own situational/range scoring
    if (base <= 0) continue;
    let s = scorePowerWithBudget(ctx, pid, base, {
      emergency: emergency || ctx.hpCritical || ctx.cannotEvade,
      finisher: finisher || ctx.oppHpCritical
    });
    if (s <= 0) continue;
    if (!allowRepeat && pid === fighter.lastUsedPower) {
      const reps = (fighter.aiJutsuHistory || []).filter(id => id === pid).length;
      s -= 20 + reps * 12;
    }
    s += (ctx.rng?.() ?? 0) * 6;
    if (s > bestScore) {
      bestScore = s;
      best = pid;
    }
  }
  return best;
}

// Record a used jutsu for repeat-avoidance (called from behavior on cast).
export function recordJutsuUse(fighter, powerId) {
  fighter.aiJutsuHistory = fighter.aiJutsuHistory || [];
  fighter.aiJutsuHistory.unshift(powerId);
  if (fighter.aiJutsuHistory.length > 6) fighter.aiJutsuHistory.pop();
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
  if (tired) {
    pool = [ATTACK.jab, ATTACK.lowKick, ATTACK.frontKick];
  } else {
    pool = [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, ATTACK.lowKick];
    if (aggression > 0.3) pool.push(ATTACK.hook, ATTACK.uppercut);
    if (aggression > 0.5 || isNightmare) pool.push(ATTACK.highKick, ATTACK.spinningKick);
    if (ctx.opponent.stamina < 40) pool.unshift(ATTACK.lowKick);
    if (ctx.oppFrozen) pool.push(ATTACK_POWER_PUNCH, ATTACK.spinningKick);
    if (ctx.oppBlockingALot && aggression > 0.4) pool.unshift(GRAB);
    if (comboNext != null) pool.unshift(comboNext);
  }
  return filterAffordableAttacks(ctx, pool, ctx.staminaLow ? 14 : 0);
}

// ── Considerations (priority order) ─────────────────────────────────────────

function evadeProjectile(ctx) {
  const { inboundThreat, fighter, stats, rng } = ctx;
  if (!inboundThreat || !fighter.canAct(ctx.now)) return null;
  if ((stats.reaction ?? 50) / 100 < (AI.EVADE_PROJECTILE_REACTION_MIN ?? 0.68)) return null;

  const power = pickPower(ctx, {
    allowed: ['shinraTensei', 'earthWall', 'spectralDash'],
    threshold: inboundThreat.heavy ? 42 : 56,
    emergency: true
  });
  if (power) return as({ type: 'power', powerId: power }, 'evadingProjectile');

  const tMs = inboundThreat.timeToImpact * 1000;
  if (fighter.onGround()) {
    if (inboundThreat.high && tMs > (AI.PROJECTILE_JUMP_WHEN_FAR_MS ?? 320)) return as({ type: 'jump' }, 'evadingProjectile');
    if (ctx.canAffordDodge && rng() < 0.55 + ctx.defense * 0.3) return as({ type: 'dodge', dir: inboundThreat.evadeDir }, 'evadingProjectile');
  }
  return as({ type: 'block', duration: 380, low: !inboundThreat.high }, 'evadingProjectile');
}

function emergencyDefense(ctx) {
  const { oppAttacking, oppHeavyWindup, oppHitbox, dist, fighter, rng } = ctx;
  if (!(oppAttacking || oppHeavyWindup) || dist > AI.COMBAT_ENTER) return null;

  const heavy = oppHeavyWindup || (oppHitbox?.damage >= 12);
  const skill = ctx.skill;
  const reaction = skill;

  // Reacting to an attack is the core skill check, and it scales with raw skill so
  // even a few intelligence levels noticeably improve defense. A maxed fighter
  // blocks/dodges almost everything; a novice barely reacts at all.
  const reactChance = heavy ? 0.16 + skill * 0.84 : 0.03 + skill * 0.95;
  if (rng() > reactChance) return null;

  const power = pickPower(ctx, {
    allowed: ['shinraTensei', 'earthWall', 'spectralDash', 'cloneJutsu'],
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
    allowed: ['lightningCutter', 'dragonRoar', 'shinraTensei', 'fireball', 'shuriken', 'iceSpikes'],
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
  if (!shouldPrioritizeRecovery(ctx)) return null;
  if (ctx.dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330) || ctx.isSafe) return as({ type: 'recover' }, 'recharging');
  return as({ type: 'move', dir: -ctx.faceToward(), run: false, commitMs: 600 }, 'retreating');
}

function survive(ctx) {
  if (!ctx.hpCritical) return null;
  const { dist, cornered, fighter, now } = ctx;

  if (cornered && dist < 120 && canUsePowerWithBudget(ctx, 'shinraTensei', { emergency: true })) {
    return as({ type: 'power', powerId: 'shinraTensei' }, 'defending');
  }
  const gcdReady = !fighter.lastGlobalSkillAt || now - fighter.lastGlobalSkillAt >= GCD_MS;
  if (dist > 180 && gcdReady && canUsePowerWithBudget(ctx, 'heal', { emergency: true })) {
    return as({ type: 'power', powerId: 'heal' }, 'recharging');
  }
  const power = pickPower(ctx, {
    allowed: ['earthWall', 'cloneJutsu', 'spectralDash', 'shinraTensei'],
    threshold: 34,
    emergency: true,
    allowRepeat: true
  });
  if (power) return as({ type: 'power', powerId: power }, 'defending');
  if (dist < 200) return as({ type: 'move', dir: -ctx.faceToward(), run: true, commitMs: 500 }, 'retreating');
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
  const power = pickPower(ctx, { allowed: ['shuriken', 'fireball', 'lightningCutter', 'iceSpikes', 'shinraTensei'], threshold: 28, finisher: true });
  if (power) return as({ type: 'power', powerId: power }, 'punishing');
  if (ctx.inRange && ctx.fighter.hasStamina(8)) {
    const pool = filterAffordableAttacks(ctx, [ATTACK.cross, ATTACK.hook, ATTACK.uppercut], 0);
    if (pool.length) return as({ type: 'attack', attack: pick(pool, ctx.rng) }, 'punishing');
  }
  return as({ type: 'move', dir: ctx.faceToward(), run: true, commitMs: 300 }, 'punishing');
}

function useOffensivePower(ctx) {
  const { dist, rng, isNightmare } = ctx;
  const allowed = dist > 180
    ? ['fireball', 'shuriken', 'iceSpikes', 'flameShower', 'vacuumPull']
    : dist < 120
      ? ['lightningCutter', 'dragonRoar', 'shinraTensei', 'spectralDash', 'cloneJutsu']
      : null;
  const power = pickPower(ctx, { allowed, threshold: isNightmare ? 44 : 56 });
  // Smart fighters use jutsu at the right moment; weak ones rarely do.
  if (power && (isNightmare || rng() < 0.35 + execSkill(ctx) * 0.6)) return as({ type: 'power', powerId: power }, 'combat');
  return null;
}

function closeOrAttack(ctx) {
  const { inRange, fighter, dist, tired } = ctx;
  const toward = ctx.faceToward();

  if (tired || (fighter.stamina < 15 && dist < 110)) {
    return as({ type: 'move', dir: -toward, run: false, commitMs: 400 }, 'retreating');
  }
  if (inRange && fighter.hasStamina(8)) {
    // Low intelligence sometimes mistimes the hit, but mostly it just attacks
    // poorly and gets blocked/punished — so keep this modest (no full freeze).
    if (ctx.rng() < 0.3 * (1 - execSkill(ctx))) return as({ type: 'move', dir: toward, run: false, commitMs: 140 }, 'approaching');
    const pool = buildAttackPool(ctx);
    if (pool.length) return as({ type: 'attack', attack: pick(pool, ctx.rng) }, 'combat');
  }
  if (!inRange) {
    const run = shouldRun(ctx);
    return as({ type: 'move', dir: toward, run, commitMs: run ? 560 : 380 }, 'approaching');
  }
  return as({ type: 'move', dir: toward, run: false, commitMs: 240 }, 'pressuring');
}

const CONSIDERATIONS = [
  evadeProjectile,
  emergencyDefense,
  punishOpening,
  counterHeal,
  counterClone,
  recoverStamina,
  survive,
  antiAir,
  useOffensivePower,
  closeOrAttack
];

export function decideAction(ctx) {
  for (const consider of CONSIDERATIONS) {
    const action = consider(ctx);
    if (action) return action;
  }
  return as({ type: 'move', dir: ctx.faceToward(), run: false }, 'approaching');
}

// Should the AI interrupt a committed move to re-decide right now?
export function hasUrgentInterrupt(ctx) {
  return !!(ctx.inboundThreat
    || ((ctx.oppAttacking || ctx.oppHeavyWindup) && ctx.dist <= AI.COMBAT_ENTER)
    || ctx.oppStaggered
    || ctx.oppJustWhiffed);
}
