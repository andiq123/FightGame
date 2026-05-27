import { AI } from '../config/constants.js';

export const STRATEGY = {
    NEUTRAL: 'neutral',
    RUSH_DOWN: 'rushDown',
    ZONING: 'zoning',
    TURTLE: 'turtle',
    CORNER_TRAP: 'cornerTrap',
    BAIT_AND_PUNISH: 'baitAndPunish',
    DISRESPECT: 'disrespect' // Taunt/Style on them
};

const PERSONAS = {
    BALANCED: {
        name: 'Balanced',
        baseAggression: 0.5,
        riskTolerance: 0.5,
        preferredRange: [80, 180],
        strategies: [STRATEGY.NEUTRAL, STRATEGY.RUSH_DOWN, STRATEGY.ZONING]
    },
    AGGRESSIVE: {
        name: 'Aggressive',
        baseAggression: 0.8,
        riskTolerance: 0.8,
        preferredRange: [40, 100],
        strategies: [STRATEGY.RUSH_DOWN, STRATEGY.CORNER_TRAP, STRATEGY.DISRESPECT]
    },
    DEFENSIVE: {
        name: 'Defensive',
        baseAggression: 0.2,
        riskTolerance: 0.2,
        preferredRange: [150, 350],
        strategies: [STRATEGY.ZONING, STRATEGY.TURTLE, STRATEGY.BAIT_AND_PUNISH]
    },
    TRICKSTER: {
        name: 'Trickster',
        baseAggression: 0.6,
        riskTolerance: 0.6,
        preferredRange: [100, 250],
        strategies: [STRATEGY.BAIT_AND_PUNISH, STRATEGY.CORNER_TRAP, STRATEGY.ZONING]
    }
};

export class AIStrategy {
    constructor(fighterId, intelligence) {
        this.fighterId = fighterId;
        this.intelligence = intelligence; // 0-100
        this.persona = this.selectPersona(intelligence);
        this.currentStrategy = STRATEGY.NEUTRAL;
        this.strategyTimer = 0;
        this.adaptation = {}; // Track opponent habits: { 'jumpIn': 0.5, 'wakeUpDP': 0.2 }
        this.mood = {
            confidence: 0.5,
            frustration: 0,
            respect: 0.5
        };
    }

    selectPersona(intelligence) {
        if (intelligence > 85) return PERSONAS.TRICKSTER;
        if (intelligence > 60) return PERSONAS.BALANCED;
        return PERSONAS.BALANCED;
    }

    update(ctx, dt) {
        this.strategyTimer -= dt * 1000;

        // Assess Situation
        this.updateMood(ctx);
        this.analyzeOpponent(ctx);

        if (this.strategyTimer <= 0 || this.shouldForceStrategyChange(ctx)) {
            this.pickStrategy(ctx);
            this.strategyTimer = 4500 + Math.random() * 2500;
        }

        return {
            strategy: this.currentStrategy,
            mood: this.mood,
            targetRange: this.getTargetRange()
        };
    }

    updateMood(ctx) {
        const { hpLead, oppJustWhiffed, oppJustGotHit, hitALot } = ctx;

        // Confidence tracks pushing the advantage
        if (hpLead > 0.2) this.mood.confidence += 0.01;
        else if (hpLead < -0.2) this.mood.confidence -= 0.01;

        if (oppJustGotHit) this.mood.confidence += 0.05;
        if (hitALot) {
            this.mood.confidence -= 0.1;
            this.mood.frustration += 0.1;
        }

        this.mood.confidence = Math.max(0, Math.min(1, this.mood.confidence));
        this.mood.frustration = Math.max(0, Math.min(1, this.mood.frustration));
    }

    analyzeOpponent(ctx) {
        // Simplified habit tracking
        if (ctx.oppJustWhiffed) {
            this.adaptation.whiffs = (this.adaptation.whiffs || 0) + 1;
        }
        // TODO: More complex analysis (jump tendency, block tendency)
    }

    shouldForceStrategyChange(ctx) {
        // Immediate overrides
        if (ctx.cornered && ctx.dist < 140 && this.currentStrategy !== STRATEGY.TURTLE && this.currentStrategy !== STRATEGY.RUSH_DOWN) return true;
        if (ctx.oppCornered && this.currentStrategy !== STRATEGY.CORNER_TRAP) return true;
        return false;
    }

    pickStrategy(ctx) {
        const { dist, hpLead, canSeeOpponent, oppCornered } = ctx;

        if (oppCornered && this.mood.confidence > 0.4) {
            this.currentStrategy = STRATEGY.CORNER_TRAP;
            return;
        }

        if (hpLead < -0.3 && this.mood.confidence < 0.35) {
            this.currentStrategy = STRATEGY.TURTLE;
            return;
        }

        if (!canSeeOpponent) {
            this.currentStrategy = STRATEGY.ZONING;
            return;
        }

        if (dist > 260) {
            this.currentStrategy = this.intelligence > 65 ? STRATEGY.ZONING : STRATEGY.NEUTRAL;
            return;
        }

        if (dist < 95 && this.mood.confidence > 0.45) {
            this.currentStrategy = STRATEGY.RUSH_DOWN;
            return;
        }

        this.currentStrategy = STRATEGY.NEUTRAL;
    }

    getTargetRange() {
        // Dynamic range based on strategy
        switch (this.currentStrategy) {
            case STRATEGY.RUSH_DOWN: return [null, 60]; // Get IN
            case STRATEGY.CORNER_TRAP: return [100, 160]; // Stay just outside wake-up range
            case STRATEGY.ZONING: return [250, 500];
            case STRATEGY.TURTLE: return [100, 200];
            default: return this.persona.preferredRange;
        }
    }
}
