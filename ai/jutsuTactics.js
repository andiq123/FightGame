import { getPowerStaminaCost, scorePower } from '../entities/powers/index.js';
import { STRATEGY } from './strategy.js';
import { scorePowerWithBudget } from './staminaStrategy.js';

export const JUTSU_INTENT = {
  ANY: 'any',
  RANGED: 'ranged',
  CLOSE: 'close',
  PUNISH: 'punish',
  DEFENSE: 'defense',
  RECOVERY: 'recovery',
  ENGAGE: 'engage',
  SETUP: 'setup',
  FINISH: 'finish',
  PRESSURE: 'pressure'
};

const GLOBAL_JUTSU_GCD_MS = 700;
const PLAN_TTL_MS = 2600;
const PLAN_PREPARE_MIN_SCORE = 42;

export const JUTSU_PROFILES = {
  fireball: {
    roles: ['ranged', 'pressure', 'finish'],
    requiresSight: true,
    min: 100,
    max: 520,
    sweet: [145, 360]
  },
  shuriken: {
    roles: ['ranged', 'interrupt', 'finish'],
    requiresSight: true,
    min: 55,
    max: 430,
    sweet: [80, 260]
  },
  iceSpikes: {
    roles: ['ranged', 'control', 'punish', 'finish'],
    requiresSight: true,
    min: 85,
    max: 420,
    sweet: [120, 320]
  },
  flameShower: {
    roles: ['ranged', 'zone', 'pressure', 'finish'],
    min: 150,
    max: 1200,
    sweet: [240, 720]
  },
  lightningCutter: {
    roles: ['close', 'punish', 'finish'],
    requiresSight: true,
    min: 0,
    max: 105,
    sweet: [35, 92]
  },
  shinraTensei: {
    roles: ['close', 'defense', 'punish', 'finish'],
    min: 0,
    max: 150,
    sweet: [0, 115]
  },
  dragonRoar: {
    roles: ['close', 'punish', 'pressure', 'finish'],
    min: 0,
    max: 185,
    sweet: [45, 150]
  },
  spectralDash: {
    roles: ['engage', 'defense', 'mobility', 'punish'],
    requiresSight: true,
    min: 60,
    max: 450,
    sweet: [85, 260]
  },
  vacuumPull: {
    roles: ['engage', 'control', 'pressure', 'finish'],
    min: 130,
    max: 580,
    sweet: [180, 430]
  },
  earthWall: {
    roles: ['defense', 'recovery', 'setup', 'control'],
    min: 90,
    max: 520,
    sweet: [130, 390]
  },
  cloneJutsu: {
    roles: ['setup', 'pressure', 'defense', 'engage', 'interrupt'],
    min: 55,
    max: 420,
    sweet: [90, 320]
  },
  heal: {
    roles: ['recovery', 'defense'],
    min: 170,
    max: 1200,
    sweet: [220, 700]
  }
};

function hasRole(profile, role) {
  return role === JUTSU_INTENT.ANY || profile.roles.includes(role);
}

function distanceFit(profile, dist) {
  if (profile.min != null && dist < profile.min) return -60 - (profile.min - dist) * 0.35;
  if (profile.max != null && dist > profile.max) return -60 - (dist - profile.max) * 0.18;
  if (!profile.sweet) return 0;

  const [minSweet, maxSweet] = profile.sweet;
  if (dist >= minSweet && dist <= maxSweet) return 38;
  const nearest = dist < minSweet ? minSweet : maxSweet;
  return Math.max(0, 28 - Math.abs(dist - nearest) * 0.18);
}

function intentFit(profile, intent) {
  if (intent === JUTSU_INTENT.ANY) return 0;
  if (hasRole(profile, intent)) return 45;

  if (intent === JUTSU_INTENT.RANGED && profile.roles.includes('zone')) return 35;
  if (intent === JUTSU_INTENT.PUNISH && profile.roles.includes('close')) return 22;
  if (intent === JUTSU_INTENT.DEFENSE && profile.roles.includes('mobility')) return 28;
  if (intent === JUTSU_INTENT.ENGAGE && profile.roles.includes('ranged')) return 20;
  if (intent === JUTSU_INTENT.PRESSURE && profile.roles.includes('setup')) return 20;
  if (intent === JUTSU_INTENT.FINISH && profile.roles.includes('punish')) return 24;

  return -30;
}

function situationalFit(pid, ctx, intent) {
  let s = 0;
  const dist = ctx.eyeDist ?? ctx.dist;

  if (ctx.oppHpCritical && ['fireball', 'shuriken', 'iceSpikes', 'flameShower', 'lightningCutter', 'shinraTensei', 'dragonRoar', 'vacuumPull'].includes(pid)) s += 40;
  if ((ctx.oppStaggered || ctx.oppRecovering || ctx.oppJustWhiffed) && ['lightningCutter', 'dragonRoar', 'shinraTensei', 'spectralDash', 'fireball', 'shuriken', 'iceSpikes'].includes(pid)) s += 48;
  if (ctx.oppHealing && ['shuriken', 'fireball', 'cloneJutsu', 'shinraTensei'].includes(pid)) s += 58;
  if ((ctx.inboundThreat || ctx.oppAttacking || ctx.oppHeavyWindup) && ['shinraTensei', 'earthWall', 'spectralDash', 'cloneJutsu', 'iceSpikes'].includes(pid)) s += 52;
  if ((ctx.hpLow || ctx.hpCritical) && ['heal', 'earthWall', 'cloneJutsu', 'spectralDash', 'fireball', 'shuriken', 'flameShower'].includes(pid)) s += 34;
  if (ctx.staminaLow && ['heal', 'earthWall'].includes(pid)) s += 28;
  if (ctx.oppBlockingALot && ['vacuumPull', 'flameShower', 'lightningCutter', 'shinraTensei'].includes(pid)) s += 42;
  if (ctx.oppCornered && ['flameShower', 'earthWall', 'vacuumPull', 'dragonRoar', 'shinraTensei'].includes(pid)) s += 34;
  if (ctx.cornered && ['shinraTensei', 'spectralDash', 'earthWall', 'cloneJutsu'].includes(pid)) s += 42;
  if (ctx.strategy === STRATEGY.ZONING && ['fireball', 'shuriken', 'iceSpikes', 'flameShower', 'earthWall'].includes(pid)) s += 35;
  if (ctx.strategy === STRATEGY.RUSH_DOWN && ['spectralDash', 'vacuumPull', 'cloneJutsu', 'lightningCutter', 'dragonRoar'].includes(pid)) s += 28;
  if (ctx.strategy === STRATEGY.CORNER_TRAP && ['earthWall', 'vacuumPull', 'flameShower', 'dragonRoar', 'shinraTensei'].includes(pid)) s += 32;
  if (ctx.strategy === STRATEGY.TURTLE && ['earthWall', 'heal', 'shuriken', 'fireball', 'shinraTensei'].includes(pid)) s += 28;
  if (pid === 'iceSpikes' && ctx.opponent.y >= -20 && dist > 100) s += 25;
  if (pid === 'cloneJutsu' && (ctx.clones || []).filter(c => c.ownerId === ctx.fighter.id).length === 0) s += 22;

  if (intent === JUTSU_INTENT.RANGED && dist < 95 && !['shinraTensei'].includes(pid)) s -= 55;
  if (intent === JUTSU_INTENT.CLOSE && dist > 165) s -= 60;
  if (intent === JUTSU_INTENT.RECOVERY && dist < 140 && !ctx.isSafe) s -= 45;

  return s;
}

function repeatAdjustment(ctx, pid, score, allowRepeat) {
  if (allowRepeat || pid !== ctx.fighter.lastUsedPower) return score;
  const recent = ctx.fighter.aiJutsuHistory || [];
  const repeatCount = recent.filter(id => id === pid).length;
  return score - 18 - repeatCount * 12;
}

function getCooldownRemaining(ctx, pid) {
  return Math.max(0, (ctx.fighter.powerCooldowns?.[pid] || 0) - ctx.now);
}

function isPlanStillValid(ctx, plan) {
  if (!plan?.powerId) return false;
  if ((plan.expiresAt || 0) <= ctx.now) return false;
  if (!ctx.fighter.powers?.includes(plan.powerId)) return false;
  return JUTSU_PROFILES[plan.powerId] != null;
}

function planPotential(pid, profile, ctx, intent) {
  if (profile.requiresSight && !ctx.canSeeOpponent && !['earthWall', 'cloneJutsu', 'heal'].includes(pid)) return -Infinity;

  const dist = ctx.eyeDist ?? ctx.dist;
  const cooldown = getCooldownRemaining(ctx, pid);
  if (cooldown > 4500) return -Infinity;
  const staminaShort = Math.max(0, getPowerStaminaCost(pid) - ctx.fighter.stamina);
  const cooldownPenalty = cooldown > 0 ? Math.min(42, cooldown / 160) : -12;
  const staminaPenalty = staminaShort * 1.4;
  const statBonus = Math.max(ctx.aggression || 0, ctx.defense || 0, ctx.spacing || 0, ctx.risk || 0) * 10;

  return 35
    + intentFit(profile, intent)
    + Math.max(-25, distanceFit(profile, dist) * 0.7)
    + situationalFit(pid, ctx, intent)
    + statBonus
    - cooldownPenalty
    - staminaPenalty
    + (ctx.rng?.() ?? 0) * 4;
}

function createPlan(ctx, pid, intent, score) {
  const profile = JUTSU_PROFILES[pid];
  const [desiredMin, desiredMax] = profile.sweet || [profile.min ?? 0, profile.max ?? 999];
  return {
    powerId: pid,
    intent,
    desiredMin,
    desiredMax,
    requiresSight: profile.requiresSight === true,
    createdAt: ctx.now,
    expiresAt: ctx.now + PLAN_TTL_MS,
    score: Math.round(score)
  };
}

export function planNextJutsu(ctx, options = {}) {
  const intent = options.intent || JUTSU_INTENT.ANY;
  const allowed = options.allowed ? new Set(options.allowed) : null;
  const blocked = options.blocked ? new Set(options.blocked) : null;

  let best = null;
  let bestScore = -Infinity;
  for (const pid of ctx.fighter.powers || []) {
    if (allowed && !allowed.has(pid)) continue;
    if (blocked?.has(pid)) continue;
    const profile = JUTSU_PROFILES[pid];
    if (!profile) continue;
    const score = planPotential(pid, profile, ctx, intent);
    if (score > bestScore) {
      bestScore = score;
      best = pid;
    }
  }

  return best && bestScore >= (options.threshold ?? PLAN_PREPARE_MIN_SCORE)
    ? createPlan(ctx, best, intent, bestScore)
    : null;
}

export function ensureJutsuPlan(ctx, options = {}) {
  const queue = ctx.fighter.aiJutsuQueue || [];
  const current = queue.find(plan => isPlanStillValid(ctx, plan));
  if (current) {
    ctx.fighter.aiJutsuQueue = [current];
    return current;
  }

  const next = planNextJutsu(ctx, options);
  ctx.fighter.aiJutsuQueue = next ? [next] : [];
  return next;
}

function clearCurrentPlan(fighter) {
  fighter.aiJutsuQueue = [];
}

function getPreparationAction(ctx, plan) {
  const dist = ctx.eyeDist ?? ctx.dist;
  const toward = ctx.faceToward();
  const away = -toward;
  const cooldownReady = (ctx.fighter.powerCooldowns?.[plan.powerId] || 0) <= ctx.now;
  const hasStamina = ctx.fighter.stamina >= getPowerStaminaCost(plan.powerId);

  if (plan.requiresSight && !ctx.canSeeOpponent) {
    if (ctx.nearestObstacle?.d < 100 && ctx.fighter.onGround() && ctx.fighter.hasStamina?.(14)) {
      return { type: 'jump', wallVault: true, dir: ctx.nearestObstacle.dir || toward };
    }
    return { type: 'move', dir: toward, run: false, commitMs: 360 };
  }

  if (dist > plan.desiredMax) {
    const gap = dist - plan.desiredMax;
    return { type: 'move', dir: toward, run: gap > 140 && !ctx.staminaLow, commitMs: gap > 140 ? 520 : 340 };
  }

  if (dist < plan.desiredMin) {
    return { type: 'move', dir: away, run: false, commitMs: 380 };
  }

  if (!hasStamina || !cooldownReady) {
    if (ctx.oppAttacking && dist < 130) return { type: 'block', duration: 180 };
    return { type: 'recover' };
  }

  return null;
}

export function getPlannedJutsuAction(ctx, options = {}) {
  const plan = ensureJutsuPlan(ctx, options);
  if (!plan) return null;

  const ready = selectJutsu(ctx, {
    intent: plan.intent,
    threshold: options.executeThreshold ?? 26,
    allowed: [plan.powerId],
    emergency: options.emergency,
    finisher: options.finisher,
    allowRepeat: options.allowRepeat
  });

  if (ready) {
    clearCurrentPlan(ctx.fighter);
    return { type: 'power', powerId: ready, planned: true };
  }

  if (options.prepare === false) return null;
  return getPreparationAction(ctx, plan);
}

export function recordJutsuUse(fighter, powerId) {
  fighter.aiJutsuHistory = fighter.aiJutsuHistory || [];
  fighter.aiJutsuHistory.unshift(powerId);
  if (fighter.aiJutsuHistory.length > 6) fighter.aiJutsuHistory.pop();
  clearCurrentPlan(fighter);
}

export function selectJutsu(ctx, options = {}) {
  const {
    intent = JUTSU_INTENT.ANY,
    threshold = 30,
    allowRepeat = false,
    emergency = false,
    finisher = false,
    ignoreGlobalCooldown = false
  } = options;
  const allowed = options.allowed ? new Set(options.allowed) : null;
  const blocked = options.blocked ? new Set(options.blocked) : null;

  const { fighter, now } = ctx;
  if (!fighter.powers?.length) return null;
  if (!ignoreGlobalCooldown && fighter.lastGlobalSkillAt && now - fighter.lastGlobalSkillAt < GLOBAL_JUTSU_GCD_MS) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const pid of fighter.powers) {
    if (allowed && !allowed.has(pid)) continue;
    if (blocked?.has(pid)) continue;
    const profile = JUTSU_PROFILES[pid];
    if (!profile || !fighter.canUsePower(pid)) continue;
    if (profile.requiresSight && !ctx.canSeeOpponent) continue;

    const rawScore = scorePower(pid, ctx);
    let s = scorePowerWithBudget(ctx, pid, rawScore, {
      emergency: emergency || ctx.hpCritical || ctx.cannotEvade,
      finisher: finisher || ctx.oppHpCritical
    });
    if (s <= 0) continue;

    s += intentFit(profile, intent);
    s += distanceFit(profile, ctx.eyeDist ?? ctx.dist);
    s += situationalFit(pid, ctx, intent);
    s = repeatAdjustment(ctx, pid, s, allowRepeat || emergency || finisher);

    const statBonus = Math.max(ctx.aggression || 0, ctx.defense || 0, ctx.spacing || 0, ctx.risk || 0) * 12;
    s += statBonus + (ctx.rng?.() ?? 0) * 5;

    if (s > bestScore) {
      bestScore = s;
      best = pid;
    }
  }

  return bestScore >= threshold ? best : null;
}
