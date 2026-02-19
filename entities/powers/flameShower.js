import { registerPower } from './registry.js';
import { SKILL_DAMAGE, ARENA } from '../../config/constants.js';

registerPower('flameShower', {
    name: 'Flame Shower',
    cooldown: 25000,
    tip: 'Ultimate: Rain fire from the heavens. High knockback force.'
}, {
    score: ({ dist, fighter, opponent, stats, rng }) => {
        // Only use if healthy and has stamina
        if (fighter.stamina < 60) return 0;

        // High intelligence bosses use this more strategically
        const intelligence = stats.reaction / 100;
        const aggression = stats.aggression / 100;

        // Good for pressure at any range, but favor mid-long
        let s = 40 + aggression * 30 + (intelligence * 20);

        if (dist > 300) s += 40;
        if (opponent.status.active('stagger', performance.now())) s += 30; // Punish recovery

        // Cooldown is long, so don't waste it if opponent is already low and we can finish with melee
        if (opponent.hp < 50 && dist < 100) s -= 40;

        return s;
    },
    execute: ({ fighter, opponent, projectiles, world }) => {
        const now = performance.now();
        const count = 10 + Math.floor(Math.random() * 5); // 10-14 fireballs

        // Spawn fireballs at intervals to create a "shower" feel
        for (let i = 0; i < count; i++) {
            // Staggered timing could be done here, but usually execute is for one frame.
            // However, we can just push them all with slightly different Y or different VY.
            // Or better: slightly offset Y positions so they don't all land at once.
            const xPos = (Math.random() - 0.5) * (ARENA.BOUNDS * 1.8);
            const yOffset = - (i * 120); // Each one starts higher than the last

            projectiles.push({
                x: xPos,
                y: -700 + yOffset,
                vx: (Math.random() - 0.5) * 120, // Slightly more diagonal drift for clearer push direction
                vy: 450 + Math.random() * 150,
                damage: 15,
                stun: 80, // Minimal stun for hit reaction
                knockback: 180, // High knockback to "push away"
                heavy: true,
                high: true,
                ownerId: fighter.id,
                type: 'fireball',
                createdAt: now
            });
        }

        // Add Burning Sky Effect
        if (world) {
            world.skyFocus = {
                type: 'fire',
                intensity: 1,
                expiry: now + 4200
            };
            // Spawning a cluster of scorch marks for the shower
            import('../../services/particleSystem.js').then(ps => {
                for (let i = 0; i < 3; i++) {
                    ps.spawnDecal(world.decals, (Math.random() - 0.5) * 600, 810 - 2, 'scorch', 0.8 + Math.random() * 0.5);
                }
            });
        }

        return true;
    },
    spawnEffect: 'fireball'
});
