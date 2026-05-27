import { POSE } from '../entities/fighter.js';
import { ATTACK_POWER_PUNCH } from '../entities/attacks.js';
import { applyKnockback, applyAttackerRecoil } from './physics.js';
import { createRagdoll } from './ragdoll.js';
import { createHitEffect } from '../core/hitEffectFactory.js';
import { getRagdollOriginY, getHitEffectY } from '../core/coordinates.js';
import { secureRandom } from '../utils.js';
import { COMBAT, FIGHTER } from '../config/constants.js';

function applyHitResult(attacker, defender, dmg, now, hitEffects, options = {}) {
  const finalDmg = defender.takeDamage(dmg, options.heavy === true, attacker.x, now);
  if (options.extra) {
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), ...options.extra }));
  }
}

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
  if (!hb || defender.status.active('invincible', now)) return;

  const lowAttack = !hb.high;
  const isBlockingHigh = defender.status.active('block', now);
  const isBlockingLow = defender.status.active('blockLow', now);
  const successfullyBlocked = (isBlockingHigh && !lowAttack) || (isBlockingLow && lowAttack);
  const blockMistake = (isBlockingHigh && lowAttack) || (isBlockingLow && !lowAttack);

  if (successfullyBlocked) {
    if (attacker.getWeapon().guardBreak) {
      const chipDmg = Math.round(hb.damage * 0.15);
      applyHitResult(attacker, defender, chipDmg, now, hitEffects, { extra: { dmg: chipDmg, guardBreak: true } });
    }
    attacker.stamina = Math.max(0, attacker.stamina - (FIGHTER.DOUBLE_JUMP_STAMINA ?? 10));
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), block: true }));
    return;
  }

  if (blockMistake) {
    const dmg = Math.round(hb.damage * getComboScale(attacker.comboCount) * 0.4);
    applyHitResult(attacker, defender, dmg, now, hitEffects, { hitFlash: 100, extra: { dmg } });
    defender.status.set('stun', now + hb.stun * 0.5);
    applyKnockback(defender, hb.knockback * 0.5, attacker.x, false);
    return;
  }
  if (defender.shieldActive) {
    defender.shieldActive = false;
    defender.status.clear('shield');
    hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), shield: true }));
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

  if (!hitboxOverlap(hb, defender.x)) return;

  const counter = defender.currentAttack && defender.getAttackHitbox(now) ? COMBAT.COUNTER_BONUS : 1;
  const comboScale = getComboScale(attacker.comboCount);
  const overchargeMult = attacker.status.active('overcharge', now) ? 2.2 : 1;

  let momentumMult = 1;
  const mom = attacker.momentumAtAttackStart ?? 0;
  if (mom >= 1) momentumMult = COMBAT.RUN_MOMENTUM_MULT ?? 1.28;
  else if (mom >= 0.5) momentumMult = COMBAT.FAST_MOVE_MOMENTUM_MULT ?? 1.12;
  else if (mom > 0) momentumMult = 1 + mom * 0.2;
  if (attacker.airAttack) momentumMult *= (COMBAT.AIR_ATTACK_MULT ?? 1.14);

  const weapon = attacker.getWeapon();
  const crit = (weapon.critChance && secureRandom() < weapon.critChance) ? 1.5 : 1;
  const stunScale = weapon.stunMult || 1;
  const weaponKB = weapon.knockback || 1;

  // Claymore Execute: bonus damage on low HP targets
  const executeMult = (weapon.executeDmg && defender.hp / defender.maxHp < 0.3) ? weapon.executeDmg : 1;

  const dmg = Math.round(hb.damage * comboScale * counter * attacker.damageMult * defender.damageTakenMult * overchargeMult * momentumMult * crit * executeMult);

  if (defender.status.active('counterStance', now)) {
    const counterDmg = Math.round(dmg * 0.8);
    applyHitResult(defender, attacker, counterDmg, now, hitEffects, { extra: { dmg: counterDmg, counter: true } });
    defender.status.clear('counterStance');
  }

  applyHitResult(attacker, defender, dmg, now, hitEffects, { extra: crit > 1 ? { crit: true } : null });
  defender.hitsDecayAt = now + 5000;
  defender.status.set('stun', now + hb.stun * stunScale);

  // Status Clearance, Lifesteal & Passives
  if (attacker.status.active('vampire', now)) attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.6));
  if (attacker.status.active('lifesteal', now)) attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.12));

  // Vampirism Passive: 15% life drain
  if (attacker.hasPassive('vampirism')) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.15));
    hitEffects.push(createHitEffect(attacker.x, { y: getHitEffectY(attacker.y), heal: true }));
  }

  // Thorns Passive: 10% reflection
  if (defender.hasPassive('thorns')) {
    const reflectDmg = Math.round(dmg * 0.10);
    attacker.takeDamage(reflectDmg, false, defender.x, now);
    hitEffects.push(createHitEffect(attacker.x, { y: getHitEffectY(attacker.y), thorns: true, dmg: reflectDmg }));
  }

  const equipLifesteal = attacker.getLifesteal();
  if (equipLifesteal > 0) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * equipLifesteal));
    hitEffects.push(createHitEffect(attacker.x, { y: getHitEffectY(attacker.y), heal: true }));
  }
  attacker.status.clear('overcharge', 'active'); // Clear overcharge on hit

  attacker.comboCount++;
  attacker.lastComboTime = now;
  attacker.lastHitLandAt = now;
  attacker.lastLandingAttackType = hb.type;

  // Katana: Bleed — ticking damage over time
  if (weapon.bleedChance && secureRandom() < weapon.bleedChance) {
    defender.bleedTicks = (defender.bleedTicks || 0) + 3;
    defender.bleedDmg = weapon.bleedDmg || 3;
    defender.bleedInterval = defender.bleedInterval || 0;
  }

  defender.status.set('stun', now + hb.stun);
  defender.status.set('hitFlash', now + (counter > 1 ? COMBAT.HIT_FLASH_COUNTER_MS : COMBAT.HIT_FLASH_MS));
  defender.hitFromX = attacker.x;
  defender.pose = POSE.hit;

  const afterwardDefender = defender.x > attacker.x ? 1 : -1;
  const heavy = hb.damage >= 14 || hb.kickLaunch;

  // Knockback: apply weapon multiplier and passive resist.
  const kbResist = defender.hasPassive('sturdy') ? 0.6 : 1;
  const pushback = weapon.pushback || 1;
  applyKnockback(defender, hb.knockback * kbResist * weaponKB * pushback, attacker.x, heavy, hb.type === 6 || hb.type === ATTACK_POWER_PUNCH, hb.kickLaunch);
  applyAttackerRecoil(attacker, hb.knockback, -afterwardDefender);

  const shouldStagger = !defender.status.active('stagger', now) && defender.hp > 0 &&
    (dmg >= COMBAT.STAGGER_DAMAGE || (counter > 1 && dmg >= COMBAT.STAGGER_COUNTER) || (attacker.comboCount >= 4 && dmg >= 9));

  if (shouldStagger || hb.kickLaunch) {
    defender.status.set('stagger', now + COMBAT.STAGGER_DURATION_MS);
    defender.currentAttack = null;
    defender.pose = POSE.stagger;
    defender.staggerRagdoll = createRagdoll(defender.x, getRagdollOriginY(defender), defender.facing, defender.vx, defender.vy, attacker.x, hb.type === 6, now);
  }

  const punchDir = defender.x > attacker.x ? 1 : -1;
  hitEffects.push(createHitEffect(defender.x, { y: getHitEffectY(defender.y), dmg, counter: counter > 1, heavy: hb.damage >= 9 || hb.kickLaunch, splatter: true, splatterDir: punchDir, splatterColor: attacker.color }));
}

export function resolveCombat(f1, f2, now, hitEffects, cloneHitByF1 = null, cloneHitByF2 = null) {
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
  if (!cloneHitByF1) processHit(f1, f2, now, hitEffects);
  if (!cloneHitByF2) processHit(f2, f1, now, hitEffects);
}

export function decayCombos(f1, f2, now) {
  const ext1 = f1.getWeapon().comboExtend || 1;
  const ext2 = f2.getWeapon().comboExtend || 1;
  if (now - f1.lastComboTime > COMBAT.COMBO_DECAY_MS * ext1) f1.comboCount = 0;
  if (now - f2.lastComboTime > COMBAT.COMBO_DECAY_MS * ext2) f2.comboCount = 0;
}
