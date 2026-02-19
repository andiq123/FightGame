import { ARENA, PHYSICS } from '../config/constants.js';

export const GROUND_Y = 810;

export const ARENA_BOUNDS = ARENA.BOUNDS;

const FIGHTER_MARGIN = ARENA.FIGHTER_MARGIN ?? 24;

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
  const weight = PHYSICS.WEIGHT ?? 1.15;
  fighter.vy += PHYSICS.GRAVITY * mult * dt * weight;
  const terminal = PHYSICS.TERMINAL_VY ?? 900;
  if (fighter.vy > terminal) fighter.vy = terminal;
  if (fighter.y < 0) fighter.vy *= (PHYSICS.AIR_RESISTANCE ?? 0.99);
}

export function integratePosition(fighter, dt, now) {
  const wasOnGround = fighter.y >= -2;
  const prevVy = fighter.vy;

  // Apply Air Resistance (Drag)
  const speed = Math.hypot(fighter.vx, fighter.vy);
  const dragCoeff = PHYSICS.AIR_DRAG ?? 0.0012;
  if (speed > 100) {
    const drag = speed * speed * dragCoeff * dt;
    const dragX = (fighter.vx / speed) * drag;
    const dragY = (fighter.vy / speed) * drag;
    fighter.vx -= dragX;
    fighter.vy -= dragY;
  }
  fighter.vx *= (PHYSICS.AIR_RESISTANCE ?? 0.992);

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

export function applyFriction(fighter, dt) {
  if (fighter.onGround()) {
    const isMoving = Math.abs(fighter.vx) > 10;
    const isSliding = fighter.pose === 'slide';
    const friction = isSliding ? PHYSICS.FRICTION_MIN : (isMoving ? PHYSICS.FRICTION_AIR : PHYSICS.FRICTION_GROUND);
    fighter.vx *= Math.pow(friction, dt * 60);
  } else {
    fighter.vx *= Math.pow(PHYSICS.FRICTION_AIR, dt * 60);
  }
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
  const speedMult = fighter.speedMult || 1;
  const maxSpeed = (fighter.pose === 'run' ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED) * speedMult;
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
  if (fighter.pose === 'swing') {
    applyGravity(fighter, dt);
    integratePosition(fighter, dt, now);
    applyFriction(fighter, dt, false, false);
    clampToGround(fighter);
    clampToArena(fighter);
    return;
  }

  const inDodge = fighter.pose === 'dodge' && fighter.status.active('invincible', now);
  if (inDodge && fighter.dodgeStartAt != null) {
    applyDodgeMotion(fighter, now);
    applyGravity(fighter, dt);
    integratePosition(fighter, dt, now);
    clampToGround(fighter);
    applyFriction(fighter, dt, true, false);
    clampToArena(fighter);
    return;
  }

  const inHitstun = fighter.status.active('stun', now) && fighter.pose === 'hit';
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
  const stability = fighter.getStability ? fighter.getStability() : 1;
  const horiz = dir * amount * mult * stability;
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
