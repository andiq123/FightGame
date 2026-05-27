import { getDistance, ARENA_BOUNDS } from '../engine/physics.js';
import { castRay } from '../engine/raycast.js';
import { getInboundThreat } from '../engine/projectileThreat.js';
import { AI, FIGHTER } from '../config/constants.js';

export function faceToward(fighter, opponent) {
    if (!fighter || !opponent) return 1;
    const dx = opponent.x - fighter.x;
    if (Math.abs(dx) < 5) return fighter.facing || 1;
    return dx > 0 ? 1 : -1;
}

export function buildCtx(fighter, opponent, stats, now, rng, clones = [], projectiles = [], obstacles = []) {
    const dist = getDistance(fighter, opponent);

    // Find nearest obstacle
    const nearestObstacle = (obstacles || []).reduce((best, o) => {
        const d = Math.abs(fighter.x - o.x) - (o.width / 2);
        return (!best || d < best.d) ? { o, d, dir: Math.sign(o.x - fighter.x) } : best;
    }, null);

    // Find nearest clone
    const oppId = opponent.id;
    const enemyClones = clones.filter(c => c.ownerId === oppId);
    const nearestClone = enemyClones.reduce((best, c) => {
        const d = Math.abs(fighter.x - c.x);
        return !best || d < best.dist ? { clone: c, dist: d } : best;
    }, null);

    // Raycasting (Vision)
    const ray = castRay(fighter, opponent);
    const rayDist = ray.dist;
    const canSee = ray.hit && !ray.blocked;

    // Opponent State
    const oppHitbox = opponent.getAttackHitbox(now);
    const oppAttacking = opponent.currentAttack && oppHitbox;
    const oppRecoveryUntil = opponent.status.get('recovery');
    const oppStaggerUntil = opponent.status.get('stagger');
    const oppGetUpUntil = opponent.status.get('getUp');
    const oppBlockUntil = opponent.status.get('block');
    const oppBlockLowUntil = opponent.status.get('blockLow');
    const fighterRecoveryUntil = fighter.status.get('recovery');

    const oppRecovering = oppRecoveryUntil > now;
    const oppStaggered = oppStaggerUntil > now;
    const oppGettingUp = oppGetUpUntil > now;
    const oppBlocking = oppBlockUntil > now || oppBlockLowUntil > now;
    const inRecovery = fighterRecoveryUntil > now;
    const immobilized = fighter.status.anyActive(['frozen', 'deepFreeze', 'anchored', 'stun', 'stagger'], now);

    // Frame Advantage
    let frameAdvantage = 0;
    if (oppRecovering) frameAdvantage += (oppRecoveryUntil - now);
    if (oppStaggered) frameAdvantage += (oppStaggerUntil - now);
    if (inRecovery) frameAdvantage -= (fighterRecoveryUntil - now);

    // Ranges
    const inFireballRange = canSee && rayDist >= AI.FIREBALL_MIN && rayDist <= AI.FIREBALL_MAX && !oppAttacking;
    const inShurikenRange = canSee && rayDist >= AI.SHURIKEN_MIN && rayDist <= AI.SHURIKEN_MAX;
    const rangedPowers = (fighter.powers || []).filter(p => ['fireball', 'shuriken'].includes(p));
    const hasRangedPower = rangedPowers.length > 0;

    // Evasive Timer
    const evasiveStates = ['retreating', 'defending', 'regrouping'];
    const timeInEvasiveState = evasiveStates.includes(fighter.aiState) && (fighter.aiStateEnteredAt != null)
        ? now - fighter.aiStateEnteredAt
        : 0;
    const evasiveTimeOver = timeInEvasiveState >= (AI.EVADE_MAX_MS ?? 2500);

    const justGotUp = (fighter.lastStaggerEndAt || 0) > 0 && now - fighter.lastStaggerEndAt < AI.REGROUP_AFTER_STAGGER_MS;
    const hitALot = (fighter.hitsTakenLast5Sec || 0) >= 3;
    const tired = fighter.stamina < (stats.reaction >= 95 ? 15 : (fighter.status.active('shocked', now) ? AI.TIRED_STAMINA + 20 : AI.TIRED_STAMINA)) || (!(stats.reaction >= 95) && fighter.stamina < AI.REGROUP_STAMINA_MIN && (fighter.hitsTakenLast5Sec || 0) >= 2);
    const energized = fighter.stamina >= AI.ENERGIZED_STAMINA && (fighter.hitsTakenLast5Sec || 0) <= 1;

    // Base Context Object
    const ctx = {
        fighter,
        opponent,
        stats,
        now,
        rng,
        dist,
        rayDist,
        eyeDist: canSee ? rayDist : dist, // LoS-aware distance: raycast when visible, fallback to positional
        ray,

        // Core Attributes
        intelligence: stats.reaction,
        isNightmare: stats.reaction >= 95,
        isExpert: stats.reaction >= 85,

        // Tactical Data
        frameAdvantage,
        blockedByWall: nearestObstacle && ray.blocked && ray.hit && nearestObstacle.d < dist,

        // Opponent Data
        opponentX: opponent.x,
        oppHitbox,
        oppAttacking,
        oppStaggered,
        oppGettingUp,
        oppRecovering,
        oppBlocking,
        oppHeavyWindup: opponent.currentAttack && oppHitbox === null && (opponent.currentAttack.data?.damage || 0) >= 12,
        inRecovery,
        immobilized,

        // Zones
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

        // Stats Normalized
        aggression: stats.aggression / 100,
        defense: stats.defense / 100,
        combo: stats.comboTendency / 100,
        risk: stats.riskTolerance / 100,
        spacing: stats.spacing / 100,
        parkour: (stats.parkourTendency ?? 40) / 100,

        // Status — compute ratios once, derive flags from them
        hpRatio: fighter.hp / fighter.maxHp,
        hpCritical: fighter.hp / fighter.maxHp < 0.25,
        hpLow: fighter.hp / fighter.maxHp < 0.45,
        oppHpCritical: opponent.hp / opponent.maxHp < 0.25,
        staminaRatio: fighter.stamina / fighter.maxStamina,
        isBurning: fighter.status.active('burning', now),
        isFrozen: fighter.status.active('frozen', now),
        isShocked: fighter.status.active('shocked', now),
        oppBurning: opponent.status.active('burning', now),
        oppFrozen: opponent.status.active('frozen', now),
        oppShocked: opponent.status.active('shocked', now),

        // Logic Flags
        shouldRetreat: (fighter.hp / fighter.maxHp < (stats.reaction >= 95 ? 0.04 : AI.RETREAT_HP_RATIO)) || (fighter.status.active('burning', now) && fighter.hp < 60) || (fighter.stamina < (stats.reaction >= 95 ? 15 : AI.RETREAT_STAMINA)),
        timeInEvasiveState,
        retreatStopped: dist >= (AI.RETREAT_STOP_DIST ?? 320),
        evasiveTimeOver,
        justGotUp,
        hitALot,
        tired,
        energized,

        // World / Env
        facingOpponent: ray.facingOpponent,
        canSeeOpponent: canSee,
        clones,
        projectiles,
        obstacles,
        nearestClone,
        nearestEnemyClone: nearestClone?.clone || null,
        cloneDist: nearestClone?.dist ?? Infinity,
        nearestObstacle,
        inboundThreat: getInboundThreat(fighter, projectiles),
        archetype: fighter.archetype || 'hero',

        // New Tactical Senses
        isSafe: nearestObstacle && ray.blocked && ray.hit && nearestObstacle.o.ownerId === fighter.id && nearestObstacle.d < 150,
        underPressure: (hitALot || (dist < 150 && oppAttacking)) && !oppStaggered,
        staminaHigh: fighter.stamina / fighter.maxStamina > 0.85,
        staminaMid: fighter.stamina / fighter.maxStamina > 0.45,
        staminaLow: fighter.stamina / fighter.maxStamina < 0.25,

        // Helpers
        faceToward: () => faceToward(fighter, opponent),
        faceTowardClone: (c) => (fighter.x < c.x ? 1 : -1)
    };

    // Opponent Capability Checks (Power cooldowns)
    const oppPowerReady = (pid) => opponent.powers?.includes(pid) && (opponent.powerCooldowns?.[pid] ?? 0) <= now && opponent.stamina >= 20;
    ctx.oppHasFireball = oppPowerReady('fireball');
    ctx.oppHasShuriken = oppPowerReady('shuriken');
    ctx.oppHasLightning = oppPowerReady('lightningCutter');
    ctx.oppHasShinra = oppPowerReady('shinraTensei');
    ctx.oppHasClone = oppPowerReady('cloneJutsu');
    ctx.oppHasHeal = oppPowerReady('heal');

    const oppRangedReady = (ctx.oppHasFireball || ctx.oppHasShuriken) && canSee;
    const inOpponentFireballZone = canSee && rayDist >= AI.FIREBALL_MIN && rayDist <= AI.FIREBALL_MAX;
    const inOpponentShurikenZone = canSee && rayDist >= AI.SHURIKEN_MIN && rayDist <= AI.SHURIKEN_MAX;

    ctx.oppRangedReady = oppRangedReady;
    ctx.threatByOppRanged = oppRangedReady && (inOpponentFireballZone || inOpponentShurikenZone) && !oppAttacking;
    ctx.inOpponentFireballZone = inOpponentFireballZone;
    ctx.inOpponentShurikenZone = inOpponentShurikenZone;

    ctx.cornered = Math.abs(fighter.x) > ARENA_BOUNDS * 0.88;
    ctx.nearWall = Math.abs(fighter.x) > ARENA_BOUNDS * 0.82;
    ctx.oppCornered = Math.abs(opponent.x) > ARENA_BOUNDS * 0.88;

    const reserve = AI.STAMINA_RESERVE_DEFENSE ?? 38;
    const dashCost = (FIGHTER?.DASH_STAMINA ?? 20);
    const slideCost = (FIGHTER?.SLIDE_STAMINA ?? 18);
    ctx.canAffordDodge = fighter.stamina >= dashCost + 12;
    ctx.canAffordSlide = fighter.stamina >= slideCost + reserve;

    ctx.hpLead = (fighter.hp / fighter.maxHp) - (opponent.hp / opponent.maxHp);
    ctx.oppHpRatio = opponent.hp / opponent.maxHp;

    const whiffWindow = AI.WHIFF_PUNISH_WINDOW_MS ?? 320;
    ctx.oppJustWhiffed = (opponent.lastWhiffAt || 0) > 0 && now - opponent.lastWhiffAt < (ctx.isNightmare ? whiffWindow * 1.5 : whiffWindow);

    fighter.aiMemory = fighter.aiMemory || {};
    if (oppBlocking) fighter.aiMemory.oppBlockTicks = (fighter.aiMemory.oppBlockTicks || 0) + 1;
    else fighter.aiMemory.oppBlockTicks = 0;

    ctx.oppBlockingALot = (fighter.aiMemory.oppBlockTicks || 0) > (ctx.isNightmare ? 15 : 22);
    ctx.oppJustGotHit = (opponent.lastHitAt || 0) > 0 && now - opponent.lastHitAt < 600;
    ctx.oppHealing = opponent.status.active('healEffect', now);

    if (evasiveStates.includes(fighter.aiState)) fighter.lastEvasiveStateAt = now;
    ctx.reengaging = (now - (fighter.lastEvasiveStateAt || 0) < 3400) && !ctx.tired;
    // Note: Combat Mode logic is now handled by Strategy, not Context building

    // Tactical History
    fighter.aiMemory.lastStates = fighter.aiMemory.lastStates || [];
    if (fighter.aiMemory.lastStates[0] !== fighter.aiState) {
        fighter.aiMemory.lastStates.unshift(fighter.aiState);
        if (fighter.aiMemory.lastStates.length > 5) fighter.aiMemory.lastStates.pop();
    }

    return ctx;
}
