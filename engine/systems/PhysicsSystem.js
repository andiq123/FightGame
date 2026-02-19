import { updatePhysics, GROUND_Y, ARENA_BOUNDS } from '../physics.js';
import { spawnLandingDust } from '../../services/particleSystem.js';
import { COMBAT_EXTRA } from '../../config/constants.js';

/**
 * PhysicsSystem handles spatial integration, collisions, and movement.
 */
export class PhysicsSystem {
    update(world, dt, now, secureRandom) {
        const scaledDt = dt * world.gameSpeed;
        const fighters = [world.fighter1, world.fighter2];

        fighters.forEach(f => {
            if (!f) return;

            this.resolveObstacleCollision(f, world.obstacles);

            const wasOnGround = f.y >= -3;

            if (!f.status.active('stagger', now)) {
                updatePhysics(f, scaledDt, now);
            }

            const justLanded = !wasOnGround && f.y >= -3;
            if (justLanded && f.vy > 100) {
                spawnLandingDust(world.particles, f.x, GROUND_Y, f.vy, secureRandom);
                if (f.vy > 350) world.screenShake = Math.min(15, world.screenShake + (f.vy / 80));
            }

            // Keep in bounds
            f.x = Math.max(-ARENA_BOUNDS, Math.min(ARENA_BOUNDS, f.x));
        });

        // Fighter-to-Fighter Push
        this.resolveFighterCollision(world.fighter1, world.fighter2);

        // Tick Obstacles
        world.obstacles = world.obstacles.filter(o => {
            o.life -= scaledDt;
            return o.life > 0;
        });
    }

    resolveFighterCollision(f1, f2) {
        if (!f1 || !f2) return;
        const dist = Math.abs(f1.x - f2.x);
        if (dist < COMBAT_EXTRA.FIGHTER_OVERLAP_DIST) {
            const push = (f1.x < f2.x ? -1 : 1) * COMBAT_EXTRA.FIGHTER_OVERLAP_PUSH;
            f1.vx += push;
            f2.vx -= push;
        }
    }

    resolveObstacleCollision(f, obstacles) {
        if (!obstacles || obstacles.length === 0) return;
        obstacles.forEach(o => {
            const dx = f.x - o.x;
            const halfW = o.width / 2;
            if (Math.abs(dx) < halfW + 20) { // 20 is fighter radius approx
                // Push fighter out
                if (f.x < o.x) f.x = o.x - halfW - 20;
                else f.x = o.x + halfW + 20;
                f.vx = 0;
            }
        });
    }
}
