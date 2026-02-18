import { POSE } from '../entities/fighter.js';
import { ATTACK_POWER_PUNCH } from '../entities/attacks.js';
import { applyKnockback, applyAttackerRecoil } from './physics.js';
import { createRagdoll } from './ragdoll.js';
import { createHitEffect } from '../core/hitEffectFactory.js';
import { getRagdollOriginY } from '../core/coordinates.js';
import { secureRandom } from '../utils.js';
import { COMBAT } from '../config/constants.js';

function hitboxOverlap(hb, targetX) {
  return Math.abs(targetX - hb.x) < hb.w + COMBAT.HITBOX_EXTRA;
}

export function checkCloneHit(attacker, clones, opponentId, now) {
  const hb = attacker.getAttackHitbox(now);
  if (!hb) return null;
  return clones.find(c => c.ownerId === opponentId && hitboxOverlap(hb, c.x)) || null;
}

function getComboScale(comboCount) {
  return COMBAT.COMBO_SCALE[Math.min(comboCount, COMBAT.COMBO_SCALE.length - 1)] || 0.6;
}

function processHit(attacker, defender, now, hitEffects) {
  const hb = attacker.getAttackHitbox(now);
  if (!hb || (defender.invincibleUntil || 0) > now) return;
  const lowAttack = !hb.high;
  const blockingHigh = defender.blockUntil > now;
  const blockingLow = defender.blockLowUntil > now;
  if (blockingHigh && !lowAttack || blockingLow && lowAttack) {
    attacker.stamina = Math.max(0, attacker.stamina - 10);
    hitEffects.push(createHitEffect(defender.x, { block: true }));
    return;
  }
  if (blockingHigh && lowAttack || blockingLow && !lowAttack) {
    const comboScale = getComboScale(attacker.comboCount);
    const counter = defender.currentAttack && defender.getAttackHitbox(now) ? COMBAT.COUNTER_BONUS : 1;
    const dmg = Math.round(hb.damage * comboScale * counter * 0.4);
    defender.hp = Math.max(0, defender.hp - dmg);
    defender.lastHitAt = now;
    defender.hitsTakenLast5Sec = (defender.hitsTakenLast5Sec || 0) + 1;
    attacker.damageDealt += dmg;
    defender.stunUntil = now + hb.stun * 0.5;
    applyKnockback(defender, hb.knockback * 0.5, attacker.x, false);
    hitEffects.push(createHitEffect(defender.x, { dmg }));
    return;
  }
  if (defender.shieldActive) {
    defender.shieldActive = false;
    defender.shieldUntil = 0;
    hitEffects.push(createHitEffect(defender.x, { shield: true }));
    return;
  }
  if (defender.smokeUntil > now && secureRandom() < 0.5) {
    hitEffects.push(createHitEffect(defender.x, { smoke: true }));
    return;
  }
  if (!hitboxOverlap(hb, defender.x)) return;
  const counter = defender.currentAttack && defender.getAttackHitbox(now) ? COMBAT.COUNTER_BONUS : 1;
  const comboScale = getComboScale(attacker.comboCount);
  const overchargeMult = attacker.overchargeUntil > now ? 2.2 : 1;
  let dmg = Math.round(hb.damage * comboScale * counter * attacker.damageMult * defender.damageTakenMult * overchargeMult);
  const shouldStagger = defender.staggerUntil <= now && defender.hp > 0 &&
    (dmg >= COMBAT.STAGGER_DAMAGE || (counter > 1 && dmg >= COMBAT.STAGGER_COUNTER) || (attacker.comboCount >= 4 && dmg >= 9));
  if (defender.counterStanceUntil > now) {
    const counterDmg = Math.round(dmg * 0.8);
    attacker.hp = Math.max(0, attacker.hp - counterDmg);
    defender.damageDealt += counterDmg;
    defender.counterStanceUntil = 0;
    hitEffects.push(createHitEffect(attacker.x, { dmg: counterDmg, counter: true }));
  }
  defender.hp = Math.max(0, defender.hp - dmg);
  defender.lastHitAt = now;
  defender.hitsTakenLast5Sec = (defender.hitsTakenLast5Sec || 0) + 1;
  defender.hitsDecayAt = now + 5000;
  attacker.damageDealt += dmg;
  if (attacker.vampireUntil > now) attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.6));
  if (attacker.lifestealUntil > now) attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.12));
  if (attacker.overchargeUntil > now) attacker.overchargeUntil = 0;
  attacker.comboCount++;
  attacker.lastComboTime = now;
  attacker.lastHitLandAt = now;
  attacker.lastLandingAttackType = hb.type;
  defender.stunUntil = now + hb.stun;
  defender.hitFlashUntil = now + (counter > 1 ? COMBAT.HIT_FLASH_COUNTER_MS : COMBAT.HIT_FLASH_MS);
  defender.hitLastDmg = dmg;
  defender.pose = POSE.hit;
  const towardDefender = defender.x > attacker.x ? 1 : -1;
  const upwardHit = hb.type === 6 || hb.type === ATTACK_POWER_PUNCH;
  const kickLaunch = hb.kickLaunch === true;
  const heavy = hb.damage >= 14 || kickLaunch;
  applyKnockback(defender, hb.knockback, attacker.x, heavy, upwardHit, kickLaunch);
  applyAttackerRecoil(attacker, hb.knockback, -towardDefender);
  if (shouldStagger || kickLaunch) {
    defender.staggerUntil = now + COMBAT.STAGGER_DURATION_MS;
    defender.currentAttack = null;
    defender.pose = POSE.stagger;
    defender.staggerRagdoll = createRagdoll(defender.x, getRagdollOriginY(defender), defender.facing, defender.vx, defender.vy, attacker.x, upwardHit);
  }
  hitEffects.push(createHitEffect(defender.x, { dmg, counter: counter > 1, heavy: hb.damage >= 9 || hb.kickLaunch }));
}

export function resolveCombat(f1, f2, now, hitEffects, cloneHitByF1 = null, cloneHitByF2 = null) {
  const hb1 = f1.getAttackHitbox(now);
  const hb2 = f2.getAttackHitbox(now);
  const bothAttacking = hb1 && hb2;
  if (bothAttacking && Math.abs(f1.x - f2.x) < 80) {
    hitEffects.push(createHitEffect((f1.x + f2.x) / 2, { clash: true }));
    f1.stunUntil = now + 100;
    f2.stunUntil = now + 100;
    f1.lastClashAt = now;
    f2.lastClashAt = now;
    f1.currentAttack = null;
    f2.currentAttack = null;
    f1.pose = POSE.idle;
    f2.pose = POSE.idle;
    return;
  }
  if (!cloneHitByF1) processHit(f1, f2, now, hitEffects);
  if (!cloneHitByF2) processHit(f2, f1, now, hitEffects);
}

export function decayCombos(f1, f2, now) {
  if (now - f1.lastComboTime > COMBAT.COMBO_DECAY_MS) f1.comboCount = 0;
  if (now - f2.lastComboTime > COMBAT.COMBO_DECAY_MS) f2.comboCount = 0;
}
