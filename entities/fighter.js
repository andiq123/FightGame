import { getPower } from './powers/index.js';
import { updateRagdoll, isRagdollSettled } from '../engine/ragdoll.js';
import { ATTACK, ATTACK_POWER_PUNCH, GRAB, ATTACK_DATA } from './attacks.js';
import { HP, ARENA, COMBAT, PHYSICS, FIGHTER } from '../config/constants.js';

const FIGHTER_MARGIN = 24;
const JUMP_STAMINA = 14;
const DOUBLE_JUMP_STAMINA = 10;
const WALL_JUMP_STAMINA = 12;
const SLIDE_STAMINA = 18;
const DASH_STAMINA = 20;
const WHIFF_HIT_WINDOW = 100;

export const POSE = { idle: 'idle', punch: 'punch', kick: 'kick', block: 'block', dodge: 'dodge', grab: 'grab', hit: 'hit', jump: 'jump', air: 'air', slide: 'slide', stagger: 'stagger', getUp: 'getUp', teleport: 'teleport', walk: 'walk', run: 'run' };

class Fighter {
  constructor(id, color, x, facing = 1, maxHp = 200) {
    this.id = id;
    this.color = color;
    this.x = x;
    this.y = 0;
    this.facing = facing;
    this.vx = 0;
    this.vy = 0;
    this.maxHp = Math.max(HP.MIN, Math.min(HP.MAX, maxHp));
    this.hp = this.maxHp;
    this.stamina = FIGHTER.DEFAULT_MAX_STAMINA;
    this.maxStamina = FIGHTER.DEFAULT_MAX_STAMINA;
    this.pose = POSE.idle;
    this.poseTime = 0;
    this.currentAttack = null;
    this.stunUntil = 0;
    this.invincibleUntil = 0;
    this.blockUntil = 0;
    this.blockLowUntil = 0;
    this.recoveryUntil = 0;
    this.hitFlashUntil = 0;
    this.speedMult = 1;
    this.speedMultUntil = 0;
    this.shieldActive = false;
    this.shieldUntil = 0;
    this.vampireUntil = 0;
    this.counterStanceUntil = 0;
    this.damageMult = 1;
    this.damageMultUntil = 0;
    this.damageTakenMult = 1;
    this.damageTakenMultUntil = 0;
    this.smokeUntil = 0;
    this.overchargeUntil = 0;
    this.lifestealUntil = 0;
    this.staggerUntil = 0;
    this.staggerRagdoll = null;
    this.doubleJumpUsed = false;
    this.wallJumpCooldown = 0;
    this.slideUntil = 0;
    this.powers = [];
    this.powerCooldowns = {};
    this.damageDealt = 0;
    this.comboCount = 0;
    this.lastComboTime = 0;
    this.roundsWon = 0;
    this.healEffectUntil = 0;
    this.hitLastDmg = 0;
    this.getUpUntil = 0;
    this.shinraTenseiUntil = 0;
    this.lastStaggerEndAt = 0;
    this.lastHitAt = 0;
    this.hitsTakenLast5Sec = 0;
    this.lastClashAt = 0;
    this.lastLeftGroundAt = 0;
    this.jumpBufferedAt = 0;
    this.landingSquashUntil = 0;
    this.lastAttackEndedAt = 0;
    this.lastWhiffAt = 0;
    this.lastLandingAttackType = null;
    this.isRunning = false;
    this.teleportUntil = 0;
    this.teleportDir = 0;
  }

  setPowers(powerIds) {
    this.powers = powerIds || [];
    this.powers.forEach(p => this.powerCooldowns[p] = 0);
  }

  onGround() { return this.y >= -3; }

  staminaRatio() {
    const m = this.maxStamina || 1;
    return m > 0 ? Math.min(1, this.stamina / m) : 0;
  }

  canRun() {
    return this.staminaRatio() >= (PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28);
  }

  canAct(now) {
    return !this.staggerRagdoll && this.stunUntil <= now && this.recoveryUntil <= now && this.staggerUntil <= now && this.getUpUntil <= now && !this.currentAttack && this.slideUntil <= now && this.pose !== POSE.teleport;
  }

  canTeleport(now, closeEvade = false) {
    const cost = closeEvade ? (PHYSICS.TELEPORT_CLOSE_STAMINA ?? 38) : PHYSICS.TELEPORT_STAMINA;
    return this.canAct(now) && this.hasStamina(cost);
  }

  canJump(now) {
    const coyoteOk = this.onGround() || (now - (this.lastLeftGroundAt || 0) < PHYSICS.COYOTE_TIME_MS);
    return this.canAct(now) && coyoteOk && this.hasStamina(JUMP_STAMINA) && this.staggerUntil <= now;
  }

  canDoubleJump(now) {
    return !this.onGround() && !this.doubleJumpUsed && this.hasStamina(DOUBLE_JUMP_STAMINA) && this.staggerUntil <= now;
  }

  canWallJump(now) {
    return !this.onGround() && this.wallJumpCooldown <= now && this.hasStamina(WALL_JUMP_STAMINA) && this.staggerUntil <= now;
  }

  canSlide(now) {
    return this.canAct(now) && this.onGround() && this.hasStamina(SLIDE_STAMINA);
  }

  hasStamina(amount) { return this.stamina >= amount; }

  canUsePower(powerId) {
    const end = this.powerCooldowns[powerId] ?? 0;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return this.powers.includes(powerId) && end <= now && this.stamina >= FIGHTER.POWER_BASE_COST;
  }

  usePower(powerId, now) {
    if (!this.canUsePower(powerId)) return false;
    const p = getPower(powerId);
    if (!p) return false;
    this.powerCooldowns[powerId] = now + p.cooldown;
    this.stamina = Math.max(0, this.stamina - FIGHTER.POWER_BASE_COST);
    this.lastUsedPower = powerId;
    this.lastUsedAt = now;
    return true;
  }

  startAttack(type, now) {
    const data = ATTACK_DATA[type];
    if (!data || !this.hasStamina(data.stamina)) return false;
    const aerialOk = [ATTACK.jab, ATTACK.cross, ATTACK.highKick, ATTACK.frontKick, ATTACK.axeKick].includes(type);
    if (this.onGround()) { if (!this.canAct(now)) return false; }
    else { if (this.currentAttack || !aerialOk) return false; }
    this.stamina = Math.max(0, this.stamina - data.stamina);
    this.currentAttack = { type, started: now, data, dir: this.facing };
    const isPunch = type <= 2 || type === ATTACK_POWER_PUNCH || type === ATTACK.uppercut;
    this.pose = type === GRAB ? POSE.grab : (isPunch ? POSE.punch : POSE.kick);
    this.poseTime = 0;
    return true;
  }

  startJump(now) {
    if (!this.canJump(now)) return false;
    this.stamina = Math.max(0, this.stamina - JUMP_STAMINA);
    this.vy = PHYSICS.JUMP_VY;
    this.doubleJumpUsed = false;
    this.pose = POSE.jump;
    this.jumpBufferedAt = 0;
    return true;
  }

  startShortHop(now) {
    if (!this.canJump(now)) return false;
    this.stamina = Math.max(0, this.stamina - DOUBLE_JUMP_STAMINA);
    this.vy = PHYSICS.JUMP_SHORT_VY;
    this.doubleJumpUsed = false;
    this.pose = POSE.jump;
    this.jumpBufferedAt = 0;
    return true;
  }

  doubleJump(now) {
    if (!this.canDoubleJump(now)) return false;
    this.stamina = Math.max(0, this.stamina - DOUBLE_JUMP_STAMINA);
    this.vy = PHYSICS.DOUBLE_JUMP_VY;
    this.doubleJumpUsed = true;
    this.pose = POSE.air;
    return true;
  }

  wallJump(dir, now) {
    if (!this.canWallJump(now)) return false;
    this.stamina = Math.max(0, this.stamina - WALL_JUMP_STAMINA);
    this.vy = PHYSICS.WALL_JUMP_VY;
    this.vx = dir * PHYSICS.WALL_JUMP_VX;
    this.facing = dir;
    this.wallJumpCooldown = now + FIGHTER.WALL_JUMP_COOLDOWN_MS;
    this.pose = POSE.air;
    return true;
  }

  startSlide(dir, now) {
    if (!this.canSlide(now)) return false;
    this.stamina = Math.max(0, this.stamina - SLIDE_STAMINA);
    this.vx = dir * PHYSICS.SLIDE_SPEED * this.speedMult;
    this.facing = dir;
    this.slideUntil = now + FIGHTER.SLIDE_DURATION_MS;
    this.invincibleUntil = now + FIGHTER.SLIDE_INVULN_MS;
    this.pose = POSE.slide;
    return true;
  }

  startDash(dir, now) {
    if (!this.canAct(now) || !this.hasStamina(DASH_STAMINA)) return false;
    this.stamina = Math.max(0, this.stamina - DASH_STAMINA);
    this.invincibleUntil = now + PHYSICS.DODGE_INVULN_MS;
    this.dodgeDir = dir;
    this.dodgeStartAt = now;
    this.vx = 0;
    this.facing = dir;
    this.pose = POSE.dodge;
    return true;
  }

  startTeleport(dir, now, closeEvade = false) {
    const cost = closeEvade ? (PHYSICS.TELEPORT_CLOSE_STAMINA ?? 38) : PHYSICS.TELEPORT_STAMINA;
    if (!this.canTeleport(now, closeEvade)) return false;
    this.stamina = Math.max(0, this.stamina - cost);
    this.teleportUntil = now + (closeEvade ? PHYSICS.TELEPORT_WINDUP_MS * 0.85 : PHYSICS.TELEPORT_WINDUP_MS);
    this.teleportDir = dir;
    this.vx = 0;
    this.facing = dir;
    this.pose = POSE.teleport;
    this.poseTime = 0;
    return true;
  }

  completeTeleport(now) {
    this.x += PHYSICS.TELEPORT_DIST * this.teleportDir;
    this.x = Math.max(-ARENA.BOUNDS + FIGHTER_MARGIN, Math.min(ARENA.BOUNDS - FIGHTER_MARGIN, this.x));
    this.invincibleUntil = now + PHYSICS.TELEPORT_INVULN_MS;
    this.teleportUntil = 0;
    this.teleportDir = 0;
    this.pose = POSE.idle;
  }

  update(dt, now) {
    this.poseTime += dt;

    if (this.staggerRagdoll) {
      updateRagdoll(this.staggerRagdoll, dt);
      const pelvis = this.staggerRagdoll.points[2];
      this.x = pelvis.x;
      this.y = 0;
      this.vx = 0;
      this.vy = 0;
      const knockStart = this.staggerUntil - COMBAT.STAGGER_DURATION_MS;
      const minKnockElapsed = now - knockStart >= (COMBAT.STAGGER_MIN_KNOCK_MS ?? 580);
      const settled = isRagdollSettled(this.staggerRagdoll);
      if (settled) {
        if (!this.staggerRagdoll.settledAt) this.staggerRagdoll.settledAt = now;
      } else {
        this.staggerRagdoll.settledAt = null;
      }
      const settledDuration = this.staggerRagdoll.settledAt ? now - this.staggerRagdoll.settledAt : 0;
      const settledLongEnough = settled && settledDuration >= (COMBAT.RAGDOLL_SETTLE_MS ?? 180);
      const canRise = (minKnockElapsed && settledLongEnough) || now >= this.staggerUntil;
      if (canRise) {
        this.staggerUntil = 0;
        this.staggerRagdoll = null;
        this.lastStaggerEndAt = now;
        this.getUpUntil = now + COMBAT.GET_UP_DURATION_MS;
        this.pose = POSE.getUp;
        this.poseTime = 0;
      }
      return;
    }

    if (this.getUpUntil > 0 && now >= this.getUpUntil) {
      this.getUpUntil = 0;
      this.pose = POSE.idle;
    }

    if (this.lastHitAt > 0 && now - this.lastHitAt > FIGHTER.HITS_DECAY_MS) this.hitsTakenLast5Sec = 0;

    if (this.pose === POSE.walk || this.pose === POSE.run) {
      const isActuallyRunning = this.pose === POSE.run && this.canRun();
      const rate = isActuallyRunning ? (PHYSICS.RUN_STAMINA_PER_SEC ?? 26) : (PHYSICS.WALK_STAMINA_PER_SEC ?? 8);
      this.stamina = Math.max(0, this.stamina - rate * dt);
    }
    this.stamina = Math.min(this.maxStamina, this.stamina + dt * (FIGHTER.STAMINA_REGEN_PER_SEC ?? 32));

    if (this.speedMultUntil > 0 && now > this.speedMultUntil) { this.speedMult = 1; this.speedMultUntil = 0; }
    if (this.shieldUntil > 0 && now > this.shieldUntil) this.shieldActive = false;
    if (this.damageMultUntil > 0 && now > this.damageMultUntil) this.damageMult = 1;
    if (this.damageTakenMultUntil > 0 && now > this.damageTakenMultUntil) this.damageTakenMult = 1;

    this.powers.forEach(p => {
      if (this.powerCooldowns[p] > 0 && this.powerCooldowns[p] <= now) this.powerCooldowns[p] = 0;
    });

    if (this.currentAttack) {
      const a = this.currentAttack;
      if (now - a.started >= a.data.duration) {
        this.lastAttackEndedAt = now;
        if ((this.lastHitLandAt || 0) < a.started + WHIFF_HIT_WINDOW) this.lastWhiffAt = now;
        this.currentAttack = null;
        this.pose = POSE.idle;
        if (!a.data.combo) this.recoveryUntil = now + (COMBAT.RECOVERY_MS ?? 95);
      }
    }

    if (this.blockUntil <= now && this.blockLowUntil <= now && this.pose === POSE.block) this.pose = POSE.idle;
    if (this.pose === POSE.dodge && now > this.invincibleUntil) {
      this.pose = POSE.idle;
      this.dodgeStartAt = undefined;
    }
    if (this.pose === POSE.teleport && now >= this.teleportUntil) this.completeTeleport(now);
    if (this.pose === POSE.hit && this.hitFlashUntil <= now) this.pose = POSE.idle;
    if (this.slideUntil > 0 && now > this.slideUntil) { this.slideUntil = 0; this.pose = POSE.idle; }
    if (this.onGround() && (this.pose === POSE.jump || this.pose === POSE.air)) {
      this.pose = POSE.idle;
      this.landingSquashUntil = now + (FIGHTER.LANDING_SQUASH_MS ?? 150);
    }
    if (this.onGround()) this.doubleJumpUsed = false;
  }

  getAttackHitbox(now) {
    if (!this.currentAttack) return null;
    const a = this.currentAttack;
    const elapsed = now - a.started;
    const activeStart = a.type === GRAB ? 0.25 : 0.3;
    const activeEnd = a.type === GRAB ? 0.6 : 0.75;
    if (elapsed < a.data.duration * activeStart || elapsed > a.data.duration * activeEnd) return null;
    const dir = a.dir != null ? a.dir : this.facing;
    return {
      x: this.x + dir * (a.type === GRAB ? 35 : 55),
      w: a.data.range * 0.6,
      damage: a.data.damage,
      stun: a.data.stun,
      knockback: a.data.knockback,
      type: a.type,
      high: a.data.high,
      kickLaunch: a.data.kickLaunch === true
    };
  }

  resetForRound(x, facing) {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.staggerUntil = 0;
    this.staggerRagdoll = null;
    this.doubleJumpUsed = false;
    this.wallJumpCooldown = 0;
    this.slideUntil = 0;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.pose = POSE.idle;
    this.currentAttack = null;
    this.stunUntil = 0;
    this.invincibleUntil = 0;
    this.blockUntil = 0;
    this.blockLowUntil = 0;
    this.recoveryUntil = 0;
    this.shieldActive = false;
    this.shieldUntil = 0;
    this.vampireUntil = 0;
    this.counterStanceUntil = 0;
    this.damageMult = 1;
    this.damageMultUntil = 0;
    this.damageTakenMult = 1;
    this.damageTakenMultUntil = 0;
    this.smokeUntil = 0;
    this.overchargeUntil = 0;
    this.lifestealUntil = 0;
    this.damageDealt = 0;
    this.comboCount = 0;
    this.healEffectUntil = 0;
    this.aiState = null;
    this.aiStateUntil = 0;
    this.aiStateEnteredAt = 0;
    this.aiActionHistory = [];
    this.dodgeDir = undefined;
    this.dodgeStartAt = undefined;
    this.lastLeftGroundAt = 0;
    this.jumpBufferedAt = 0;
    this.hitLastDmg = 0;
    this.getUpUntil = 0;
    this.shinraTenseiUntil = 0;
    this.lastStaggerEndAt = 0;
    this.lastHitAt = 0;
    this.hitsTakenLast5Sec = 0;
    this.lastClashAt = 0;
    this.landingSquashUntil = 0;
    this.lastAttackEndedAt = 0;
    this.lastWhiffAt = 0;
    this.lastComboTime = 0;
    this.lastHitLandAt = 0;
    this.lastLandingAttackType = null;
    this.isRunning = false;
    this.teleportUntil = 0;
    this.teleportDir = 0;
    this.teleportEffectSpawned = false;
    this.lastEvasiveStateAt = 0;
  }
}
export { Fighter };
