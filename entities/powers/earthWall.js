import { registerPower } from './registry.js';
import { SKILL_DAMAGE, FIGHTER } from '../../config/constants.js';

registerPower('earthWall', {
    name: 'Earth Wall',
    cooldown: 18000,
    tip: 'Creates a physical barrier that blocks movement'
}, {
    score: ({ dist, fighter, stats, rng, opponent, inboundThreat }) => {
        if (dist < 120) return 0; // Too risky very close

        let s = 30;

        // 1. Defensive: Low health needs cover
        const hpRatio = fighter.hp / fighter.maxHp;
        if (hpRatio < 0.3) s += 60;

        // 2. Tactical: Opponent is aggressive and at distance
        if (opponent.vx !== 0 && dist > 300) s += 40;

        // 3. Stamina Management: Gather stamina behind cover
        const staminaRatio = fighter.stamina / fighter.maxStamina;
        if (staminaRatio < 0.4) s += 50;

        // 4. Counter ranged attacks
        if (inboundThreat) s += 55;

        // 5. Intelligence scaling
        const defense = stats.defense / 100;
        let finalScore = (s + rng() * 25) * (defense + 0.5);

        // Archetype Bonus
        if (fighter.archetype === 'golem' || fighter.archetype === 'vanguard') {
            finalScore += 40;
        }

        return finalScore;
    },
    execute: ({ fighter, opponent, world }) => {
        const dir = fighter.facing;
        const wallX = fighter.x + dir * 85;

        world.addObstacle({
            x: wallX,
            y: 0,
            width: 60,
            height: 120,
            life: 6,
            type: 'earth',
            ownerId: fighter.id
        });

        return true;
    },
    spawnEffect: 'earth'
});
