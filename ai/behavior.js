import { POSE } from '../entities/fighter.js';
import { executePower } from '../entities/powers/index.js';
import { evaluateState, getStateAction, faceToward } from './stateMachine.js';
import { AI, PHYSICS, AI_STATE } from '../config/constants.js';

const FALLBACK_ATTACK_RATIO = 0.7;
const FALLBACK_JUMP_RATIO = 0.5;
const FALLBACK_POWER_RATIO = 0.6;
const BLOCK_DEFAULT_MS = 320;
const ACTION_HISTORY_MAX = 5;

function persistState(fighter, state, now) {
  fighter.aiState = state;
  fighter.aiStateEnteredAt = now;

  const intelligence = fighter.aiIntelligence || 50;
  const reactivity = Math.max(0.75, 1.15 - (intelligence / 280));

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

  dur = Math.round(dur * reactivity);

  if (intelligence >= 115) {
    if (state === AI_STATE.COMBAT || state === AI_STATE.PRESSURING || state === AI_STATE.PUNISHING) {
      dur = Math.max(dur, 320);
    }
  }

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
    const run = action.run === true && fighter.canRun();
    const idle = action.idle === true;
    fighter.isRunning = run;
    const moveSpeed = idle ? 0 : (run ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED);
    fighter.vx = action.dir * moveSpeed * (fighter.speedMult || 1);
    fighter.facing = action.dir;
    if (idle) {
      fighter.pose = POSE.idle;
    } else {
      fighter.pose = run ? POSE.run : POSE.walk;
    }
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
    // Lock facing during block to prevent jitter
    fighter.facing = faceToward(fighter, opponent);
    const duration = action.duration || BLOCK_DEFAULT_MS;
    if (action.low) fighter.status.set('blockLow', now + duration);
    else fighter.status.set('block', now + duration);
  },
  dodge(fighter, opponent, action, now) {
    fighter.status.set('invincible', now + PHYSICS.DODGE_INVULN_MS);
    fighter.dodgeDir = action.dir;
    fighter.dodgeStartAt = now;
    fighter.vx = 0;
    fighter.pose = POSE.dodge;
    fighter.facing = action.dir;
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
    } else {
      applyFallbackMove(fighter, opponent, faceToward(fighter, opponent), FALLBACK_POWER_RATIO);
    }
  }
};

export function executeAI(fighter, opponent, stats, now, rng, hitEffects = [], projectiles = [], clones = [], world) {
  if (!fighter.canAct(now)) return null;

  // Cache intelligence for persistState
  fighter.aiIntelligence = stats.reaction ?? 50; // Intelligence Decoupling

  const state = evaluateState(fighter, opponent, stats, now, rng, clones, projectiles, world.obstacles);
  const reactTime = (AI.REACT_BASE_MS + (100 - stats.reaction) * AI.REACT_SCALE) / 1000;
  if (!fighter.canAct(now) || fighter.status.active('aiState', now)) return null;

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
      handler(fighter, opponent, action, now, hitEffects, projectiles, clones);
    } else {
      handler(fighter, opponent, action, now);
    }
  }

  return action.type === 'power' ? action : null;
}
