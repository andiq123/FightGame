import { ATTACK, ATTACK_POWER_PUNCH, GRAB, COMBO_CHAINS } from '../entities/attacks.js';
import { scorePower } from '../entities/powers/index.js';
import { AI, PHYSICS, FIGHTER, AI_STATE } from '../config/constants.js';
import { buildCtx, faceToward } from './context.js';
import { TRANSITION_CHECKS, Transitions } from './transitions.js';
import { STRATEGY } from './strategy.js';

// Re-export for compatibility
export { faceToward };

function preprocessActionForObstacles(fighter, action, ctx) {
  if (!ctx.nearestObstacle) return action;

  const { o, d, dir } = ctx.nearestObstacle;
  const movingTowardObstacle = action?.type === 'move' && action.dir === dir;
  const isMyWall = o.ownerId === fighter.id;
  const isEnemyWall = !isMyWall && o.ownerId != null;

  // Proactive jump: AI sees an enemy wall blocking the path to the opponent
  if (isEnemyWall && d < 85 && movingTowardObstacle) {
    if (fighter.onGround() && fighter.hasStamina(FIGHTER?.JUMP_STAMINA ?? 14)) {
      return { type: 'jump', wallVault: true, dir };
    }
  }

  // Close to any wall while moving toward it
  if (movingTowardObstacle && d < 60) {
    const hpRatio = fighter.hp / fighter.maxHp;
    const staminaRatio = fighter.stamina / fighter.maxStamina;

    // Use own wall as cover when hurt
    if (isMyWall && (hpRatio < 0.4 || staminaRatio < 0.3)) {
      return { type: 'block', duration: 500, low: false };
    }

    // Jump over any wall with forward momentum - PRIORITY over turning back
    if (fighter.onGround() && fighter.hasStamina(FIGHTER?.JUMP_STAMINA ?? 14)) {
      return { type: 'jump', wallVault: true, dir };
    }

    // If we can't jump yet, DON'T turn around (causes spinning).
    // Instead, wait/guard to build stamina for the jump.
    return { type: 'block', duration: 150, low: false }; // Wait for stamina/cooldown
  }

  return action;
}

function getNextComboAttack(fighter, combo, rng) {
  const n = fighter.comboCount;
  if (n === 0) return null;
  const last = fighter.lastLandingAttackType;
  if (last == null) return null;
  const candidates = COMBO_CHAINS
    .filter(chain => chain.length > n && chain[n - 1] === last)
    .map(chain => chain[n]);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

const GCD_MS = 700;

function pickPower(ctx) {
  const { fighter, rng, now } = ctx;
  const threshold = ctx._desperateThreshold ?? 12;
  if (fighter.lastGlobalSkillAt && now - fighter.lastGlobalSkillAt < GCD_MS) return null;
  if (!fighter.powers?.length) return null;
  let best = null, bestScore = 0;
  for (const pid of fighter.powers) {
    if (!fighter.canUsePower(pid)) continue;
    const s = scorePower(pid, ctx);
    if (s > bestScore) { bestScore = s; best = pid; }
  }
  if (bestScore >= threshold && best === fighter.lastUsedPower && rng() < 0.48) return null;
  return bestScore >= threshold ? best : null;
}

function pickRangedPower(ctx) {
  const { fighter, inFireballRange, inShurikenRange, canSeeOpponent, dist, rng, now } = ctx;
  if (fighter.lastGlobalSkillAt && now - fighter.lastGlobalSkillAt < GCD_MS) return null;
  if (!canSeeOpponent) return null; // Added Environment Check
  let best = null, bestScore = 0;
  for (const pid of ['fireball', 'shuriken']) {
    if (!fighter.powers.includes(pid) || !fighter.canUsePower(pid)) continue;
    if (pid === 'fireball' && !inFireballRange) continue;
    if (pid === 'shuriken' && !inShurikenRange) continue;
    let s = scorePower(pid, ctx);

    // Strategy Bonus
    if (fighter.aiCombatMode === STRATEGY.ZONING) s += 40;
    if (fighter.aiCombatMode === STRATEGY.TURTLE && dist > 200) s += 30;

    if (dist > 140 && pid === 'shuriken') s += 25;
    if (dist >= 180 && dist <= 250 && pid === 'fireball') s += 25;
    if (s > bestScore) { bestScore = s; best = pid; }
  }
  if (bestScore >= 12 && best === fighter.lastUsedPower && rng() < 0.45) return null;
  return bestScore >= 12 ? best : null;
}

// Action Getters
function getProjectileEvadeAction(ctx) {
  const { inboundThreat, fighter, stats, rng } = ctx;
  if (!inboundThreat) return null;
  const evadeDir = inboundThreat.evadeDir;
  const tMs = inboundThreat.timeToImpact * 1000;
  const jumpWhenFar = AI.PROJECTILE_JUMP_WHEN_FAR_MS ?? 320;
  const highProjectile = inboundThreat.high;
  const reaction = (stats.reaction ?? 50) / 100;
  const expertLevel = reaction >= 0.72;
  const canCrouch = highProjectile && fighter.onGround();
  if (expertLevel && fighter.onGround() && rng() < 0.78) return { type: 'dodge', dir: evadeDir };
  if (fighter.onGround()) {
    const jumpOverHigh = highProjectile && (expertLevel || tMs > jumpWhenFar || (inboundThreat.heavy && tMs > 180));
    const jumpWhenTime = (inboundThreat.heavy || !highProjectile) && tMs > jumpWhenFar;
    if (jumpOverHigh || jumpWhenTime) return { type: 'jump' };
  }
  if (fighter.onGround() && rng() < 0.7) return { type: 'dodge', dir: evadeDir };
  if (canCrouch) return { type: 'block', duration: 420, low: true };
  return { type: 'block', duration: 400, low: !highProjectile };
}

function getDefendAction(ctx) {
  const { oppHitbox, fighter, rng, intelligence, dist } = ctx;
  const reaction = intelligence / 100;

  if (ctx.cannotEvade && fighter.canUsePower('shinraTensei') && dist <= 140) {
    return { type: 'power', powerId: 'shinraTensei' };
  }

  const toward = ctx.faceToward(0.1);
  const away = -toward;
  const heavyIncoming = oppHitbox?.damage >= 12;
  const highIncoming = oppHitbox?.high !== false;

  // Predictive Dodging
  if (fighter.onGround()) {
    if (heavyIncoming) {
      if (rng() < 0.3 + reaction * 0.5) return { type: 'dodge', dir: away };
    } else {
      if (rng() < 0.2 + reaction * 0.3) return { type: 'dodge', dir: away };
    }
    // Hop over low attacks
    if (!highIncoming && rng() < 0.4 + reaction * 0.4) return { type: 'jump' };
  }

  // Default Block
  return { type: 'block', duration: heavyIncoming ? 350 : 250, low: !highIncoming };
}

function getPunishAction(ctx) {
  const { oppStaggered, oppGettingUp, oppRecovering, rng, dist, fighter } = ctx;
  if (oppStaggered) {
    if (!ctx.preserveStamina && dist <= 100 && fighter.canUsePower('lightningCutter') && rng() < 0.65) return { type: 'power', powerId: 'lightningCutter' };
    const heavies = ctx.preserveStamina ? [ATTACK.hook, ATTACK.uppercut, ATTACK.cross] : [ATTACK.hook, ATTACK.highKick, ATTACK.uppercut, ATTACK_POWER_PUNCH];
    return { type: 'attack', attack: heavies[Math.floor(rng() * heavies.length)] };
  }
  if (oppGettingUp && ctx.grabRange && ctx.fighter.hasStamina(FIGHTER?.WALL_JUMP_STAMINA ?? 12) && rng() < 0.45) return { type: 'attack', attack: GRAB }; // Wake-up grab
  if (oppRecovering && dist > AI.ATTACK_RANGE && dist < 170 && dist > 140) return { type: 'move', dir: ctx.faceToward(), run: true };

  // Strategy Influence: Corner pressure punish
  if (fighter.aiCombatMode === STRATEGY.CORNER_TRAP && oppGettingUp) {
    return { type: 'block', duration: 100 }; // Bait reversal then punish? Or meaty attack?
    // For now, simplify: use Heavy
  }

  const punish = [ATTACK.cross, ATTACK.uppercut, ATTACK.hook, ATTACK.highKick, ATTACK.spinningKick, ATTACK.frontKick, ATTACK.lowKick];
  return { type: 'attack', attack: punish[Math.floor(rng() * punish.length)] };
}

function buildCombatAttackPool(ctx) {
  const { fighter, tired, aggression, combo, rng, reengaging, isNightmare, frameAdvantage } = ctx;
  const comboNext = getNextComboAttack(fighter, combo, rng);
  const combatMode = fighter.aiCombatMode || STRATEGY.NEUTRAL;

  const openers = [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, ATTACK.lowKick];
  const simple = [ATTACK.jab, ATTACK.cross, ATTACK.lowKick, ATTACK.frontKick, ATTACK.hook];
  const heavy = [ATTACK_POWER_PUNCH, ATTACK.highKick, ATTACK.spinningKick, ATTACK.uppercut, ATTACK.hook, ATTACK.axeKick];

  let pool = tired ? [ATTACK.jab, ATTACK.lowKick, ATTACK.frontKick] : [...openers, ATTACK.uppercut];

  // Nightmare Optimization: Guaranteed Combo Continuation
  if (isNightmare && fighter.comboCount >= 1 && comboNext != null && frameAdvantage > 0) {
    return [comboNext];
  }

  // Strategy-Based Pool
  if (combatMode === STRATEGY.RUSH_DOWN || (reengaging && fighter.stamina >= 30)) {
    pool = [...heavy, ...pool]; // Use heavy hitters to break guard
  }
  if (combatMode === STRATEGY.CORNER_TRAP) {
    pool = [ATTACK.uppercut, ATTACK.hook, ATTACK_POWER_PUNCH, ATTACK.spinningKick]; // Juggle potential
  }
  if (ctx.oppFrozen) pool = [...heavy, ...pool];

  if (!tired && fighter.comboCount >= 1 && comboNext != null) pool = [comboNext, ...pool];

  if (!tired && aggression > 0.2) pool = [...simple, ATTACK.uppercut, ATTACK.frontKick];
  if (!tired && aggression > 0.3) pool = [...pool, ATTACK.highKick, ATTACK.spinningKick];

  if (!tired && ctx.opponent.stamina < 40) pool = [ATTACK.lowKick, ...pool];
  if (ctx.oppBlockingALot && aggression > 0.4) pool = [GRAB, ...pool];

  return pool;
}

function getCombatAction(ctx) {
  const { fighter, inRange, grabRange, oppBlocking, rng, dist, tired, isNightmare, intelligence, parkour, nearestEnemyClone, cloneDist, hpCritical, hpLow, oppHpCritical, cornered } = ctx;
  const toward = ctx.faceToward();
  const away = -toward;
  const reaction = intelligence / 100;
  const strategy = fighter.aiCombatMode || STRATEGY.NEUTRAL;
  const { underPressure, isSafe, staminaLow, staminaHigh } = ctx;

  // 1. High-Priority Reactive Actions & Pressure Management
  if (underPressure) {
    if (staminaLow || (hpCritical && rng() < 0.7)) return { type: 'move', dir: away, run: true };
    if (rng() < 0.45) return { type: 'block', duration: 150 };
  }

  if (isNightmare || (reaction > 0.8 && rng() < 0.7)) {
    if (ctx.oppJustWhiffed && inRange && fighter.hasStamina(15)) {
      const punish = [ATTACK.cross, ATTACK.uppercut, ATTACK_POWER_PUNCH];
      return { type: 'attack', attack: punish[Math.floor(rng() * punish.length)] };
    }
  }

  // 2. Clone Management
  if (nearestEnemyClone && cloneDist < dist && cloneDist < 120) {
    const dir = ctx.faceTowardClone(nearestEnemyClone);
    if (cloneDist < AI.ATTACK_RANGE && fighter.hasStamina(10)) {
      return { type: 'attack', attack: ATTACK.jab };
    }
    return { type: 'move', dir, run: true };
  }

  // 3. HP-Critical Burst: When near death, AI goes all-in on skills
  if (hpCritical) {
    // Desperate escape: shinraTensei to blast out of a corner
    if (cornered && dist < 120 && fighter.canUsePower('shinraTensei')) {
      return { type: 'power', powerId: 'shinraTensei' };
    }
    // Use pickPower but with a lower acceptance threshold (score >= 8 vs normal >= 12)
    const desperatePower = pickPower({ ...ctx, _desperateThreshold: 8 });
    if (desperatePower) return { type: 'power', powerId: desperatePower };
  }

  // 4. Strategy Specifics
  if (strategy === STRATEGY.ZONING) {
    // Use ranged powers liberally
    const ranged = pickRangedPower(ctx);
    if (ranged && dist > 150) return { type: 'power', powerId: ranged };
    // Move away to maintain distance
    if (dist < 250 && !inRange) return { type: 'move', dir: away, run: true };
  }

  if (strategy === STRATEGY.CORNER_TRAP) {
    if (dist > 100) return { type: 'move', dir: toward, run: true }; // Keep them there
    if (oppBlocking && grabRange && rng() < 0.6) return { type: 'attack', attack: GRAB }; // Grab them out of block
  }

  if (strategy === STRATEGY.TURTLE) {
    // Prioritize blocking and counter-pokes
    if (dist < 80 && !ctx.oppAttacking && rng() < 0.3) return { type: 'attack', attack: ATTACK.jab }; // Poke
    if (!ctx.oppAttacking && rng() < 0.8) return { type: 'block', duration: 100 }; // Flash block
  }

  // 5. Finish-Mode: Opponent is critically low — use skills to close out
  if (oppHpCritical && rng() < 0.85) {
    const finisher = pickPower(ctx);
    if (finisher && dist < 280) return { type: 'power', powerId: finisher };
  }

  // 6. Power Usage (General) — raised probability from 0.55 → 0.72
  const power = pickPower(ctx);
  if (power && (isNightmare || rng() < 0.72)) {
    if (power === 'shinraTensei' && dist < 100 && (ctx.oppAttacking || isNightmare)) {
      return { type: 'power', powerId: 'shinraTensei' };
    }
    if (power === 'lightningCutter' && ctx.oppRecovering && inRange) {
      return { type: 'power', powerId: 'lightningCutter' };
    }
    if (dist < 250) return { type: 'power', powerId: power };
  }

  // 5. Parkour & Style
  if (parkour > 0.65 && !inRange && dist > 90 && dist < 190 && fighter.onGround() && strategy !== STRATEGY.TURTLE) {
    if (rng() < 0.18 * parkour) return { type: 'slide', dir: toward };
  }

  // 6. Default Attack Execution
  if (inRange && fighter.hasStamina(8)) {
    const pool = buildCombatAttackPool(ctx);
    if (pool.length) return { type: 'attack', attack: pool[Math.floor(rng() * pool.length)] };
  }

  // 7. Movement & Closing Distance
  if (tired || (fighter.stamina < 15 && dist < 110)) return { type: 'move', dir: away, run: false };

  if (!inRange) {
    const run = shouldRunToEngage(ctx, 120);
    return { type: 'move', dir: toward, run, commitMs: run ? 520 : 360 };
  }

  return { type: 'move', dir: toward, run: false };
}

function shouldRunToEngage(ctx, threshold = AI.PREFERRED_DIST_MAX) {
  if (ctx.tired || ctx.staminaLow) return false;
  if (ctx.fighter.aiCombatMode === STRATEGY.TURTLE) return false;
  if ((ctx.staminaRatio ?? 0) < (PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28)) return false;
  return ctx.dist > threshold || ctx.oppStaggered || ctx.oppRecovering || ctx.oppHpCritical || ctx.isNightmare;
}

function getApproachAction(ctx) {
  const { fighter, dist, canSeeOpponent, nearestEnemyClone, cloneDist, tired, canAffordSlide, parkour, isNightmare, rng, strategy } = ctx;
  const aggression = ctx.aggression ?? 0.5;
  const toward = ctx.faceToward();

  // If opponent is staggered/stunned, RUSH THEM immediately
  if (ctx.oppStaggered) {
    return { type: 'move', dir: toward, run: true };
  }

  if (!canSeeOpponent && ctx.blockedByWall) {
    if (tired || ctx.staminaRatio < 0.7) {
      return { type: 'move', dir: -toward, run: true }; // Retreat
    }
    // Else continue to preprocessActionForObstacles (jump)
  }

  const ranged = pickRangedPower(ctx);
  if (ranged && dist > 100 && strategy === STRATEGY.ZONING) return { type: 'power', powerId: ranged };

  // Clone handling
  if (nearestEnemyClone && cloneDist < dist && cloneDist < 180) {
    const dir = ctx.faceTowardClone(nearestEnemyClone);
    return { type: 'move', dir, run: true };
  }

  if (!fighter.onGround() && fighter.hasStamina(10) && !fighter.doubleJumpUsed && dist > 260 && rng() < 0.18 + (parkour ?? 0) * 0.18) return { type: 'doubleJump' };

  const slideMinDist = AI.SLIDE_MIN_DIST ?? 95;

  if (parkour > 0.7 && dist >= slideMinDist && dist < 150 && fighter.onGround() && canAffordSlide && rng() < 0.25) return { type: 'slide', dir: toward };

  const run = shouldRunToEngage(ctx, AI.PREFERRED_DIST_MAX);
  return { type: 'move', dir: toward, run, commitMs: run ? 620 : 420 };
}

function getRetreatAction(ctx) {
  const { fighter, dist, rng, staminaRatio, hpLow, hpCritical } = ctx;
  const away = ctx.faceToward() === 1 ? -1 : 1;
  const runToEscape = staminaRatio >= (PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28) && staminaRatio > 0.5;

  // Try to heal while retreating if HP is low and we have distance
  if ((hpLow || hpCritical) && dist > 180) {
    if (fighter.lastGlobalSkillAt && ctx.now - fighter.lastGlobalSkillAt < GCD_MS) {
      // still on GCD, skip
    } else if (fighter.canUsePower('heal') && rng() < 0.85) {
      return { type: 'power', powerId: 'heal' };
    }
  }

  if (fighter.onGround() && fighter.hasStamina(14) && dist < 90 && rng() < 0.2) return { type: 'jump' };
  return { type: 'move', dir: away, run: runToEscape, commitMs: 560 };
}

function getRegroupAction(ctx) {
  const { fighter, dist, rng, cornered, hpLow, hpCritical, staminaRatio, tired, inRecovery, isSafe, staminaHigh, staminaLow } = ctx;
  const toward = ctx.faceToward();
  const away = -toward;

  // 1. Recovery Check: If we are already fully recovered, start moving toward with confidence
  if (staminaHigh && !tired && !inRecovery && dist > 350) {
    return { type: 'move', dir: toward, run: false, commitMs: 420 };
  }

  // 2. High-Priority: Heal during regroup if HP is low and safe
  if ((hpLow || hpCritical) && (dist > 150 || isSafe)) {
    if (!fighter.lastGlobalSkillAt || ctx.now - fighter.lastGlobalSkillAt >= GCD_MS) {
      if (fighter.canUsePower('heal') && (rng() < 0.9 || isSafe)) {
        return { type: 'power', powerId: 'heal' };
      }
    }
  }

  // 3. Medium-Priority: Harassment while regrouping (Don't just run, fight back!)
  if (!staminaLow && (dist > 140 || isSafe)) {
    const ranged = pickRangedPower(ctx);
    if (ranged && rng() < 0.7) {
      return { type: 'power', powerId: ranged };
    }
  }

  // 4. Utility: Safe behind wall
  if (isSafe) {
    if (staminaHigh) return { type: 'move', dir: toward, run: false }; // Peeking out
    return { type: 'block', duration: 300, low: false, idle: true }; // Confident catching breath
  }

  if (ctx.blockedByWall && staminaRatio < 0.7) {
    return { type: 'block', duration: 300, low: false };
  }

  // 5. Emergency: Trapped in corner
  if (cornered && dist < 100) {
    if (rng() < 0.75) return { type: 'dodge', dir: toward };
    return { type: 'move', dir: toward, run: false };
  }

  // 6. Default: Maintain distance while recovering
  const run = staminaRatio > 0.3 && dist < 400;
  return { type: 'move', dir: away, run, commitMs: run ? 560 : 420 };
}

function getPrepareAction(ctx) {
  const { fighter, dist, isNightmare } = ctx;
  const toward = ctx.faceToward();
  const away = -toward;
  const ranged = pickRangedPower(ctx);
  if (ranged && dist > 95 && dist < 220) return { type: 'power', powerId: ranged };
  if (isNightmare) return { type: 'move', dir: toward, run: false };
  if (dist < AI.PREFERRED_DIST_MAX + 30) return { type: 'move', dir: away, run: false };
  return { type: 'move', dir: toward, run: true };
}

function getBaitAction(ctx) {
  const { dist, rng } = ctx;
  const toward = ctx.faceToward();
  const away = -toward;
  if (dist < 130) return { type: 'move', dir: away, run: false }; // Back off to whiff
  if (rng() < 0.2) return { type: 'move', dir: toward, run: false }; // Feint in
  return { type: 'move', dir: away, run: false };
}

function getPressureAction(ctx) {
  const { dist, rng, fighter } = ctx;
  const toward = ctx.faceToward();
  if (dist > 60) return { type: 'move', dir: toward, run: true };
  if (fighter.hasStamina(15) && rng() < 0.7) {
    return { type: 'attack', attack: ATTACK.jab };
  }
  return { type: 'move', dir: toward, run: false };
}

function getRechargeAction(ctx) {
  const { dist, staminaRatio, blockedByWall } = ctx;
  const toward = ctx.faceToward();
  const ranged = pickRangedPower(ctx);
  if (ranged && dist > 140 && staminaRatio > 0.4) {
    return { type: 'power', powerId: ranged };
  }
  // Safe recharge
  if (blockedByWall || dist > 350) return { type: 'move', dir: toward, run: false, idle: true };
  return { type: 'move', dir: -toward, run: true };
}

const STATE_ACTIONS = {
  [AI_STATE.EVADING_PROJECTILE]: getProjectileEvadeAction,
  [AI_STATE.SHINRA_DEFENSE]: () => ({ type: 'power', powerId: 'shinraTensei' }),
  [AI_STATE.REGROUPING]: getRegroupAction,
  [AI_STATE.DEFENDING]: getDefendAction,
  [AI_STATE.PUNISHING]: getPunishAction,
  [AI_STATE.RETREATING]: getRetreatAction,
  [AI_STATE.PREPARING]: getPrepareAction,
  [AI_STATE.COMBAT]: getCombatAction,
  [AI_STATE.APPROACHING]: getApproachAction,
  [AI_STATE.BAITING]: getBaitAction,
  [AI_STATE.PRESSURING]: getPressureAction,
  [AI_STATE.RECHARGING]: getRechargeAction,
};

export function evaluateState(fighter, opponent, stats, now, rng, clones = [], projectiles = [], obstacles = []) {
  const ctx = buildCtx(fighter, opponent, stats, now, rng, clones, projectiles, obstacles);
  ctx.canTransition = now >= (fighter.aiStateUntil || 0) || (ctx.evasiveTimeOver === true);
  const reaction = stats.reaction / 100;
  const minEvadeReaction = AI.EVADE_PROJECTILE_REACTION_MIN ?? 0.9;

  if (ctx.inboundThreat && fighter.canAct(now) && reaction >= minEvadeReaction && Transitions.evadeProjectile(ctx)) return AI_STATE.EVADING_PROJECTILE;

  const currentStateLocked = fighter.aiState && !ctx.canTransition;
  const urgentDefense = (ctx.oppAttacking || ctx.oppHeavyWindup) && ctx.dist <= AI.COMBAT_ENTER && Transitions.defend(ctx);
  const urgentPunish = ctx.oppJustWhiffed && ctx.dist < 155 && !ctx.tired;

  if (currentStateLocked && !urgentDefense && !urgentPunish) {
    return fighter.aiState;
  }

  if (urgentDefense) return AI_STATE.DEFENDING;
  if (urgentPunish) return AI_STATE.PUNISHING;

  for (const [guard, check, state] of TRANSITION_CHECKS) {
    if (!guard(ctx)) continue;
    if (!check(ctx)) continue;
    // Note: ensure fighter.aiCombatMode is set elsewhere (by Strategy) or default here
    return state;
  }

  return fighter.aiState || AI_STATE.APPROACHING;
}

export function getStateAction(state, fighter, opponent, stats, now, rng, clones = [], projectiles = [], obstacles = []) {
  const ctx = buildCtx(fighter, opponent, stats, now, rng, clones, projectiles, obstacles);
  const fn = STATE_ACTIONS[state] || getApproachAction;
  const action = fn(ctx);
  return preprocessActionForObstacles(fighter, action, ctx);
}
