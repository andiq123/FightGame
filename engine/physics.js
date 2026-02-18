import { ARENA, PHYSICS } from '../config/constants.js';

export const GROUND_Y = 540;
export const ARENA_BOUNDS = ARENA.BOUNDS;

const FIGHTER_MARGIN = 40 * 0.6;

function applyDodgeMotion(fighter, now) {
  const elapsed = (now - (fighter.dodgeStartAt ?? now)) / 1000;
  const totalDur = PHYSICS.DODGE_DURATION_MS / 1000;
  const phase = Math.min(1, totalDur > 0 ? elapsed / totalDur : 1);
  const anticipation = Math.min(1, (PHYSICS.DODGE_ANTICIPATION_MS / 1000) > 0 ? elapsed / (PHYSICS.DODGE_ANTICIPATION_MS / 1000) : 1);
  const rampUp = 1 - Math.exp(-PHYSICS.DODGE_ACCEL * elapsed * (1 + anticipation * 0.5));
  const rampDown = phase > 0.7 ? Math.max(0, (1 - phase) / 0.3) : 1;
  const speedMult = fighter.speedMult || 1;
  fighter.vx = (fighter.dodgeDir ?? 1) * PHYSICS.DODGE_PEAK_SPEED * speedMult * rampUp * rampDown;
  fighter.vx *= 1 - PHYSICS.DODGE_DECEL * Math.max(0, phase - 0.5);
}

function applyGravity(fighter, dt) {
  const vy = fighter.vy;
  const nearApex = vy > PHYSICS.APEX_VY_LOW && vy < PHYSICS.APEX_VY_HIGH && fighter.y < 0;
  let mult = vy < 0 ? PHYSICS.GRAVITY_ASCENT : (nearApex ? PHYSICS.GRAVITY_APEX : 1);
  if (fighter.y < 0 && vy > 0 && (PHYSICS.GRAVITY_FALL_MULT ?? 1) > 1) mult *= PHYSICS.GRAVITY_FALL_MULT;
  fighter.vy += PHYSICS.GRAVITY * mult * dt;
  const terminal = PHYSICS.TERMINAL_VY ?? 900;
  if (fighter.vy > terminal) fighter.vy = terminal;
  if (fighter.y < 0) fighter.vy *= (PHYSICS.AIR_RESISTANCE ?? 0.99);
}

function integratePosition(fighter, dt, now) {
  const wasOnGround = fighter.y >= -2;
  const prevVy = fighter.vy;
  fighter.x += fighter.vx * dt;
  fighter.y += fighter.vy * dt;
  if (wasOnGround && fighter.y < -2) fighter.lastLeftGroundAt = now;
  if (fighter.y >= 0) {
    fighter.lastLeftGroundAt = 0;
    if (!wasOnGround && prevVy > (PHYSICS.LANDING_BOUNCE_VY_THRESH ?? 400)) {
      const bounceMult = PHYSICS.LANDING_BOUNCE_MULT ?? 0.12;
      fighter.vy = -prevVy * bounceMult;
    }
  }
}

function applyFriction(fighter, dt, inDodge, inHitstun) {
  const friction = inDodge ? 0 : (inHitstun ? PHYSICS.FRICTION_BASE * PHYSICS.HIT_FRICTION : PHYSICS.FRICTION_BASE);
  const velDrag = 1 + Math.abs(fighter.vx) * PHYSICS.FRICTION_VEL_SCALE;
  fighter.vx *= Math.max(PHYSICS.FRICTION_MIN, 1 - friction * velDrag * dt);
  if (Math.abs(fighter.vx) < PHYSICS.VELOCITY_DEADZONE && fighter.y >= 0) fighter.vx = 0;
}

function clampToGround(fighter) {
  if (fighter.y >= 0) {
    fighter.y = 0;
    if (Math.abs(fighter.vy) < 45) fighter.vy = 0;
  }
}

function getStaminaSpeedMultiplier(fighter) {
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
  const staminaMult = getStaminaSpeedMultiplier(fighter);
  const runMinRatio = PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28;
  const ratio = Math.min(1, (fighter.maxStamina || 1) > 0 ? fighter.stamina / (fighter.maxStamina || 1) : 0);
  const canRun = ratio >= runMinRatio;
  const baseSpeed = (fighter.pose === 'run' && canRun) ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED;
  const maxSpeed = baseSpeed * staminaMult * (fighter.speedMult || 1);
  if (Math.abs(fighter.vx) > maxSpeed) fighter.vx = Math.sign(fighter.vx) * maxSpeed;
}

function clampToArena(fighter) {
  if (fighter.x < -ARENA_BOUNDS + FIGHTER_MARGIN) {
    fighter.x = -ARENA_BOUNDS + FIGHTER_MARGIN;
    if (fighter.vx < 0) fighter.vx *= PHYSICS.WALL_BOUNCE;
  }
  if (fighter.x > ARENA_BOUNDS - FIGHTER_MARGIN) {
    fighter.x = ARENA_BOUNDS - FIGHTER_MARGIN;
    if (fighter.vx > 0) fighter.vx *= PHYSICS.WALL_BOUNCE;
  }
}

export function updatePhysics(fighter, dt, now) {
  if (fighter.pose === 'teleport') return;

  const inDodge = fighter.pose === 'dodge' && (fighter.invincibleUntil || 0) > now;
  if (inDodge && fighter.dodgeStartAt != null) {
    applyDodgeMotion(fighter, now);
    applyGravity(fighter, dt);
    integratePosition(fighter, dt, now);
    clampToGround(fighter);
    applyFriction(fighter, dt, true, false);
    clampWalkRunSpeed(fighter);
    clampToArena(fighter);
    return;
  }

  const inHitstun = (fighter.stunUntil || 0) > now && fighter.pose === 'hit';
  applyGravity(fighter, dt);
  integratePosition(fighter, dt, now);
  clampToGround(fighter);
  applyFriction(fighter, dt, false, inHitstun);
  clampWalkRunSpeed(fighter);
  clampToArena(fighter);
}

export function applyKnockback(fighter, amount, fromX, heavy, upward = false, kickLaunch = false) {
  const dir = fighter.x > fromX ? 1 : -1;
  let mult = heavy ? PHYSICS.KNOCKBACK_HEAVY_MULT : PHYSICS.KNOCKBACK_LIGHT_MULT;
  if (kickLaunch && PHYSICS.KNOCKBACK_KICK_LAUNCH_MULT) mult = PHYSICS.KNOCKBACK_KICK_LAUNCH_MULT;
  const horiz = dir * amount * mult;
  fighter.vx += horiz;
  const upwardMult = upward ? PHYSICS.UPPERCUT_UPWARD : (heavy ? PHYSICS.KNOCKBACK_UPWARD : 0);
  if (upwardMult > 0) {
    fighter.vy += -Math.abs(amount) * upwardMult * 0.92;
  } else if (heavy && Math.abs(horiz) > 80) {
    fighter.vy += -Math.abs(amount) * 0.08;
  }
  fighter.facing = -dir;
}

export function applyAttackerRecoil(attacker, amount, towardDefender) {
  attacker.vx += towardDefender * amount * PHYSICS.ATTACKER_RECOIL;
}

export function getDistance(f1, f2) {
  return Math.abs(f1.x - f2.x);
}
