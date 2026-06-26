import { TD, opp } from './config.js';
import { POSE } from '../entities/fighter.js';
import { killCreep, evasion } from './combat.js';
import { spawnHitParticles, spawnFrost } from '../services/particleSystem.js';

const PROJ_Y = -70; // chest height (matches the renderer's offset)

// A caster creep lobs a bolt at an enemy creep. `team` marks the owner side so
// it only hurts the other team (creeps and their base).
export function castCreepBolt(world, c, target, now) {
  const r = c.ranged;
  const dir = Math.sign(target.x - c.x) || c.dir;
  world.projectiles.push({
    team: c.team, x: c.x + dir * 40, y: PROJ_Y, vx: dir * r.speed,
    type: r.type, dmg: c.rangedDmg ?? r.damage, radius: r.radius, slowMs: r.slowMs || 0,
    hitIds: new Set(),
  });
  spawnHitParticles(world.particles, c.x + dir * 30, TD.GROUND_Y - 60, false, world.rng);
}

// A base looses a ballistic arrow at an enemy creep — its only static defence.
export function fireBaseArrow(world, base, target, now) {
  const F = TD.BASE_FIRE;
  const dir = Math.sign(target.x - base.x) || 1;
  const fromX = base.x + dir * (base.w / 2);
  const fromTopY = -(base.h - 36);
  const dx = target.x - fromX;
  const t = Math.max(0.09, Math.abs(dx) / F.speed);
  const vx = dx / t;
  const vy = (-55 - fromTopY - 0.5 * F.arc * t * t) / t; // land at mid-body at time t
  world.projectiles.push({
    team: base.team, x: fromX, y: fromTopY, vx, vy,
    type: 'arrow', arc: F.arc, dmg: F.damage, radius: 40, hitIds: new Set(),
  });
}

function fizzle(world, p) {
  if (p.type === 'ice') spawnFrost(world.particles, p.x, TD.GROUND_Y, world.rng);
  else spawnHitParticles(world.particles, p.x, TD.GROUND_Y + PROJ_Y, false, world.rng);
}

export function updateProjectiles(world, dt, now) {
  for (const p of world.projectiles) {
    p.x += p.vx * dt;
    if (p.arc) { p.vy = (p.vy || 0) + p.arc * dt; p.y += p.vy * dt; }
    p.spin = (p.spin || 0) + dt * (p.type === 'shuriken' ? 26 : p.type === 'ice' ? 9 : 0) * Math.sign(p.vx || 1);
    if (Math.abs(p.x) > TD.STAGE_HALF) { p._dead = true; continue; }
    if (p.arc && p.y >= 0) { p.y = 0; fizzle(world, p); p._dead = true; continue; }
    if (p.arc && p.y < PROJ_Y - 45) continue; // arrow still high — rains down before it can hit
    stepBolt(world, p, now);
  }
  world.projectiles = world.projectiles.filter(p => !p._dead);
}

function stepBolt(world, p, now) {
  // Enemy creeps in the bolt's path.
  for (const o of world.creeps) {
    if (o.hp <= 0 || o.team === p.team || p.hitIds.has(o.id)) continue;
    if (Math.abs(o.x - p.x) > p.radius + 24 * (o.scale || 1)) continue;
    p.hitIds.add(o.id);
    if (o.traits?.untouchable && world.rng() < 0.99 * evasion(o)) {
      world.hitEffects.push({ x: o.x, y: TD.GROUND_Y + o.y - 70, t: 0, dmg: 0, block: true });
      continue;
    }
    p._dead = true;
    damageCreep(world, o, p, now);
    return;
  }
  // Enemy base in the bolt's path.
  const base = world.bases[opp(p.team)];
  if (base.hp > 0 && Math.abs(p.x - base.x) <= p.radius + base.w / 2) {
    p._dead = true;
    base.hp = Math.max(0, base.hp - p.dmg);
    world.hitEffects.push({ x: base.x, y: TD.GROUND_Y - 120, t: 0, dmg: p.dmg, heavy: true });
  }
}

function damageCreep(world, o, p, now) {
  const dealt = o.takeDamage(p.dmg, true, p.x, now);
  o.vx += Math.sign(p.vx) * 180;
  o.pose = POSE.hit; o.poseTime = 0;
  o.currentAttack = null;
  o.status.set('stun', now + 200);
  if (p.slowMs) o.status.set('frozen', now + p.slowMs);
  const oy = TD.GROUND_Y + o.y - 70 * (o.scale || 1);
  world.hitEffects.push({ x: o.x, y: oy, t: 0, dmg: dealt, heavy: true, ice: p.type === 'ice' });
  if (p.type === 'ice') spawnFrost(world.particles, o.x, TD.GROUND_Y, world.rng);
  else spawnHitParticles(world.particles, o.x, oy, false, world.rng);
  world.screenShake = Math.min(22, world.screenShake + 6);
  if (o.hp <= 0) killCreep(world, o, p.team, now);
}
