import { POSE } from '../entities/fighter.js';
import { ATTACK, ATTACK_POWER_PUNCH } from '../entities/attacks.js';
import { applyKnockback, applyAttackerRecoil } from './physics.js';
import { createRagdoll } from './ragdoll.js';
import { createHitEffect } from '../core/hitEffectFactory.js';
import { getRagdollOriginY, getHitEffectY } from '../core/coordinates.js';
import { secureRandom } from '../utils.js';
import { COMBAT, FIGHTER } from '../config/constants.js';

function applyHitResult(attacker, defender, dmg, now, hitEffects, options = {}) {
  const finalDmg = defender.takeDamage(dmg, options.heavy === true, attacker.x, now);
  attacker.damageDealt = (attacker.damageDealt || 0) + finalDmg; // count melee toward damage stat
  if (options.extra) {
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), ...options.extra }));
  }
}

function hitboxOverlap(hb, targetX) {
  return Math.abs(targetX - hb.x) < hb.w + COMBAT.HITBOX_EXTRA;
}

// A protective wall standing between the two fighters blocks a melee strike.
function wallBetween(ax, bx, obstacles) {
  if (!obstacles?.length) return null;
  const lo = Math.min(ax, bx) + 6;
  const hi = Math.max(ax, bx) - 6;
  return obstacles.find(o => o.x > lo && o.x < hi) || null;
}

// Vertical reach: ground pokes can't hit someone leaping overhead; only
// launchers (uppercut / high kick / kick-launch moves) reach high into the air.
function withinVerticalReach(hb, attacker, defender) {
  const gap = Math.abs((attacker.y || 0) - (defender.y || 0));
  const isLauncher = hb.kickLaunch || hb.type === ATTACK.uppercut || hb.type === ATTACK.highKick;
  return gap <= (isLauncher ? (COMBAT.VERTICAL_REACH_HIGH ?? 180) : (COMBAT.VERTICAL_REACH ?? 95));
}

export function checkCloneHit(attacker, clones, opponentId, now) {
  const hb = attacker.getAttackHitbox(now);
  if (!hb) return null;
  return clones.find(c => c.ownerId === opponentId && hitboxOverlap(hb, c.x)) || null;
}

function getComboScale(comboCount) {
  return COMBAT.COMBO_SCALE[Math.min(comboCount, COMBAT.COMBO_SCALE.length - 1)] || 0.6;
}

function processHit(attacker, defender, now, hitEffects, obstacles = []) {
  const hb = attacker.getAttackHitbox(now);
  if (!hb || defender.status.active('invincible', now)) return;

  // 1. Accurate reach: must be in horizontal range AND vertical reach.
  if (!hitboxOverlap(hb, defender.x)) return;
  if (!withinVerticalReach(hb, attacker, defender)) return;

  // 2. Wall protection: a wall between the fighters eats the strike.
  const wall = wallBetween(attacker.x, defender.x, obstacles);
  if (wall) {
    hitEffects.push(createHitEffect(wall.x, { y: getHitEffectY(0), block: true }));
    return;
  }

  const lowAttack = !hb.high;
  const ducking = defender.status.active('blockLow', now);
  const airborne = !defender.onGround();

  // 3. Height evasion (full whiff → attacker is now punishable):
  //    duck UNDER a high attack, or jump OVER a low attack.
  if ((ducking && !lowAttack) || (airborne && lowAttack)) {
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), dodge: true }));
    attacker.lastWhiffAt = now;
    return;
  }

  // 4. Guard: standing block stops highs, crouch block stops lows.
  const isBlockingHigh = defender.status.active('block', now);
  const successfullyBlocked = (isBlockingHigh && !lowAttack) || (ducking && lowAttack);
  const blockMistake = isBlockingHigh && lowAttack; // standing guard beaten by a low hit

  if (successfullyBlocked) {
    attacker.stamina = Math.max(0, attacker.stamina - (FIGHTER.DOUBLE_JUMP_STAMINA ?? 10));
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), block: true }));
    return;
  }

  if (blockMistake) {
    const dmg = Math.round(hb.damage * getComboScale(attacker.comboCount) * 0.4);
    applyHitResult(attacker, defender, dmg, now, hitEffects, { hitFlash: 100, extra: { dmg } });
    defender.status.set('stun', now + hb.stun * 0.5);
    defender.hitFromX = attacker.x;
    defender.pose = POSE.hit;
    defender.poseTime = 0;
    applyKnockback(defender, hb.knockback * 0.5, attacker.x, false, false, false, now);
    return;
  }
  if (defender.status.active('smoke', now) && secureRandom() < 0.5) {
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), smoke: true }));
    return;
  }

  // Blur Passive: 15% automatic melee dodge
  if (defender.hasPassive('blur') && secureRandom() < 0.15) {
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), dodge: true }));
    return;
  }

  const counter = defender.currentAttack && defender.getAttackHitbox(now) ? COMBAT.COUNTER_BONUS : 1;
  const comboScale = getComboScale(attacker.comboCount);
  let momentumMult = 1;
  const mom = attacker.momentumAtAttackStart ?? 0;
  if (mom >= 1) momentumMult = COMBAT.RUN_MOMENTUM_MULT ?? 1.28;
  else if (mom >= 0.5) momentumMult = COMBAT.FAST_MOVE_MOMENTUM_MULT ?? 1.12;
  else if (mom > 0) momentumMult = 1 + mom * 0.2;
  if (attacker.airAttack) momentumMult *= (COMBAT.AIR_ATTACK_MULT ?? 1.14);

  // 5. Critical hit: a random clean strike lands for bonus damage + extra punch.
  const isCrit = secureRandom() < (COMBAT.CRIT_CHANCE ?? 0.15);
  const critMult = isCrit ? (COMBAT.CRIT_MULT ?? 1.6) : 1;

  const dmg = Math.round(hb.damage * comboScale * counter * critMult * attacker.damageMult * defender.damageTakenMult * momentumMult);

  applyHitResult(attacker, defender, dmg, now, hitEffects);
  defender.hitsDecayAt = now + 5000;
  defender.status.set('stun', now + hb.stun);

  // Status Clearance, Lifesteal & Passives
  if (attacker.hasPassive('vampirism')) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.15));
    hitEffects.push(createHitEffect(attacker.x, { y: getHitEffectY(attacker.y), heal: true }));
  }

  attacker.comboCount++;
  attacker.lastComboTime = now;
  attacker.lastHitLandAt = now;
  attacker.lastLandingAttackType = hb.type;

  const stunMult = isCrit ? 1.3 : 1;
  defender.status.set('stun', now + hb.stun * stunMult);
  defender.status.set('hitFlash', now + (counter > 1 || isCrit ? COMBAT.HIT_FLASH_COUNTER_MS : COMBAT.HIT_FLASH_MS));
  defender.hitFromX = attacker.x;
  defender.pose = POSE.hit;
  defender.poseTime = 0;

  const afterwardDefender = defender.x > attacker.x ? 1 : -1;
  const heavy = hb.damage >= 14 || hb.kickLaunch || isCrit;

  applyKnockback(defender, hb.knockback * (isCrit ? 1.25 : 1), attacker.x, heavy, hb.type === 6 || hb.type === ATTACK_POWER_PUNCH, hb.kickLaunch, now);
  applyAttackerRecoil(attacker, hb.knockback, -afterwardDefender);

  const shouldStagger = !defender.status.active('stagger', now) && defender.hp > 0 &&
    (dmg >= COMBAT.STAGGER_DAMAGE || isCrit || (counter > 1 && dmg >= COMBAT.STAGGER_COUNTER) || (attacker.comboCount >= 4 && dmg >= 9));

  if (shouldStagger || hb.kickLaunch) {
    defender.status.set('stagger', now + COMBAT.STAGGER_DURATION_MS);
    defender.currentAttack = null;
    defender.pose = POSE.stagger;
    defender.staggerRagdoll = createRagdoll(defender.x, getRagdollOriginY(defender), defender.facing, defender.vx, defender.vy, attacker.x, hb.type === 6, now);
  }

  const punchDir = defender.x > attacker.x ? 1 : -1;
  hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), dmg, counter: counter > 1, crit: isCrit, heavy: hb.damage >= 9 || hb.kickLaunch || isCrit, splatter: true, splatterDir: punchDir, splatterColor: attacker.color }));
}

export function resolveCombat(f1, f2, now, hitEffects, cloneHitByF1 = null, cloneHitByF2 = null, obstacles = []) {
  const hb1 = f1.getAttackHitbox(now);
  const hb2 = f2.getAttackHitbox(now);
  const bothAttacking = hb1 && hb2;
  if (bothAttacking && Math.abs(f1.x - f2.x) < 80) {
    hitEffects.push(createHitEffect((f1.x + f2.x) / 2, { y: getHitEffectY((f1.y + f2.y) / 2), clash: true }));
    f1.status.set('stun', now + 100);
    f2.status.set('stun', now + 100);
    f1.lastClashAt = now;
    f2.lastClashAt = now;
    f1.currentAttack = null;
    f2.currentAttack = null;
    f1.pose = POSE.idle;
    f2.pose = POSE.idle;
    return;
  }
  if (!cloneHitByF1) processHit(f1, f2, now, hitEffects, obstacles);
  if (!cloneHitByF2) processHit(f2, f1, now, hitEffects, obstacles);
}

export function decayCombos(f1, f2, now) {
  if (now - f1.lastComboTime > COMBAT.COMBO_DECAY_MS) f1.comboCount = 0;
  if (now - f2.lastComboTime > COMBAT.COMBO_DECAY_MS) f2.comboCount = 0;
}
