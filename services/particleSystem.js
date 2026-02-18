import { getHitEffectY, getCloneDissolveY } from '../core/coordinates.js';

const PARTICLE_GRAVITY = 180;
const PARTICLE_LIFE_RATE = 1.8;
const MAX_PARTICLES = 72;

function createParticle(x, y, vx, vy, type) {
  return { x, y, vx, vy, life: 0, type };
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
      heavy ? 'fire' : 'hit'
    ));
  }
}

export function spawnHealParticles(particles, fighter, rng) {
  trimBeforeSpawn(particles, 5);
  const y = getHitEffectY();
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
  const y = getCloneDissolveY();
  for (let i = 0; i < 6; i++) {
    const a = (dir > 0 ? 0 : Math.PI) + (rng() - 0.5) * 0.5;
    const speed = 70 + rng() * 90;
    particles.push(createParticle(px, y, Math.cos(a) * speed, (rng() - 0.5) * 50, 'fire'));
  }
}

export function spawnClonePoof(particles, fighter, rng) {
  const x = fighter.x + fighter.facing * 50;
  spawnCloneDissolve(particles, x, getCloneDissolveY(), rng);
}

export function spawnShinraTensei(particles, fighter, rng) {
  trimBeforeSpawn(particles, 8);
  const y = getHitEffectY();
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
  const y = getHitEffectY();
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

export function spawnTeleportDeparture(particles, fighter, rng) {
  trimBeforeSpawn(particles, 10);
  const y = getHitEffectY();
  const x = fighter.x;
  const color = fighter.color || '#888';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng() * 0.4;
    const speed = 80 + rng() * 120;
    const p = createParticle(x + (rng() - 0.5) * 20, y, Math.cos(a) * speed, Math.sin(a) * speed - 40, 'teleport');
    p.color = color;
    particles.push(p);
  }
}

export function spawnTeleportArrival(particles, x, y, color, rng) {
  trimBeforeSpawn(particles, 10);
  const baseColor = color || '#888';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng() * 0.4;
    const speed = 60 + rng() * 100;
    const p = createParticle(x + (rng() - 0.5) * 24, y, Math.cos(a) * speed, Math.sin(a) * speed - 30, 'teleport');
    p.color = baseColor;
    particles.push(p);
  }
}

export function tickParticles(particles, dt) {
  return particles.filter(p => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.type !== 'teleport') p.vy += PARTICLE_GRAVITY * dt;
    p.life += dt * (p.type === 'teleport' ? PARTICLE_LIFE_RATE * 0.7 : PARTICLE_LIFE_RATE);
    return p.life < 1;
  }).slice(-MAX_PARTICLES);
}
