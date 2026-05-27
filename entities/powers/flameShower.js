import { registerPower } from './registry.js';
import { SKILL_DAMAGE, ARENA } from '../../config/constants.js';

registerPower('flameShower', {
    name: 'Flame Shower',
    cooldown: 25000,
    staminaCost: 58,
    tip: 'Ultimate: Rain fire from the heavens. High knockback force.'
}, {
    score: ({ dist, fighter, opponent, stats, rng, oppBlockingALot, oppCornered, oppHpCritical, hpLow }) => {
        // Relaxed stamina gate — this is a strategic ultimate, not a stamina burner
        if (fighter.stamina < 30) return 0;

        // Don't waste it if opponent is already near-dead and we can melee-finish
        if (oppHpCritical && dist < 120) return 5;

        const intelligence = stats.reaction / 100;
        const aggression = stats.aggression / 100;

        let s = 35 + aggression * 30 + intelligence * 25;

        // Zone control at range
        if (dist > 250) s += 45;
        if (dist > 150 && dist <= 250) s += 25;

        // Break turtles: shower bypasses blocks
        if (oppBlockingALot) s += 50;

        // Corner zone denial: rain fire over a cornered opponent
        if (oppCornered) s += 40;

        // Punish recovery
        if (opponent.status.active('stagger', performance.now())) s += 35;

        // AI is losing but has range — use ultimate to reset momentum
        if (hpLow && dist > 200) s += 35;

        return s + rng() * 20;
    },
    execute: ({ fighter, opponent, projectiles, world }) => {
        const now = performance.now();
        const count = 10 + Math.floor(Math.random() * 5); // 10-14 fireballs

        // Spawn fireballs at intervals to create a "shower" feel
        for (let i = 0; i < count; i++) {
            // Staggered timing could be done here, but usually execute is for one frame.
            // However, we can just push them all with slightly different Y or different VY.
            // Or better: slightly offset Y positions so they don't all land at once.
            const spread = opponent.status.active('stagger', now) || opponent.status.active('recovery', now) ? 260 : 520;
            const center = Math.max(-ARENA.BOUNDS + 120, Math.min(ARENA.BOUNDS - 120, opponent.x));
            const xPos = Math.max(-ARENA.BOUNDS + 60, Math.min(ARENA.BOUNDS - 60, center + (Math.random() - 0.5) * spread));
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
