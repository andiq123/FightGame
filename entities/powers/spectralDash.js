import { registerPower } from './registry.js';
import { PHYSICS } from '../../config/constants.js';
import { spawnSpectralTrail } from '../../services/particleSystem.js';

registerPower('spectralDash', {
    name: 'Spectral Dash',
    cooldown: 9000,
    tip: 'Dash through the opponent'
}, {
    score: ({ dist, stats, rng, opponent, projectiles, fighter, obstacles }) => {
        if (dist < 60) return 0; // Too close, just use melee

        // Environment Check: Ensure destination is safe
        const dir = fighter.x < opponent.x ? 1 : -1;
        const targetX = opponent.x + (dir * 120);

        // Bounds check
        if (Math.abs(targetX) > 900) return 0; // Don't dash out of arena

        // Obstacle check
        const hitWall = (obstacles || []).some(o =>
            targetX > o.x - o.width / 2 &&
            targetX < o.x + o.width / 2
        );
        if (hitWall) return 0; // Don't dash into a wall

        let s = 20;

        // 1. Reactive: Dodge incoming projectiles
        if (projectiles && projectiles.length > 0) {
            const incoming = projectiles.find(p => (p.x < fighter.x && p.vx > 0) || (p.x > fighter.x && p.vx < 0));
            if (incoming && Math.abs(incoming.x - fighter.x) < 200) {
                s += 80; // High priority dodge
            }
        }

        // 2. Punitive: Opponent is in recovery
        if (opponent.status.active('recovery', performance.now())) {
            s += 50;
        }

        // 3. Position: Dash through if pressing or cornered
        if (dist < 200 && dist > 60) {
            s += 30;
        }

        // 4. Escape: Cornered with no stamina
        if (fighter.x && Math.abs(fighter.x) > 900 && dist < 150) {
            s += 55; // Priority escape
        }

        const reaction = stats.reaction / 100;
        let finalScore = (s + rng() * 20) * (reaction + 0.5);

        // Archetype Bonus
        if (fighter.archetype === 'assassin') finalScore += 45;
        if (fighter.archetype === 'oracle') finalScore += 35;

        return finalScore;
    },
    execute: ({ fighter, opponent, world }) => {
        const startX = fighter.x;
        const startY = 810 - 45; // Center of figure

        // Spawn start trail
        if (world && world.particles) {
            spawnSpectralTrail(world.particles, startX, startY, Math.random);
        }

        const targetX = opponent.x + (fighter.x < opponent.x ? 120 : -120);

        // Pass through check: did we cross them?
        const crossed = (startX < opponent.x && targetX > opponent.x) || (startX > opponent.x && targetX < opponent.x);

        fighter.x = targetX;
        fighter.vx = 0;
        fighter.facing = fighter.x < opponent.x ? 1 : -1;

        fighter.status.set('invincible', performance.now() + 300);
        if (world) {
            world.skyFocus = { type: 'glitch', intensity: 1, expiry: performance.now() + 350 };
        }
        if (crossed) {
            fighter.status.set('phased', performance.now() + 3000);
        }

        // Final trail
        if (world && world.particles) {
            spawnSpectralTrail(world.particles, fighter.x, startY, Math.random);
        }

        return true;
    },
    spawnEffect: 'spectral'
});
