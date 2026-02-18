import { ATTACK, ATTACK_POWER_PUNCH, GRAB, COMBO_CHAINS } from '../entities/attacks.js';
import { scorePower } from '../entities/powers/index.js';
import { getDistance, ARENA_BOUNDS } from '../engine/physics.js';
import { castRay } from '../engine/raycast.js';
import { getInboundThreat } from '../engine/projectileThreat.js';
import { AI, PHYSICS } from '../config/constants.js';

export const AI_STATE = {
  EVADING_PROJECTILE: 'evadingProjectile',
  SHINRA_DEFENSE: 'shinraDefense',
  REGROUPING: 'regrouping',
  PREPARING: 'preparing',
  RETREATING: 'retreating',
  DEFENDING: 'defending',
  PUNISHING: 'punishing',
  COMBAT: 'combat',
  APPROACHING: 'approaching'
};

const STATE_PRIORITY = [
  AI_STATE.EVADING_PROJECTILE,
  AI_STATE.SHINRA_DEFENSE,
  AI_STATE.REGROUPING,
  AI_STATE.RETREATING,
  AI_STATE.DEFENDING,
  AI_STATE.PUNISHING,
  AI_STATE.PREPARING,
  AI_STATE.COMBAT,
  AI_STATE.APPROACHING
];

export function faceToward(fighter, opponent) {
  return fighter.x < opponent.x ? 1 : -1;
}

function buildCtx(fighter, opponent, stats, now, rng, clones = [], projectiles = []) {
  const dist = getDistance(fighter, opponent);
  const oppId = opponent.id;
  const enemyClones = clones.filter(c => c.ownerId === oppId);
  const nearestClone = enemyClones.reduce((best, c) => {
    const d = Math.abs(fighter.x - c.x);
    return !best || d < best.dist ? { clone: c, dist: d } : best;
  }, null);
  const ray = castRay(fighter, opponent);
  const rayDist = ray.dist;
  const oppHitbox = opponent.getAttackHitbox(now);
  const oppAttacking = opponent.currentAttack && oppHitbox;
  const canSee = ray.hit && !ray.blocked;
  const inFireballRange = canSee && rayDist >= AI.FIREBALL_MIN && rayDist <= AI.FIREBALL_MAX && !oppAttacking;
  const inShurikenRange = canSee && rayDist >= AI.SHURIKEN_MIN && rayDist <= AI.SHURIKEN_MAX;
  const rangedPowers = (fighter.powers || []).filter(p => ['fireball', 'shuriken'].includes(p));
  const hasRangedPower = rangedPowers.length > 0;
  const inRangedZone = rayDist >= AI.RANGED_POWER_MIN && rayDist <= AI.RANGED_POWER_MAX;
  const evasiveStates = [AI_STATE.RETREATING, AI_STATE.DEFENDING, AI_STATE.REGROUPING];
  const timeInEvasiveState = evasiveStates.includes(fighter.aiState) && (fighter.aiStateEnteredAt != null)
    ? now - fighter.aiStateEnteredAt
    : 0;
  const retreatStopped = dist >= (AI.RETREAT_STOP_DIST ?? 320);
  const evasiveTimeOver = timeInEvasiveState >= (AI.EVADE_MAX_MS ?? 2500);

  const ctx = {
    fighter,
    opponent,
    stats,
    now,
    rng,
    dist,
    rayDist,
    ray,
    opponentX: opponent.x,
    oppHitbox,
    oppAttacking,
    oppStaggered: opponent.staggerUntil > now,
    oppGettingUp: opponent.getUpUntil > now,
    oppRecovering: opponent.recoveryUntil > now,
    oppBlocking: opponent.blockUntil > now || opponent.blockLowUntil > now,
    oppHeavyWindup: opponent.currentAttack && oppHitbox === null && (opponent.currentAttack.data?.damage || 0) >= 12,
    inRange: dist <= AI.ATTACK_RANGE,
    grabRange: dist <= AI.GRAB_RANGE,
    inCombatZone: dist <= AI.COMBAT_ENTER,
    outOfCombatZone: dist > AI.COMBAT_EXIT,
    far: dist > AI.APPROACH_THRESHOLD,
    veryFar: dist > (AI.DASH_FROM_DIST ?? AI.DASH_THRESHOLD),
    tooClose: dist < AI.PREFERRED_DIST_MIN,
    inFireballRange,
    inShurikenRange,
    hasRangedPower,
    inRangedZone,
    aggression: stats.aggression / 100,
    defense: stats.defense / 100,
    combo: stats.comboTendency / 100,
    risk: stats.riskTolerance / 100,
    spacing: stats.spacing / 100,
    hpRatio: fighter.hp / fighter.maxHp,
    staminaRatio: fighter.stamina / fighter.maxStamina,
    shouldRetreat: fighter.hp / fighter.maxHp < AI.RETREAT_HP_RATIO || fighter.stamina < AI.RETREAT_STAMINA,
    timeInEvasiveState,
    retreatStopped,
    evasiveTimeOver,
    justGotUp: (fighter.lastStaggerEndAt || 0) > 0 && now - fighter.lastStaggerEndAt < AI.REGROUP_AFTER_STAGGER_MS,
    hitALot: (fighter.hitsTakenLast5Sec || 0) >= 3,
    tired: fighter.stamina < AI.TIRED_STAMINA || (fighter.stamina < AI.REGROUP_STAMINA_MIN && (fighter.hitsTakenLast5Sec || 0) >= 2),
    energized: fighter.stamina >= AI.ENERGIZED_STAMINA && (fighter.hitsTakenLast5Sec || 0) <= 1,
    facingOpponent: ray.facingOpponent,
    canSeeOpponent: canSee,
    nearestEnemyClone: nearestClone?.clone,
    cloneDist: nearestClone?.dist ?? Infinity,
    faceToward: () => faceToward(fighter, opponent),
    faceTowardClone: (c) => (fighter.x < c.x ? 1 : -1),
    inboundThreat: getInboundThreat(fighter, projectiles)
  };
  const oppPowerReady = (pid) => opponent.powers?.includes(pid) && (opponent.powerCooldowns?.[pid] ?? 0) <= now && opponent.stamina >= 20;
  const oppHasFireball = oppPowerReady('fireball');
  const oppHasShuriken = oppPowerReady('shuriken');
  const oppHasLightning = oppPowerReady('lightningCutter');
  const oppHasShinra = oppPowerReady('shinraTensei');
  const oppHasClone = oppPowerReady('cloneJutsu');
  const oppHasHeal = oppPowerReady('heal');
  const oppRangedReady = (oppHasFireball || oppHasShuriken) && canSee;
  const inOpponentFireballZone = canSee && rayDist >= AI.FIREBALL_MIN && rayDist <= AI.FIREBALL_MAX;
  const inOpponentShurikenZone = canSee && rayDist >= AI.SHURIKEN_MIN && rayDist <= AI.SHURIKEN_MAX;
  const threatByOppRanged = oppRangedReady && (inOpponentFireballZone || inOpponentShurikenZone) && !oppAttacking;
  const oppSide = opponent.x < -ARENA_BOUNDS * 0.3 ? -1 : (opponent.x > ARENA_BOUNDS * 0.3 ? 1 : 0);
  const mySide = fighter.x < -ARENA_BOUNDS * 0.3 ? -1 : (fighter.x > ARENA_BOUNDS * 0.3 ? 1 : 0);
  const inboundThreat = ctx.inboundThreat;
  ctx.cannotEvade = inboundThreat && (fighter.stamina < (PHYSICS.DODGE_STAMINA ?? 26) || inboundThreat.timeToImpact * 1000 < 120);
  ctx.cornered = Math.abs(fighter.x) > ARENA_BOUNDS * 0.88;
  ctx.nearWall = Math.abs(fighter.x) > ARENA_BOUNDS * 0.82;
  const reserve = AI.STAMINA_RESERVE_DEFENSE ?? 38;
  ctx.staminaReserve = reserve;
  const teleportStamina = PHYSICS.TELEPORT_STAMINA ?? 24;
  const teleportCloseStamina = PHYSICS.TELEPORT_CLOSE_STAMINA ?? 38;
  const closeDist = PHYSICS.TELEPORT_CLOSE_DIST ?? 95;
  ctx.canAffordTeleport = fighter.stamina >= teleportStamina + reserve && fighter.canTeleport?.(now) !== false;
  ctx.canAffordTeleportClose = dist <= closeDist && fighter.stamina >= teleportCloseStamina + reserve && fighter.canTeleport?.(now, true) !== false;
  ctx.canAffordDodge = fighter.stamina >= (PHYSICS.DODGE_STAMINA ?? 26) + 12;
  ctx.canAffordSlide = fighter.stamina >= 18 + reserve;
  ctx.preserveStamina = fighter.stamina < 60;
  ctx.staminaComfortable = fighter.stamina >= 85;
  ctx.oppCornered = Math.abs(opponent.x) > ARENA_BOUNDS * 0.88;
  ctx.farRange = dist >= 110;
  ctx.midRange = dist >= 90 && dist <= 200;
  ctx.idealShurikenRange = dist >= 120 && dist <= 200;
  ctx.oppHasFireball = oppHasFireball;
  ctx.oppHasShuriken = oppHasShuriken;
  ctx.oppHasLightning = oppHasLightning;
  ctx.oppHasShinra = oppHasShinra;
  ctx.oppHasClone = oppHasClone;
  ctx.oppHasHeal = oppHasHeal;
  ctx.oppRangedReady = oppRangedReady;
  ctx.threatByOppRanged = threatByOppRanged;
  ctx.inOpponentFireballZone = inOpponentFireballZone;
  ctx.inOpponentShurikenZone = inOpponentShurikenZone;
  ctx.oppSide = oppSide;
  ctx.mySide = mySide;
  ctx.oppHpLead = (opponent.hp / opponent.maxHp) - (fighter.hp / fighter.maxHp);
  const whiffWindow = AI.WHIFF_PUNISH_WINDOW_MS ?? 320;
  ctx.oppJustWhiffed = (opponent.lastWhiffAt || 0) > 0 && now - opponent.lastWhiffAt < whiffWindow;
  fighter.aiMemory = fighter.aiMemory || {};
  if (opponent.blockUntil > now || opponent.blockLowUntil > now) fighter.aiMemory.oppBlockTicks = (fighter.aiMemory.oppBlockTicks || 0) + 1;
  else fighter.aiMemory.oppBlockTicks = 0;
  if (opponent.currentAttack) fighter.aiMemory.oppAttackTicks = (fighter.aiMemory.oppAttackTicks || 0) + 1;
  else fighter.aiMemory.oppAttackTicks = 0;
  if (opponent.lastHitAt && now - opponent.lastHitAt < 600) fighter.aiMemory.oppJustHitAt = opponent.lastHitAt;
  ctx.oppBlockingALot = (fighter.aiMemory.oppBlockTicks || 0) > 22;
  ctx.oppAttackingALot = (fighter.aiMemory.oppAttackTicks || 0) > 15;
  ctx.oppJustGotHit = (fighter.aiMemory.oppJustHitAt || 0) > 0 && now - fighter.aiMemory.oppJustHitAt < 600;
  ctx.hpLead = (fighter.hp / fighter.maxHp) - (opponent.hp / opponent.maxHp);
  ctx.momentum = (fighter.damageDealt || 0) - (opponent.damageDealt || 0);
  if (evasiveStates.includes(fighter.aiState)) fighter.lastEvasiveStateAt = now;
  const reengaging = (now - (fighter.lastEvasiveStateAt || 0) < 2200) && fighter.stamina >= 40 && !ctx.tired;
  ctx.reengaging = reengaging;
  const styleDrift = (now * 0.00025 + (fighter.id || 0) * 0.33) % 1;
  const preferPressure = ctx.inRange && (ctx.oppBlockingALot || (ctx.oppRecovering && dist < 95) || ctx.oppJustGotHit || dist < AI.PREFERRED_DIST_MAX);
  const preferSpacing = ctx.hpLead > 0.18 && ctx.spacing > 0.5 && !ctx.oppStaggered && !ctx.oppGettingUp && dist > AI.PREFERRED_DIST_MAX && styleDrift < 0.65;
  const preferHeavy = reengaging && (dist < 130 || ctx.inRange) && fighter.stamina >= 28;
  ctx.combatMode = preferHeavy ? 'heavy' : (preferPressure ? 'pressure' : (preferSpacing ? 'spacing' : 'neutral'));
  return ctx;
}

function getNextComboAttack(fighter, combo, rng) {
  const n = fighter.comboCount;
  if (n === 0) return null;
  const last = fighter.lastLandingAttackType;
  if (last == null) return null;
  const candidates = COMBO_CHAINS
    .filter(chain => chain.length > n && chain[n - 1] === last)
    .map(chain => chain[n]);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

function pickPower(ctx) {
  const { fighter, rng } = ctx;
  if (!fighter.powers?.length) return null;
  let best = null, bestScore = 0;
  const scoreCtx = { ...ctx };
  for (const pid of fighter.powers) {
    const s = scorePower(pid, scoreCtx);
    if (s > bestScore) { bestScore = s; best = pid; }
  }
  if (bestScore >= 12 && best === fighter.lastUsedPower && rng() < 0.48) return null;
  return bestScore >= 12 ? best : null;
}

function pickRangedPower(ctx) {
  const { fighter, inFireballRange, inShurikenRange, canSeeOpponent, dist, rng } = ctx;
  if (!canSeeOpponent) return null;
  let best = null, bestScore = 0;
  const scoreCtx = { ...ctx };
  for (const pid of ['fireball', 'shuriken']) {
    if (!fighter.powers.includes(pid) || !fighter.canUsePower(pid)) continue;
    if (pid === 'fireball' && !inFireballRange) continue;
    if (pid === 'shuriken' && !inShurikenRange) continue;
    let s = scorePower(pid, scoreCtx);
    if (dist > 140 && pid === 'shuriken') s += 25;
    if (dist >= 180 && dist <= 250 && pid === 'fireball') s += 25;
    if (s > bestScore) { bestScore = s; best = pid; }
  }
  if (bestScore >= 12 && best === fighter.lastUsedPower && rng() < 0.45) return null;
  return bestScore >= 12 ? best : null;
}

const Transitions = {
  evadeProjectile(ctx) {
    if (!ctx.inboundThreat || ctx.cannotEvade || !ctx.fighter.canAct(ctx.now)) return false;
    const minReaction = AI.EVADE_PROJECTILE_REACTION_MIN ?? 0.9;
    if ((ctx.stats?.reaction ?? 0) / 100 < minReaction) return false;
    const tMs = ctx.inboundThreat.timeToImpact * 1000;
    const reaction = ctx.stats.reaction / 100;
    const levelScale = reaction >= 0.9 ? 0.5 + reaction * 0.4 : 0.65 + reaction * 0.3;
    const minMs = AI.PROJECTILE_EVADE_TIME_MIN_MS * levelScale;
    const maxMsRaw = ctx.inboundThreat.heavy ? (AI.PROJECTILE_EVADE_TIME_MAX_MS_FAR ?? AI.PROJECTILE_EVADE_TIME_MAX_MS) : AI.PROJECTILE_EVADE_TIME_MAX_MS;
    const maxMs = maxMsRaw * (0.88 + ctx.defense * 0.15);
    if (tMs < minMs || tMs > maxMs) return false;
    const t = AI.TRANSITION || {};
    let evadeChance = (t.EVADE_PROJECTILE_BASE ?? 0.08) + ctx.defense * (t.EVADE_PROJECTILE_STAT_MUL ?? 0.28) + reaction * 0.18;
    if (ctx.inboundThreat.heavy) evadeChance += 0.1;
    if (tMs > (AI.PROJECTILE_JUMP_WHEN_FAR_MS ?? 400)) evadeChance = Math.min(0.65, evadeChance + 0.18);
    return ctx.rng() < evadeChance;
  },
  shinraDefense(ctx) {
    return ctx.inboundThreat && ctx.cannotEvade && ctx.fighter.canUsePower('shinraTensei');
  },
  regroup(ctx) {
    const { fighter, tired, justGotUp, hitALot, dist, cornered, evasiveTimeOver } = ctx;
    if (evasiveTimeOver) return false;
    if (!fighter.canAct(ctx.now) || (cornered && dist < 90)) return false;
    const needsRegroup = tired || (justGotUp && fighter.stamina < AI.REGROUP_STAMINA_MIN) || (hitALot && fighter.stamina < 55);
    if (!needsRegroup || (dist > AI.COMBAT_EXIT + 60 && fighter.stamina > 80)) return false;
    const chance = AI.TRANSITION?.REGROUP_CHANCE ?? 0.28;
    return ctx.rng() < chance;
  },
  retreat(ctx) {
    const t = AI.TRANSITION || {};
    if (ctx.evasiveTimeOver || ctx.retreatStopped) return false;
    if (!ctx.shouldRetreat || ctx.dist <= AI.PREFERRED_DIST_MIN) return false;
    const chance = (t.RETREAT_BASE ?? 0.04) + (1 - ctx.spacing) * (t.RETREAT_SPACING_MUL ?? 0.02);
    return ctx.rng() < chance;
  },
  defend(ctx) {
    const { oppAttacking, oppHeavyWindup, fighter, defense, rng, evasiveTimeOver } = ctx;
    if (evasiveTimeOver) return false;
    if (!oppAttacking && !oppHeavyWindup || !fighter.hasStamina(14)) return false;
    const t = AI.TRANSITION || {};
    if (oppHeavyWindup && fighter.hasStamina(20) && rng() < (t.DEFEND_WINDUP ?? 0.35)) return true;
    return rng() < (t.DEFEND_ATTACK_BASE ?? 0.08) + defense * (t.DEFEND_ATTACK_STAT_MUL ?? 0.22);
  },
  punish(ctx) {
    const { oppStaggered, oppGettingUp, oppRecovering, inRange, fighter, oppJustWhiffed } = ctx;
    if (ctx.tired) return false;
    if (oppJustWhiffed && inRange && fighter.hasStamina(10)) return true;
    if (oppStaggered && inRange && fighter.hasStamina(14)) return true;
    if (oppGettingUp && (inRange || (ctx.dist < 145 && fighter.hasStamina(20))) && fighter.hasStamina(10)) return true;
    if (oppRecovering && inRange && fighter.hasStamina(10)) return true;
    const reaction = (ctx.stats?.reaction ?? 50) / 100;
    if (oppRecovering && ctx.dist > 65 && ctx.dist < 175 && fighter.hasStamina(24) && reaction >= 0.35) return true;
    return false;
  },
  prepare(ctx) {
    const { fighter, dist, energized, rng } = ctx;
    if (!fighter.canAct(ctx.now)) return false;
    const emerging = fighter.stamina >= AI.REGROUP_STAMINA_MIN && fighter.stamina < AI.ENERGIZED_STAMINA;
    const hasRanged = (fighter.powers || []).some(p => ['fireball', 'shuriken', 'lightningCutter'].includes(p));
    const wantsPrep = (emerging && (fighter.hitsTakenLast5Sec || 0) >= 2) || (hasRanged && !energized && dist < 180);
    if (!wantsPrep || dist <= AI.PREFERRED_DIST_MIN) return false;
    const t = AI.TRANSITION || {};
    const chance = (t.PREPARE_BASE ?? 0.1) + (ctx.stats.reaction / 100) * (t.PREPARE_REACTION_MUL ?? 0.06);
    return rng() < chance;
  }
};

const TRANSITION_CHECKS = [
  [() => true, (ctx) => Transitions.evadeProjectile(ctx), AI_STATE.EVADING_PROJECTILE],
  [() => true, (ctx) => Transitions.shinraDefense(ctx), AI_STATE.SHINRA_DEFENSE],
  [() => true, (ctx) => Transitions.regroup(ctx), AI_STATE.REGROUPING],
  [() => true, (ctx) => Transitions.retreat(ctx), AI_STATE.RETREATING],
  [() => true, (ctx) => Transitions.defend(ctx), AI_STATE.DEFENDING],
  [() => true, (ctx) => {
    if (!Transitions.punish(ctx)) return false;
    const r = (ctx.stats?.reaction ?? 50) / 100;
    const minR = AI.TRANSITION?.PUNISH_REACTION_MIN ?? 0.22;
    return r >= minR || ctx.oppStaggered || ctx.oppGettingUp;
  }, AI_STATE.PUNISHING],
  [() => true, (ctx) => Transitions.prepare(ctx), AI_STATE.PREPARING],
  [(ctx) => ctx.canTransition, (ctx) => ctx.inCombatZone && !ctx.tired, AI_STATE.COMBAT],
  [(ctx) => ctx.canTransition, (ctx) => ctx.outOfCombatZone || ctx.far, AI_STATE.APPROACHING],
];

function getProjectileEvadeAction(ctx) {
  const { inboundThreat, fighter, preserveStamina, stats } = ctx;
  if (!inboundThreat) return null;
  const evadeDir = inboundThreat.evadeDir;
  const tMs = inboundThreat.timeToImpact * 1000;
  const jumpWhenFar = AI.PROJECTILE_JUMP_WHEN_FAR_MS ?? 380;
  const highProjectile = inboundThreat.high;
  const reaction = (stats.reaction ?? 50) / 100;
  const expertLevel = reaction >= 0.85;
  const canCrouch = highProjectile && fighter.onGround() && fighter.hasStamina(8);
  const preferCrouch = !expertLevel && canCrouch && (preserveStamina || (stats.defense / 100 > 0.5 && tMs < 250));
  if (preferCrouch) return { type: 'block', duration: 400, low: true };
  if (fighter.onGround() && fighter.hasStamina(12)) {
    const jumpOverHigh = highProjectile && (expertLevel || tMs > jumpWhenFar || (inboundThreat.heavy && tMs > 200));
    const jumpWhenTime = (inboundThreat.heavy || !highProjectile) && tMs > jumpWhenFar;
    if (jumpOverHigh || jumpWhenTime) return { type: 'jump' };
  }
  if (expertLevel && fighter.hasStamina(PHYSICS.DODGE_STAMINA ?? 26)) return { type: 'dodge', dir: evadeDir };
  if (preserveStamina && canCrouch && !expertLevel) return { type: 'block', duration: 380, low: true };
  if (fighter.hasStamina(PHYSICS.DODGE_STAMINA ?? 26)) return { type: 'dodge', dir: evadeDir };
  if (fighter.hasStamina(12) && fighter.onGround()) return { type: 'jump' };
  if (canCrouch) return { type: 'block', duration: 380, low: true };
  return { type: 'block', duration: 380, low: false };
}

function getDefendAction(ctx) {
  const { oppHitbox, fighter, defense, rng, cannotEvade, preserveStamina, canAffordDodge, canAffordTeleportClose } = ctx;
  if (cannotEvade && fighter.canUsePower('shinraTensei') && ctx.dist <= 140) return { type: 'power', powerId: 'shinraTensei' };
  const dodgeDir = ctx.faceToward() === 1 ? -1 : 1;
  const heavyIncoming = oppHitbox?.damage >= 10;
  const highIncoming = oppHitbox?.high !== false;
  if (ctx.dist <= (PHYSICS.TELEPORT_CLOSE_DIST ?? 95) && canAffordTeleportClose && (heavyIncoming || rng() < 0.62)) return { type: 'teleport', dir: dodgeDir, closeEvade: true };
  if (highIncoming && fighter.onGround() && fighter.hasStamina(14) && rng() < 0.55) return { type: 'jump' };
  if (fighter.onGround() && fighter.hasStamina(14) && !highIncoming && rng() < 0.42) return { type: 'jump' };
  if (fighter.hasStamina(PHYSICS.DODGE_STAMINA ?? 26) && (heavyIncoming || (defense > 0.35 && rng() < 0.7))) return { type: 'dodge', dir: dodgeDir };
  const preferBlock = preserveStamina || !canAffordDodge || (!heavyIncoming && rng() < 0.6);
  return { type: 'block', duration: preferBlock ? 280 : 260, low: !highIncoming };
}

function getPunishAction(ctx) {
  const { oppStaggered, oppGettingUp, oppRecovering, rng, dist, fighter } = ctx;
  if (oppStaggered) {
    if (!ctx.preserveStamina && dist <= 100 && fighter.canUsePower('lightningCutter') && rng() < 0.65) return { type: 'power', powerId: 'lightningCutter' };
    const heavies = ctx.preserveStamina ? [ATTACK.hook, ATTACK.uppercut, ATTACK.cross] : [ATTACK.hook, ATTACK.highKick, ATTACK.uppercut, ATTACK_POWER_PUNCH];
    return { type: 'attack', attack: heavies[Math.floor(rng() * heavies.length)] };
  }
  if (oppGettingUp && ctx.grabRange && ctx.fighter.hasStamina(12) && rng() < 0.45) return { type: 'attack', attack: GRAB };
  if (oppRecovering && dist > AI.ATTACK_RANGE && dist < 170 && ctx.canAffordTeleport && dist > 140) return { type: 'teleport', dir: ctx.faceToward() };
  if (oppRecovering && dist > AI.ATTACK_RANGE && dist < 140) return { type: 'move', dir: ctx.faceToward(), run: true };
  const punish = [ATTACK.cross, ATTACK.uppercut, ATTACK.hook, ATTACK.highKick, ATTACK.spinningKick, ATTACK.frontKick, ATTACK.lowKick];
  return { type: 'attack', attack: punish[Math.floor(rng() * punish.length)] };
}

function buildCombatAttackPool(ctx) {
  const { fighter, opponent, tired, aggression, combo, combatMode, rng, reengaging } = ctx;
  const comboNext = getNextComboAttack(fighter, combo, rng);
  const openers = [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, ATTACK.lowKick];
  const simple = [ATTACK.jab, ATTACK.cross, ATTACK.lowKick, ATTACK.frontKick, ATTACK.hook];
  const kicks = [ATTACK.highKick, ATTACK.spinningKick, ATTACK.axeKick, ATTACK.frontKick];
  const heavy = [ATTACK_POWER_PUNCH, ATTACK.highKick, ATTACK.spinningKick, ATTACK.uppercut, ATTACK.hook, ATTACK.axeKick];
  let pool = tired ? [ATTACK.jab, ATTACK.lowKick, ATTACK.frontKick] : [...openers, ATTACK.uppercut];
  if (combatMode === 'heavy' || (reengaging && fighter.stamina >= 30)) pool = [...heavy, ...pool];
  if (!tired && fighter.comboCount >= 1 && comboNext != null) pool = [comboNext, ...pool];
  else if (!tired && fighter.comboCount === 0 && combatMode !== 'heavy') pool = [...openers, ATTACK.cross, ATTACK.uppercut];
  if (!tired && aggression > 0.18) pool = [...simple, ATTACK.uppercut, ATTACK.frontKick];
  if (!tired && aggression > 0.28) pool = [...pool, ...kicks];
  if (!tired && opponent.stamina < 50) pool = [ATTACK.lowKick, ATTACK.frontKick, ATTACK.cross, ...pool];
  if (!tired && !ctx.preserveStamina && (ctx.hpLead < -0.08 || ctx.oppCornered) && fighter.stamina >= 32) pool = [...heavy, ...pool];
  if (ctx.oppHasHeal && ctx.oppHpLead < -0.06 && !tired && fighter.stamina >= 32 && rng() < 0.6) pool = [...heavy, ...pool];
  if (!tired && !ctx.preserveStamina && ctx.oppCornered && ctx.risk > 0.2 && fighter.stamina >= 32) pool = [ATTACK.spinningKick, ATTACK.highKick, ATTACK.uppercut, ...pool];
  if (ctx.energized && ctx.grabRange && fighter.hasStamina(12) && rng() < 0.45) pool = [GRAB, ...pool];
  if (ctx.dist < 55 && !tired) pool = [ATTACK.uppercut, ATTACK.hook, ATTACK.axeKick, ...pool];
  return pool;
}

function getCombatAction(ctx) {
  const { fighter, opponent, inRange, grabRange, oppBlocking, combo, aggression, risk, rng, facingOpponent, inFireballRange, inShurikenRange, nearestEnemyClone, cloneDist, dist, tired, energized, spacing, oppHasLightning, oppHasShinra, oppHasHeal, oppHpLead, combatMode, oppBlockingALot, oppJustWhiffed, reengaging, nearWall, canAffordSlide } = ctx;
  const reaction = (ctx.stats?.reaction ?? 50) / 100;
  const toward = ctx.faceToward();
  const away = toward === 1 ? -1 : 1;

  if (nearWall && !fighter.onGround() && fighter.wallJumpCooldown <= ctx.now && fighter.hasStamina(12) && rng() < 0.55) {
    const toCenter = fighter.x > 0 ? -1 : 1;
    return { type: 'wallJump', dir: toCenter };
  }
  if (!fighter.onGround() && fighter.hasStamina(10) && !fighter.doubleJumpUsed && rng() < 0.28) return { type: 'doubleJump' };
  if (reengaging && !inRange && dist >= 85 && dist < 155 && fighter.onGround() && canAffordSlide && rng() < 0.5) return { type: 'slide', dir: toward };
  if (inRange && !tired && fighter.hasStamina(8) && rng() < 0.78) {
    const pool = buildCombatAttackPool(ctx);
    if (pool.length) return { type: 'attack', attack: pool[Math.floor(rng() * pool.length)] };
  }

  if (tired && dist > 65 && rng() < 0.5) return { type: 'move', dir: away, run: false };
  if (fighter.stamina < 12 && dist > AI.PREFERRED_DIST_MIN && rng() < 0.35) return { type: 'move', dir: away, run: false };
  const cloneInRange = nearestEnemyClone && cloneDist <= AI.ATTACK_RANGE;
  const preferClone = ctx.oppHasClone && nearestEnemyClone && cloneDist < 120;
  const targetClone = (cloneInRange && (cloneDist < ctx.dist || cloneDist < 100)) || preferClone;
  if (targetClone && nearestEnemyClone) {
    const dir = ctx.faceTowardClone(nearestEnemyClone);
    if (fighter.facing !== dir) return { type: 'move', dir, run: true };
    if (cloneDist <= AI.ATTACK_RANGE && fighter.hasStamina(10)) return { type: 'attack', attack: [ATTACK.jab, ATTACK.cross][Math.floor(rng() * 2)] };
    if (preferClone) return { type: 'move', dir, run: true };
  }
  if (oppHasLightning && grabRange && !opponent.recoveryUntil && rng() < 0.08) return { type: 'move', dir: away, run: false };
  if (oppHasShinra && dist < 85 && rng() < 0.07) return { type: 'move', dir: away, run: false };
  if (!facingOpponent) return { type: 'move', dir: toward, run: true };
  if (!inRange && dist > 75) {
    if (!fighter.onGround() && fighter.hasStamina(10) && !fighter.doubleJumpUsed && rng() < 0.22) return { type: 'doubleJump' };
    if (fighter.onGround() && fighter.hasStamina(14) && dist < 150 && dist > 50 && (ctx.aggression ?? 0.5) > 0.3 && rng() < 0.5) return { type: 'jump' };
    if (fighter.onGround() && dist >= 80 && dist < 145 && canAffordSlide && !tired && rng() < 0.38) return { type: 'slide', dir: toward };
    return { type: 'move', dir: toward, run: true };
  }
  if (ctx.oppHeavyWindup && reaction > 0.5 && inRange && rng() < 0.15 + reaction * 0.1) return { type: 'block', duration: 220, low: rng() < 0.5 };
  const recentClash = (fighter.lastClashAt || 0) > 0 && ctx.now - fighter.lastClashAt < 450;
  if (recentClash && inRange && rng() < 0.06) {
    if (fighter.onGround() && fighter.hasStamina(14) && rng() < 0.5) return { type: 'jump' };
    if (ctx.canAffordTeleportClose && dist <= (PHYSICS.TELEPORT_CLOSE_DIST ?? 95) && rng() < 0.4) return { type: 'teleport', dir: away, closeEvade: true };
    return { type: 'move', dir: away, run: false };
  }
  if (ctx.tooClose && dist < AI.PREFERRED_DIST_MIN && !ctx.oppCornered && rng() < 0.06) {
    if (fighter.onGround() && fighter.hasStamina(14) && rng() < 0.5) return { type: 'jump' };
    if (ctx.canAffordTeleportClose && rng() < 0.4) return { type: 'teleport', dir: away, closeEvade: true };
    return { type: 'move', dir: away, run: false };
  }
  if (inRange && fighter.onGround() && fighter.hasStamina(14) && rng() < 0.07) return { type: 'jump' };

  if (combatMode === 'spacing' && dist > AI.PREFERRED_DIST_MAX) {
    if (oppJustWhiffed && inRange && fighter.hasStamina(10)) return { type: 'attack', attack: [ATTACK.cross, ATTACK.frontKick, ATTACK.uppercut][Math.floor(rng() * 3)] };
    if (ctx.hpLead > 0.28 && rng() < 0.1 + spacing * 0.08) {
      if (ctx.canAffordTeleport && dist < 280 && dist > 70 && rng() < 0.25) return { type: 'teleport', dir: away };
      return { type: 'move', dir: away, run: false };
    }
    if (dist > AI.PREFERRED_DIST_MAX + 30 && rng() < 0.06) {
      if (ctx.canAffordTeleport && dist < 280 && rng() < 0.25) return { type: 'teleport', dir: away };
      return { type: 'move', dir: away, run: false };
    }
  }

  const ranged = pickRangedPower(ctx);
  if (ranged && ctx.dist > 120 && !inRange && (inFireballRange || inShurikenRange) && !ctx.preserveStamina && rng() < (combatMode === 'pressure' ? 0.35 : 0.5)) return { type: 'power', powerId: ranged };
  const power = pickPower(ctx);
  const expensivePowers = ['fireball', 'shinraTensei', 'lightningCutter'];
  if (power && !tired && !inRange && (!ctx.preserveStamina || !expensivePowers.includes(power)) && (combatMode !== 'spacing' || rng() < 0.5)) return { type: 'power', powerId: power };

  if (combatMode === 'pressure') {
    if ((oppBlocking || oppBlockingALot) && grabRange && fighter.hasStamina(12)) return { type: 'attack', attack: GRAB };
    if (ctx.oppRecovering && inRange && fighter.canUsePower('lightningCutter') && !ctx.preserveStamina && rng() < 0.42) return { type: 'power', powerId: 'lightningCutter' };
    if (ctx.oppAttackingALot && dist < 75 && fighter.canUsePower('shinraTensei') && fighter.hasStamina(35) && rng() < 0.38) return { type: 'power', powerId: 'shinraTensei' };
    if (oppBlockingALot && inRange) {
      const blockingHigh = opponent.blockUntil > ctx.now;
      const pressureMix = blockingHigh ? [ATTACK.lowKick, ATTACK.frontKick, GRAB, GRAB] : [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, GRAB];
      return { type: 'attack', attack: pressureMix[Math.floor(rng() * pressureMix.length)] };
    }
    if (ctx.oppRecovering && inRange && fighter.hasStamina(8)) {
      const pressureAttacks = [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, ATTACK.lowKick, ATTACK.uppercut];
      return { type: 'attack', attack: pressureAttacks[Math.floor(rng() * pressureAttacks.length)] };
    }
  }

  const hitAndRun = (fighter.lastHitLandAt || 0) > 0 && ctx.now - fighter.lastHitLandAt < 320 && spacing > 0.55;
  if (hitAndRun && combatMode !== 'pressure' && !inRange && rng() < 0.06) {
    if (fighter.onGround() && fighter.hasStamina(14) && rng() < 0.4) return { type: 'jump' };
    if (ctx.canAffordTeleport && dist < 260 && dist > 50 && rng() < 0.25) return { type: 'teleport', dir: away };
    return { type: 'move', dir: away, run: false };
  }

  const comboNext = getNextComboAttack(fighter, combo, rng);
  if (comboNext && !tired && fighter.hasStamina(8) && combo > 0.15 && fighter.comboCount >= 1) return { type: 'attack', attack: comboNext };
  if (oppBlocking && grabRange && fighter.hasStamina(12)) return { type: 'attack', attack: GRAB };
  if (grabRange && fighter.hasStamina(12) && (combatMode === 'pressure' ? rng() < 0.62 : rng() < 0.5)) return { type: 'attack', attack: GRAB };
  if (oppBlocking && inRange) {
    const blockingHigh = opponent.blockUntil > ctx.now;
    const mixup = blockingHigh ? [ATTACK.lowKick, ATTACK.frontKick, GRAB] : [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, GRAB];
    return { type: 'attack', attack: mixup[Math.floor(rng() * mixup.length)] };
  }

  if (fighter.hasStamina(8)) {
    const pool = buildCombatAttackPool(ctx);
    if (combatMode === 'spacing' && !inRange && rng() < 0.06) return { type: 'move', dir: away, run: false };
    return { type: 'attack', attack: pool[Math.floor(rng() * pool.length)] };
  }

  const wantClose = dist > AI.PREFERRED_DIST_MAX;
  const wantFar = dist < AI.PREFERRED_DIST_MIN && !ctx.oppCornered && !inRange;
  if (wantFar && rng() < 0.35) {
    if (fighter.onGround() && fighter.hasStamina(14) && rng() < 0.45) return { type: 'jump' };
    if (ctx.canAffordTeleportClose && dist <= (PHYSICS.TELEPORT_CLOSE_DIST ?? 95) && rng() < 0.35) return { type: 'teleport', dir: away, closeEvade: true };
    return { type: 'move', dir: away, run: false };
  }
  if (combatMode === 'spacing' && inRange && rng() < 0.05) return { type: 'move', dir: away, run: false };
  if (wantClose) {
    if (fighter.onGround() && fighter.hasStamina(14) && dist < 160 && rng() < 0.4) return { type: 'jump' };
    return { type: 'move', dir: toward, run: true };
  }
  return { type: 'move', dir: toward, run: true };
}

function getApproachAction(ctx) {
  const { fighter, veryFar, dist, canSeeOpponent, nearestEnemyClone, cloneDist, tired, canAffordSlide, preserveStamina, staminaComfortable, oppHasShinra, threatByOppRanged, mySide, rng, reengaging } = ctx;
  const aggression = ctx.aggression ?? 0.5;
  const toward = ctx.faceToward();
  const ranged = pickRangedPower(ctx);
  if (ranged && dist > 100 && !reengaging) return { type: 'power', powerId: ranged };
  if (ctx.nearWall && !fighter.onGround() && fighter.wallJumpCooldown <= ctx.now && fighter.hasStamina(12) && rng() < 0.7) {
    const towardCenter = fighter.x > 0 ? -1 : 1;
    return { type: 'wallJump', dir: towardCenter };
  }
  if (!fighter.onGround() && fighter.hasStamina(10) && !fighter.doubleJumpUsed && rng() < 0.35) return { type: 'doubleJump' };
  if (reengaging && dist >= 90 && dist < 150 && fighter.onGround() && canAffordSlide && rng() < 0.6) return { type: 'slide', dir: toward };
  if (ctx.nearWall && fighter.onGround() && dist > 60 && fighter.hasStamina(14) && rng() < 0.45) return { type: 'jump' };
  if (aggression > 0.2 && dist < 270 && dist > 45 && fighter.onGround() && fighter.hasStamina(14) && rng() < 0.65) return { type: 'jump' };
  if (dist > 85 && dist < 210 && fighter.onGround() && fighter.hasStamina(14) && rng() < 0.52) return { type: 'jump' };
  if (nearestEnemyClone && cloneDist < dist && cloneDist < 180) {
    const dir = ctx.faceTowardClone(nearestEnemyClone);
    if (cloneDist > 220 && ctx.canAffordTeleport) return { type: 'teleport', dir };
    return { type: 'move', dir, run: true };
  }
  if (!canSeeOpponent) return { type: 'move', dir: ctx.faceToward(), run: true };
  if (tired && dist < 120) return { type: 'move', dir: ctx.faceToward() === 1 ? -1 : 1, run: false };
  if (ctx.cornered && !threatByOppRanged && !ctx.inboundThreat && dist > 80) {
    const towardCenter = fighter.x > 0 ? -1 : 1;
    if (fighter.onGround() && fighter.hasStamina(14) && rng() < 0.52) return { type: 'jump' };
    if (ctx.canAffordTeleport && rng() < 0.45) return { type: 'teleport', dir: towardCenter };
    if (rng() < 0.65) return { type: 'move', dir: towardCenter, run: false };
  }
  if (ctx.oppHasHeal && ctx.oppHpLead < -0.08 && dist < 180 && rng() < 0.65) return { type: 'move', dir: ctx.faceToward(), run: true };
  if (threatByOppRanged && dist >= 90 && dist <= 200) {
    if (fighter.onGround() && fighter.hasStamina(12) && rng() < 0.58) return { type: 'jump' };
    const lateral = (mySide <= 0 ? 1 : -1);
    if (rng() < 0.45) return { type: 'move', dir: lateral, run: false };
  }
  const teleportDist = AI.DASH_ONLY_WHEN_DIST ?? 400;
  const runMinStamina = (ctx.staminaRatio ?? 0.5) >= (PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28);
  const teleportWorthIt = dist >= teleportDist && (ctx.oppStaggered || ctx.oppGettingUp || staminaComfortable || dist > 320) && !(oppHasShinra && dist < 160) && !preserveStamina;
  if (veryFar && ctx.canAffordTeleport && !tired && teleportWorthIt) return { type: 'teleport', dir: ctx.faceToward() };
  if (dist > 280 && ctx.canAffordTeleport && !tired && !preserveStamina && rng() < 0.42) return { type: 'teleport', dir: ctx.faceToward() };
  if (oppHasShinra && dist < 140 && dist > 70) return { type: 'move', dir: toward, run: false };
  const slideMinDist = AI.SLIDE_MIN_DIST ?? 95;
  if (fighter.onGround() && dist >= slideMinDist && dist < 160 && canAffordSlide && !tired && !preserveStamina && !oppHasShinra && rng() < 0.55) return { type: 'slide', dir: toward };
  return { type: 'move', dir: toward, run: dist > 70 && runMinStamina };
}

function getRetreatAction(ctx) {
  const { fighter, dist, canAffordTeleport, rng, staminaRatio, retreatStopped, cornered } = ctx;
  const toward = ctx.faceToward();
  const away = toward === 1 ? -1 : 1;
  if (retreatStopped || (cornered && dist > (AI.COMBAT_EXIT ?? 260))) {
    return { type: 'move', dir: toward, run: staminaRatio >= (PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28) && rng() < 0.6 };
  }
  const power = pickPower(ctx);
  if (power === 'heal' && fighter.canUsePower('heal')) return { type: 'power', powerId: 'heal' };
  if (canAffordTeleport && dist < 320 && dist > 60 && rng() < 0.5) return { type: 'teleport', dir: away };
  if (fighter.onGround() && fighter.hasStamina(14) && dist < 100 && rng() < 0.35) return { type: 'jump' };
  const runToEscape = staminaRatio >= (PHYSICS.RUN_STAMINA_MIN_RATIO ?? 0.28) && staminaRatio > 0.5;
  return { type: 'move', dir: away, run: runToEscape && rng() < 0.4 };
}

function getRegroupAction(ctx) {
  const { fighter, dist, rng, cornered, canAffordDodge, preserveStamina } = ctx;
  const away = ctx.faceToward() === 1 ? -1 : 1;
  const toward = ctx.faceToward();
  if (cornered && dist < 100) {
    if (canAffordDodge && !preserveStamina && rng() < 0.6) return { type: 'dodge', dir: toward };
    return { type: 'move', dir: toward, run: false };
  }
  if (canAffordDodge && !preserveStamina && dist < 95 && rng() < 0.45) return { type: 'dodge', dir: away };
  if (ctx.canAffordTeleport && dist < 200 && dist > 50 && rng() < 0.5) return { type: 'teleport', dir: away };
  if (fighter.hasStamina(14) && fighter.onGround() && dist < 95 && !preserveStamina && rng() < 0.52) return { type: 'jump' };
  if (fighter.canUsePower('heal') && fighter.hp / fighter.maxHp < AI.REGROUP_HP_RATIO && rng() < 0.4) {
    const power = pickPower(ctx);
    if (power === 'heal') return { type: 'power', powerId: 'heal' };
  }
  if (fighter.stamina < 40 && dist < 70 && rng() < 0.6) return { type: 'block', duration: 350, low: rng() < 0.5 };
  return { type: 'move', dir: away, run: false };
}

function getPrepareAction(ctx) {
  const { fighter, dist } = ctx;
  const away = ctx.faceToward() === 1 ? -1 : 1;
  const ranged = pickRangedPower(ctx);
  if (ranged && dist > 95 && dist < 220) return { type: 'power', powerId: ranged };
  if (dist < AI.PREFERRED_DIST_MAX + 30) return { type: 'move', dir: away, run: false };
  return { type: 'move', dir: ctx.faceToward(), run: true };
}

export function evaluateState(fighter, opponent, stats, now, rng, clones = [], projectiles = []) {
  const ctx = buildCtx(fighter, opponent, stats, now, rng, clones, projectiles);
  ctx.canTransition = now >= (fighter.aiStateUntil || 0) || (ctx.evasiveTimeOver === true);
  const reaction = stats.reaction / 100;
  const minEvadeReaction = AI.EVADE_PROJECTILE_REACTION_MIN ?? 0.9;

  if (ctx.inboundThreat && fighter.canAct(now) && reaction >= minEvadeReaction && Transitions.evadeProjectile(ctx)) return AI_STATE.EVADING_PROJECTILE;

  for (const [guard, check, state] of TRANSITION_CHECKS) {
    if (!guard(ctx)) continue;
    if (!check(ctx)) continue;
    if (state === AI_STATE.COMBAT) fighter.aiCombatMode = ctx.combatMode;
    return state;
  }

  return fighter.aiState || AI_STATE.APPROACHING;
}

const STATE_ACTIONS = {
  [AI_STATE.EVADING_PROJECTILE]: getProjectileEvadeAction,
  [AI_STATE.SHINRA_DEFENSE]: () => ({ type: 'power', powerId: 'shinraTensei' }),
  [AI_STATE.REGROUPING]: getRegroupAction,
  [AI_STATE.DEFENDING]: getDefendAction,
  [AI_STATE.PUNISHING]: getPunishAction,
  [AI_STATE.RETREATING]: getRetreatAction,
  [AI_STATE.PREPARING]: getPrepareAction,
  [AI_STATE.COMBAT]: getCombatAction,
  [AI_STATE.APPROACHING]: getApproachAction,
};

export function getStateAction(state, fighter, opponent, stats, now, rng, clones = [], projectiles = []) {
  const ctx = buildCtx(fighter, opponent, stats, now, rng, clones, projectiles);
  const fn = STATE_ACTIONS[state] || getApproachAction;
  return fn(ctx);
}
