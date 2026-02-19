import { updatePhysics, GROUND_Y, ARENA_BOUNDS } from '../physics.js';
import { spawnLandingDust } from '../../services/particleSystem.js';
import { COMBAT_EXTRA, PHYSICS_EXTRA } from '../../config/constants.js';
import { updateRagdoll } from '../ragdoll.js';

/**
 * PhysicsSystem handles spatial integration, collisions, and movement.
 */
export class PhysicsSystem {
    update(world, dt, now, secureRandom) {
        const scaledDt = dt * world.gameSpeed;
        const fighters = [world.fighter1, world.fighter2];

        fighters.forEach(f => {
            if (!f) return;

            const prevVx = f.vx;
            const prevVy = f.vy;
            const wasOnGround = f.y >= -3;

            this.resolveObstacleCollision(f, world.obstacles, prevVx, now);

            if (f.staggerRagdoll) {
                updateRagdoll(f.staggerRagdoll, scaledDt, now, world.obstacles);
                const pelvis = f.staggerRagdoll.points[2];
                f.x = pelvis.x;
                f.y = pelvis.y - GROUND_Y;
                // Sync velocity for damage detection
                const safeDt = Math.max(0.001, scaledDt);
                f.vx = (pelvis.x - pelvis.prevX) / safeDt;
                f.vy = (pelvis.y - pelvis.prevY) / safeDt;
            } else {
                updatePhysics(f, scaledDt, now);
            }

            const isDistressed = f.status.active('stagger', now) || f.pose === 'hit' || f.pose === 'stagger' || f.staggerRagdoll;

            // Detect Wall Slam Damage
            const margin = 25; // Constant.js FIGHTER_MARGIN is 24
            const atLeftWall = f.x <= -ARENA_BOUNDS + margin;
            const atRightWall = f.x >= ARENA_BOUNDS - margin;
            if (isDistressed && ((atLeftWall && prevVx < -PHYSICS_EXTRA.IMPACT_DMG_THRESHOLD_WALL) ||
                (atRightWall && prevVx > PHYSICS_EXTRA.IMPACT_DMG_THRESHOLD_WALL))) {
                const impactCooldown = 300;
                if (now - (f.lastImpactAt || 0) > impactCooldown) {
                    const dmg = Math.floor(Math.abs(prevVx) * PHYSICS_EXTRA.IMPACT_DMG_MULT);
                    f.takeDamage(dmg, true, atLeftWall ? -ARENA_BOUNDS : ARENA_BOUNDS, now);
                    f.lastImpactAt = now;
                }
            }

            const justLanded = !wasOnGround && f.y >= -3;
            if (justLanded) {
                // Ground Impact Damage
                if (isDistressed && prevVy > PHYSICS_EXTRA.IMPACT_DMG_THRESHOLD_GROUND) {
                    const impactCooldown = 300;
                    if (now - (f.lastImpactAt || 0) > impactCooldown) {
                        const dmg = Math.floor(prevVy * PHYSICS_EXTRA.IMPACT_DMG_MULT);
                        f.takeDamage(dmg, true, f.x, now);
                        f.lastImpactAt = now;
                    }
                }

                if (prevVy > 100) {
                    spawnLandingDust(world.particles, f.x, GROUND_Y, prevVy, secureRandom);
                    if (prevVy > 350) world.screenShake = Math.min(15, world.screenShake + (prevVy / 80));
                }
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

    resolveObstacleCollision(f, obstacles, prevVx, now) {
        if (!obstacles || obstacles.length === 0) return;
        obstacles.forEach(o => {
            const dx = f.x - o.x;
            const halfW = o.width / 2;
            const margin = 20;
            if (Math.abs(dx) < halfW + margin) {
                const isDistressed = f.status.active('stagger', now) || f.pose === 'hit' || f.pose === 'stagger' || f.staggerRagdoll;
                // Impact Damage for slamming into obstacles
                if (isDistressed && Math.abs(prevVx) > PHYSICS_EXTRA.IMPACT_DMG_THRESHOLD_WALL) {
                    const impactCooldown = 300;
                    if (now - (f.lastImpactAt || 0) > impactCooldown) {
                        const dmg = Math.floor(Math.abs(prevVx) * PHYSICS_EXTRA.IMPACT_DMG_MULT);
                        f.takeDamage(dmg, true, o.x, now);
                        f.lastImpactAt = now;
                    }
                }

                // Push fighter out
                if (f.x < o.x) f.x = o.x - halfW - margin;
                else f.x = o.x + halfW + margin;
                f.vx = 0;
            }
        });
    }
}
