import { executeAI, sustainAIMoveIntent } from '../../ai/behavior.js';
import { getAIStats } from '../../ai/presets.js';
import { AIStrategy } from '../../ai/strategy.js';
import { AI } from '../../config/constants.js';

/**
 * AISystem handles periodic AI decision making.
 */
export class AISystem {
    constructor() {
        this.aiTicks = [0, 0];
    }

    update(world, dt, now, secureRandom, intelligence1, monsterIntelligence, skillFeed, spawnEffects, getSpawnEffect) {
        const scaledDt = dt * world.gameSpeed;
        const fighters = [world.fighter1, world.fighter2];
        const aiStats = [getAIStats(intelligence1), getAIStats(monsterIntelligence)];

        [0, 1].forEach(i => {
            const fighter = fighters[i];
            if (!fighter) return;
            sustainAIMoveIntent(fighter, now, scaledDt);

            // Ensure archetype is known for AI scoring
            if (i === 1 && monsterIntelligence && !fighter.archetype) {
                // This is the monster slot
                fighter.archetype = monsterIntelligence.id || 'monster';
            }

            this.aiTicks[i] += scaledDt;
            const reactTime = (AI.DECISION_INTERVAL_MS ?? 185) / 1000;

            if (this.aiTicks[i] >= reactTime && !fighter.status.active('stagger', now)) {
                this.aiTicks[i] = 0;
                const opponent = fighters[1 - i];

                // Strategy Update
                if (!fighter.aiStrategy) {
                    fighter.aiStrategy = new AIStrategy(fighter.id, aiStats[i].reaction);
                }

                let strategyData = null;
                if (fighter.aiStrategy) {
                    // Update strategy based on temporary context (lightweight)
                    // Simple vision check: center-to-center ray
                    let canSee = true;
                    if (world.obstacles && world.obstacles.length > 0) {
                        const minX = Math.min(fighter.x, opponent.x);
                        const maxX = Math.max(fighter.x, opponent.x);
                        const centerY = (fighter.y + opponent.y) / 2 - 40; // Approx chest height
                        canSee = !world.obstacles.some(o =>
                            o.x > minX && o.x < maxX &&
                            centerY > o.y - o.height / 2 && centerY < o.y + o.height / 2
                        );
                    }

                    const tempCtx = {
                        now: now,
                        hpLead: (fighter.hp / fighter.maxHp) - (opponent.hp / opponent.maxHp),
                        dist: Math.abs(fighter.x - opponent.x),
                        cornered: Math.abs(fighter.x) > 800,
                        oppCornered: Math.abs(opponent.x) > 800,
                        oppJustWhiffed: (opponent.lastWhiffAt || 0) > 0 && now - opponent.lastWhiffAt < 400,
                        oppJustGotHit: (opponent.lastHitAt || 0) > 0 && now - opponent.lastHitAt < 600,
                        hitALot: (fighter.hitsTakenLast5Sec || 0) >= 3,
                        canSeeOpponent: canSee,
                        staminaRatio: fighter.stamina / (fighter.maxStamina || 1),
                        staminaLow: fighter.stamina / (fighter.maxStamina || 1) <= (AI.STAMINA_LOW_RATIO ?? 0.3),
                        staminaCritical: fighter.stamina / (fighter.maxStamina || 1) <= (AI.STAMINA_CRITICAL_RATIO ?? 0.16)
                    };
                    strategyData = fighter.aiStrategy.update(tempCtx, scaledDt);
                    fighter.aiCombatMode = strategyData.strategy; // Sync to fighter state
                }

                const act = executeAI(
                    fighter, opponent, aiStats[i], now, secureRandom,
                    world.hitEffects, world.projectiles, world.clones, world
                );

                if (act?.type === 'power' && act.powerId) {
                    this.handleAISkill(i, act.powerId, now, skillFeed, fighter, spawnEffects, getSpawnEffect);
                }
            }
        });
    }

    handleAISkill(fighterId, powerId, now, skillFeed, fighter, spawnEffects, getSpawnEffect) {
        fighter.lastGlobalSkillAt = now; // Trigger Global Skill Cooldown
        skillFeed.unshift({ fighterId, powerId, at: now });
        if (skillFeed.length > 4) skillFeed.pop();

        if (spawnEffects && getSpawnEffect) {
            const spawnKey = getSpawnEffect(powerId);
            if (spawnEffects[spawnKey]) spawnEffects[spawnKey](fighter);
        }
    }
}
