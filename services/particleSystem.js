import { getHitEffectY, getCloneDissolveY } from '../core/coordinates.js';

const PARTICLE_GRAVITY = 180;
const PARTICLE_LIFE_RATE = 1.6; // Slightly slower life for better "flurries"
const MAX_PARTICLES = 256;

function createParticle(x, y, vx, vy, type, size = 4, growth = 0) {
  return { x, y, vx, vy, life: 0, type, size, growth };
}

export function spawnDecal(decals, x, y, type, size = 1) {
  if (decals.length > 50) decals.shift();
  decals.push({ x, y, type, life: 0, size, maxLife: 5 + Math.random() * 3 });
}

function trimBeforeSpawn(particles, need) {
  if (particles.length + need > MAX_PARTICLES) particles.splice(0, particles.length + need - MAX_PARTICLES);
}

export function spawnHitParticles(particles, x, y, heavy, rng) {
  const count = heavy ? 10 : 6;
  trimBeforeSpawn(particles, count);
  const vxRange = heavy ? 200 : 110;
  const vyRange = heavy ? 160 : 80;
  for (let i = 0; i < count; i++) {
    particles.push(createParticle(
      x + (rng() - 0.5) * 16, y,
      (rng() - 0.5) * vxRange,
      -rng() * vyRange - (heavy ? 15 : 0),
      heavy ? 'fire' : 'hit',
      heavy ? 6 + rng() * 4 : 3 + rng() * 2,
      heavy ? 0.4 : 0.1
    ));
  }
}

export function spawnHealParticles(particles, fighter, rng) {
  trimBeforeSpawn(particles, 5);
  const y = getHitEffectY(fighter.y);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.4;
    const speed = 50 + rng() * 60;
    particles.push(createParticle(fighter.x, y, Math.cos(a) * speed, Math.sin(a) * speed - 35, 'heal'));
  }
}

export function spawnFireballLaunch(particles, fighter, rng) {
  trimBeforeSpawn(particles, 6);
  const dir = fighter.facing;
  const px = fighter.x + dir * 55;
  const y = getCloneDissolveY(fighter.y);
  for (let i = 0; i < 12; i++) {
    const a = (dir > 0 ? 0 : Math.PI) + (rng() - 0.5) * 0.7;
    const speed = 80 + rng() * 120;
    particles.push(createParticle(px, y, Math.cos(a) * speed, (rng() - 0.5) * 60, 'fire', 5 + rng() * 5, 0.45));
  }
}

export function spawnClonePoof(particles, fighter, rng) {
  const x = fighter.x + fighter.facing * 50;
  spawnCloneDissolve(particles, x, getCloneDissolveY(), rng);
}

export function spawnShinraTensei(particles, fighter, rng) {
  trimBeforeSpawn(particles, 8);
  const y = getHitEffectY(fighter.y);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.15;
    const speed = 130 + rng() * 120;
    particles.push(createParticle(fighter.x, y, Math.cos(a) * speed, Math.sin(a) * speed - 60, 'shinra'));
  }
}

export function spawnLightningCutter(particles, fighter, rng) {
  trimBeforeSpawn(particles, 6);
  const dir = fighter.facing;
  const px = fighter.x + dir * 45;
  const y = getHitEffectY(fighter.y);
  for (let i = 0; i < 6; i++) {
    const spread = (rng() - 0.5) * 0.35;
    const a = (dir > 0 ? 0 : Math.PI) + spread;
    const speed = 160 + rng() * 100;
    particles.push(createParticle(px, y, Math.cos(a) * speed, (rng() - 0.5) * 70, 'lightning'));
  }
}

export function spawnCloneDissolve(particles, x, y, rng) {
  trimBeforeSpawn(particles, 6);
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const r = 60 + rng() * 60;
    particles.push(createParticle(x + Math.cos(a) * 15, y, Math.cos(a) * r, -rng() * 70 - 35, 'smoke'));
  }
}
export function spawnLandingDust(particles, x, y, magnitude = 100, rng) {
  const count = Math.min(8, Math.floor(4 + magnitude / 100));
  trimBeforeSpawn(particles, count);
  for (let i = 0; i < count; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    particles.push(createParticle(
      x + dir * (rng() * 12), y,
      dir * (40 + rng() * 120),
      -rng() * 45,
      'smoke'
    ));
  }
}

export function spawnEarthDust(particles, x, y, rng) {
  trimBeforeSpawn(particles, 12);
  for (let i = 0; i < 12; i++) {
    const vx = (rng() - 0.5) * 180;
    const vy = -rng() * 120 - 40;
    particles.push(createParticle(x + (rng() - 0.5) * 40, y, vx, vy, 'smoke'));
  }
}

export function spawnVortex(particles, x, y, rng) {
  trimBeforeSpawn(particles, 8);
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2;
    const r = 80 + rng() * 40;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    particles.push(createParticle(px, py, -Math.cos(a) * 120, -Math.sin(a) * 120, 'shinra'));
  }
}

export function spawnFrost(particles, x, y, rng) {
  trimBeforeSpawn(particles, 5);
  for (let i = 0; i < 5; i++) {
    particles.push(createParticle(x + (rng() - 0.5) * 20, y, (rng() - 0.5) * 40, -rng() * 30, 'shinra'));
  }
}

export function spawnDragonFire(particles, x, y, dir, rng) {
  trimBeforeSpawn(particles, 20);
  for (let i = 0; i < 40; i++) {
    const a = (dir > 0 ? 0 : Math.PI) + (rng() - 0.5) * 1.4;
    const speed = 180 + rng() * 350;
    particles.push(createParticle(x, y, Math.cos(a) * speed, Math.sin(a) * speed - 50, 'fire', 8 + rng() * 8, 0.6));
  }
}

export function spawnSpectralTrail(particles, x, y, rng) {
  trimBeforeSpawn(particles, 6);
  for (let i = 0; i < 6; i++) {
    particles.push(createParticle(x + (rng() - 0.5) * 30, y - 40, (rng() - 0.5) * 20, (rng() - 0.5) * 20, 'lightning'));
  }
}

export function spawnDashDust(particles, x, y, dir, rng) {
  trimBeforeSpawn(particles, 6);
  for (let i = 0; i < 6; i++) {
    particles.push(createParticle(x, y, -dir * (rng() * 100 + 50), -rng() * 30, 'smoke'));
  }
}




export function tickParticles(particles, dt) {
  let n = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += PARTICLE_GRAVITY * dt;
    p.life += dt * PARTICLE_LIFE_RATE;
    if (p.life < 1) particles[n++] = p;
  }
  particles.length = n;
  if (n > MAX_PARTICLES) particles.splice(0, n - MAX_PARTICLES);
  return particles;
}
