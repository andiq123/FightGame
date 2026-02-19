import { PHYSICS, RENDER } from '../../config/constants.js';

/**
 * World holds the complete state of the game match.
 * It is the single source of truth for simulation.
 */
export class World {
    constructor() {
        this.reset();
    }

    reset() {
        this.fighters = [];
        this.clones = [];
        this.projectiles = [];
        this.particles = [];
        this.hitEffects = [];
        this.obstacles = [];
        this.decals = []; // { x, y, type, life, size }

        this.roundState = 'fighting'; // 'countdown', 'fighting', 'ended'
        this.roundCountdown = 0;
        this.roundWinner = -1;
        this.roundHistory = [];

        this.ragdollPhase = 0;
        this.activeRagdolls = [];
        this.pendingRoundEnd = null;

        this.hitStopRemaining = 0;
        this.koSlowMo = 0;

        this.screenShake = 0;
        this.hitZoom = 1;
        this.smoothCamX = 0;

        this.time = 0;
        this.gameSpeed = 1;
        this.skyFocus = null; // { type: string, intensity: number, expiry: number }
    }

    get fighter1() { return this.fighters[0]; }
    get fighter2() { return this.fighters[1]; }

    set fighter1(f) { this.fighters[0] = f; }
    set fighter2(f) { this.fighters[1] = f; }

    addFighter(fighter) {
        this.fighters.push(fighter);
    }

    addProjectile(p) { this.projectiles.push(p); }
    addClone(c) { this.clones.push(c); }
    addParticle(p) { this.particles.push(p); }
    addHitEffect(e) { this.hitEffects.push(e); }
    addObstacle(o) { this.obstacles.push(o); }

    clearTransientState() {
        this.hitEffects = [];
        this.particles = [];
        this.projectiles = [];
        this.clones = [];
        this.obstacles = [];
        this.decals = [];
        this.activeRagdolls = [];
        this.ragdollPhase = 0;
        this.hitStopRemaining = 0;
        this.koSlowMo = 0;
        this.screenShake = 0;
        this.hitZoom = 1;
        this.skyFocus = null;
    }
}
