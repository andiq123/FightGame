import {
    drawStickman, drawBackground, drawHitEffect, drawDamageNumber,
    drawParticles, drawProjectiles, drawClones, drawHitVignette, drawDecals
} from '../renderer.js';
import { drawRagdoll } from '../ragdoll.js';
import { RENDER, PHYSICS } from '../../config/constants.js';
import { secureRandom } from '../../utils.js';

const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const GROUND_Y = 810;

/**
 * Viewport handles the rendering of the World.
 * It is responsible for scaling, camera movement, and visual effects.
 */
export class Viewport {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
    }

    render(world, now) {
        const { ctx, canvas } = this;
        if (!ctx || !world.fighter1 || !world.fighter2) return;

        this.resize();

        const camX = world.smoothCamX;
        const sx = canvas.width / LOGICAL_WIDTH;
        const sy = canvas.height / LOGICAL_HEIGHT;
        const centerX = LOGICAL_WIDTH / 2;

        const countdownZoom = world.roundState === 'countdown' ? 1 + 0.06 * Math.max(0, world.roundCountdown / 2.5) : 1;
        const dynamicZoom = world.dynamicZoom || 1.0;
        const cinematicZoom = world.cinematicZoom || 1.0; // slow-mo punch-in
        const zoom = world.hitZoom * countdownZoom * dynamicZoom * cinematicZoom;
        const shakeX = (secureRandom() - 0.5) * world.screenShake;
        const shakeY = (secureRandom() - 0.5) * world.screenShake;

        // Apply Transformation Matrix
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        ctx.scale(sx, sy);
        ctx.translate(centerX - camX + shakeX / sx, shakeY / sy);

        // Draw Background
        drawBackground(ctx, LOGICAL_WIDTH, LOGICAL_HEIGHT, camX, now, world);

        // Draw Environment Reactions
        drawDecals(ctx, world.decals, now);

        // Draw Entities
        if (world.ragdollPhase > 0 && world.activeRagdolls.length > 0) {
            const loserId = world.pendingRoundEnd?.roundWinner === 1 ? 1 : 0;
            if (loserId === 0) {
                drawRagdoll(ctx, world.activeRagdolls[0].ragdoll, world.activeRagdolls[0].color, now);
                drawStickman(ctx, world.fighter2, GROUND_Y, now);
            } else {
                drawStickman(ctx, world.fighter1, GROUND_Y, now);
                drawRagdoll(ctx, world.activeRagdolls[0].ragdoll, world.activeRagdolls[0].color, now);
            }
        } else {
            [world.fighter1, world.fighter2].forEach(f => {
                if (f.staggerRagdoll) drawRagdoll(ctx, f.staggerRagdoll, f.color, now);
                else drawStickman(ctx, f, GROUND_Y, now);
            });
        }

        drawProjectiles(ctx, world.projectiles, GROUND_Y, now);
        drawClones(ctx, world.clones, GROUND_Y, now);
        drawParticles(ctx, world.particles);

        world.hitEffects.forEach(h => {
            drawHitEffect(ctx, h);
            if (h.dmg > 0) drawDamageNumber(ctx, h.x, h.y - 25, h.dmg, Math.max(0, 1 - h.t * 2.2), h.counter, h.crit);
        });

        ctx.restore();

        // Screen-space effects
        if (world.hitStopRemaining > 0 || (world.hitZoom < 0.99)) {
            const vignetteIntensity = world.hitStopRemaining > 0 ? 1 : Math.max(0, (1 - world.hitZoom) * 10);
            drawHitVignette(ctx, canvas.width, canvas.height, vignetteIntensity);
        }
    }
}
