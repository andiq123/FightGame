import { POSE } from '../entities/fighter.js';
import { PASSIVE } from '../config/passives.js';
import { TD } from './config.js';
import { evasionStaminaFactor } from './perception.js';
import { spawnHitParticles } from '../services/particleSystem.js';

// Integrate one Fighter-body's position with simple gravity + ground clamp.
// fighter.y: 0 == on the ground, negative == airborne (matches the renderer).
export function integrate(f, dt) {
  if (f.staggerRagdoll) return; // ragdoll drives its own position
  f.vy += TD.GRAVITY * dt;
  f.y += f.vy * dt;
  if (f.y >= 0) { f.y = 0; if (f.vy > 0) f.vy = 0; }
  f.x += f.vx * dt;
  // Keep everyone inside the stage.
  const lim = TD.STAGE_HALF - 40;
  if (f.x < -lim) { f.x = -lim; f.vx = 0; }
  if (f.x > lim) { f.x = lim; f.vx = 0; }
}

function addHit(world, x, y, dmg, opts = {}) {
  world.hitEffects.push({ x, y, t: 0, dmg, heavy: !!opts.heavy, crit: !!opts.crit, counter: false });
  spawnHitParticles(world.particles, x, y, !!opts.heavy, world.rng);
  world.screenShake = Math.min(26, world.screenShake + (opts.heavy ? 14 : 6));
}

// Resolve the hero's active attack against every monster (once per attack each).
export function resolveHeroAttacks(world, now) {
  const hero = world.hero;
  const hb = hero.getAttackHitbox?.(now);
  if (!hb) return;
  if (!hero._hitSet || hero._hitAtkId !== hero.currentAttack.started) {
    hero._hitSet = new Set();
    hero._hitAtkId = hero.currentAttack.started;
  }
  for (const m of world.monsters) {
    if (m.hp <= 0 || hero._hitSet.has(m.id)) continue;
    const half = (m.def.atkRange * 0.5) + hb.w * 0.5 + 18 * (m.scale || 1);
    if (Math.abs(m.x - hb.x) > half) continue;
    if (m.y < -160) continue; // can't reach high-flyers with ground pokes
    hero._hitSet.add(m.id);
    const dmg = Math.round(hb.damage * hero.damageMult);
    const heavy = hb.knockback > 45;
    const dealt = m.takeDamage(dmg, heavy, hero.x, now);
    // Vampirism passive: heal a fraction of melee damage dealt.
    if (hero.hasPassive('vampirism')) hero.hp = Math.min(hero.maxHp, hero.hp + dealt * PASSIVE.VAMPIRISM_LIFESTEAL);
    m.vx += hero.facing * hb.knockback * 6;
    if (hb.kickLaunch || hb.knockdown) m.vy = -260;
    m.pose = POSE.hit; m.poseTime = 0;
    m.currentAttack = null; // interrupt a wind-up
    m.status.set('stun', now + (heavy ? 320 : 130)); // brief stun so knockback reads
    addHit(world, m.x, TD.GROUND_Y + m.y - 70 * (m.scale || 1), dealt, { heavy });
    if (m.hp <= 0) killMonster(world, m, now);
  }
}

// Apply a monster's connecting attack to the hero or the tower.
export function resolveMonsterAttacks(world, now) {
  const hero = world.hero;
  for (const m of world.monsters) {
    if (m.hp <= 0) continue;
    const a = m.currentAttack;
    if (!a) { m._pendingHeroHit = m._pendingTowerHit = false; m._pendingAllyHit = null; continue; }
    const elapsed = now - a.started;
    const active = elapsed >= a.data.duration * 0.3 && elapsed <= a.data.duration * 0.72;
    if (!active) continue;

    if (m._pendingHeroHit && hero.hp > 0) {
      if (Math.abs(hero.x - m.x) <= m.def.atkRange + 30 && hero.y > -150) {
        m._pendingHeroHit = false;
        // Sharingan: negate a clean hit and warp behind for a counter.
        if (sharinganNegate(world, hero, m, m.x, now)) continue;
        // Untouchable trait (~99%) / Blur passive (15%) let the hero slip the hit,
        // but stamina gates the chance — near empty (<5%) the hero is too gassed to
        // weave and takes the blow.
        const ev = evasionStaminaFactor(hero);
        const dodge = (hero.traits?.untouchable && world.rng() < 0.99 * ev)
          || (hero.hasPassive('blur') && world.rng() < 0.15 * ev);
        if (dodge) {
          hero.status.set('invincible', now + 120);
          hero.dodgeDir = Math.sign(hero.x - m.x) || hero.facing;
          hero.dodgeStartAt = now;
          hero.pose = POSE.dodge;
          world.hitEffects.push({ x: hero.x, y: TD.GROUND_Y + hero.y - 70, t: 0, dmg: 0, block: true });
        } else {
          const mdmg = m.dmg ?? m.def.dmg;
          const heavy = m.def.scale > 1.2 || mdmg >= 22; // brutes/elites & big hits land HARD
          const dealt = hero.takeDamage(mdmg, heavy, m.x, now);
          const kb = heavy ? 420 : 200;
          hero.vx += Math.sign(hero.x - m.x) * kb;
          if (heavy && !hero.traits?.unbreakable) {
            // Beaten heavy: a real stagger — stunned, can't act, knocked back.
            hero.pose = POSE.hit; hero.poseTime = 0;
            hero.status.set('stun', now + 420);
            if (mdmg >= 34) hero.vy = -240; // the biggest blows pop the hero off the ground
            world.slowMo = 120;
          }
          addHit(world, hero.x, TD.GROUND_Y + hero.y - 70, dealt, { heavy });
          // Thorns passive: reflect a slice of the damage back.
          if (hero.hasPassive('thorns')) {
            const r = m.takeDamage(Math.round(mdmg * PASSIVE.THORNS_REFLECT), false, hero.x, now);
            addHit(world, m.x, TD.GROUND_Y + m.y - 70 * (m.scale || 1), r, {});
            if (m.hp <= 0) killMonster(world, m, now);
          }
        }
      }
    }
    if (m._pendingAllyHit != null) {
      const ally = world.allies.find(x => x.id === m._pendingAllyHit && x.hp > 0);
      if (!ally || Math.abs(ally.x - m.x) > m.def.atkRange + 30 || ally.y <= -150) {
        m._pendingAllyHit = null;
      } else {
        m._pendingAllyHit = null;
        const mdmg = m.dmg ?? m.def.dmg;
        const heavy = m.def.scale > 1.2 || mdmg >= 22;
        const dealt = ally.takeDamage(mdmg, heavy, m.x, now);
        ally.vx += Math.sign(ally.x - m.x) * (heavy ? 360 : 180);
        ally.pose = POSE.hit; ally.poseTime = 0;
        if (heavy) ally.status.set('stun', now + 300);
        addHit(world, ally.x, TD.GROUND_Y + ally.y - 70 * (ally.scale || 1), dealt, { heavy });
      }
    }
    if (m._pendingTowerHit) {
      const tower = world.playerTower;
      if (m.x - (tower.x + tower.w / 2) <= TD.TOWER_RANGE) {
        m._pendingTowerHit = false;
        const tdmg = m.towerDmg ?? m.def.towerDmg;
        tower.hp = Math.max(0, tower.hp - tdmg);
        world.screenShake = Math.min(30, world.screenShake + 10);
        addHit(world, tower.x + tower.w / 2, TD.GROUND_Y - 120, tdmg, { heavy: true });
      }
    }
  }
}

// Hero meleeing the enemy tower (to win).
export function resolveHeroVsEnemyTower(world, now) {
  const hero = world.hero;
  const hb = hero.getAttackHitbox?.(now);
  const et = world.enemyTower;
  if (!hb || et.hp <= 0) return;
  if (hero.facing < 0) return;
  if (Math.abs(hb.x - (et.x - et.w / 2)) > 120) return;
  const id = hero.currentAttack.started;
  if (hero._towerHitId === id) return;
  hero._towerHitId = id;
  const dmg = Math.round(hb.damage * hero.damageMult * 1.5);
  et.hp = Math.max(0, et.hp - dmg);
  addHit(world, et.x - et.w / 2, TD.GROUND_Y - 150, dmg, { heavy: true });
}

// Credit a monster's death exactly once — bumping the hero's kill count and gold
// pool (world.gold IS the hero's purse) — no matter what landed the killing blow:
// the hero's fists/skills, the BASE TOWER's arrows, a burning DoT, or thorns.
export function killMonster(world, m, now) {
  m._dead = true;
  if (m._credited) return;
  m._credited = true;
  world.kills += 1;
  world.gold += (m.reward ?? m.def.reward);
  spawnHitParticles(world.particles, m.x, TD.GROUND_Y + m.y - 60, true, world.rng);
}

// Sharingan: if active and off internal cooldown, negate an incoming hit, warp
// the hero beside the attacker, and counter (melee attacker only). Returns true
// when the hit was negated. Reused by both melee and ranged hit resolution.
export function sharinganNegate(world, hero, attacker, attackerX, now) {
  if (!hero.status.active('sharingan', now) || hero.status.active('sharinganCd', now)) return false;
  hero.status.set('sharinganCd', now + 650);
  hero.status.set('invincible', now + 220);
  const dir = Math.sign(attackerX - hero.x) || hero.facing || 1;
  hero.x = attackerX - dir * 62;
  hero.facing = dir;
  hero.vx = 0;
  hero.needsDashDust = true;
  world.hitEffects.push({ x: hero.x, y: TD.GROUND_Y - 70, t: 0, dmg: 0, sharinganWarp: true });
  world.slowMo = Math.max(world.slowMo, 160);
  if (attacker && attacker.isMonster && attacker.hp > 0) {
    const dealt = attacker.takeDamage(Math.round(40 * hero.damageMult), true, hero.x, now);
    attacker.vx += dir * 380; attacker.status.set('stun', now + 480); attacker.currentAttack = null;
    addHit(world, attacker.x, TD.GROUND_Y + attacker.y - 70 * (attacker.scale || 1), dealt, { heavy: true, counter: true });
    if (attacker.hp <= 0) killMonster(world, attacker, now);
  }
  return true;
}

export function reapDead(world, now) {
  // Catch deaths from sources that bypass killMonster (burning/DoT ticks inside a
  // fighter's own update, etc.) so their reward is never silently dropped.
  for (const m of world.monsters) if (m.hp <= 0 && !m._credited) killMonster(world, m, now);
  world.monsters = world.monsters.filter(m => !m._dead);
}

// Keep marching monsters from stacking into a single blob: nudge overlapping
// neighbours apart along the lane so they read as a column.
export function separateMonsters(world) {
  const ms = world.monsters;
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i];
    if (a.hp <= 0 || a.y < -20) continue;
    for (let j = i + 1; j < ms.length; j++) {
      const b = ms[j];
      if (b.hp <= 0 || b.y < -20) continue;
      const minGap = 34 * (a.scale || 1) + 34 * (b.scale || 1);
      const dx = b.x - a.x;
      const d = Math.abs(dx);
      if (d < minGap) {
        const push = (minGap - d) * 0.5;
        // Break perfect overlaps (d≈0) deterministically by spawn order.
        const dir = d > 0.001 ? (dx > 0 ? 1 : -1) : 1;
        a.x -= dir * push;
        b.x += dir * push;
      }
    }
  }
}
