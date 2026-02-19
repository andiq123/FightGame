import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('vacuumPull', {
    name: 'Vacuum Pull',
    cooldown: 14000,
    tip: 'Pulls the opponent towards you'
}, {
    score: ({ dist, stats, rng, opponent, fighter }) => {
        if (dist < 150 || dist > 550) return 0;

        let s = 40;

        // 1. Pressure: Pull them back into melee range
        if (fighter.aiState === 'PRESSURING') s += 40;

        // 2. Anti-Air: Catch them while jumping
        if (opponent.y < -40) s += 50;

        const aggression = stats.aggression / 100;
        let finalScore = (s + rng() * 20) * (aggression + 0.5);

        // Archetype Bonus
        if (fighter.archetype === 'assassin' || fighter.archetype === 'oracle') {
            finalScore += 40;
        }

        return finalScore;
    },
    execute: ({ fighter, opponent, world, hitEffects }) => {
        const dx = fighter.x - opponent.x;
        const dist = Math.abs(dx);
        const dir = dx > 0 ? 1 : -1;

        if (world) {
            world.skyFocus = { type: 'vacuum', intensity: 1, expiry: performance.now() + 600 };
        }

        opponent.vx += dir * 800; // Strong pull
        opponent.status.set('stagger', performance.now() + 400); // Small stun

        if (dist < 150) {
            opponent.status.set('anchored', performance.now() + 1500);
        }

        if (hitEffects) {
            hitEffects.push({
                x: fighter.x, y: 810 - 50, t: 0,
                vacuum: true, radius: 60,
                ownerId: fighter.id
            });
        }

        return true;
    },
    spawnEffect: 'vacuum'
});
