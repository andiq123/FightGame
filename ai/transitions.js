import { AI, AI_STATE } from '../config/constants.js';

export const Transitions = {
    evadeProjectile(ctx) {
        if (!ctx.inboundThreat || ctx.cannotEvade || !ctx.fighter.canAct(ctx.now)) return false;
        const minReaction = AI.EVADE_PROJECTILE_REACTION_MIN ?? 0.68;
        if ((ctx.stats?.reaction ?? 0) / 100 < minReaction) return false;
        const tMs = ctx.inboundThreat.timeToImpact * 1000;
        const reaction = ctx.stats.reaction / 100;
        const levelScale = reaction >= 0.85 ? 0.4 + reaction * 0.35 : 0.5 + reaction * 0.35;
        const minMs = AI.PROJECTILE_EVADE_TIME_MIN_MS * levelScale;
        const maxMsRaw = ctx.inboundThreat.heavy ? (AI.PROJECTILE_EVADE_TIME_MAX_MS_FAR ?? 1600) : AI.PROJECTILE_EVADE_TIME_MAX_MS;
        const maxMs = maxMsRaw * (0.92 + ctx.defense * 0.12);
        if (tMs < minMs || tMs > maxMs) return false;
        const t = AI.TRANSITION || {};
        let evadeChance = (t.EVADE_PROJECTILE_BASE ?? 0.35) + ctx.defense * (t.EVADE_PROJECTILE_STAT_MUL ?? 0.45) + reaction * 0.22;
        if (ctx.inboundThreat.heavy) evadeChance += 0.18;
        if (tMs > (AI.PROJECTILE_JUMP_WHEN_FAR_MS ?? 320)) evadeChance = Math.min(0.88, evadeChance + 0.2);
        return ctx.rng() < evadeChance;
    },
    shinraDefense(ctx) {
        return ctx.inboundThreat && ctx.cannotEvade && ctx.fighter.canUsePower('shinraTensei');
    },
    regroup(ctx) {
        const { fighter, tired, justGotUp, hitALot, dist, cornered, evasiveTimeOver, inRecovery, staminaRatio, isSafe, staminaHigh } = ctx;
        if (evasiveTimeOver) return false;

        // Regroup Hysteresis: Stay until highly recovered
        const isRegrouping = fighter.aiState === AI_STATE.REGROUPING;
        if (isRegrouping) {
            const recovered = !tired && !inRecovery && staminaHigh;
            if (recovered) return false;
            return true;
        }

        // Safety Awareness: If safe behind wall, regroup even if not strictly tired
        if (isSafe && !staminaHigh) return true;

        if (!fighter.canAct(ctx.now) || (cornered && dist < 90)) return false;

        const needsRegroup = tired || justGotUp || inRecovery || (hitALot && staminaRatio < 0.7);
        if (!needsRegroup) return false;

        return true;
    },
    retreat(ctx) {
        if (ctx.evasiveTimeOver || ctx.retreatStopped) return false;
        if (!ctx.shouldRetreat || ctx.dist <= AI.PREFERRED_DIST_MIN) return false;
        if (ctx.fighter.aiState === AI_STATE.RETREATING) return true;
        return ctx.hpCritical || ctx.staminaLow || ctx.isBurning;
    },
    defend(ctx) {
        const { oppAttacking, oppHeavyWindup, fighter, defense, rng, evasiveTimeOver, inRecovery } = ctx;
        if (evasiveTimeOver) return false;
        if (!oppAttacking && !oppHeavyWindup) return false;
        const t = AI.TRANSITION || {};
        if (oppHeavyWindup) return rng() < (t.DEFEND_WINDUP ?? 0.78);
        if (inRecovery && (oppAttacking || oppHeavyWindup)) return true;
        if (ctx.dist < AI.GRAB_RANGE) return true;
        return rng() < (t.DEFEND_ATTACK_BASE ?? 0.32) + defense * (t.DEFEND_ATTACK_STAT_MUL ?? 0.48);
    },
    punish(ctx) {
        const { oppStaggered, oppGettingUp, oppRecovering, inRange, fighter, oppJustWhiffed } = ctx;
        if (ctx.tired) return false;
        if (oppJustWhiffed && (inRange || ctx.dist < 155)) return true;
        if (oppStaggered && (inRange || ctx.dist < 135)) return true;
        if (oppGettingUp && (inRange || ctx.dist < 160)) return true;
        if (oppRecovering && (inRange || ctx.dist < 165)) return true;
        const reaction = (ctx.stats?.reaction ?? 50) / 100;
        if (oppRecovering && ctx.dist > 55 && ctx.dist < 190 && reaction >= 0.25) return true;
        return false;
    },
    prepare(ctx) {
        const { fighter, dist, energized, rng } = ctx;
        if (!fighter.canAct(ctx.now)) return false;
        const emerging = fighter.stamina >= AI.REGROUP_STAMINA_MIN && fighter.stamina < AI.ENERGIZED_STAMINA;
        const hasRanged = (fighter.powers || []).some(p => ['fireball', 'shuriken', 'lightningCutter'].includes(p));
        const wantsPrep = (emerging && (fighter.hitsTakenLast5Sec || 0) >= 2) || (hasRanged && !energized && dist < 180);
        if (!wantsPrep || dist <= AI.PREFERRED_DIST_MIN) return false;
        if (fighter.aiState === AI_STATE.PREPARING) return true;
        return ctx.staminaRatio < 0.55 || ctx.hitALot;
    },
    bait(ctx) {
        const { dist, oppRecovering, oppBlocking, aggression, rng, isExpert } = ctx;
        if (dist < 100 || dist > 220 || !isExpert) return false;
        // Bait if opponent is blocking a lot or if we have high spacing stat
        const baitChance = (0.1 + (1 - aggression) * 0.3 + ctx.spacing * 0.2);
        return rng() < baitChance && !oppRecovering && !oppBlocking;
    },
    pressure(ctx) {
        const { fighter, dist, aggression, rng, tired, immobilized } = ctx;
        if (tired || immobilized || dist > 140) return false;
        if (fighter.aiState === AI_STATE.PRESSURING) return dist <= AI.COMBAT_ENTER && !tired;
        return aggression > 0.65 || ctx.oppJustGotHit || ctx.oppCornered;
    },
    recharge(ctx) {
        const { fighter, dist, inboundThreat, oppAttacking, staminaLow, staminaHigh, isSafe } = ctx;
        if (inboundThreat || oppAttacking) return false;

        const isRecharging = fighter.aiState === AI_STATE.RECHARGING;

        // Enter recharge if very low stamina or safe
        if (!isRecharging && (staminaLow || (isSafe && !staminaHigh)) && dist > AI.COMBAT_EXIT) return true;

        // Continue recharging until high stamina
        if (isRecharging && !staminaHigh) return true;

        return false;
    }
};

export const TRANSITION_CHECKS = [
    [() => true, (ctx) => Transitions.evadeProjectile(ctx), AI_STATE.EVADING_PROJECTILE],
    [() => true, (ctx) => Transitions.shinraDefense(ctx), AI_STATE.SHINRA_DEFENSE],
    [() => true, (ctx) => Transitions.regroup(ctx), AI_STATE.REGROUPING],
    [() => true, (ctx) => Transitions.retreat(ctx), AI_STATE.RETREATING],
    [() => true, (ctx) => Transitions.defend(ctx), AI_STATE.DEFENDING],
    [() => true, (ctx) => {
        if (!Transitions.punish(ctx)) return false;
        const r = (ctx.stats?.reaction ?? 50) / 100;
        const minR = AI.TRANSITION?.PUNISH_REACTION_MIN ?? 0.08;
        return r >= minR || ctx.oppStaggered || ctx.oppGettingUp || ctx.oppJustWhiffed;
    }, AI_STATE.PUNISHING],
    [() => true, (ctx) => Transitions.prepare(ctx), AI_STATE.PREPARING],
    [() => true, (ctx) => Transitions.bait(ctx), AI_STATE.BAITING],
    [() => true, (ctx) => Transitions.pressure(ctx), AI_STATE.PRESSURING],
    [() => true, (ctx) => Transitions.recharge(ctx), AI_STATE.RECHARGING],

    // COMBAT Transition with Hysteresis
    [(ctx) => ctx.canTransition, (ctx) => {
        const isCombat = ctx.fighter.aiState === AI_STATE.COMBAT;
        const lowBound = AI.COMBAT_ENTER; // 185
        const highBound = AI.COMBAT_EXIT;  // 260
        // Sticky logic: stay in combat until we hit the exit threshold
        if (isCombat) return ctx.dist < highBound;
        // Enter combat only when hitting the entry threshold
        if (ctx.dist < lowBound && !ctx.tired) return true;
        return false;
    }, AI_STATE.COMBAT],

    // APPROACHING Transition with Hysteresis
    [(ctx) => ctx.canTransition, (ctx) => {
        const isApproaching = ctx.fighter.aiState === AI_STATE.APPROACHING;
        const exitBound = AI.COMBAT_ENTER - 35;
        if (isApproaching) return ctx.dist > exitBound && !ctx.oppAttacking;
        return ctx.dist > AI.COMBAT_EXIT || ctx.far;
    }, AI_STATE.APPROACHING],
];
