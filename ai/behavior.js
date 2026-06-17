import { POSE } from '../entities/fighter.js';
import { executePower } from '../entities/powers/index.js';
import { faceToward, buildCtx } from './context.js';
import { decideAction, recordJutsuUse, hasUrgentInterrupt } from './decide.js';
import { PHYSICS } from '../config/constants.js';
import { getStaminaSpeedMultiplier } from '../engine/physics.js';

export { faceToward };

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

// Commit briefly to the chosen action so the AI doesn't jitter by re-deciding
// every tick. Only moves/recovers need a hold — attacks and powers are gated by
// their own pose locks. Urgent threats interrupt the commit (see executeAI).
function commitAction(fighter, action, now) {
  fighter.aiState = action.aiLabel || fighter.aiState || 'approaching';
  fighter.aiStateEnteredAt = now;
  let dur = 0;
  if (action.type === 'move') dur = action.commitMs || 360;
  else if (action.type === 'recover') dur = 220;
  else if (action.type === 'block') dur = action.duration || 200;
  fighter.aiStateUntil = now + dur;
  if (dur > 0) fighter.status.set('aiState', now + dur);
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
      // Wall vault: leap HIGHER (to clear the wall) and carry forward to land
      // on the other side.
      fighter.vy = PHYSICS.WALL_VAULT_VY ?? -720;
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
  fighter.aiIntelligence = stats.reaction ?? 50;

  // One context build per decision — sensing (vision, threats, frame advantage).
  const ctx = buildCtx(fighter, opponent, stats, now, rng, clones, projectiles, world.obstacles);

  // Honor the brief action commit unless something urgent demands a re-decide.
  if (fighter.status.active('aiState', now) && !hasUrgentInterrupt(ctx)) {
    continueMoveIntent(fighter, now);
    return null;
  }

  let action = decideAction(ctx);
  if (!action) return null;

  const comboStat = (stats.comboTendency || 50) / 100;
  const intelligence = fighter.aiIntelligence / 100;

  // Anti-repetition: break up a string of identical attacks/powers (relaxed for
  // high combo/intelligence so multi-hit chains still flow).
  const repeatThreshold = 0.58 + (1 - comboStat) * 0.22 - (intelligence * 0.15);
  const maxSame = comboStat > 0.6 ? 3 : 2;
  if (isRepeating(fighter, action, maxSame) && (action.type === 'attack' || action.type === 'power') && rng() < repeatThreshold) {
    const toward = faceToward(fighter, opponent);
    action = { type: 'move', dir: toward === 1 ? -1 : 1, run: false, aiLabel: 'approaching' };
  }

  recordAction(fighter, action);

  const handler = ACTION_HANDLERS[action.type];
  if (handler) {
    commitAction(fighter, action, now);
    if (action.type === 'power') {
      action.world = world;
      if (!handler(fighter, opponent, action, now, hitEffects, projectiles, clones)) return null;
    } else {
      handler(fighter, opponent, action, now);
    }
  }

  return action.type === 'power' ? action : null;
}
