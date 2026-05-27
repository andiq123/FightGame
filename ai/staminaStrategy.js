import { ATTACK_DATA } from '../entities/attacks.js';
import { getPowerStaminaCost } from '../entities/powers/index.js';
import { AI, FIGHTER } from '../config/constants.js';
import { canSpendStamina, getAttackStaminaCost } from '../entities/components/StaminaModel.js';

export function getStaminaProfile(ctx) {
  const maxStamina = ctx.fighter.maxStamina || 1;
  const ratio = Math.max(0, Math.min(1, ctx.fighter.stamina / maxStamina));
  const criticalRatio = AI.STAMINA_CRITICAL_RATIO ?? 0.16;
  const lowRatio = AI.STAMINA_LOW_RATIO ?? 0.3;
  const recoverRatio = AI.STAMINA_RECOVER_RATIO ?? 0.72;
  const restDistance = AI.STAMINA_SAFE_REST_DIST ?? 330;

  return {
    ratio,
    critical: ratio <= criticalRatio,
    low: ratio <= lowRatio,
    recovered: ratio >= recoverRatio,
    comfortable: ratio >= 0.5,
    reserve: FIGHTER.POWER_STAMINA_RESERVE ?? 38,
    finisherReserve: FIGHTER.POWER_FINISHER_RESERVE ?? 12,
    restDistance,
    safeToRest: ctx.dist >= restDistance || ctx.isSafe
  };
}

export function shouldPrioritizeRecovery(ctx) {
  const stamina = getStaminaProfile(ctx);
  if (ctx.oppStaggered || ctx.oppHpCritical) return false;
  return stamina.critical || (stamina.low && !ctx.oppRecovering);
}

export function canUsePowerWithBudget(ctx, powerId, options = {}) {
  const stamina = getStaminaProfile(ctx);
  const cost = getPowerStaminaCost(powerId);
  const reserve = options.finisher || options.emergency ? stamina.finisherReserve : stamina.reserve;
  if (!ctx.fighter.canUsePower(powerId)) return false;
  if (options.ignoreReserve) return ctx.fighter.stamina >= cost;
  return canSpendStamina(ctx.fighter, cost, reserve);
}

export function scorePowerWithBudget(ctx, powerId, baseScore, options = {}) {
  if (baseScore <= 0) return 0;
  if (!canUsePowerWithBudget(ctx, powerId, options)) return 0;

  const stamina = getStaminaProfile(ctx);
  const afterRatio = (ctx.fighter.stamina - getPowerStaminaCost(powerId)) / (ctx.fighter.maxStamina || 1);
  if (afterRatio < (AI.STAMINA_LOW_RATIO ?? 0.3) && !options.finisher && !options.emergency) {
    return baseScore * 0.45;
  }
  if (stamina.low && !options.finisher && !options.emergency) {
    return baseScore * 0.25;
  }
  return baseScore;
}

export function filterAffordableAttacks(ctx, attacks, reserve = 0) {
  const momentum = ctx.fighter.momentumAtAttackStart || 0;
  return attacks.filter(type => {
    const data = ATTACK_DATA[type];
    if (!data) return false;
    return canSpendStamina(ctx.fighter, getAttackStaminaCost(data, momentum), reserve);
  });
}
