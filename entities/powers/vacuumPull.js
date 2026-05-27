import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('vacuumPull', {
    name: 'Vacuum Pull',
    cooldown: 14000,
    staminaCost: 32,
    tip: 'Pulls the opponent towards you'
}, {
    score: ({ dist, stats, rng, opponent, fighter, oppCornered, oppBlocking, oppHpCritical, hpCritical }) => {
        if (dist < 130 || dist > 580) return 0;

        let s = 35;

        // 1. Pressure: Pull them into melee when chasing
        if (fighter.aiState === 'pressuring') s += 45;

        // 2. Corner trap: pull them deeper into the corner they're stuck in
        if (oppCornered && dist > 150) s += 60;

        // 3. Block-breaker: yank them out of their guard and follow up
        if (oppBlocking && dist > 150) s += 50;

        // 4. Finisher pull: drag them in range for a killing blow
        if (oppHpCritical && dist > 150) s += 55;

        // 5. Anti-Air: Catch them while airborne
        if (opponent.y < -40) s += 55;

        // 6. Don't waste it if AI is critically hurt (need to escape not engage)
        if (hpCritical) s -= 40;

        const aggression = stats.aggression / 100;
        let finalScore = (s + rng() * 20) * (aggression + 0.5);

        if (fighter.archetype === 'assassin' || fighter.archetype === 'oracle') finalScore += 40;

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
        if (!opponent.status.active('stagger', performance.now())) {
            opponent.status.set('stagger', performance.now() + 400); // Small stun
        }

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
