import { FIGHTER, PHYSICS } from '../../config/constants.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function spendStamina(fighter, amount) {
  const cost = Math.max(0, Math.round(amount || 0));
  // Tireless characters (e.g. One Strike) never spend — their bar never lowers.
  if (fighter.traits?.tireless) return cost;
  fighter.stamina = Math.max(0, fighter.stamina - cost);
  return cost;
}

export function canSpendStamina(fighter, amount, reserve = 0) {
  return fighter.stamina - Math.max(0, amount || 0) >= Math.max(0, reserve || 0);
}

export function getAttackStaminaCost(attackData, momentum = 0) {
  if (!attackData) return Infinity;
  const baseCost = attackData.stamina || 0;
  const damageLoad = Math.max(0, (attackData.damage || 0) - 7) * (FIGHTER.ATTACK_DAMAGE_STAMINA_MULT ?? 0.45);
  const durationLoad = Math.max(0, (attackData.duration || 0) - 260) / 160;
  const heavyLoad = (attackData.damage || 0) >= 14 || attackData.kickLaunch ? (FIGHTER.HEAVY_ATTACK_STAMINA_BONUS ?? 4) : 0;
  const momentumLoad = Math.max(0, momentum || 0) * (FIGHTER.MOMENTUM_ATTACK_STAMINA_BONUS ?? 3);
  return Math.ceil(baseCost * (FIGHTER.ATTACK_STAMINA_MULT ?? 1.35) + damageLoad + durationLoad + heavyLoad + momentumLoad);
}

export function getHitStaminaDamage(damage, isHeavy = false) {
  const base = Math.max(0, damage || 0) * (FIGHTER.HIT_STAMINA_DAMAGE_MULT ?? 0.55);
  const heavy = isHeavy ? (FIGHTER.HEAVY_HIT_STAMINA_BONUS ?? 6) : 0;
  return clamp(Math.round(base + heavy), 0, FIGHTER.MAX_HIT_STAMINA_DAMAGE ?? 28);
}

export function getMovementStaminaDrain(fighter, dt) {
  if (!fighter.onGround?.()) return 0;
  if (fighter.pose === 'run' || fighter.isRunning) {
    return (PHYSICS.RUN_STAMINA_PER_SEC ?? 26) * dt;
  }
  if (fighter.pose === 'walk' && Math.abs(fighter.vx || 0) > (PHYSICS.WALK_FAST_THRESH ?? 180)) {
    return (PHYSICS.WALK_STAMINA_PER_SEC ?? 8) * 0.35 * dt;
  }
  return 0;
}

export function getStaminaRegenRate(fighter) {
  const base = FIGHTER.STAMINA_REGEN_PER_SEC ?? 32;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (fighter.currentAttack || fighter.pose === 'punch' || fighter.pose === 'kick') return 0;
  if (fighter.pose === 'hit' || fighter.pose === 'stagger' || fighter.pose === 'getUp') return base * 0.15;
  if (fighter.pose === 'block' || fighter.status?.active?.('stun', now)) return base * 0.25;
  if (fighter.pose === 'slide' || fighter.pose === 'dodge' || fighter.pose === 'jump' || fighter.pose === 'air') return 0;
  if (fighter.pose === 'recover' && Math.abs(fighter.vx || 0) < 20 && fighter.onGround?.()) {
    return base * (FIGHTER.RECOVERY_STAMINA_REGEN_MULT ?? 1.6);
  }
  return base;
}

export function isRunAffordable(fighter) {
  const ratio = fighter.staminaRatio?.() ?? (fighter.stamina / (fighter.maxStamina || 1));
  return ratio >= (PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28);
}
