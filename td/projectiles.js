import { TD, opp } from './config.js';
import { PHYSICS } from '../config/constants.js';
import { POSE } from '../entities/fighter.js';
import { aimY, projHitsUnit, projHitsBase } from '../core/hitbox.js';
import { killCreep, evasion, tryTdRagdoll, knockFlyerDown } from './combat.js';
import { eachNear } from './spatial.js';
import { spawnHitParticles, spawnFrost } from '../services/particleSystem.js';

const PROJ_Y = -70; // chest height (matches the renderer's offset)
const G = TD.GRAVITY ?? PHYSICS.GRAVITY ?? 1500;

const TYPE_GRAVITY = {
  kunai: 820, shuriken: 900, arrow: G, fireball: 1380, ice: 1050, bolt: 680,
};

export { aimY as creepAimY };

function aimPoint(target) {
  if (target?.id != null) return { x: target.x, y: aimY(target) };
  return { x: target.x, y: PROJ_Y };
}

// Ballistic solve: hit (x1,y1) from (x0,y0) with gravity g>0 (down = +y).
export function solveBallistic(x0, y0, x1, y1, speed, g) {
  let t = Math.max(0.07, Math.abs(x1 - x0) / Math.max(120, speed));
  let vx = 0, vy = 0;
  for (let i = 0; i < 12; i++) {
    vx = (x1 - x0) / t;
    vy = (y1 - y0 - 0.5 * g * t * t) / t;
    if (Math.hypot(vx, vy) <= speed * 1.22) break;
    t *= 1.1;
  }
  return { vx, vy, arc: g };
}

function gravityFor(type, flying) {
  const base = TYPE_GRAVITY[type] ?? G;
  return flying ? Math.max(280, base * 0.45) : base;
}

function pushProjectile(world, p) {
  world.projectiles.push({ hitIds: new Set(), ...p });
}

// A caster creep lobs a bolt at an enemy creep. `team` marks the owner side so
// it only hurts the other team (creeps and their base).
export function castCreepBolt(world, c, target, now) {
  const r = c.ranged;
  const dir = Math.sign(target.x - c.x) || c.dir;
  const x0 = c.x + dir * 40;
  const y0 = c.flying ? c.y : PROJ_Y;
  const { x: x1, y: y1 } = aimPoint(target);
  const { vx, vy, arc } = solveBallistic(x0, y0, x1, y1, r.speed, gravityFor(r.type, c.flying));
  pushProjectile(world, {
    team: c.team, x: x0, y: y0, vx, vy, arc,
    type: r.type, dmg: c.rangedDmg ?? r.damage, radius: r.radius,
    slowMs: r.slowMs || 0, stunMs: r.stunMs || 0, perfectStrike: !!c.traits?.perfectStrike,
    flyBolt: !!c.flying,
  });
  spawnHitParticles(world.particles, c.x + dir * 30, TD.GROUND_Y + (c.flying ? c.y : -60), false, world.rng);
}

// A base looses a ballistic arrow at an enemy creep — its only static defence.
export function fireBaseArrow(world, base, target, now) {
  const F = TD.BASE_FIRE;
  const dir = Math.sign(target.x - base.x) || 1;
  const fromX = base.x + dir * (base.w / 2);
  const fromTopY = -(base.h - 36);
  const targetY = target?.id != null ? aimY(target) : PROJ_Y;
  const dx = target.x - fromX;
  const t = Math.max(0.09, Math.abs(dx) / F.speed);
  const vx = dx / t;
  const vy = (targetY - fromTopY - 0.5 * F.arc * t * t) / t;
  pushProjectile(world, {
    team: base.team, x: fromX, y: fromTopY, vx, vy,
    type: 'arrow', arc: F.arc, dmg: F.damage, radius: 40,
  });
}

function fizzle(world, p) {
  if (p.type === 'ice') spawnFrost(world.particles, p.x, TD.GROUND_Y, world.rng);
  else if (p.type === 'fireball') spawnHitParticles(world.particles, p.x, TD.GROUND_Y - 40, true, world.rng);
  else spawnHitParticles(world.particles, p.x, TD.GROUND_Y + PROJ_Y, false, world.rng);
}

export function updateProjectiles(world, dt, now) {
  for (const p of world.projectiles) {
    const g = p.arc ?? 0;
    if (g) {
      p.vy = (p.vy || 0) + g * dt;
      p.y += p.vy * dt;
    }
    p.x += p.vx * dt;
    p.spin = (p.spin || 0) + dt * ({
      shuriken: 26, ice: 9, kunai: 18, fireball: 6, bolt: 14, arrow: 0,
    }[p.type] ?? 12) * Math.sign(p.vx || 1);
    if (p.flyBolt) {
      const base = world.bases[opp(p.team)];
      const past = p.vx > 0 ? p.x > base.x + base.w / 2 + 100 : p.x < base.x - base.w / 2 - 100;
      if (past) { fizzle(world, p); p._dead = true; continue; }
    } else if (Math.abs(p.x) > TD.STAGE_HALF) { p._dead = true; continue; }
    if (g && p.y >= 0) { fizzle(world, p); p._dead = true; continue; }
    stepBolt(world, p, now);
  }
  world.projectiles = world.projectiles.filter(p => !p._dead);
}

function stepBolt(world, p, now) {
  const sorted = world._aliveByX;
  const scan = (o) => {
    if (p._dead) return;
    if (o.team === p.team || p.hitIds.has(o.id)) return;
    if (!projHitsUnit(p, o)) return;
    p.hitIds.add(o.id);
    if (o.traits?.untouchable && !p.perfectStrike && world.rng() < 0.99 * evasion(o)) {
      world.hitEffects.push({ x: o.x, y: TD.GROUND_Y + o.y - 70, t: 0, dmg: 0, block: true });
      return;
    }
    p._dead = true;
    damageCreep(world, o, p, now);
  };
  if (sorted) eachNear(sorted, p.x, 120, scan);
  else for (const o of world.creeps) { if (o.hp <= 0 || o.team === p.team || p.hitIds.has(o.id)) continue; if (!projHitsUnit(p, o)) continue; scan(o); break; }
  if (p._dead) return;
  const base = world.bases[opp(p.team)];
  if (base.hp > 0 && projHitsBase(p, base)) {
    p._dead = true;
    base.hp = Math.max(0, base.hp - p.dmg);
    world.hitEffects.push({ x: base.x, y: TD.GROUND_Y - 120, t: 0, dmg: p.dmg, heavy: true });
  }
}

function damageCreep(world, o, p, now) {
  const dealt = o.takeDamage(p.dmg, true, p.x, now);
  o.pose = POSE.hit; o.poseTime = 0;
  o.currentAttack = null;
  o.status.set('stun', now + 240);
  const push = TD.RAGDOLL?.pushMul ?? 1.22;
  const kbX = Math.sign(p.vx) * (300 + p.dmg * 2.2) * push;
  const kbY = o.flying ? 140 + p.dmg * 0.5 : (p.type === 'fireball' ? -260 : -180);
  if (o.flying) knockFlyerDown(o, now, kbX * 0.55, p.type === 'fireball' ? 220 : 160);
  const R = TD.RAGDOLL ?? {};
  const ragdolled = (world.rng() < (R.projChance ?? 0.55) || p.type === 'fireball' || p.dmg >= 36 || o.flying)
    && tryTdRagdoll(world, o, p.x, kbX, kbY, now, { heavy: true, dmg: dealt, force: p.type === 'fireball' || o.flying });
  if (!ragdolled) {
    o.vx += Math.sign(p.vx) * (240 + p.dmg * 0.6) * push;
    o.impactFrictionUntil = Math.max(o.impactFrictionUntil || 0, now + (PHYSICS.IMPACT_FRICTION_MS ?? 360));
  }
  if (p.slowMs) o.status.set('frozen', now + p.slowMs);
  if (p.stunMs) o.status.set('stun', now + Math.max(200, p.stunMs));
  const oy = TD.GROUND_Y + o.y - 70 * (o.scale || 1);
  world.hitEffects.push({
    x: o.x, y: oy, t: 0, dmg: dealt, heavy: true,
    ice: p.type === 'ice', fire: p.type === 'fireball',
  });
  if (p.type === 'ice') spawnFrost(world.particles, o.x, TD.GROUND_Y, world.rng);
  else if (p.type === 'fireball') spawnHitParticles(world.particles, o.x, oy, true, world.rng);
  else spawnHitParticles(world.particles, o.x, oy, false, world.rng);
  world.screenShake = Math.min(22, world.screenShake + 6);
  if (o.hp <= 0) killCreep(world, o, p.team, now);
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('projectiles.js')) {
  const shot = solveBallistic(0, -70, 500, -70, 900, G);
  let x = 0, y = -70, vy = shot.vy;
  const dt = 1 / 60;
  let nearY = 0;
  for (let i = 0; i < 120; i++) {
    vy += shot.arc * dt;
    y += vy * dt;
    x += shot.vx * dt;
    if (Math.abs(x - 500) < 12) nearY = y;
  }
  console.assert(Math.abs(nearY + 70) < 25, 'ballistic passes target height');
  const ground = { x: 100, y: 0, scale: 1, flying: false };
  console.assert(!projHitsUnit({ x: 100, y: -200, radius: 26, flyBolt: true }, ground), 'overhead bolt misses');
  console.assert(projHitsUnit({ x: 100, y: -58, radius: 26 }, ground), 'body-height bolt hits');
  console.log('projectiles ok');
}
