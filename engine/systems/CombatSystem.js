import { resolveCombat, decayCombos, checkCloneHit } from '../combat.js';
import { tickProjectiles, processProjectileHits } from '../projectileSystem.js';
import { spawnCloneDissolve, spawnHitParticles } from '../../services/particleSystem.js';
import { getCloneDissolveY, getHitEffectY } from '../../core/coordinates.js';
import { CLONE, RENDER } from '../../config/constants.js';
import { createHitEffect } from '../../core/hitEffectFactory.js';
import { POSE } from '../../entities/fighter.js';

/**
 * CombatSystem orchestrates all battle-related logic.
 */
export class CombatSystem {
    update(world, dt, now, secureRandom) {
        if (!world.fighter1 || !world.fighter2) return;

        // 1. Decay combos
        decayCombos(world.fighter1, world.fighter2, now);

        // 2. Clone Interactions
        const hb1 = world.fighter1.getAttackHitbox(now);
        const hb2 = world.fighter2.getAttackHitbox(now);

        const cloneHitByF1 = checkCloneHit(world.fighter1, world.clones, 1, now);
        const cloneHitByF2 = checkCloneHit(world.fighter2, world.clones, 0, now);

        // A clone is a decoy — any clean melee hit pops it instantly.
        if (cloneHitByF1) {
            spawnCloneDissolve(world.particles, cloneHitByF1.x, getCloneDissolveY(), secureRandom);
            world.clones = world.clones.filter(c => c !== cloneHitByF1);
        }
        if (cloneHitByF2) {
            spawnCloneDissolve(world.particles, cloneHitByF2.x, getCloneDissolveY(), secureRandom);
            world.clones = world.clones.filter(c => c !== cloneHitByF2);
        }

        // 3. Resolve Main Combat
        resolveCombat(world.fighter1, world.fighter2, now, world.hitEffects, cloneHitByF1, cloneHitByF2, world.obstacles);

        // 4. Projectile Processing
        tickProjectiles(world.projectiles, dt * world.gameSpeed);
        const projResult = processProjectileHits(
            world.projectiles, world.fighter1, world.fighter2, world.clones,
            world.hitEffects, world.particles, now, dt * world.gameSpeed, secureRandom, world.obstacles
        );
        world.projectiles = projResult.projectiles;
        world.clones = world.clones.filter(c => !projResult.hitClones.has(c));

        // 5. Clone Behavior Update
        this.updateClones(world, dt, now, secureRandom);

        // 6. Post-combat screenshake & effects
        this.processHitEffects(world, secureRandom);
    }

    updateClones(world, dt, now, secureRandom) {
        const scaledDt = dt * world.gameSpeed;

        world.clones = world.clones.filter(c => {
            if (c.removed || (c.dissolveAt != null && now >= c.dissolveAt)) {
                this.finishCloneDissolve(c, world, secureRandom);
                return false;
            }

            const targetInfo = this.getCloneTarget(c, world);
            const target = targetInfo.entity;
            const targetX = target.x;
            c.targetKind = targetInfo.type;
            c.facing = c.x < targetX ? 1 : -1;
            const dist = Math.abs(c.x - targetX) || 0.01;

            // 1. Tactical Teleport
            if (targetInfo.type === 'fighter' && dist > CLONE.TELEPORT_DIST && now - (c.lastTeleportAt || 0) > CLONE.TELEPORT_COOLDOWN_MS) {
                c.x = targetX - (c.facing * CLONE.TELEPORT_OFFSET); // Flank-warp
                c.lastTeleportAt = now;
                c.attackWindupAt = 0; // Immediate reset
            }

            const windupActive = c.attackWindupAt && now - c.attackWindupAt < CLONE.WINDUP_MS;
            const chaseSpeed = dist < 200 ? CLONE.CHASE_SPEED_FAST : CLONE.CHASE_SPEED;

            c.vx = windupActive ? 0 : (targetX - c.x) / dist * chaseSpeed;
            c.vx = Math.max(-600, Math.min(600, c.vx));
            c.x += c.vx * scaledDt;

            const inRange = dist < CLONE.HIT_RADIUS;
            // Combo Pacing
            const cooldown = c.comboStep > 0 ? CLONE.COMBO_COOLDOWN_MS : CLONE.HIT_COOLDOWN_MS;
            const canHit = now - (c.lastHitAt || 0) >= cooldown;

            if (inRange && !c.attackWindupAt && canHit) c.attackWindupAt = now;
            if (!inRange && c.comboStep === 0) c.attackWindupAt = 0;

            const windupDone = c.attackWindupAt && now - c.attackWindupAt >= CLONE.WINDUP_MS;

            if (inRange && canHit && windupDone) {
                if (targetInfo.type === 'clone') {
                    this.applyCloneVsCloneDamage(c, target, world, now, secureRandom);
                } else {
                    this.applyCloneDamage(c, target, world, now);
                }
                c.comboStep = (c.comboStep + 1) % 3;
                c.lastHitAt = now;
                c.attackWindupAt = 0;
            }

            if (now - c.createdAt >= CLONE.DURATION_MS) {
                this.finishCloneDissolve(c, world, secureRandom);
                return false;
            }
            return true;
        });
        world.clones = world.clones.filter(c => !c.removed);
    }

    getCloneTarget(clone, world) {
        const enemyClone = this.getNearestEnemyClone(clone, world.clones);
        if (enemyClone) return { type: 'clone', entity: enemyClone };

        return {
            type: 'fighter',
            entity: clone.targetId === 0 ? world.fighter1 : world.fighter2
        };
    }

    getNearestEnemyClone(clone, clones) {
        let nearest = null;
        let nearestDist = Infinity;

        for (const candidate of clones) {
            if (
                candidate === clone ||
                candidate.ownerId === clone.ownerId ||
                candidate.removed ||
                candidate.dissolveAt != null ||
                candidate.hp <= 0
            ) {
                continue;
            }

            const dist = Math.abs(candidate.x - clone.x);
            if (dist < nearestDist) {
                nearest = candidate;
                nearestDist = dist;
            }
        }

        return nearest;
    }

    applyCloneVsCloneDamage(clone, targetClone, world, now, secureRandom) {
        if (targetClone.removed || targetClone.hp <= 0) return;

        const previousHp = targetClone.hp;
        targetClone.hp = Math.max(0, targetClone.hp - clone.damage);
        const dmg = previousHp - targetClone.hp;
        (clone.ownerId === 0 ? world.fighter1 : world.fighter2).damageDealt += dmg;

        const recoilDir = targetClone.x >= clone.x ? 1 : -1;
        targetClone.vx = Math.max(-350, Math.min(350, (targetClone.vx || 0) * 0.25 + recoilDir * 160));
        targetClone.facing = -recoilDir;
        targetClone.hitFlashUntil = now + 140;

        world.hitEffects.push(createHitEffect(targetClone.x, {
            y: getCloneDissolveY(),
            dmg,
            ownerId: clone.ownerId,
            cloneHit: true
        }));

        clone.lastHitAt = now;
        clone.attackPoseUntil = now + 200;
        clone.attackWindupAt = 0;

        if (targetClone.hp <= 0) {
            targetClone.dissolveAt = now;
            targetClone.removed = true;
            this.finishCloneDissolve(targetClone, world, secureRandom);
        }
    }

    finishCloneDissolve(clone, world, secureRandom) {
        if (clone.dissolveSpawned) return;
        clone.dissolveSpawned = true;
        spawnCloneDissolve(world.particles, clone.x, getCloneDissolveY(), secureRandom);
    }

    applyCloneDamage(clone, target, world, now) {
        const dmg = target.takeDamage(clone.damage, false, clone.x, now);
        (clone.ownerId === 0 ? world.fighter1 : world.fighter2).damageDealt += dmg;

        target.status.set('stun', now + clone.stun);
        target.status.set('hitFlash', now + 140);
        target.hitFromX = clone.x;
        target.pose = POSE.hit;
        target.poseTime = 0;

        world.hitEffects.push(createHitEffect(target.x, { y: getHitEffectY(target.y), dmg }));
        clone.lastHitAt = now;
        clone.attackPoseUntil = now + 200;
        clone.attackWindupAt = 0;
    }

    processHitEffects(world, secureRandom) {
        world.hitEffects.forEach(h => {
            if (h.t > 0.01) return; // Only process on first frame

            // Shatter Mechanic: Heavy hit on Frozen
            const target = h.ownerId === 0 ? world.fighter2 : world.fighter1;
            if (target && h.heavy && target.status.active('frozen', performance.now())) {
                const shatterDmg = 25;
                target.takeDamage(shatterDmg, false, h.x, performance.now());
                target.status.clear('frozen');
                h.shatter = true;
            }

            if (h.dmg > 0 && !h.fire) spawnHitParticles(world.particles, h.x, h.y, h.heavy, secureRandom);
            if (h.shinra) {
                world.screenShake = Math.min(25, world.screenShake + (RENDER.SHAKE_SKILL ?? 22));
                world.hitZoom = Math.min(world.hitZoom, RENDER.ZOOM_SKILL ?? 0.86);
                world.hitStopRemaining = Math.max(world.hitStopRemaining, RENDER.HIT_STOP_HEAVY_MS ?? 160);
            }
            if (h.lightning) {
                world.screenShake = Math.min(20, world.screenShake + (RENDER.SHAKE_SKILL ?? 22));
                world.hitZoom = Math.min(world.hitZoom, RENDER.ZOOM_SKILL ?? 0.86);
                world.hitStopRemaining = Math.max(world.hitStopRemaining, RENDER.HIT_STOP_HEAVY_MS ?? 160);
            }

            if (h.counter || h.crit) {
                world.screenShake = Math.min(30, world.screenShake + (RENDER.SHAKE_COUNTER ?? 10));
                world.hitZoom = Math.min(world.hitZoom, RENDER.ZOOM_HEAVY ?? 0.88);
                world.hitStopRemaining = Math.max(world.hitStopRemaining, RENDER.HIT_STOP_COUNTER_MS ?? 180);
            } else if (h.heavy) {
                world.screenShake = Math.min(20, world.screenShake + (RENDER.SHAKE_HEAVY ?? 12));
                world.hitZoom = Math.min(world.hitZoom, RENDER.ZOOM_HEAVY ?? 0.88);
                world.hitStopRemaining = Math.max(world.hitStopRemaining, RENDER.HIT_STOP_HEAVY_MS ?? 120);
            } else if (h.dmg > 0 && !h.shinra && !h.lightning) {
                world.screenShake = Math.min(10, world.screenShake + (RENDER.SHAKE_LIGHT ?? 5));
                world.hitStopRemaining = Math.max(world.hitStopRemaining, RENDER.HIT_STOP_MS ?? 45);
            }
        });
    }
}
