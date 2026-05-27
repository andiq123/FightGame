import { POSE } from '../entities/fighter.js';
import { executePower } from '../entities/powers/index.js';
import { evaluateState, getStateAction, faceToward } from './stateMachine.js';
import { recordJutsuUse } from './jutsuTactics.js';
import { AI, PHYSICS, AI_STATE } from '../config/constants.js';
import { getStaminaSpeedMultiplier } from '../engine/physics.js';

const FALLBACK_ATTACK_RATIO = 0.7;
const FALLBACK_JUMP_RATIO = 0.5;
const FALLBACK_POWER_RATIO = 0.6;
const BLOCK_DEFAULT_MS = 320;
const ACTION_HISTORY_MAX = 5;
const MOVE_INTENT_MS = 520;
const DEFAULT_FRAME_DT = 1 / 60;

function moveTowardZero(value, amount) {
  if (Math.abs(value) <= amount) return 0;
  return value - Math.sign(value) * amount;
}

function canUseLocomotion(fighter, now) {
  return fighter.canAct(now) || fighter.pose === POSE.walk || fighter.pose === POSE.run || fighter.pose === POSE.idle;
}

function isDirectionBlocked(fighter, dir, now) {
  return fighter.blockedMove?.until > now && fighter.blockedMove.dir === dir;
}

function applyLocomotion(fighter, dir, run, idle, now) {
  const shouldRun = run === true && fighter.canRun();
  fighter.isRunning = shouldRun;
  fighter.facing = dir || fighter.facing || 1;

  if (idle) {
    fighter.vx = 0;
    fighter.moveDir = 0;
    fighter.isRunning = false;
    if (fighter.pose !== POSE.idle) {
      fighter.pose = POSE.idle;
      fighter.poseTime = 0;
    }
    return;
  }

  if (isDirectionBlocked(fighter, dir, now)) {
    fighter.aiMoveIntent = null;
    fighter.aiStateUntil = now;
    fighter.status.clear('aiState');
    fighter.vx = 0;
    fighter.moveDir = 0;
    fighter.isRunning = false;
    if (fighter.pose === POSE.walk || fighter.pose === POSE.run) fighter.pose = POSE.idle;
    return;
  }

  const nextPose = shouldRun ? POSE.run : POSE.walk;
  const speed = shouldRun ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED;
  const staminaSpeed = getStaminaSpeedMultiplier(fighter);
  const targetVx = dir * speed * (fighter.speedMult || 1) * staminaSpeed;
  const accel = shouldRun ? 0.72 : 0.62;
  fighter.vx += (targetVx - fighter.vx) * accel;

  if (fighter.pose !== nextPose || fighter.moveDir !== dir) {
    fighter.pose = nextPose;
    fighter.poseTime = 0;
  }
  fighter.moveDir = dir;
}

function applyIntentionalBrake(fighter, now, dt = DEFAULT_FRAME_DT) {
  if (!fighter.onGround() || !canUseLocomotion(fighter, now)) return false;
  if (![POSE.idle, POSE.walk, POSE.run, POSE.recover].includes(fighter.pose)) return false;

  const brake = (PHYSICS.MOVE_BRAKE_PER_SEC ?? 2200) * Math.max(0.001, dt);
  fighter.vx = moveTowardZero(fighter.vx, brake);
  fighter.isRunning = false;

  if (Math.abs(fighter.vx) <= (PHYSICS.VELOCITY_DEADZONE ?? 10)) {
    fighter.vx = 0;
    fighter.moveDir = 0;
    if (fighter.pose === POSE.walk || fighter.pose === POSE.run) {
      fighter.pose = POSE.idle;
      fighter.poseTime = 0;
    }
  } else if (fighter.pose === POSE.run) {
    fighter.pose = POSE.walk;
    fighter.poseTime = 0;
  }

  return true;
}

function continueMoveIntent(fighter, now) {
  const intent = fighter.aiMoveIntent;
  if (!intent || intent.until <= now) {
    fighter.aiMoveIntent = null;
    fighter.isRunning = false;
    return false;
  }
  if (!canUseLocomotion(fighter, now)) {
    fighter.aiMoveIntent = null;
    fighter.isRunning = false;
    return false;
  }
  applyLocomotion(fighter, intent.dir, intent.run, intent.idle, now);
  return true;
}

export function sustainAIMoveIntent(fighter, now, dt = DEFAULT_FRAME_DT) {
  if (continueMoveIntent(fighter, now)) return true;
  return applyIntentionalBrake(fighter, now, dt);
}

function persistState(fighter, state, now) {
  fighter.aiState = state;
  fighter.aiStateEnteredAt = now;

  let dur = {
    [AI_STATE.COMBAT]: AI.STATE_COMBAT_MS ?? 360,
    [AI_STATE.APPROACHING]: AI.STATE_APPROACH_MS ?? 520,
    [AI_STATE.PUNISHING]: AI.STATE_PUNISH_MS ?? 280,
    [AI_STATE.DEFENDING]: AI.STATE_DEFEND_MS ?? 240,
    [AI_STATE.EVADING_PROJECTILE]: 180,
    [AI_STATE.SHINRA_DEFENSE]: 180,
    [AI_STATE.REGROUPING]: 700,
    [AI_STATE.RETREATING]: 620,
    [AI_STATE.PREPARING]: 500,
    [AI_STATE.BAITING]: 520,
    [AI_STATE.PRESSURING]: 460,
    [AI_STATE.RECHARGING]: 760
  }[state] ?? AI.STATE_MIN_MS;

  dur = Math.round(dur);

  if (state === AI_STATE.COMBAT && fighter.aiCombatMode === 'pressure') dur = Math.min(700, dur + 120);
  if (state === AI_STATE.COMBAT && fighter.aiCombatMode === 'spacing') dur = Math.max(260, dur - 80);

  fighter.aiStateUntil = now + dur;
  fighter.status.set('aiState', now + dur);
}

function actionKey(action) {
  if (action?.type === 'attack') return `a:${action.attack}`;
  if (action?.type === 'power') return `p:${action.powerId}`;
  return action?.type || '?';
}

function recordAction(fighter, action) {
  fighter.aiActionHistory = fighter.aiActionHistory || [];
  fighter.aiActionHistory.push(actionKey(action));
  if (fighter.aiActionHistory.length > ACTION_HISTORY_MAX) fighter.aiActionHistory.shift();
}

function isRepeating(fighter, action, maxSame = 2) {
  const h = fighter.aiActionHistory || [];
  if (h.length < maxSame) return false;
  const key = actionKey(action);
  return h.slice(-maxSame).every(k => k === key);
}

function applyFallbackMove(fighter, opponent, dir, ratio = 1) {
  fighter.vx = dir * PHYSICS.WALK_SPEED * ratio * (fighter.speedMult || 1);
}

const ACTION_HANDLERS = {
  move(fighter, opponent, action, now) {
    fighter.aiMoveIntent = {
      dir: action.dir,
      run: action.run === true,
      idle: action.idle === true,
      until: now + (action.commitMs || MOVE_INTENT_MS)
    };
    applyLocomotion(fighter, action.dir, action.run, action.idle, now);
  },
  attack(fighter, opponent, action, now) {
    fighter.facing = faceToward(fighter, opponent);
    if (!fighter.startAttack(action.attack, now)) {
      const backDir = faceToward(fighter, opponent) === 1 ? -1 : 1;
      applyFallbackMove(fighter, opponent, backDir, FALLBACK_ATTACK_RATIO);
    }
  },
  block(fighter, opponent, action, now) {
    fighter.pose = POSE.block;
    // Lock facing during block to prevent jitter
    fighter.facing = faceToward(fighter, opponent);
    const duration = action.duration || BLOCK_DEFAULT_MS;
    if (action.low) fighter.status.set('blockLow', now + duration);
    else fighter.status.set('block', now + duration);
  },
  dodge(fighter, opponent, action, now) {
    if (!fighter.startDash(action.dir, now)) {
      fighter.pose = POSE.block;
      fighter.facing = faceToward(fighter, opponent);
      fighter.status.set('block', now + 180);
    }
  },
  jump(fighter, opponent, action, now) {
    if (!fighter.startJump(now)) {
      applyFallbackMove(fighter, opponent, faceToward(fighter, opponent), FALLBACK_JUMP_RATIO);
    } else if (action.wallVault && action.dir) {
      // Wall vault: apply strong forward momentum to arc over the wall
      fighter.vx = action.dir * PHYSICS.RUN_SPEED * (fighter.speedMult || 1);
      fighter.facing = action.dir;
    }
  },
  doubleJump(fighter, opponent, action, now) {
    fighter.doubleJump(now);
  },
  wallJump(fighter, opponent, action, now) {
    fighter.wallJump(action.dir, now);
  },
  slide(fighter, opponent, action, now) {
    fighter.startSlide(action.dir, now);
  },
  power(fighter, opponent, action, now, hitEffects, projectiles, clones) {
    if (fighter.usePower(action.powerId, now)) {
      fighter.facing = faceToward(fighter, opponent);
      const execCtx = { fighter, opponent, hitEffects, projectiles, clones, world: action.world };
      executePower(action.powerId, execCtx);
      recordJutsuUse(fighter, action.powerId);
      return true;
    } else {
      applyFallbackMove(fighter, opponent, faceToward(fighter, opponent), FALLBACK_POWER_RATIO);
      return false;
    }
  },
  recover(fighter, opponent, action, now) {
    fighter.isRunning = false;
    fighter.vx *= 0.35;
    fighter.facing = faceToward(fighter, opponent);
    if (fighter.pose !== POSE.recover) {
      fighter.pose = POSE.recover;
      fighter.poseTime = 0;
    }
  }
};

export function executeAI(fighter, opponent, stats, now, rng, hitEffects = [], projectiles = [], clones = [], world) {
  if (!fighter.canAct(now)) {
    fighter.aiMoveIntent = null;
    return null;
  }

  // Cache tactical intelligence for repetition and combo scoring.
  fighter.aiIntelligence = stats.reaction ?? 50; // Intelligence Decoupling

  const state = evaluateState(fighter, opponent, stats, now, rng, clones, projectiles, world.obstacles);
  if (fighter.status.active('aiState', now)) {
    continueMoveIntent(fighter, now);
    return null;
  }

  let action = getStateAction(state, fighter, opponent, stats, now, rng, clones, projectiles, world.obstacles);
  if (!action) return null;

  const comboStat = (stats.comboTendency || 50) / 100;
  const intelligence = fighter.aiIntelligence / 100;

  // Relax repetition penalty for high intelligence/combo levels (allows multi-hit strings)
  const repeatThreshold = 0.58 + (1 - comboStat) * 0.22 - (intelligence * 0.15);
  const maxSame = comboStat > 0.6 ? 3 : 2;

  if (isRepeating(fighter, action, maxSame) && (action.type === 'attack' || action.type === 'power') && rng() < repeatThreshold) {
    const toward = faceToward(fighter, opponent);
    // Don't just stand there, move if repeating too much
    action = { type: 'move', dir: toward === 1 ? -1 : 1, run: false };
  }

  recordAction(fighter, action);

  const handler = ACTION_HANDLERS[action.type];
  if (handler) {
    persistState(fighter, state, now); // Persist ONLY if we take a valid action
    if (action.type === 'power') {
      action.world = world;
      if (!handler(fighter, opponent, action, now, hitEffects, projectiles, clones)) return null;
    } else {
      handler(fighter, opponent, action, now);
    }
  }

  return action.type === 'power' ? action : null;
}
