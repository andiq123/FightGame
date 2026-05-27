import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';

registerPower('iceSpikes', {
    name: 'Ice Spikes',
    cooldown: 10000,
    staminaCost: 30,
    tip: 'Trail of ice pillars that hits low'
}, {
    score: ({ eyeDist, dist, stats, rng, opponent, fighter, oppHpCritical, hpLow }) => {
        if (eyeDist < 85 || eyeDist > 360) return 0;

        let s = 45;

        // 1. Grounded opponent = full hit potential
        if (opponent.y >= -20) s += 45;

        // 2. Freeze-to-finish: set up a combo when opponent is near death
        if (oppHpCritical) s += 55;

        // 3. Opponent charging in fast — freeze them mid-rush
        const rushingIn = (fighter.x < opponent.x && opponent.vx < -90) ||
            (fighter.x > opponent.x && opponent.vx > 90);
        if (rushingIn && eyeDist < 300) s += 50;

        // 4. AI is defensive/low: buy distance with a freeze
        if (hpLow && eyeDist > 130) s += 30;

        if (eyeDist >= 110 && eyeDist <= 280) s += 25;
        if (opponent.status.active('block', performance.now()) || opponent.status.active('blockLow', performance.now())) s += 18;

        // 5. Don't double-freeze an already frozen opponent
        if (opponent.status.active('frozen', performance.now())) return 0;

        const reaction = stats.reaction / 100;
        let finalScore = (s + rng() * 30) * (reaction + 0.4);

        if (fighter.archetype === 'vanguard') finalScore += 50;

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
