import { registerPower } from './registry.js';
import { SKILL_DAMAGE, FIGHTER } from '../../config/constants.js';

registerPower('earthWall', {
    name: 'Earth Wall',
    cooldown: 18000,
    tip: 'Creates a physical barrier that blocks movement'
}, {
    score: ({ dist, fighter, stats, rng, opponent, inboundThreat, hpLow, hpCritical, oppCornered, staminaRatio }) => {
        if (dist < 90) return 0; // Not useful in melee

        const hpRatio = fighter.hp / fighter.maxHp;
        let s = 25;

        // 1. Emergency cover when critically hurt
        if (hpCritical) s += 80;
        else if (hpLow) s += 50;
        else if (hpRatio < 0.5) s += 30;

        // 2. Counter ranged attacks: block incoming projectiles
        if (inboundThreat) s += 65;

        // 3. Stamina recovery: sit behind a wall to regen
        if ((staminaRatio ?? fighter.stamina / fighter.maxStamina) < 0.35) s += 45;

        // 4. Trap: wall behind cornered opponent to deny escape
        if (oppCornered && dist > 120 && dist < 350) s += 50;

        // 5. Opponent approaching fast: cut them off
        const isRushing = (fighter.x < opponent.x && opponent.vx < -80) ||
            (fighter.x > opponent.x && opponent.vx > 80);
        if (isRushing && dist > 100) s += 40;

        const defense = stats.defense / 100;
        let finalScore = (s + rng() * 25) * (defense + 0.5);

        if (fighter.archetype === 'golem' || fighter.archetype === 'vanguard') finalScore += 40;

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
