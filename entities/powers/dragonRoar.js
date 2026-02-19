import { registerPower } from './registry.js';
import { SKILL_DAMAGE } from '../../config/constants.js';
import { spawnDragonFire } from '../../services/particleSystem.js';

registerPower('dragonRoar', {
    name: 'Dragon Roar',
    cooldown: 25000,
    tip: 'Massive shockwave, high stun'
}, {
    score: ({ dist, stats, rng, opponent, fighter, hpCritical }) => {
        if (dist > 140) return 0; // Must be very close

        let s = 60;

        // 1. Counter: Punish their attack
        if (opponent.pose === 'attack') s += 60;

        // 2. Desperation: Low HP, go for broke
        if (hpCritical && dist <= 130) s += 50;

        // 3. Risk scaling
        const risk = stats.riskTolerance / 100;
        let finalScore = (s + rng() * 30) * (risk + 0.6);

        // Archetype Bonus
        if (fighter.archetype === 'golem') {
            finalScore += 50;
        }

        return finalScore;
    },
    execute: ({ fighter, opponent, world, hitEffects }) => {
        const dir = fighter.facing;
        const dist = Math.abs(fighter.x - opponent.x);

        if (dist < 180) {
            let dmg = SKILL_DAMAGE.DRAGON_ROAR || 75;

            // Combustion Synergy
            if (opponent.status.active('burning', performance.now())) {
                dmg *= 1.4;
                opponent.status.set('burning', performance.now() + 4000); // REFRESH
            }

            opponent.takeDamage(dmg, true, fighter.x, performance.now());
            if (!opponent.status.active('stagger', performance.now())) {
                opponent.status.set('stagger', performance.now() + 1500);
            }

            if (!opponent.status.active('burning', performance.now())) {
                opponent.status.set('burning', performance.now() + 4000);
            }
            const kb = (opponent.x < fighter.x ? -1 : 1) * 1200;
            opponent.vx = kb;

            hitEffects.push({
                x: opponent.x, y: 810 - 50, t: 0,
                dragon: true, radius: 50,
                ownerId: fighter.id
            });
        }

        if (world && world.particles) {
            spawnDragonFire(world.particles, fighter.x + dir * 30, 810 - 60, dir, Math.random);
            import('../../services/particleSystem.js').then(ps => {
                ps.spawnDecal(world.decals, opponent.x, 810 - 2, 'scorch', 1.2);
            });
        }

        world.screenShake = 25;

        return true;
    },
    spawnEffect: 'dragon'
});
