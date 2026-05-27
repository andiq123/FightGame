import { ARENA, PHYSICS } from '../config/constants.js';

export const GROUND_Y = 810;

export const ARENA_BOUNDS = ARENA.BOUNDS;

const FIGHTER_MARGIN = ARENA.FIGHTER_MARGIN ?? 24;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const perFrameDamping = (factor, dt) => Math.pow(factor, dt * 60);

function applyDodgeMotion(fighter, now) {
  const elapsed = (now - (fighter.dodgeStartAt ?? now)) / 1000;
  const totalDur = PHYSICS.DODGE_DURATION_MS / 1000;
  const phase = Math.min(1, totalDur > 0 ? elapsed / totalDur : 1);
  const ease = Math.sin(phase * Math.PI);
  const speedMult = fighter.speedMult || 1;
  fighter.vx = (fighter.dodgeDir ?? 1) * PHYSICS.DODGE_PEAK_SPEED * speedMult * ease;
}

function applyGravity(fighter, dt) {
  const vy = fighter.vy;
  const nearApex = vy > PHYSICS.APEX_VY_LOW && vy < PHYSICS.APEX_VY_HIGH && fighter.y < 0;
  let mult = vy < 0 ? PHYSICS.GRAVITY_ASCENT : (nearApex ? PHYSICS.GRAVITY_APEX : 1);
  if (fighter.y < 0 && vy > 0 && (PHYSICS.GRAVITY_FALL_MULT ?? 1) > 1) mult *= PHYSICS.GRAVITY_FALL_MULT;
  const weight = PHYSICS.WEIGHT ?? 1.15;
  fighter.vy += PHYSICS.GRAVITY * mult * dt * weight;
  const terminal = PHYSICS.TERMINAL_VY ?? 900;
  if (fighter.vy > terminal) fighter.vy = terminal;
  if (fighter.y < 0) fighter.vy *= (PHYSICS.AIR_RESISTANCE ?? 0.99);
}

function applyAirDrag(fighter, dt) {
  if (fighter.onGround()) return;
  const speed = Math.hypot(fighter.vx, fighter.vy);
  if (speed < 80) return;
  const drag = speed * (PHYSICS.AIR_DRAG ?? 0.00055) * dt;
  fighter.vx -= fighter.vx * drag;
  fighter.vy -= fighter.vy * drag * 0.35;
}

export function integratePosition(fighter, dt, now) {
  const wasOnGround = fighter.y >= -2;

  fighter.x += fighter.vx * dt;
  fighter.y += fighter.vy * dt;
  if (wasOnGround && fighter.y < -2) fighter.lastLeftGroundAt = now;
  if (fighter.y >= 0) {
    fighter.lastLeftGroundAt = 0;
  }
}

export function applyFriction(fighter, dt, now) {
  const hardImpact = fighter.onGround() && (fighter.impactFrictionUntil || 0) > now;
  if (!hardImpact) return;

  fighter.vx *= perFrameDamping(PHYSICS.HIT_FRICTION ?? 0.84, dt);
  if (Math.abs(fighter.vx) <= (PHYSICS.VELOCITY_DEADZONE ?? 10)) fighter.vx = 0;
}

function clampToGround(fighter) {
  if (fighter.y >= 0) {
    fighter.y = 0;
    if (Math.abs(fighter.vy) < 45) fighter.vy = 0;
  }
}

export function getStaminaSpeedMultiplier(fighter) {
  const maxStam = fighter.maxStamina || 1;
  const ratio = Math.min(1, fighter.stamina / maxStam);
  const minR = PHYSICS.MOVE_SPEED_MIN_RATIO ?? 0.18;
  const maxR = PHYSICS.MOVE_SPEED_MAX_RATIO ?? 1;
  return minR + (maxR - minR) * ratio * ratio;
}

function clampWalkRunSpeed(fighter) {
  if (fighter.pose !== 'walk' && fighter.pose !== 'run') return;
  if (Math.abs(fighter.vx) < PHYSICS.WALK_RUN_IDLE_THRESHOLD) {
    fighter.pose = 'idle';
    return;
  }
  const speedMult = fighter.speedMult || 1;
  const staminaSpeed = getStaminaSpeedMultiplier(fighter);
  const maxSpeed = (fighter.pose === 'run' ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED) * speedMult * staminaSpeed;
  fighter.vx = clamp(fighter.vx, -maxSpeed, maxSpeed);
}

function markMovementBlocked(fighter, dir, now, reason) {
  if (!dir || !Number.isFinite(now)) return;
  fighter.blockedMove = { dir, until: now + 520, reason };
  if (fighter.aiMoveIntent?.dir === dir) fighter.aiMoveIntent = null;
  if (fighter.status?.clear) fighter.status.clear('aiState');
  fighter.aiStateUntil = Math.min(fighter.aiStateUntil || now, now);
}

function clampToArena(fighter, now) {
  if (fighter.x < -ARENA_BOUNDS + FIGHTER_MARGIN) {
    fighter.x = -ARENA_BOUNDS + FIGHTER_MARGIN;
    if (fighter.vx < 0) {
      fighter.vx *= PHYSICS.WALL_BOUNCE;
      markMovementBlocked(fighter, -1, now, 'arena');
    }
  }
  if (fighter.x > ARENA_BOUNDS - FIGHTER_MARGIN) {
    fighter.x = ARENA_BOUNDS - FIGHTER_MARGIN;
    if (fighter.vx > 0) {
      fighter.vx *= PHYSICS.WALL_BOUNCE;
      markMovementBlocked(fighter, 1, now, 'arena');
    }
  }
}

export function updatePhysics(fighter, dt, now) {
  const inDodge = fighter.pose === 'dodge' && fighter.status.active('invincible', now);
  if (inDodge && fighter.dodgeStartAt != null) applyDodgeMotion(fighter, now);

  applyGravity(fighter, dt);
  applyAirDrag(fighter, dt);
  integratePosition(fighter, dt, now);
  clampToGround(fighter);
  applyFriction(fighter, dt, now);
  clampWalkRunSpeed(fighter);
  clampToArena(fighter, now);
}

export function applyKnockback(fighter, amount, fromX, heavy, upward = false, kickLaunch = false, now = performance.now()) {
  const dir = fighter.x > fromX ? 1 : -1;
  let mult = heavy ? PHYSICS.KNOCKBACK_HEAVY_MULT : PHYSICS.KNOCKBACK_LIGHT_MULT;
  if (kickLaunch && PHYSICS.KNOCKBACK_KICK_LAUNCH_MULT) mult = PHYSICS.KNOCKBACK_KICK_LAUNCH_MULT;
  const horiz = dir * amount * mult;
  fighter.vx = clamp(fighter.vx + horiz, -760, 760);
  if (heavy) {
    fighter.impactFrictionUntil = Math.max(fighter.impactFrictionUntil || 0, now + (PHYSICS.IMPACT_FRICTION_MS ?? 360));
  }
  const upwardMult = upward ? PHYSICS.UPPERCUT_UPWARD : (heavy ? PHYSICS.KNOCKBACK_UPWARD : 0);
  if (upwardMult > 0) {
    fighter.vy = clamp(fighter.vy - Math.abs(amount) * upwardMult, -720, 820);
  } else if (heavy && Math.abs(horiz) > 80) {
    fighter.vy = clamp(fighter.vy - Math.abs(amount) * 0.05, -720, 820);
  }
  fighter.facing = -dir;
}

export function applyAttackerRecoil(attacker, amount, towardDefender) {
  attacker.vx += towardDefender * amount * PHYSICS.ATTACKER_RECOIL;
}

export function getDistance(f1, f2) {
  return Math.abs(f1.x - f2.x);
}
