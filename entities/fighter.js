import { getPower, getPowerStaminaCost } from './powers/index.js';
import { isRagdollSettled } from '../engine/ragdoll.js';
import { ATTACK, ATTACK_POWER_PUNCH, GRAB, ATTACK_DATA } from './attacks.js';
import { ARENA, PHYSICS, HP, COMBAT, FIGHTER, SKILL_AI } from '../config/constants.js';
import { STAT, clampStat, powerProfile, statT } from '../config/stats.js';
import { PASSIVE } from '../config/passives.js';
import { StatusManager } from './components/StatusManager.js';
import { ActionBuffer } from './components/ActionBuffer.js';
import {
  canSpendStamina,
  getAttackStaminaCost,
  getHitStaminaDamage,
  getMovementStaminaDrain,
  getStaminaRegenRate,
  isRunAffordable,
  spendStamina
} from './components/StaminaModel.js';
import { gaitPhaseSpeed } from '../engine/fightAnimations.js';

export const POSE = { idle: 'idle', punch: 'punch', kick: 'kick', block: 'block', dodge: 'dodge', grab: 'grab', hit: 'hit', jump: 'jump', air: 'air', slide: 'slide', stagger: 'stagger', getUp: 'getUp', walk: 'walk', run: 'run', recover: 'recover' };

class Fighter {
  constructor(id, color, x, facing = 1, maxHp = 200) {
    this.status = new StatusManager();
    this.buffer = new ActionBuffer(250);

    this.id = id;
    this.color = color;
    this.traits = {};          // per-character special behaviours (see ai/monsters.js)
    this.style = null;         // rendering style key (e.g. 'caped')
    this.capeColor = null;
    this.x = x;
    this.y = 0;
    this.facing = facing;
    this.vx = 0;
    this.vy = 0;
    // Two 1–20 levels (see config/stats.js). `power` drives HP + the physical
    // multipliers below; `intelligence` drives the AI brain. Kept in sync via
    // setStats().
    this.power = STAT.DEFAULT;
    this.intelligence = STAT.DEFAULT;
    this.maxHp = Math.max(HP.MIN, Math.min(HP.MAX, maxHp));
    this.hp = this.maxHp;
    this.stamina = FIGHTER.DEFAULT_MAX_STAMINA;
    this.maxStamina = FIGHTER.DEFAULT_MAX_STAMINA;
    this.pose = POSE.idle;
    this.poseTime = 0;
    this.currentAttack = null;
    this.speedMult = 1;
    this.damageMult = 1;       // melee dealt   — derived from power
    this.damageTakenMult = 1;  // melee taken   — derived from power
    this.powerMult = 1;        // skill damage  — derived from power
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
    this.hitFromX = 0;
    this.lastStaggerEndAt = 0;
    this.lastHitAt = 0;
    this.hitsTakenLast5Sec = 0;
    this.lastClashAt = 0;
    this.lastLeftGroundAt = 0;
    this.lastAttackEndedAt = 0;
    this.lastWhiffAt = 0;
    this.lastLandingAttackType = null;
    this.isRunning = false;
    this.impactFrictionUntil = 0;
    this.aiMoveIntent = null;
    this.aiJutsuHistory = [];
    this.blockedMove = null;
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

  // Set the two 1–20 levels and recompute everything derived from power.
  setStats({ power, intelligence } = {}) {
    if (power != null) this.power = clampStat(power);
    if (intelligence != null) this.intelligence = clampStat(intelligence);
    this.deriveFromPower();
    // Intelligence also governs BODY CONTROL: a master (20) accelerates crisply
    // and stops on a dime to strike; a novice (1) is sluggish to start and slides
    // like ice — overshooting range and unable to plant a clean hit. 0…1.
    this.moveAgility = statT(this.intelligence);
    // ...and CHAKRA CONTROL: a master recharges jutsu far faster, so skills are
    // central to its game; a novice's recharge slowly. Effective-cooldown factor.
    this.skillCooldownMult = SKILL_AI.COOLDOWN_MULT_NOVICE
      + (SKILL_AI.COOLDOWN_MULT_MASTER - SKILL_AI.COOLDOWN_MULT_NOVICE) * statT(this.intelligence);
    this.hp = this.maxHp;
  }

  // HP, melee damage, defense and skill damage all derive from `power`.
  deriveFromPower() {
    const p = powerProfile(this.power);
    this.maxHp = p.hp;
    this.damageMult = p.damageMult;
    this.damageTakenMult = p.damageTakenMult;
    this.powerMult = p.skillMult;
  }

  onGround() { return this.y >= (this.groundY || 0) - 3; }

  staminaRatio() {
    const m = this.maxStamina || 1;
    return m > 0 ? Math.min(1, this.stamina / m) : 0;
  }

  canRun() {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return isRunAffordable(this) && !this.status.active('frozen', now) && !this.status.active('deepFreeze', now) && !this.status.active('anchored', now);
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
    return this.powers.includes(powerId) && end <= now && this.stamina >= getPowerStaminaCost(powerId);
  }

  usePower(powerId, now) {
    if (!this.canAct(now)) {
      this.buffer.set('power', { powerId }, now);
      return false;
    }
    if (!this.canUsePower(powerId)) return false;
    const p = getPower(powerId);
    if (!p) return false;
    this.powerCooldowns[powerId] = now + p.cooldown * (this.skillCooldownMult ?? 1);
    spendStamina(this, getPowerStaminaCost(powerId));
    this.lastUsedPower = powerId;
    this.lastUsedAt = now;
    return true;
  }

  // Can the current attack's recovery be cancelled into a new attack?
  // - hit-confirm: after landing a hit you can chain straight into the next move
  // - speed cancel: a faster (or equal) move can cut a slower one's recovery
  // Startup/active frames can never be cancelled (no skipping the commitment).
  canCancelAttack(type, now) {
    const data = ATTACK_DATA[type];
    if (!data) return false;
    const minStart = COMBAT.CANCEL_AFTER ?? 0.55;
    if (this.currentAttack) {
      const cur = this.currentAttack;
      if (now - cur.started < cur.data.duration * minStart) return false; // still in startup/active
      const landedHit = (this.lastHitLandAt || 0) >= cur.started;
      const faster = data.duration <= cur.data.duration;
      return landedHit || faster;
    }
    if (this.status.active('recovery', now)) {
      return (this.lastHitLandAt || 0) > now - (COMBAT.CANCEL_HIT_WINDOW_MS ?? 280);
    }
    return false;
  }

  startAttack(type, now) {
    // Cancel a recovering attack into this one when eligible (combo / speed cancel).
    if ((this.currentAttack || this.status.active('recovery', now)) && this.canCancelAttack(type, now)) {
      this.currentAttack = null;
      this.status.clear('recovery');
    }
    if (!this.canAct(now) && !(!this.onGround() && !this.currentAttack)) {
      this.buffer.set('attack', { type }, now);
      return false;
    }
    const data = ATTACK_DATA[type];
    if (!data) return false;
    const aerialOk = [ATTACK.jab, ATTACK.cross, ATTACK.highKick, ATTACK.frontKick, ATTACK.axeKick].includes(type);
    if (this.onGround()) { if (!this.canAct(now)) return false; }
    else { if (this.currentAttack || !aerialOk) return false; }
    if (this.isRunning) this.momentumAtAttackStart = 1;
    else if (this.status.active('swingLand', now)) this.momentumAtAttackStart = 0.92;
    else if (Math.abs(this.vx) >= PHYSICS.RUN_SPEED_THRESH) this.momentumAtAttackStart = 0.6;
    else if (Math.abs(this.vx) >= PHYSICS.WALK_FAST_THRESH) this.momentumAtAttackStart = 0.35;
    else this.momentumAtAttackStart = 0;
    const staminaCost = getAttackStaminaCost(data, this.momentumAtAttackStart);
    if (!this.tdCreep) {
      if (!canSpendStamina(this, staminaCost)) return false;
      spendStamina(this, staminaCost);
    }
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
    if (!canSpendStamina(this, FIGHTER.JUMP_STAMINA ?? 14)) return false;
    spendStamina(this, FIGHTER.JUMP_STAMINA ?? 14);
    this.vy = PHYSICS.JUMP_VY;
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
    if (!canSpendStamina(this, (FIGHTER.JUMP_STAMINA ?? 14) * 0.7)) return false;
    spendStamina(this, (FIGHTER.JUMP_STAMINA ?? 14) * 0.7);
    this.vy = PHYSICS.JUMP_SHORT_VY;
    this.doubleJumpUsed = false;
    this.pose = POSE.jump;
    this.status.clear('jumpBuffer');
    return true;
  }

  doubleJump(now) {
    if (!this.canDoubleJump(now)) return false;
    if (this.stamina < (FIGHTER.DOUBLE_JUMP_STAMINA ?? 10)) return false;
    spendStamina(this, FIGHTER.DOUBLE_JUMP_STAMINA ?? 10);
    this.vy = PHYSICS.DOUBLE_JUMP_VY;
    this.doubleJumpUsed = true;
    this.pose = POSE.air;
    return true;
  }

  wallJump(dir, now) {
    if (!this.canWallJump(now)) return false;
    if (this.stamina < (FIGHTER.WALL_JUMP_STAMINA ?? 12)) return false;
    spendStamina(this, FIGHTER.WALL_JUMP_STAMINA ?? 12);
    this.vy = PHYSICS.WALL_JUMP_VY;
    this.vx = dir * PHYSICS.WALL_JUMP_VX;
    this.facing = dir;
    this.wallJumpCooldown = now + FIGHTER.WALL_JUMP_COOLDOWN_MS;
    this.pose = POSE.air;
    return true;
  }

  startSlide(dir, now) {
    if (!this.canSlide(now)) return false;
    if (!canSpendStamina(this, FIGHTER.SLIDE_STAMINA ?? 18)) return false;
    spendStamina(this, FIGHTER.SLIDE_STAMINA ?? 18);
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
    if (!canSpendStamina(this, FIGHTER.DASH_STAMINA ?? 20)) return false;
    spendStamina(this, FIGHTER.DASH_STAMINA ?? 20);
    this.status.set('invincible', now + PHYSICS.DODGE_INVULN_MS);
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

    // ponytail: TD march uses a stable gait clock — not re-derived from jittery vx each draw.
    if (this.tdCreep && this.onGround() && (this.pose === POSE.walk || this.pose === POSE.run)) {
      const isRun = this.pose === POSE.run;
      const prof = this.animProfile;
      const spd = gaitPhaseSpeed(
        Math.max(Math.abs(this.vx), this.moveSpeed * 0.72),
        this.moveSpeed,
        this.scale,
        isRun,
        prof?.walk?.cycleMul ?? 1,
      );
      this._gaitPhase = ((this._gaitPhase || 0) + dt * spd * (isRun ? 1.28 : 1)) % (Math.PI * 2);
    }

    if (!this.tdCreep) {
      this.poseHistory.unshift({ x: this.x, y: this.y, pose: this.pose, time: now });
      if (this.poseHistory.length > 10) this.poseHistory.pop();
      if (this.currentAttack) {
        this.attackTrail.unshift({ x: this.x, y: this.y, time: now, type: this.currentAttack.type });
        if (this.attackTrail.length > 8) this.attackTrail.pop();
      } else if (this.attackTrail.length > 0) {
        this.attackTrail.shift();
      }
    }

    if (this._ragdollLaunch) {
      this.poseTime += dt;
      return;
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

    if (!this.tdCreep) {
      const movementDrain = getMovementStaminaDrain(this, dt);
      if (movementDrain > 0) {
        spendStamina(this, movementDrain);
        if (this.stamina <= 0 && this.pose === POSE.run) {
          this.isRunning = false;
          this.pose = Math.abs(this.vx) > PHYSICS.WALK_RUN_IDLE_THRESHOLD ? POSE.walk : POSE.idle;
          this.poseTime = 0;
        }
      } else {
        this.stamina = Math.min(this.maxStamina, this.stamina + dt * getStaminaRegenRate(this));
      }
    }

    // Tireless characters (e.g. One Strike) never run out — endless dodging/punching.
    if (this.tdCreep || this.traits?.tireless) this.stamina = this.maxStamina;

    const isFrozen = this.status.active('frozen', now);

    this.speedMult = this.status.active('speedBoost', now) ? 1.4 : 1;
    if (this.status.active('phased', now)) this.speedMult *= 1.2; // Phased speed boost
    if (this.hasPassive('swift')) this.speedMult *= PASSIVE.SWIFT_SPEED_MULT; // Swift passive

    // Regeneration passive: slowly recover HP over time.
    if (this.hasPassive('regen') && this.hp > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + PASSIVE.REGEN_HP_PER_SEC * dt);
    }

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
      if (this.flying) this.vy = 0;
      else this.vy = Math.max(0, this.vy);
    }

    // Anchored: Heavy footed, no jumps or runs
    if (this.status.active('anchored', now)) {
      this.isRunning = false;
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

    this.powers.forEach(p => {
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
    if (this.pose === POSE.recover && !this.status.active('aiState', now)) {
      this.pose = POSE.idle;
    }
    if (this.status.active('slide', now) && now > this.status.get('slide')) {
      this.status.clear('slide');
      this.pose = POSE.idle;
    }
    if (!this.flying && this.onGround() && (this.pose === POSE.jump || this.pose === POSE.air)) {
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
    const data = a.data;
    const elapsed = now - a.started;
    const activeStart = a.type === GRAB ? 0.25 : 0.3;
    const activeEnd = a.type === GRAB ? 0.6 : 0.75;
    if (elapsed < a.data.duration * activeStart || elapsed > a.data.duration * activeEnd) return null;
    const dir = a.dir != null ? a.dir : this.facing;
    const s = this.scale || 1;
    const xOffset = (a.type === GRAB ? 35 : 55) * s;
    const width = data.range * 0.6 * s;

    return {
      x: this.x + xOffset * dir,
      w: width,
      damage: data.damage,
      knockback: data.knockback,
      stun: data.stun,
      high: data.high,
      type: a.type,
      kickLaunch: data.kickLaunch === true,
      knockdown: data.knockdown === true,
      light: data.light === true
    };
  }

  takeDamage(amount, isHeavy = false, attackerX = 0, now = performance.now()) {
    const ironSkin = this.hasPassive('ironSkin') ? (1 - PASSIVE.IRON_SKIN_REDUCTION) : 1;
    const finalDmg = Math.round(amount * this.damageTakenMult * ironSkin);
    this.hp = Math.max(0, this.hp - finalDmg);
    this.lastHitAt = now;
    this.hitFromX = attackerX;
    this.hitsTakenLast5Sec = (this.hitsTakenLast5Sec || 0) + 1;
    this.hitLastDmg = finalDmg;
    spendStamina(this, getHitStaminaDamage(finalDmg, isHeavy));
    this.status.set('hitFlash', now + (isHeavy ? 200 : 140));
    if (this.hp > 0 && isHeavy) {
      this.pose = POSE.hit;
      this.poseTime = 0;
      this.impactFrictionUntil = Math.max(this.impactFrictionUntil || 0, now + (PHYSICS.IMPACT_FRICTION_MS ?? 360));
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
    this.deriveFromPower(); // keep power/intelligence across rounds (re-derives maxHp + mults)
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.pose = POSE.idle;
    this.currentAttack = null;
    this.damageDealt = 0;
    this.comboCount = 0;
    this.aiState = null;
    this.aiStateUntil = 0;
    this.aiStateEnteredAt = 0;
    this.aiActionHistory = [];
    this.aiJutsuHistory = [];
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
    this.hitFromX = 0;
    this.isRunning = false;
    this.impactFrictionUntil = 0;
    this.aiMoveIntent = null;
    this.blockedMove = null;
    this.momentumAtAttackStart = 0;
    this.airAttack = false;
  }
}
export { Fighter };
