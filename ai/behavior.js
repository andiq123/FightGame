import { POSE } from '../entities/fighter.js';
import { executePower } from '../entities/powers/index.js';
import { AI_STATE, evaluateState, getStateAction, faceToward } from './stateMachine.js';
import { AI, PHYSICS } from '../config/constants.js';

const FALLBACK_ATTACK_RATIO = 0.7;
const FALLBACK_JUMP_RATIO = 0.5;
const FALLBACK_POWER_RATIO = 0.6;
const FALLBACK_DODGE_RATIO = 0.8;
const BLOCK_DEFAULT_MS = 320;
const ACTION_HISTORY_MAX = 5;

function persistState(fighter, state, now) {
  fighter.aiState = state;
  fighter.aiStateEnteredAt = now;
  let dur = {
    [AI_STATE.COMBAT]: AI.STATE_COMBAT_MS ?? AI.STATE_MIN_MS,
    [AI_STATE.APPROACHING]: AI.STATE_APPROACH_MS ?? AI.STATE_MIN_MS,
    [AI_STATE.PUNISHING]: AI.STATE_PUNISH_MS ?? AI.STATE_MIN_MS,
    [AI_STATE.DEFENDING]: AI.STATE_DEFEND_MS ?? 50,
    [AI_STATE.EVADING_PROJECTILE]: 50,
    [AI_STATE.SHINRA_DEFENSE]: 40,
    [AI_STATE.REGROUPING]: 140,
    [AI_STATE.RETREATING]: 100,
    [AI_STATE.PREPARING]: 120
  }[state] ?? AI.STATE_MIN_MS;
  if (state === AI_STATE.COMBAT && fighter.aiCombatMode === 'pressure') dur = Math.min(220, dur + 45);
  if (state === AI_STATE.COMBAT && fighter.aiCombatMode === 'spacing') dur = Math.max(100, dur - 25);
  fighter.aiStateUntil = now + dur;
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
    const run = action.run === true && fighter.canRun();
    fighter.isRunning = run;
    const moveSpeed = run ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED;
    fighter.vx = action.dir * moveSpeed * (fighter.speedMult || 1);
    fighter.facing = action.dir;
    fighter.pose = run ? POSE.run : POSE.walk;
    fighter.poseTime = 0;
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
    const duration = action.duration || BLOCK_DEFAULT_MS;
    if (action.low) fighter.blockLowUntil = now + duration;
    else fighter.blockUntil = now + duration;
  },
  dodge(fighter, opponent, action, now) {
    const cost = PHYSICS.DODGE_STAMINA ?? 26;
    if (!fighter.hasStamina(cost)) {
      applyFallbackMove(fighter, opponent, action.dir, FALLBACK_DODGE_RATIO);
      return;
    }
    fighter.stamina = Math.max(0, fighter.stamina - cost);
    fighter.invincibleUntil = now + PHYSICS.DODGE_INVULN_MS;
    fighter.dodgeDir = action.dir;
    fighter.dodgeStartAt = now;
    fighter.vx = 0;
    fighter.pose = POSE.dodge;
    fighter.facing = action.dir;
  },
  teleport(fighter, opponent, action, now) {
    if (!fighter.startTeleport(action.dir, now, action.closeEvade === true)) {
      applyFallbackMove(fighter, opponent, action.dir, 1);
    }
  },
  jump(fighter, opponent, action, now) {
    if (!fighter.startJump(now)) {
      applyFallbackMove(fighter, opponent, faceToward(fighter, opponent), FALLBACK_JUMP_RATIO);
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
      const execCtx = { fighter, opponent, hitEffects, projectiles, clones };
      executePower(action.powerId, execCtx);
    } else {
      applyFallbackMove(fighter, opponent, faceToward(fighter, opponent), FALLBACK_POWER_RATIO);
    }
  }
};

export function executeAI(fighter, opponent, stats, now, rng, hitEffects = [], projectiles = [], clones = []) {
  if (!fighter.canAct(now)) return null;

  const state = evaluateState(fighter, opponent, stats, now, rng, clones, projectiles);
  if (state !== fighter.aiState) persistState(fighter, state, now);
  else if (!fighter.aiStateUntil) fighter.aiStateUntil = now + AI.STATE_MIN_MS;

  let action = getStateAction(state, fighter, opponent, stats, now, rng, clones, projectiles);
  if (!action) return null;

  const comboStat = (stats.comboTendency || 50) / 100;
  const repeatThreshold = 0.58 + (1 - comboStat) * 0.22;
  const maxSame = comboStat > 0.6 ? 3 : 2;
  if (isRepeating(fighter, action, maxSame) && (action.type === 'attack' || action.type === 'power') && rng() < repeatThreshold) {
    const toward = faceToward(fighter, opponent);
    action = state === AI_STATE.COMBAT ? { type: 'move', dir: toward === 1 ? -1 : 1, run: false } : (state === AI_STATE.APPROACHING ? { type: 'move', dir: toward, run: false } : action);
  }

  recordAction(fighter, action);

  const handler = ACTION_HANDLERS[action.type];
  if (handler) {
    if (action.type === 'power') {
      handler(fighter, opponent, action, now, hitEffects, projectiles, clones);
    } else {
      handler(fighter, opponent, action, now);
    }
  }

  return action.type === 'power' ? action : null;
}
