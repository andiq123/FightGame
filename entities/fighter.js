import { getPower } from './powers/index.js';
import { updateRagdoll, isRagdollSettled } from '../engine/ragdoll.js';
import { ATTACK, ATTACK_POWER_PUNCH, GRAB, ATTACK_DATA } from './attacks.js';
import { ARENA, PHYSICS, HP, COMBAT, FIGHTER, EQUIPMENT } from '../config/constants.js';
import { StatusManager } from './components/StatusManager.js';
import { ActionBuffer } from './components/ActionBuffer.js';

export const POSE = { idle: 'idle', punch: 'punch', kick: 'kick', block: 'block', dodge: 'dodge', grab: 'grab', hit: 'hit', jump: 'jump', air: 'air', slide: 'slide', stagger: 'stagger', getUp: 'getUp', walk: 'walk', run: 'run' };

class Fighter {
  constructor(id, color, x, facing = 1, maxHp = 200) {
    this.status = new StatusManager();
    this.buffer = new ActionBuffer(250);

    this.id = id;
    this.color = color;
    this.x = x;
    this.y = 0;
    this.facing = facing;
    this.vx = 0;
    this.vy = 0;
    this.level = 1;
    this.levelDamageMult = 1;
    this.levelDefenseMult = 1;
    this.maxHp = Math.max(HP.MIN, Math.min(HP.MAX, maxHp));
    this.hp = this.maxHp;
    this.stamina = FIGHTER.DEFAULT_MAX_STAMINA;
    this.maxStamina = FIGHTER.DEFAULT_MAX_STAMINA;
    this.pose = POSE.idle;
    this.poseTime = 0;
    this.currentAttack = null;
    this.speedMult = 1;
    this.shieldActive = false;
    this.vampireUntil = 0; // Legacy, will be removed if no longer used by powers/index.js
    this.damageMult = 1;
    this.damageTakenMult = 1;
    this.staggerRagdoll = null;
    this.doubleJumpUsed = false;
    this.wallJumpCooldown = 0;
    this.powers = [];
    this.powerCooldowns = {};
    this.damageDealt = 0;
    this.comboCount = 0;
    this.lastComboTime = 0;
    this.roundsWon = 0;
    this.hitLastDmg = 0;
    this.lastStaggerEndAt = 0;
    this.lastHitAt = 0;
    this.hitsTakenLast5Sec = 0;
    this.lastClashAt = 0;
    this.lastLeftGroundAt = 0;
    this.lastAttackEndedAt = 0;
    this.lastWhiffAt = 0;
    this.lastLandingAttackType = null;
    this.isRunning = false;
    this.weaponId = 'fists';
    this.poseHistory = [];
    this.attackTrail = [];
    this.passives = [];
    this.scale = 1;
  }

  hasPassive(pid) {
    return this.passives && this.passives.includes(pid);
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
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return this.stamina >= 10 && !this.status.active('frozen', now) && !this.status.active('deepFreeze', now) && !this.status.active('anchored', now);
  }

  setArmor(armorId) {
    if (EQUIPMENT.ARMORS[armorId]) this.armorId = armorId;
  }

  setWeapon(weaponId) {
    if (EQUIPMENT.WEAPONS[weaponId]) this.weaponId = weaponId;
  }

  getArmor() {
    return EQUIPMENT.ARMORS[this.armorId || 'none'];
  }

  getWeapon() {
    return EQUIPMENT.WEAPONS[this.weaponId || 'fists'];
  }

  getWeight() {
    const armor = this.getArmor();
    const weapon = this.getWeapon();
    return (armor.weight || 0) + (weapon.weight || 0);
  }

  getStability() {
    return this.getArmor().knockbackResist || this.getArmor().stability || 1;
  }

  getLifesteal() {
    return this.getWeapon().lifesteal || 0;
  }

  canAct(now) {
    if (this.status.active('deepFreeze', now)) return false;
    const busy = this.status.anyActive(['stun', 'recovery', 'stagger', 'getUp', 'slide'], now);
    return !this.staggerRagdoll && !busy && !this.currentAttack;
  }


  canJump(now) {
    if (this.status.active('anchored', now) || this.status.active('deepFreeze', now)) return false;
    const coyoteOk = this.onGround() || (now - (this.lastLeftGroundAt || 0) < PHYSICS.COYOTE_TIME_MS);
    return this.canAct(now) && coyoteOk;
  }

  canDoubleJump(now) {
    return !this.onGround() && !this.doubleJumpUsed && !this.status.active('stagger', now);
  }

  canWallJump(now) {
    return !this.onGround() && this.wallJumpCooldown <= now && !this.status.active('stagger', now);
  }

  canSlide(now) {
    return this.canAct(now) && this.onGround();
  }

  hasStamina(amount) { return this.stamina >= amount; }

  canUsePower(powerId) {
    const end = this.powerCooldowns[powerId] ?? 0;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return this.powers.includes(powerId) && end <= now && this.stamina >= FIGHTER.POWER_BASE_COST;
  }

  usePower(powerId, now) {
    if (!this.canAct(now)) {
      this.buffer.set('power', { powerId }, now);
      return false;
    }
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
    if (!this.canAct(now) && !(!this.onGround() && !this.currentAttack)) {
      this.buffer.set('attack', { type }, now);
      return false;
    }
    const data = ATTACK_DATA[type];
    if (!data || !this.hasStamina(data.stamina)) return false;
    const aerialOk = [ATTACK.jab, ATTACK.cross, ATTACK.highKick, ATTACK.frontKick, ATTACK.axeKick].includes(type);
    if (this.onGround()) { if (!this.canAct(now)) return false; }
    else { if (this.currentAttack || !aerialOk) return false; }
    this.stamina = Math.max(0, this.stamina - data.stamina);
    if (this.isRunning) this.momentumAtAttackStart = 1;
    else if (this.status.active('swingLand', now)) this.momentumAtAttackStart = 0.92;
    else if (Math.abs(this.vx) >= PHYSICS.RUN_SPEED_THRESH) this.momentumAtAttackStart = 0.6;
    else if (Math.abs(this.vx) >= PHYSICS.WALK_FAST_THRESH) this.momentumAtAttackStart = 0.35;
    else this.momentumAtAttackStart = 0;
    this.airAttack = !this.onGround();
    this.currentAttack = { type, started: now, data, dir: this.facing };
    const isPunch = type <= 2 || type === ATTACK_POWER_PUNCH || type === ATTACK.uppercut;
    this.pose = type === GRAB ? POSE.grab : (isPunch ? POSE.punch : POSE.kick);
    this.poseTime = 0;
    return true;
  }

  startJump(now) {
    if (this.status.active('anchored', now) || this.status.active('deepFreeze', now)) return false;
    if (!this.canAct(now)) {
      this.buffer.set('jump', {}, now);
      return false;
    }
    if (!this.canJump(now)) return false;
    this.vy = PHYSICS.JUMP_VY * (this.getArmor().jumpMult || 1);
    this.doubleJumpUsed = false;
    this.pose = POSE.jump;
    this.status.clear('jumpBuffer');
    return true;
  }

  startShortHop(now) {
    if (!this.canAct(now)) {
      this.buffer.set('jump', { short: true }, now);
      return false;
    }
    if (!this.canJump(now)) return false;
    this.vy = PHYSICS.JUMP_SHORT_VY * (this.getArmor().jumpMult || 1);
    this.doubleJumpUsed = false;
    this.pose = POSE.jump;
    this.status.clear('jumpBuffer');
    return true;
  }

  doubleJump(now) {
    if (!this.canDoubleJump(now)) return false;
    if (this.stamina < (FIGHTER.DOUBLE_JUMP_STAMINA ?? 10)) return false;
    this.stamina -= (FIGHTER.DOUBLE_JUMP_STAMINA ?? 10);
    this.vy = PHYSICS.DOUBLE_JUMP_VY * (this.getArmor().jumpMult || 1);
    this.doubleJumpUsed = true;
    this.pose = POSE.air;
    return true;
  }

  wallJump(dir, now) {
    if (!this.canWallJump(now)) return false;
    if (this.stamina < (FIGHTER.WALL_JUMP_STAMINA ?? 12)) return false;
    this.stamina -= (FIGHTER.WALL_JUMP_STAMINA ?? 12);
    this.vy = PHYSICS.WALL_JUMP_VY * (this.getArmor().jumpMult || 1);
    this.vx = dir * PHYSICS.WALL_JUMP_VX;
    this.facing = dir;
    this.wallJumpCooldown = now + FIGHTER.WALL_JUMP_COOLDOWN_MS;
    this.pose = POSE.air;
    return true;
  }

  startSlide(dir, now) {
    if (!this.canSlide(now)) return false;
    this.vx = dir * PHYSICS.SLIDE_SPEED * this.speedMult;
    this.facing = dir;
    this.status.set('slide', now + FIGHTER.SLIDE_DURATION_MS);
    this.status.set('invincible', now + FIGHTER.SLIDE_INVULN_MS);
    this.pose = POSE.slide;
    return true;
  }

  startDash(dir, now) {
    if (!this.canAct(now)) {
      this.buffer.set('dash', { dir }, now);
      return false;
    }
    const dodgeBoost = this.getArmor().dodgeInvuln || 1;
    this.status.set('invincible', now + PHYSICS.DODGE_INVULN_MS * dodgeBoost);
    this.dodgeDir = dir;
    this.dodgeStartAt = now;
    this.vx = 0;
    this.facing = dir;
    this.pose = POSE.dodge;
    this.needsDashDust = true;
    return true;
  }

  tryHandleBuffer(now) {
    const buffered = this.buffer.get(now);
    if (!buffered || !this.canAct(now)) return;

    const { type, data } = buffered;
    this.buffer.clear();

    if (type === 'attack') this.startAttack(data.type, now);
    else if (type === 'jump') data.short ? this.startShortHop(now) : this.startJump(now);
    else if (type === 'power') this.usePower(data.powerId, now);
    else if (type === 'dash') this.startDash(data.dir, now);
  }


  update(dt, now) {
    this.poseTime += dt;

    // Visual History for Smears/Trails
    this.poseHistory.unshift({ x: this.x, y: this.y, pose: this.pose, time: now });
    if (this.poseHistory.length > 10) this.poseHistory.pop();

    if (this.currentAttack) {
      this.attackTrail.unshift({ x: this.x, y: this.y, time: now, type: this.currentAttack.type });
      if (this.attackTrail.length > 8) this.attackTrail.pop();
    } else {
      if (this.attackTrail.length > 0) this.attackTrail.shift();
    }

    if (this.staggerRagdoll) {
      this.poseHistory = [];
      this.attackTrail = [];
      // updateRagdoll is now handled by PhysicsSystem to ensure correct impact detection
      const pelvis = this.staggerRagdoll.points[2];
      this.x = pelvis.x;
      this.y = pelvis.y - 810; // Sync Y for coordinate consistency

      const knockStart = this.status.get('stagger') - COMBAT.STAGGER_DURATION_MS;
      const minKnockElapsed = now - knockStart >= (COMBAT.STAGGER_MIN_KNOCK_MS ?? 580);
      const settled = isRagdollSettled(this.staggerRagdoll);
      if (settled) {
        if (!this.staggerRagdoll.settledAt) this.staggerRagdoll.settledAt = now;
      } else {
        this.staggerRagdoll.settledAt = null;
      }
      const settledDuration = this.staggerRagdoll.settledAt ? now - this.staggerRagdoll.settledAt : 0;
      const settledLongEnough = settled && settledDuration >= (COMBAT.RAGDOLL_SETTLE_MS ?? 180);
      const canRise = (minKnockElapsed && settledLongEnough) || !this.status.active('stagger', now);
      if (canRise) {
        this.status.clear('stagger');
        this.staggerRagdoll = null;
        this.lastStaggerEndAt = now;
        this.status.set('getUp', now + COMBAT.GET_UP_DURATION_MS);
        this.pose = POSE.getUp;
        this.poseTime = 0;
      }
      return;
    }

    if (this.pose === POSE.getUp && !this.status.active('getUp', now)) {
      this.pose = POSE.idle;
    }

    if (this.lastHitAt > 0 && now - this.lastHitAt > FIGHTER.HITS_DECAY_MS) this.hitsTakenLast5Sec = 0;

    const armor = this.getArmor(); // Moved up to be available for staminaRegenBase
    const staminaRegenBase = (armor.staminaRegen || 1) * (this.hasPassive('battleFocus') ? 1.3 : 1);
    this.stamina = Math.min(this.maxStamina, this.stamina + dt * (FIGHTER.STAMINA_REGEN_PER_SEC ?? 32) * staminaRegenBase);

    // Apply Equipment Stats & Level Multipliers
    const weapon = this.getWeapon();
    const isFrozen = this.status.active('frozen', now);

    this.speedMult = armor.speed * (this.status.active('speedBoost', now) ? 1.4 : 1);
    if (this.status.active('phased', now)) this.speedMult *= 1.2; // Phased speed boost

    if (isFrozen) {
      this.speedMult *= 0.6; // 40% slow
      this.isRunning = false; // Cannot run while frozen
    }

    // Deep Freeze: Absolute immobilization
    const isDeepFrozen = this.status.active('deepFreeze', now);
    if (isDeepFrozen) {
      this.speedMult = 0;
      this.isRunning = false;
      this.vx = 0;
      this.vy = Math.max(0, this.vy); // Stop vertical movement too if falling
    }

    // Anchored: Heavy footed, no jumps or runs
    if (this.status.active('anchored', now)) {
      this.isRunning = false;
    }

    this.damageMult = weapon.damage * this.levelDamageMult * (this.status.active('overcharge', now) ? 1.5 : 1);
    const passiveDefense = this.hasPassive('stonePlating') ? 0.8 : 1;
    this.damageTakenMult = (1 / (armor.defense * this.levelDefenseMult)) * (this.status.active('defenseBoost', now) ? 0.6 : 1) * passiveDefense;

    if (this.status.active('speedMult', now) && now > this.status.get('speedMult')) {
      this.status.clear('speedMult');
    }
    if (this.status.active('shield', now) && now > this.status.get('shield')) this.shieldActive = false;
    if (this.status.active('damageMult', now) && now > this.status.get('damageMult')) {
      // This is now handled by equipment, but clear the status if it expires
      this.status.clear('damageMult');
    }
    if (this.status.active('damageTakenMult', now) && now > this.status.get('damageTakenMult')) {
      // This is now handled by equipment, but clear the status if it expires
      this.status.clear('damageTakenMult');
    }

    // Elemental: Burning (DoT)
    if (this.status.active('burning', now)) {
      if (!this.lastBurnTick) this.lastBurnTick = now;
      if (now - this.lastBurnTick >= 500) {
        this.takeDamage(4, false, 0, now);
        this.lastBurnTick = now;
      }
    } else {
      this.lastBurnTick = 0;
    }

    // Equipment: Bleed (Katana DoT)
    if (this.bleedTicks > 0) {
      this.bleedInterval = (this.bleedInterval || 0) + dt * 1000;
      if (this.bleedInterval >= 600) {
        this.takeDamage(this.bleedDmg || 3, false, 0, now);
        this.bleedTicks--;
        this.bleedInterval = 0;
      }
    }

    this.powers.forEach(p => {
      const cdr = this.status.active('phased', now) ? 1.25 : 1;
      if (this.powerCooldowns[p] > 0 && this.powerCooldowns[p] <= now) {
        this.powerCooldowns[p] = 0;
      }
    });

    if (this.currentAttack) {
      const a = this.currentAttack;
      if (now - a.started >= a.data.duration) {
        this.lastAttackEndedAt = now;
        if ((this.lastHitLandAt || 0) < a.started + (FIGHTER.WHIFF_HIT_WINDOW ?? 100)) this.lastWhiffAt = now;
        this.currentAttack = null;
        this.pose = POSE.idle;
        if (!a.data.combo) this.status.set('recovery', now + (COMBAT.RECOVERY_MS ?? 95));
      }
    }

    if (!this.status.active('block', now) && !this.status.active('blockLow', now) && this.pose === POSE.block) this.pose = POSE.idle;
    if (this.pose === POSE.dodge && now > this.status.get('invincible')) {
      this.pose = POSE.idle;
      this.dodgeStartAt = undefined;
    }
    if (this.pose === POSE.hit && !this.status.active('stun', now) && !this.status.active('hitFlash', now)) {
      this.pose = POSE.idle;
    }
    if (this.status.active('slide', now) && now > this.status.get('slide')) {
      this.status.clear('slide');
      this.pose = POSE.idle;
    }
    if (this.onGround() && (this.pose === POSE.jump || this.pose === POSE.air)) {
      this.pose = POSE.idle;
      this.status.set('landingSquash', now + (FIGHTER.LANDING_SQUASH_MS ?? 150));
      this.needsLandingDust = true;
    }

    this.tryHandleBuffer(now);

    // Elemental: Shocked (Stutter)
    if (this.status.active('shocked', now)) {
      if (!this.lastShockTick) this.lastShockTick = now;
      if (now - this.lastShockTick >= 800) {
        // Inflict minor stun/stutter
        if (!this.status.active('stagger', now)) {
          this.status.set('stun', now + 60);
          this.vx = 0; // Snap movement
          if (this.currentAttack) this.currentAttack = null; // Interrupt
        }
        this.lastShockTick = now;
      }
    } else {
      this.lastShockTick = 0;
    }

  }

  getAttackHitbox(now) {
    if (!this.currentAttack) return null;
    const a = this.currentAttack;
    const data = a.data; // Use data from currentAttack
    const elapsed = now - a.started;
    const activeStart = a.type === GRAB ? 0.25 : 0.3;
    const activeEnd = a.type === GRAB ? 0.6 : 0.75;
    if (elapsed < a.data.duration * activeStart || elapsed > a.data.duration * activeEnd) return null;
    const dir = a.dir != null ? a.dir : this.facing;
    const weapon = this.getWeapon();
    const rangeMult = weapon.range || 1;
    const xOffset = (a.type === GRAB ? 35 : 55) * rangeMult;
    const width = data.range * 0.6 * rangeMult;

    return {
      x: this.x + xOffset * dir,
      w: width,
      damage: data.damage,
      knockback: data.knockback * (weapon.knockback || 1),
      stun: data.stun,
      high: data.high,
      type: a.type,
      kickLaunch: data.kickLaunch === true
    };
  }

  takeDamage(amount, isHeavy = false, attackerX = 0, now = performance.now()) {
    const finalDmg = Math.round(amount * this.damageTakenMult);
    this.hp = Math.max(0, this.hp - finalDmg);
    this.lastHitAt = now;
    this.hitsTakenLast5Sec = (this.hitsTakenLast5Sec || 0) + 1;
    this.hitLastDmg = finalDmg;
    this.status.set('hitFlash', now + (isHeavy ? 200 : 140));
    if (this.hp > 0 && isHeavy) {
      this.pose = POSE.hit;
    }

    // Clear Deep Freeze on damage
    if (this.status.active('deepFreeze', now)) {
      this.status.clear('deepFreeze');
    }

    return finalDmg;
  }

  resetForRound(x, facing) {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.status = new StatusManager(); // Fresh start
    this.buffer.clear();
    this.staggerRagdoll = null;
    this.doubleJumpUsed = false;
    this.wallJumpCooldown = 0;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.pose = POSE.idle;
    this.currentAttack = null;
    this.shieldActive = false;
    this.damageMult = 1;
    this.damageTakenMult = 1;
    this.damageDealt = 0;
    this.comboCount = 0;
    this.aiState = null;
    this.aiStateUntil = 0;
    this.aiStateEnteredAt = 0;
    this.aiActionHistory = [];
    this.dodgeDir = undefined;
    this.dodgeStartAt = undefined;
    this.lastLeftGroundAt = 0;
    this.hitLastDmg = 0;
    this.lastStaggerEndAt = 0;
    this.lastHitAt = 0;
    this.hitsTakenLast5Sec = 0;
    this.lastClashAt = 0;
    this.lastAttackEndedAt = 0;
    this.lastWhiffAt = 0;
    this.lastComboTime = 0;
    this.lastHitLandAt = 0;
    this.lastLandingAttackType = null;
    this.isRunning = false;
    this.momentumAtAttackStart = 0;
    this.airAttack = false;
  }
}
export { Fighter };
