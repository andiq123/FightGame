import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('iceSpikes', {
    name: 'Ice Spikes',
    cooldown: 10000,
    tip: 'Trail of ice pillars that hits low'
}, {
    score: ({ dist, stats, rng, opponent, fighter }) => {
        if (dist < 100 || dist > 400) return 0;

        let s = 50;

        // 1. Low Check: Punish grounded opponents
        if (opponent.y >= -20) s += 40;

        // 2. Intelligence check
        const reaction = stats.reaction / 100;
        let finalScore = (s + rng() * 30) * (reaction + 0.4);

        // Archetype Bonus
        if (fighter.archetype === 'vanguard') {
            finalScore += 50;
        }

        return finalScore;
    },
    execute: ({ fighter, opponent, hitEffects }) => {
        const dir = fighter.facing;
        const startX = fighter.x + dir * 60;
        const now = performance.now();

        // Environment decal for the start of the ice path
        if (fighter.world) {
            import('../../services/particleSystem.js').then(ps => {
                ps.spawnDecal(fighter.world.decals, startX, 810 - 2, 'frost', 0.8);
            });
        }

        // Immediate logic for simulation stability
        for (let i = 0; i < 5; i++) {
            const px = startX + dir * i * 60;
            const distToOpp = Math.abs(px - opponent.x);

            // Visual effect
            hitEffects.push({
                x: px, y: 810 - 20, t: -(i * 0.08), // Delay the VISUAL start
                ice: true, radius: 40,
                ownerId: fighter.id,
                high: false
            });

            // Damage logic (immediate or slightly windowed is better than setTimeout)
            if (distToOpp < 50 && opponent.y >= -30) {
                const dmg = (SKILL_DAMAGE.ICE_SPIKES || 32) / 5;
                opponent.takeDamage(dmg, false, fighter.x, now);
                opponent.vx += dir * 150; // Small push
                opponent.status.set('frozen', now + 3000); // 3 seconds freeze
                opponent.status.set('deepFreeze', now + 2000); // 2 seconds deep freeze (breaks on hit)
            }
        }

        return true;
    },
    spawnEffect: 'ice'
});
