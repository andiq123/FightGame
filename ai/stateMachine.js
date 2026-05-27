import { ATTACK, ATTACK_POWER_PUNCH, GRAB, COMBO_CHAINS } from '../entities/attacks.js';
import { AI, PHYSICS, FIGHTER, AI_STATE } from '../config/constants.js';
import { buildCtx, faceToward } from './context.js';
import { TRANSITION_CHECKS, Transitions } from './transitions.js';
import { STRATEGY } from './strategy.js';
import { canUsePowerWithBudget, filterAffordableAttacks, shouldPrioritizeRecovery } from './staminaStrategy.js';
import { getPlannedJutsuAction, JUTSU_INTENT, selectJutsu } from './jutsuTactics.js';

// Re-export for compatibility
export { faceToward };

function preprocessActionForObstacles(fighter, action, ctx) {
  if (action?.type === 'move' && ctx.blockedMoveDir && action.dir === ctx.blockedMoveDir) {
    if (ctx.blockedMove?.reason === 'obstacle' && fighter.onGround() && fighter.hasStamina(FIGHTER?.JUMP_STAMINA ?? 14)) {
      return { type: 'jump', wallVault: true, dir: action.dir };
    }
    return { type: 'move', dir: -action.dir, run: false, commitMs: 320 };
  }

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
  return selectJutsu(ctx, {
    intent: ctx._jutsuIntent || JUTSU_INTENT.ANY,
    threshold: ctx._desperateThreshold ?? 52,
    emergency: ctx.hpCritical || ctx.cannotEvade,
    finisher: ctx.oppHpCritical,
    allowRepeat: ctx._allowRepeatJutsu === true
  });
}

function pickJutsu(ctx, intent, threshold = 52, options = {}) {
  return selectJutsu(ctx, {
    intent,
    threshold,
    emergency: options.emergency || ctx.hpCritical || ctx.cannotEvade,
    finisher: options.finisher || ctx.oppHpCritical,
    allowRepeat: options.allowRepeat,
    allowed: options.allowed,
    blocked: options.blocked
  });
}

function pickRangedPower(ctx, threshold = 48) {
  return pickJutsu(ctx, JUTSU_INTENT.RANGED, threshold, {
    finisher: ctx.oppHpCritical,
    allowed: ['fireball', 'shuriken', 'iceSpikes', 'flameShower']
  });
}

function getPlanIntentForState(state, ctx) {
  switch (state) {
    case AI_STATE.APPROACHING:
      return ctx.dist > 180 ? JUTSU_INTENT.RANGED : JUTSU_INTENT.ENGAGE;
    case AI_STATE.COMBAT:
      return ctx.dist < 135 ? JUTSU_INTENT.CLOSE : JUTSU_INTENT.ANY;
    case AI_STATE.PRESSURING:
      return ctx.dist > 130 ? JUTSU_INTENT.ENGAGE : JUTSU_INTENT.PRESSURE;
    case AI_STATE.PREPARING:
      return JUTSU_INTENT.SETUP;
    case AI_STATE.REGROUPING:
    case AI_STATE.RECHARGING:
      return JUTSU_INTENT.RECOVERY;
    case AI_STATE.RETREATING:
    case AI_STATE.DEFENDING:
    case AI_STATE.EVADING_PROJECTILE:
      return JUTSU_INTENT.DEFENSE;
    case AI_STATE.PUNISHING:
      return JUTSU_INTENT.PUNISH;
    case AI_STATE.BAITING:
      return JUTSU_INTENT.PUNISH;
    default:
      return JUTSU_INTENT.ANY;
  }
}

function shouldUsePlanBeforeStateAction(state, ctx) {
  if (state === AI_STATE.SHINRA_DEFENSE) return false;
  if (ctx.inboundThreat || (ctx.oppAttacking && ctx.dist <= AI.COMBAT_ENTER)) {
    return state === AI_STATE.DEFENDING || state === AI_STATE.EVADING_PROJECTILE || state === AI_STATE.RETREATING;
  }
  if (state === AI_STATE.PUNISHING) return true;
  return [
    AI_STATE.APPROACHING,
    AI_STATE.COMBAT,
    AI_STATE.PRESSURING,
    AI_STATE.PREPARING,
    AI_STATE.REGROUPING,
    AI_STATE.RECHARGING,
    AI_STATE.RETREATING,
    AI_STATE.BAITING
  ].includes(state);
}

function getQueuedJutsuAction(state, ctx) {
  if (!shouldUsePlanBeforeStateAction(state, ctx)) return null;
  const intent = getPlanIntentForState(state, ctx);
  const defensive = intent === JUTSU_INTENT.DEFENSE;
  const executeThreshold = ctx.isNightmare ? 22 : 30;
  return getPlannedJutsuAction(ctx, {
    intent,
    threshold: defensive ? 34 : 42,
    executeThreshold,
    emergency: defensive || ctx.hpCritical || ctx.cannotEvade,
    finisher: ctx.oppHpCritical,
    prepare: state !== AI_STATE.PUNISHING && state !== AI_STATE.DEFENDING && state !== AI_STATE.EVADING_PROJECTILE
  });
}

// Action Getters
function getProjectileEvadeAction(ctx) {
  const { inboundThreat, fighter, stats, rng } = ctx;
  if (!inboundThreat) return null;
  const jutsuEscape = pickJutsu(ctx, JUTSU_INTENT.DEFENSE, inboundThreat.heavy ? 42 : 56, {
    emergency: true,
    allowed: ['shinraTensei', 'earthWall', 'spectralDash']
  });
  if (jutsuEscape) return { type: 'power', powerId: jutsuEscape };

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
  const toward = ctx.faceToward(0.1);
  const away = -toward;
  const heavyIncoming = oppHitbox?.damage >= 12;
  const highIncoming = oppHitbox?.high !== false;

  const defensiveJutsu = pickJutsu(ctx, JUTSU_INTENT.DEFENSE, ctx.cannotEvade || heavyIncoming ? 38 : 62, {
    emergency: ctx.cannotEvade || heavyIncoming,
    allowed: ['shinraTensei', 'earthWall', 'spectralDash', 'cloneJutsu']
  });
  if (defensiveJutsu && (defensiveJutsu !== 'earthWall' || dist > 95)) {
    return { type: 'power', powerId: defensiveJutsu };
  }

  if (ctx.cannotEvade && canUsePowerWithBudget(ctx, 'shinraTensei', { emergency: true }) && dist <= 140) {
    return { type: 'power', powerId: 'shinraTensei' };
  }

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
  const punishJutsu = pickJutsu(ctx, JUTSU_INTENT.PUNISH, ctx.oppHpCritical ? 34 : 46, {
    finisher: ctx.oppHpCritical,
    allowed: ['lightningCutter', 'dragonRoar', 'shinraTensei', 'spectralDash', 'fireball', 'shuriken', 'iceSpikes', 'flameShower']
  });
  if (punishJutsu) return { type: 'power', powerId: punishJutsu };

  if (oppStaggered) {
    if (!ctx.preserveStamina && dist <= 100 && canUsePowerWithBudget(ctx, 'lightningCutter', { finisher: ctx.oppHpCritical }) && rng() < 0.65) return { type: 'power', powerId: 'lightningCutter' };
    const heavies = ctx.preserveStamina ? [ATTACK.hook, ATTACK.uppercut, ATTACK.cross] : [ATTACK.hook, ATTACK.highKick, ATTACK.uppercut, ATTACK_POWER_PUNCH];
    const affordable = filterAffordableAttacks(ctx, heavies, ctx.staminaLow ? 10 : 0);
    if (affordable.length) return { type: 'attack', attack: affordable[Math.floor(rng() * affordable.length)] };
    return { type: 'recover' };
  }
  if (oppGettingUp && ctx.grabRange && ctx.fighter.hasStamina(FIGHTER?.WALL_JUMP_STAMINA ?? 12) && rng() < 0.45) return { type: 'attack', attack: GRAB }; // Wake-up grab
  if (oppRecovering && dist > AI.ATTACK_RANGE && dist < 170 && dist > 140) return { type: 'move', dir: ctx.faceToward(), run: true };

  // Strategy Influence: Corner pressure punish
  if (fighter.aiCombatMode === STRATEGY.CORNER_TRAP && oppGettingUp) {
    return { type: 'block', duration: 100 }; // Bait reversal then punish? Or meaty attack?
    // For now, simplify: use Heavy
  }

  const punish = filterAffordableAttacks(ctx, [ATTACK.cross, ATTACK.uppercut, ATTACK.hook, ATTACK.highKick, ATTACK.spinningKick, ATTACK.frontKick, ATTACK.lowKick], ctx.staminaLow ? 12 : 0);
  if (!punish.length) return { type: 'recover' };
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
    const comboOnly = filterAffordableAttacks(ctx, [comboNext], ctx.staminaLow ? 12 : 0);
    if (comboOnly.length) return comboOnly;
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

  return filterAffordableAttacks(ctx, pool, ctx.staminaLow ? 14 : 0);
}

function getCombatAction(ctx) {
  const { fighter, inRange, grabRange, oppBlocking, rng, dist, tired, isNightmare, intelligence, parkour, nearestEnemyClone, cloneDist, hpCritical, hpLow, oppHpCritical, cornered } = ctx;
  const toward = ctx.faceToward();
  const away = -toward;
  const reaction = intelligence / 100;
  const strategy = fighter.aiCombatMode || STRATEGY.NEUTRAL;
  const { underPressure, isSafe, staminaLow, staminaHigh } = ctx;

  if (shouldPrioritizeRecovery(ctx)) {
    if (dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330) || isSafe) return { type: 'recover' };
    return { type: 'move', dir: away, run: false, commitMs: 700 };
  }

  // 1. High-Priority Reactive Actions & Pressure Management
  if (underPressure) {
    const defensive = pickJutsu(ctx, JUTSU_INTENT.DEFENSE, hpCritical ? 36 : 58, {
      emergency: hpCritical,
      allowed: ['shinraTensei', 'earthWall', 'spectralDash', 'cloneJutsu']
    });
    if (defensive) return { type: 'power', powerId: defensive };
    if (staminaLow || (hpCritical && rng() < 0.7)) return { type: 'move', dir: away, run: !staminaLow };
    if (rng() < 0.45) return { type: 'block', duration: 150 };
  }

  if (isNightmare || (reaction > 0.8 && rng() < 0.7)) {
    if (ctx.oppJustWhiffed && inRange && fighter.hasStamina(15)) {
      const punish = filterAffordableAttacks(ctx, [ATTACK.cross, ATTACK.uppercut, ATTACK_POWER_PUNCH], ctx.staminaLow ? 12 : 0);
      if (!punish.length) return { type: 'recover' };
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
    if (cornered && dist < 120 && canUsePowerWithBudget(ctx, 'shinraTensei', { emergency: true })) {
      return { type: 'power', powerId: 'shinraTensei' };
    }
    // Use pickPower but with a lower acceptance threshold (score >= 8 vs normal >= 12)
    const desperatePower = pickJutsu(ctx, JUTSU_INTENT.DEFENSE, 30, {
      emergency: true,
      allowRepeat: true
    }) || pickPower({ ...ctx, _desperateThreshold: 34, _allowRepeatJutsu: true });
    if (desperatePower) return { type: 'power', powerId: desperatePower };
  }

  // 4. Strategy Specifics
  if (strategy === STRATEGY.ZONING) {
    // Use ranged powers liberally
    const ranged = pickRangedPower(ctx, 40);
    if (ranged && dist > 150) return { type: 'power', powerId: ranged };
    // Move away to maintain distance
    if (dist < 250 && !inRange) return { type: 'move', dir: away, run: true };
  }

  if (strategy === STRATEGY.CORNER_TRAP) {
    const trapJutsu = pickJutsu(ctx, JUTSU_INTENT.PRESSURE, 46, {
      allowed: ['earthWall', 'vacuumPull', 'flameShower', 'dragonRoar', 'shinraTensei', 'cloneJutsu']
    });
    if (trapJutsu) return { type: 'power', powerId: trapJutsu };
    if (dist > 100) return { type: 'move', dir: toward, run: true }; // Keep them there
    if (oppBlocking && grabRange && rng() < 0.6) return { type: 'attack', attack: GRAB }; // Grab them out of block
  }

  if (strategy === STRATEGY.TURTLE) {
    const turtleJutsu = pickJutsu(ctx, JUTSU_INTENT.DEFENSE, 48, {
      allowed: ['earthWall', 'heal', 'shinraTensei', 'shuriken', 'fireball', 'cloneJutsu']
    });
    if (turtleJutsu) return { type: 'power', powerId: turtleJutsu };
    // Prioritize blocking and counter-pokes
    if (dist < 80 && !ctx.oppAttacking && rng() < 0.3) return { type: 'attack', attack: ATTACK.jab }; // Poke
    if (!ctx.oppAttacking && rng() < 0.8) return { type: 'block', duration: 100 }; // Flash block
  }

  // 5. Finish-Mode: Opponent is critically low — use skills to close out
  if (oppHpCritical) {
    const finisher = pickJutsu(ctx, JUTSU_INTENT.FINISH, 34, {
      finisher: true,
      allowRepeat: true
    });
    if (finisher) return { type: 'power', powerId: finisher };
  }

  // 6. Jutsu Usage by range and intent.
  const intent = dist > 180 ? JUTSU_INTENT.RANGED : dist < 130 ? JUTSU_INTENT.CLOSE : JUTSU_INTENT.ANY;
  const power = pickJutsu(ctx, intent, isNightmare ? 42 : 58);
  if (power && (isNightmare || rng() < 0.86)) {
    return { type: 'power', powerId: power };
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
  const toward = ctx.faceToward();

  // If opponent is staggered/stunned, RUSH THEM immediately
  if (ctx.oppStaggered) {
    return { type: 'move', dir: toward, run: true };
  }

  if (!canSeeOpponent && ctx.blockedByWall) {
    if (tired || ctx.staminaRatio < 0.7) {
      return { type: 'move', dir: -toward, run: !ctx.staminaLow }; // Retreat
    }
    // Else continue to preprocessActionForObstacles (jump)
  }

  const ranged = pickRangedPower(ctx, strategy === STRATEGY.ZONING ? 38 : 50);
  if (ranged && dist > 110) return { type: 'power', powerId: ranged };

  const engageJutsu = pickJutsu(ctx, JUTSU_INTENT.ENGAGE, 54, {
    allowed: ['vacuumPull', 'spectralDash', 'cloneJutsu', 'iceSpikes']
  });
  if (engageJutsu) return { type: 'power', powerId: engageJutsu };

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

  if ((hpLow || hpCritical || ctx.staminaLow) && dist < 220) {
    const cover = pickJutsu(ctx, JUTSU_INTENT.DEFENSE, hpCritical ? 34 : 48, {
      emergency: hpCritical || ctx.staminaCritical,
      allowed: ['earthWall', 'cloneJutsu', 'spectralDash', 'shinraTensei']
    });
    if (cover) return { type: 'power', powerId: cover };
  }

  // Try to heal while retreating if HP is low and we have distance
  if ((hpLow || hpCritical) && dist > 180) {
    if (fighter.lastGlobalSkillAt && ctx.now - fighter.lastGlobalSkillAt < GCD_MS) {
      // still on GCD, skip
    } else if (canUsePowerWithBudget(ctx, 'heal', { emergency: hpCritical }) && rng() < 0.85) {
      return { type: 'power', powerId: 'heal' };
    }
  }

  if (dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330) && ctx.staminaLow) return { type: 'recover' };
  if (fighter.onGround() && fighter.hasStamina(14) && dist < 90 && rng() < 0.2 && !ctx.staminaLow) return { type: 'jump' };
  return { type: 'move', dir: away, run: runToEscape, commitMs: 560 };
}

function getRegroupAction(ctx) {
  const { fighter, dist, rng, cornered, hpLow, hpCritical, staminaRatio, tired, inRecovery, isSafe, staminaHigh, staminaLow } = ctx;
  const toward = ctx.faceToward();
  const away = -toward;

  if (staminaLow && (dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330) || isSafe)) {
    return { type: 'recover' };
  }

  // 1. Recovery Check: If we are already fully recovered, start moving toward with confidence
  if (staminaHigh && !tired && !inRecovery && dist > 350) {
    return { type: 'move', dir: toward, run: false, commitMs: 420 };
  }

  // 2. High-Priority: Heal during regroup if HP is low and safe
  if ((hpLow || hpCritical) && (dist > 150 || isSafe)) {
    const recoveryJutsu = pickJutsu(ctx, JUTSU_INTENT.RECOVERY, hpCritical ? 32 : 44, {
      emergency: hpCritical || staminaLow,
      allowed: ['heal', 'earthWall', 'cloneJutsu']
    });
    if (recoveryJutsu) return { type: 'power', powerId: recoveryJutsu };

    if (!fighter.lastGlobalSkillAt || ctx.now - fighter.lastGlobalSkillAt >= GCD_MS) {
      if (canUsePowerWithBudget(ctx, 'heal', { emergency: hpCritical }) && (rng() < 0.9 || isSafe)) {
        return { type: 'power', powerId: 'heal' };
      }
    }
  }

  // 3. Medium-Priority: Harassment while regrouping (Don't just run, fight back!)
  if (!staminaLow && (dist > 140 || isSafe)) {
    const ranged = pickRangedPower(ctx, 46);
    if (ranged) {
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
  const setup = pickJutsu(ctx, JUTSU_INTENT.SETUP, 46, {
    allowed: ['cloneJutsu', 'earthWall', 'vacuumPull', 'iceSpikes']
  });
  if (setup) return { type: 'power', powerId: setup };
  const ranged = pickRangedPower(ctx, 44);
  if (ranged && dist > 95) return { type: 'power', powerId: ranged };
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
  if (ctx.staminaLow) return { type: 'recover' };
  const pressureJutsu = pickJutsu(ctx, dist > 130 ? JUTSU_INTENT.ENGAGE : JUTSU_INTENT.CLOSE, 46, {
    allowed: ['vacuumPull', 'spectralDash', 'cloneJutsu', 'lightningCutter', 'dragonRoar', 'shinraTensei']
  });
  if (pressureJutsu) return { type: 'power', powerId: pressureJutsu };
  if (dist > 60) return { type: 'move', dir: toward, run: true };
  if (fighter.hasStamina(15) && rng() < 0.7) {
    return { type: 'attack', attack: ATTACK.jab };
  }
  return { type: 'move', dir: toward, run: false };
}

function getRechargeAction(ctx) {
  const { dist, staminaRatio, blockedByWall } = ctx;
  const toward = ctx.faceToward();
  const recovery = pickJutsu(ctx, JUTSU_INTENT.RECOVERY, 48, {
    emergency: ctx.staminaLow,
    allowed: ['heal', 'earthWall', 'cloneJutsu']
  });
  if (recovery) return { type: 'power', powerId: recovery };

  const ranged = pickRangedPower(ctx, 52);
  if (ranged && dist > 140 && staminaRatio > 0.4) {
    return { type: 'power', powerId: ranged };
  }
  // Safe recharge
  if (blockedByWall || dist > 350) return { type: 'recover' };
  return { type: 'move', dir: -toward, run: staminaRatio > 0.45 };
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
  if (shouldPrioritizeRecovery(ctx)) {
    return ctx.dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330) || ctx.isSafe ? AI_STATE.RECHARGING : AI_STATE.RETREATING;
  }

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
  const queuedAction = getQueuedJutsuAction(state, ctx);
  if (queuedAction) return preprocessActionForObstacles(fighter, queuedAction, ctx);
  const fn = STATE_ACTIONS[state] || getApproachAction;
  const action = fn(ctx);
  return preprocessActionForObstacles(fighter, action, ctx);
}
