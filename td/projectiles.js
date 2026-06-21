import { TD } from './config.js';
import { POSE } from '../entities/fighter.js';
import { sharinganNegate } from './combat.js';
import { spawnHitParticles, spawnFireballLaunch, spawnFrost, spawnDashDust, spawnDragonFire } from '../services/particleSystem.js';

const PROJ_Y = -70; // chest height (matches drawProjectiles' offset)

// Per-type launch flourish so each skill *casts* with its own look.
function launchEffect(world, hero, type) {
  const dir = hero.facing;
  if (type === 'fireball') spawnFireballLaunch(world.particles, hero, world.rng);
  else if (type === 'ice') spawnFrost(world.particles, hero.x + dir * 50, TD.GROUND_Y, world.rng);
  else spawnDashDust(world.particles, hero.x + dir * 40, TD.GROUND_Y, dir, world.rng); // shuriken throw puff
}

// Launch a hero power skill toward the way the hero is facing. Costs stamina, so
// a tired hero can't spam skills (gated by the AI, enforced here).
export function castHeroSkill(world, hero, skill, now) {
  hero.powerCooldowns[skill.id] = now + skill.cooldownMs * (hero.skillCooldownMult ?? 1);
  hero.stamina = Math.max(0, hero.stamina - TD.HERO.skillStaminaCost);
  hero.pose = POSE.punch; hero.poseTime = 0;
  hero.currentAttack = null;

  if (skill.kind === 'heal') {
    hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * skill.amount);
    world.hitEffects.push({ x: hero.x, y: TD.GROUND_Y + hero.y - 70, t: 0, dmg: 0, heal: true });
    return;
  }
  if (skill.kind === 'buff') { // Sharingan: awaken the red eyes
    hero.status.set('sharingan', now + skill.durationMs);
    hero.status.clear('sharinganCd');
    world.hitEffects.push({ x: hero.x, y: TD.GROUND_Y + hero.y - 70, t: 0, dmg: 0, sharingan: true });
    world.slowMo = 200;
    return;
  }
  const dir = hero.facing;
  launchEffect(world, hero, skill.type);
  if (skill.type === 'fireball') world.skyFocus = { type: 'fire', intensity: 0.5, expiry: now + 600 };
  // Aim at the nearest enemy ahead — if it dodges/moves, the bolt overshoots and
  // vanishes (see updateProjectiles' miss check).
  const aim = nearestAhead(world.monsters, hero.x, dir);
  world.projectiles.push({
    target: 'monster', owner: hero, aimX: aim ? aim.x : hero.x + dir * skill.range,
    x: hero.x + dir * 46, y: PROJ_Y, vx: dir * skill.speed,
    type: skill.type, spin: 0,
    dmg: Math.round(skill.damage * (hero.powerMult ?? 1)),
    radius: skill.radius, aoe: !!skill.aoe, pierce: !!skill.pierce, slowMs: skill.slowMs || 0,
    burn: skill.type === 'fireball', // fire leaves a burning DoT
    hitIds: new Set(), life: 6,
  });
}

// A whiffed projectile dissipates with a small type-appropriate puff.
function fizzle(world, p) {
  const y = TD.GROUND_Y + (p.y ?? PROJ_Y);
  if (p.type === 'fireball') spawnDragonFire(world.particles, p.x, y, Math.sign(p.vx), world.rng);
  else if (p.type === 'ice') spawnFrost(world.particles, p.x, TD.GROUND_Y, world.rng);
  else spawnDashDust(world.particles, p.x, TD.GROUND_Y, Math.sign(p.vx) || 1, world.rng);
}

// Nearest live entity ahead of `x` in direction `dir`.
function nearestAhead(list, x, dir) {
  let best = null, bd = Infinity;
  for (const e of list) {
    if (e.hp <= 0) continue;
    const rel = (e.x - x) * dir;
    if (rel <= 0) continue;
    if (rel < bd) { bd = rel; best = e; }
  }
  return best;
}

// A tower looses an arrow at a target (your base → monsters, enemy keep → hero).
// The arrow is a true ballistic shot: we solve its launch velocity so its arc
// actually passes through the target's body, no matter how near or far (even an
// enemy hugging the base). If it whiffs, gravity carries it into the ground and
// it's destroyed there — arrows never drift across the field.
export function fireTowerArrow(world, fromX, fromTopY, dir, targetSide, dmg, aimX, now) {
  const F = TD.TOWER_FIRE;
  const g = F.arc;
  const TARGET_Y = -55;                 // aim for mid-body of the target
  const dx = aimX - fromX;
  // Time to span the horizontal gap at flight speed; clamped so a point-blank
  // shot still arcs down sharply instead of dividing by ~zero.
  const t = Math.max(0.09, Math.abs(dx) / F.speed);
  const vx = dx / t;
  // Vertical launch that lands the arrow at TARGET_Y exactly at time t.
  const vy = (TARGET_Y - fromTopY - 0.5 * g * t * t) / t;
  world.projectiles.push({
    target: targetSide, owner: { isTower: true }, aimX,
    x: fromX, y: fromTopY, vx, vy,
    type: 'arrow', arc: g, spin: 0,
    dmg, radius: 40,
    hitIds: new Set(), life: 6,
  });
}

// A caster monster lobs a bolt at the hero.
export function castMonsterSkill(world, m, hero, now) {
  const r = m.ranged;
  const dir = Math.sign(hero.x - m.x) || m.facing || -1;
  world.projectiles.push({
    target: 'hero', owner: m, aimX: hero.x,    // locked on the hero — dodge → overshoot → vanish
    x: m.x + dir * 40, y: PROJ_Y, vx: dir * r.speed,
    type: r.type,
    dmg: m.rangedDmg ?? r.damage,
    radius: r.radius, slowMs: r.slowMs || 0,
    hitIds: new Set(), life: 6,
  });
  spawnHitParticles(world.particles, m.x + dir * 30, TD.GROUND_Y - 60, false, world.rng);
}

// Move projectiles, route hits to the right side, and reap spent ones.
export function updateProjectiles(world, dt, now) {
  for (const p of world.projectiles) {
    p.x += p.vx * dt;
    if (p.arc) { p.vy = (p.vy || 0) + p.arc * dt; p.y += p.vy * dt; } // true ballistic fall
    p.spin = (p.spin || 0) + dt * (p.type === 'shuriken' ? 26 : p.type === 'ice' ? 9 : 0) * Math.sign(p.vx || 1);
    p.life -= dt;
    // Travelling trails: fire embers, frost shards.
    if (p.type === 'fireball' && world.rng() < 0.6) spawnDragonFire(world.particles, p.x, TD.GROUND_Y + PROJ_Y, Math.sign(p.vx), world.rng);
    else if (p.type === 'ice' && world.rng() < 0.4) spawnFrost(world.particles, p.x, TD.GROUND_Y + PROJ_Y, world.rng);
    if (Math.abs(p.x) > TD.STAGE_HALF || p.life <= 0) { p._dead = true; continue; }
    // GROUND IMPACT: an arcing shot that reaches the floor without connecting
    // buries itself there — no skidding or drifting across the arena.
    if (p.arc && p.y >= 0) { p.y = 0; fizzle(world, p); p._dead = true; continue; }
    // MISS → VANISH: a flat shot aimed at a target that overshoots its aim point
    // (because the target dodged or moved) fizzles instead of flying on forever.
    if (p.aimX != null && !p.arc) {
      const margin = p.radius + 70;
      const overshot = (p.vx > 0 && p.x > p.aimX + margin) || (p.vx < 0 && p.x < p.aimX - margin);
      if (overshot) { fizzle(world, p); p._dead = true; continue; }
    }
    // Arrows only connect once they've descended near body height (so they
    // visibly rain down onto the target rather than clip it on the way up).
    if (p.arc && p.y < PROJ_Y - 45) continue;
    if (p.target === 'monster') stepHeroProjectile(world, p, now);
    else stepMonsterProjectile(world, p, now);
  }
  world.projectiles = world.projectiles.filter(p => !p._dead);
}

function stepHeroProjectile(world, p, now) {
  for (const m of world.monsters) {
    if (m.hp <= 0 || p.hitIds.has(m.id)) continue;
    const reach = p.radius + 24 * (m.scale || 1);
    if (Math.abs(m.x - p.x) > reach) continue;
    // A monster mid-dodge (i-frames) slips the bolt — it flies on.
    if (m.status.active('invincible', now)) { p.hitIds.add(m.id); continue; }
    p.hitIds.add(m.id);
    damageMonster(world, m, p.dmg, p, now);
    if (p.aoe) {
      for (const o of world.monsters) {
        if (o === m || o.hp <= 0 || p.hitIds.has(o.id)) continue;
        if (Math.abs(o.x - p.x) <= p.radius) { p.hitIds.add(o.id); damageMonster(world, o, Math.round(p.dmg * 0.7), p, now); }
      }
      p._dead = true; return;
    }
    if (!p.pierce) { p._dead = true; return; }
  }
}

function stepMonsterProjectile(world, p, now) {
  const hero = world.hero;
  if (hero.hp <= 0 || p.hitIds.has(hero.id)) return;
  if (Math.abs(hero.x - p.x) > p.radius + 26) return;
  // Hero mid-dodge (i-frames from a read sidestep) → the bolt whiffs past.
  if (hero.status.active('invincible', now)) {
    p.hitIds.add(hero.id);
    world.hitEffects.push({ x: hero.x, y: TD.GROUND_Y + hero.y - 70, t: 0, dmg: 0, block: true });
    return;
  }
  p.hitIds.add(hero.id);
  p._dead = true;
  // Sharingan negates ranged hits too (no melee attacker to counter).
  if (sharinganNegate(world, hero, null, p.x, now)) return;
  // The hero's evade traits/passives apply to ranged hits too.
  const dodge = (hero.traits?.untouchable && world.rng() < 0.99)
    || (hero.hasPassive('blur') && world.rng() < 0.15);
  if (dodge) {
    hero.status.set('invincible', now + 120);
    hero.pose = POSE.dodge; hero.dodgeStartAt = now; hero.dodgeDir = -Math.sign(p.vx) || 1;
    world.hitEffects.push({ x: hero.x, y: TD.GROUND_Y + hero.y - 70, t: 0, dmg: 0, block: true });
    return;
  }
  const dealt = hero.takeDamage(p.dmg, true, p.x, now);
  hero.vx += Math.sign(p.vx) * 160;
  hero.status.set('stun', now + 220);
  if (p.slowMs) hero.status.set('frozen', now + p.slowMs);
  world.hitEffects.push({ x: hero.x, y: TD.GROUND_Y + hero.y - 70, t: 0, dmg: dealt, heavy: true });
  spawnHitParticles(world.particles, hero.x, TD.GROUND_Y + hero.y - 60, true, world.rng);
  world.screenShake = Math.min(22, world.screenShake + 7);
}

function damageMonster(world, m, dmg, p, now) {
  const dealt = m.takeDamage(dmg, true, p.x, now);
  m.vx += Math.sign(p.vx) * 180;
  m.pose = POSE.hit; m.poseTime = 0;
  m.currentAttack = null;
  m.status.set('stun', now + 200);
  if (p.slowMs) m.status.set('frozen', now + p.slowMs);      // ice → freeze/slow
  if (p.burn) m.status.set('burning', now + 2000);           // fire → burning DoT
  const my = TD.GROUND_Y + m.y - 70 * (m.scale || 1);
  world.hitEffects.push({ x: m.x, y: my, t: 0, dmg: dealt, heavy: true, fire: p.type === 'fireball', ice: p.type === 'ice' });
  if (p.type === 'fireball') { spawnDragonFire(world.particles, m.x, my, Math.sign(p.vx), world.rng); spawnHitParticles(world.particles, m.x, my, true, world.rng); }
  else if (p.type === 'ice') spawnFrost(world.particles, m.x, TD.GROUND_Y, world.rng);
  else spawnHitParticles(world.particles, m.x, my, false, world.rng);
  world.screenShake = Math.min(22, world.screenShake + 6);
  if (m.hp <= 0) { m._dead = true; world.kills++; world.gold += (m.reward ?? m.def.reward); }
}
