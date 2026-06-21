// Allied reinforcements: friendly fighters the player RECRUITS from the shop to
// intercept the enemy column. They use the same Fighter body and combat resolution
// as everyone else, with a compact "hunt the nearest enemy, hold a forward line
// otherwise" brain. Their kills credit the hero's gold (via killMonster), so a wall
// of allies buys the hero breathing room to farm and upgrade instead of just healing.
import { POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { TD } from './config.js';
import { killMonster } from './combat.js';
import { spawnHitParticles } from '../services/particleSystem.js';

const ALLY_COMBO = [ATTACK.jab, ATTACK.cross, ATTACK.hook, ATTACK.highKick];

// Nearest live enemy to a lane position (shared by the ally brain).
export function nearestEnemy(world, x) {
  let best = null, bd = Infinity;
  for (const m of world.monsters) {
    if (m.hp <= 0) continue;
    const d = Math.abs(m.x - x);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

// Ally brain — hunt the closest enemy and trade blows; with the lane clear, hold a
// forward defensive line ahead of the base so the next wave is met away from home.
export function updateAlly(a, world, dt, now) {
  if (a.hp <= 0) return;
  const range = a.attackRange;
  const target = nearestEnemy(world, a.x);

  let goalX, faceX, inRange;
  if (target) {
    faceX = target.x;
    const side = a.x <= target.x ? -1 : 1;          // approach from its near side
    goalX = target.x + side * range * 0.55;
    inRange = Math.abs(target.x - a.x) <= range && Math.abs(a.y) < 60;
  } else {
    const lineX = TD.PLAYER_TOWER_X + TD.ALLY.lineAhead;
    faceX = lineX + 1; goalX = lineX; inRange = false;
  }

  if (a.canAct(now)) a.facing = faceX >= a.x ? 1 : -1;

  const dx = goalX - a.x;
  if (a.canAct(now)) {
    if (Math.abs(dx) > 14 && !inRange) {
      const sp = Math.sign(dx) * a.moveSpeed;
      a.vx += Math.sign(sp - a.vx) * 3600 * dt;
      if (Math.sign(sp) === Math.sign(a.vx) && Math.abs(a.vx) > Math.abs(sp)) a.vx = sp;
      if (a.onGround()) a.pose = POSE.walk;
    } else {
      a.vx -= Math.sign(a.vx) * Math.min(Math.abs(a.vx), 2600 * dt);
      if (a.onGround() && Math.abs(a.vx) < 30) a.pose = POSE.idle;
    }
  }

  if (inRange && a.canAct(now) && now >= (a.nextAtkAt || 0)) {
    a.nextAtkAt = now + a.atkCdMs;
    const step = a._comboStep || 0;
    a.startAttack(ALLY_COMBO[step % ALLY_COMBO.length], now);
    if (a.currentAttack) { a._comboStep = step + 1; a._lastComboAt = now; }
  }
  if (now - (a._lastComboAt || 0) > 900) a._comboStep = 0;
}

// Resolve every ally's active melee against the enemy column (mirrors
// resolveHeroAttacks). A killing blow credits the hero's gold via killMonster.
export function resolveAllyAttacks(world, now) {
  for (const a of world.allies) {
    if (a.hp <= 0) continue;
    const hb = a.getAttackHitbox?.(now);
    if (!hb) continue;
    if (!a._hitSet || a._hitAtkId !== a.currentAttack.started) {
      a._hitSet = new Set();
      a._hitAtkId = a.currentAttack.started;
    }
    for (const m of world.monsters) {
      if (m.hp <= 0 || a._hitSet.has(m.id)) continue;
      const half = (m.def.atkRange * 0.5) + hb.w * 0.5 + 18 * (m.scale || 1);
      if (Math.abs(m.x - hb.x) > half) continue;
      if (m.y < -160) continue;
      a._hitSet.add(m.id);
      const dmg = Math.round(hb.damage * a.damageMult);
      const heavy = hb.knockback > 45;
      const dealt = m.takeDamage(dmg, heavy, a.x, now);
      m.vx += a.facing * hb.knockback * 6;
      if (hb.kickLaunch || hb.knockdown) m.vy = -260;
      m.pose = POSE.hit; m.poseTime = 0;
      m.currentAttack = null;
      m.status.set('stun', now + (heavy ? 320 : 130));
      world.hitEffects.push({ x: m.x, y: TD.GROUND_Y + m.y - 70 * (m.scale || 1), t: 0, dmg: dealt, heavy });
      spawnHitParticles(world.particles, m.x, TD.GROUND_Y + m.y - 60, heavy, world.rng);
      if (m.hp <= 0) killMonster(world, m, now);
    }
  }
}

export function reapAllies(world) {
  world.allies = world.allies.filter(a => a.hp > 0);
}
