import { executeAI, sustainAIMoveIntent } from '../../ai/behavior.js';
import { getAIStats } from '../../ai/presets.js';
import { AI } from '../../config/constants.js';

/**
 * AISystem handles periodic AI decision making.
 */
export class AISystem {
    constructor() {
        this.aiTicks = [0, 0];
    }

    update(world, dt, now, secureRandom, skillFeed, spawnEffects, getSpawnEffect) {
        const scaledDt = dt * world.gameSpeed;
        const fighters = [world.fighter1, world.fighter2];
        // Each fighter owns its 1–20 intelligence level (see config/stats.js).
        const aiStats = fighters.map(f => getAIStats(f?.intelligence));

        [0, 1].forEach(i => {
            const fighter = fighters[i];
            if (!fighter) return;
            sustainAIMoveIntent(fighter, now, scaledDt);

            if (i === 1 && !fighter.archetype) fighter.archetype = 'monster';

            this.aiTicks[i] += scaledDt;
            // Smarter fighters re-decide sooner — reaction time is the core skill gap.
            const reactTime = (aiStats[i].reactionIntervalMs ?? AI.DECISION_INTERVAL_MS ?? 185) / 1000;

            if (this.aiTicks[i] >= reactTime && !fighter.status.active('stagger', now)) {
                this.aiTicks[i] = 0;
                const opponent = fighters[1 - i];

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
