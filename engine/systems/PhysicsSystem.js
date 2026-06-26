import { updatePhysics, GROUND_Y, ARENA_BOUNDS } from '../physics.js';
import { spawnLandingDust } from '../../services/particleSystem.js';
import { updateRagdoll, commitRagdollLaunch } from '../ragdoll.js';
import { COMBAT, COMBAT_EXTRA, PHYSICS_EXTRA } from '../../config/constants.js';

function markMovementBlocked(fighter, dir, now, reason) {
    if (!dir) return;
    fighter.blockedMove = { dir, until: now + 520, reason };
    if (fighter.aiMoveIntent?.dir === dir) fighter.aiMoveIntent = null;
    fighter.status?.clear?.('aiState');
    fighter.aiStateUntil = Math.min(fighter.aiStateUntil || now, now);
}

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
            const wasOnGround = f.y >= (f.groundY || 0) - 3;

            this.resolveObstacleCollision(f, world.obstacles, prevVx, now);

            commitRagdollLaunch(f, now, COMBAT.STAGGER_DURATION_MS);
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

            const isDistressed = f.status.active('stagger', now) || f.pose === 'hit' || f.pose === 'stagger' || f.staggerRagdoll || f._ragdollLaunch;

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

            const justLanded = !wasOnGround && f.y >= (f.groundY || 0) - 3;
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
        // Also resolves the fighter's standing surface (f.groundY): the floor (0)
        // unless they're on top of a standable obstacle.
        let groundY = 0;
        if (obstacles && obstacles.length) {
            obstacles.forEach(o => {
                const halfW = o.width / 2;
                const top = -(o.height || 0);
                const overX = Math.abs(f.x - o.x) < halfW + 20;

                if (o.standable) {
                    // Standable box: stand on top when over the footprint and at/above the top.
                    if (Math.abs(f.x - o.x) < halfW - 2 && (f.y || 0) <= top + 6) {
                        groundY = Math.min(groundY, top);
                    }
                    // Block the sides only when the body is below the top (beside the box).
                    if (overX && (f.y || 0) > top + 8) this.pushOut(f, o, halfW, prevVx, now);
                } else {
                    // Tall cover (pillar / earth wall): pass over when airborne (feet 25px+ up).
                    if (overX && (f.y || 0) > -25) this.pushOut(f, o, halfW, prevVx, now);
                }
            });
        }
        f.groundY = groundY;
    }

    pushOut(f, o, halfW, prevVx, now) {
        const margin = 20;
        const isDistressed = f.status.active('stagger', now) || f.pose === 'hit' || f.pose === 'stagger' || f.staggerRagdoll || f._ragdollLaunch;
        if (isDistressed && Math.abs(prevVx) > PHYSICS_EXTRA.IMPACT_DMG_THRESHOLD_WALL && now - (f.lastImpactAt || 0) > 300) {
            const dmg = Math.floor(Math.abs(prevVx) * PHYSICS_EXTRA.IMPACT_DMG_MULT);
            f.takeDamage(dmg, true, o.x, now);
            f.lastImpactAt = now;
        }
        if (f.x < o.x) {
            f.x = o.x - halfW - margin;
            if (prevVx > 0 || f.aiMoveIntent?.dir === 1) markMovementBlocked(f, 1, now, 'obstacle');
        } else {
            f.x = o.x + halfW + margin;
            if (prevVx < 0 || f.aiMoveIntent?.dir === -1) markMovementBlocked(f, -1, now, 'obstacle');
        }
        f.vx = 0;
    }
}
