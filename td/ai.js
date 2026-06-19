import { POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { gate, statT } from '../config/stats.js';
import { castMonsterSkill } from './projectiles.js';
import { inboundProjectile, senseTarget } from './perception.js';
import { TD } from './config.js';

// ── Hero brain (fully autonomous) ────────────────────────────────────────────
// A smart defender that paces itself by STAMINA and fights with melee combos +
// the equipped POWER SKILLS (no special). Priorities:
//   1. If something is right on the hero → fight it.
//   2. Otherwise intercept the threat nearest the base (sharper INT = better).
//   3. Lane clear → siege the enemy keep.
//   4. Winded (low stamina) → break off and recover.
const HERO_COMBO = [ATTACK.jab, ATTACK.cross, ATTACK.hook, ATTACK.highKick];

// Intelligence-gated reactive dodge of an inbound projectile. Reads the threat
// via raycast; the read window and reliability scale with INT (lvl 20 ≈ frame
// perfect, low INT eats it). A successful dodge is an i-frame sidestep that makes
// the bolt whiff. Returns true if the hero committed to a dodge this frame.
function tryDodgeProjectile(hero, world, skill, now) {
  if (hero.status.active('invincible', now)) return true; // already mid-dodge
  if (!hero.canAct(now) || now < (hero._evadeAt || 0)) return false;
  const threat = inboundProjectile(world, hero, 'hero');
  if (!threat) return false;
  if (hero.status.active('sharingan', now)) return false; // let it hit → counter
  const tMs = threat.t * 1000;
  const readWindow = 110 + skill * 560;        // smarter = sees it sooner
  if (tMs > readWindow || tMs < 30) return false;
  if (world.rng() > gate(skill, 0.12)) return false; // sometimes fails to react
  hero._evadeAt = now + 320;
  if (!hero.startDash?.(threat.evadeDir, now)) {     // i-frame weave (DASH_STAMINA)
    hero.status.set('invincible', now + 160);        // fallback: brief slip if too tired to dash
    hero.pose = POSE.dodge; hero.dodgeStartAt = now; hero.dodgeDir = threat.evadeDir;
  }
  return true;
}

export function updateHero(hero, world, dt, now) {
  if (hero.hp <= 0) return {};

  const skill = hero.ai?.skill ?? 0.5;          // 0..1 intelligence
  const range = TD.HERO.attackRange;
  const keepEdge = world.enemyTower.x - world.enemyTower.w / 2;

  // ── REACTIVE PROJECTILE EVASION (intelligence-gated, raycast threat). A smart
  // hero reads an inbound bolt early and sidesteps with i-frames; a dull one eats
  // it. This interrupt runs before everything else — dodging is top priority. ──
  if (tryDodgeProjectile(hero, world, skill, now)) return {};

  let target = hero._targetId != null
    ? world.monsters.find(m => m.id === hero._targetId && m.hp > 0)
    : null;

  // ── FLEE: when badly hurt the hero gets scared and sprints HOME to the base
  // to heal in the safe zone, then charges back out once patched up. ──
  const hpRatio = hero.hp / (hero.maxHp || 1);
  if (hpRatio >= TD.HERO.fleeRecoverHp) hero._fleeing = false;
  else if (hpRatio <= TD.HERO.fleeHpRatio) hero._fleeing = true;
  const fleeing = !!hero._fleeing && !hero.traits?.tireless;

  // ── Smart stamina management (ported from the master fighting AI): when low,
  // RETREAT to a safe distance and gather stamina — but don't bail if a target is
  // one hit from death (finish it first). Hysteresis avoids dithering. ──
  const stamRatio = hero.stamina / (hero.maxStamina || 1);
  const finishing = target && target.hp <= TD.HERO.finishHp && Math.abs(target.x - hero.x) <= range;
  if (hero.traits?.tireless) hero._recovering = false;
  else if (stamRatio >= TD.HERO.recoverRatio) hero._recovering = false;
  else if (stamRatio <= TD.HERO.windedRatio && !finishing) hero._recovering = true;
  const recovering = !!hero._recovering;
  hero._winded = recovering || fleeing; // drives the HUD dim
  hero._scared = fleeing;
  if (recovering && !fleeing) hero.stamina = Math.min(hero.maxStamina, hero.stamina + dt * TD.HERO.windedRegen);

  let intent = {};
  if (now >= (hero._nextDecisionAt || 0)) {
    hero._nextDecisionAt = now + (hero.ai?.reactionIntervalMs ?? 200);
    intent = decide(hero, world, skill, recovering || fleeing, now);
    target = hero._targetId != null ? world.monsters.find(m => m.id === hero._targetId && m.hp > 0) : null;
  }

  const baseSpot = world.playerTower.x + world.playerTower.w / 2 + 80;

  // Blink trait: when the hero decides to disengage (flee or recover) and isn't
  // already home, it TELEPORTS straight to the base instead of running.
  if (hero.traits?.blink && (fleeing || recovering) && hero.canAct(now)
      && Math.abs(hero.x - baseSpot) > 260 && now >= (hero._blinkHomeAt || 0)) {
    hero.x = baseSpot;
    hero.vx = 0; hero._blinkHomeAt = now + 2500; hero.needsDashDust = true;
    hero.status.set('invincible', now + 160);
  }

  // CORNERED: while sheltering/recovering, if an enemy reaches melee range there
  // is no escape — the hero fights back (and keeps healing at the base). Survival
  // over caution.
  const nearestThreat = (fleeing || recovering) ? nearestMonster(world, hero.x) : null;
  const cornered = !!nearestThreat && Math.abs(nearestThreat.x - hero.x) <= range * 1.05 && Math.abs(hero.y) < 60;

  let goalX, faceX, inRange, retreating = false;
  if (cornered) {
    // Stand ground and swing at whatever caught us; healing continues passively.
    faceX = nearestThreat.x;
    goalX = hero.x;
    inRange = true;
  } else if (fleeing) {
    // Sprint home, glancing back at the pursuers (scared backpedal read).
    const threat = nearestThreat;
    faceX = threat ? threat.x : hero.x + 1;
    goalX = baseSpot;
    inRange = false;
    retreating = true;
  } else if (recovering) {
    // Retreat from the nearest threat toward the base until safely spaced, then
    // hold and recover. Stamina climbs; the hero re-engages once rested.
    const threat = nearestThreat;
    const gap = threat ? Math.abs(threat.x - hero.x) : Infinity;
    faceX = threat ? threat.x : hero.x + hero.facing;
    if (gap >= TD.HERO.restSafeDist) { goalX = hero.x; }
    else { const away = threat ? (Math.sign(hero.x - threat.x) || -1) : -1; goalX = hero.x + away * (TD.HERO.restSafeDist + 60); retreating = true; }
    inRange = false;
  } else if (target) {
    faceX = target.x;
    const fromLeft = hero.x <= target.x;
    goalX = target.x + (fromLeft ? -range * 0.55 : range * 0.55);
    inRange = Math.abs(target.x - hero.x) <= range && Math.abs(hero.y) < 60;
  } else {
    faceX = world.enemyTower.x;
    goalX = keepEdge - range * 0.5;
    inRange = world.enemyTower.hp > 0 && Math.abs(keepEdge - hero.x) <= range && hero.x < keepEdge;
  }

  if (hero.canAct(now)) hero.facing = faceX >= hero.x ? 1 : -1;

  // Blink trait: teleport onto a far target instead of jogging (not while recovering/fleeing).
  if (hero.traits?.blink && target && !recovering && !fleeing && hero.canAct(now)) {
    const d = Math.abs(target.x - hero.x);
    if (d > 360 && now >= (hero._blinkAt || 0)) {
      hero.x = target.x - hero.facing * range * 0.5;
      hero.vx = 0; hero._blinkAt = now + 1400; hero.needsDashDust = true;
    }
  }

  // ── Movement. Sprint to chase a far target, OR to flee while retreating. ──
  const dx = goalX - hero.x;
  if (hero.canAct(now)) {
    if (Math.abs(dx) > 14 && !inRange) {
      const canRun = Math.abs(dx) > 200 && (retreating || (!recovering && hero.stamina > hero.maxStamina * 0.25));
      const targetSpeed = Math.sign(dx) * (canRun ? TD.HERO.run : TD.HERO.walk);
      hero.isRunning = canRun;
      const accel = hero.traits?.athletic ? TD.HERO.accel * 3 : TD.HERO.accel;
      hero.vx += Math.sign(targetSpeed - hero.vx) * accel * dt;
      if (Math.sign(targetSpeed) === Math.sign(hero.vx) && Math.abs(hero.vx) > Math.abs(targetSpeed)) hero.vx = targetSpeed;
      if (hero.onGround()) hero.pose = Math.abs(hero.vx) > TD.HERO.walk + 60 ? POSE.run : POSE.walk;
    } else {
      hero.isRunning = false;
      const brake = hero.traits?.athletic ? Math.abs(hero.vx) : TD.HERO.friction * dt;
      hero.vx -= Math.sign(hero.vx) * Math.min(Math.abs(hero.vx), brake);
      if (hero.onGround() && Math.abs(hero.vx) < 30) hero.pose = POSE.idle;
    }
  }

  // ── Strike in range. Normally we don't swing while recovering, but a CORNERED
  // hero fights for its life (cornered forces inRange). Chill attacks sparingly. ──
  if (inRange && (cornered || !recovering) && hero.canAct(now)) {
    const lazy = hero.traits?.chill && world.rng() > 0.35;
    if (!lazy) {
      const step = (hero._comboStep || 0);
      hero.startAttack(HERO_COMBO[step % HERO_COMBO.length], now);
      if (hero.currentAttack) { hero._comboStep = step + 1; hero._lastComboAt = now; }
    }
  }
  if (now - (hero._lastComboAt || 0) > 900) hero._comboStep = 0;

  return intent;
}

// Intelligence-gated decision: choose a target and maybe cast a power skill.
function decide(hero, world, skill, recovering, now) {
  const monsters = world.monsters.filter(m => m.hp > 0);
  const intent = {};

  if (monsters.length) {
    // Anything already on the hero gets answered first; otherwise a sharp hero
    // defends the BASE (leftmost threat), a dull one chases whatever's nearest.
    const onMe = monsters.filter(m => Math.abs(m.x - hero.x) < 150);
    if (onMe.length) {
      hero._targetId = onMe.reduce((a, b) => (a.x < b.x ? a : b)).id; // base-ward of those on me
    } else {
      const smart = monsters.reduce((a, b) => (b.x < a.x ? b : a));   // nearest base
      const lazy = monsters.reduce((a, b) => Math.abs(b.x - hero.x) < Math.abs(a.x - hero.x) ? b : a);
      hero._targetId = (world.rng() < gate(skill, 0.1)) ? smart.id : lazy.id;
    }
  } else {
    hero._targetId = null;
  }

  // ── Power-skill selection (no special — skills are the kit). ──
  if (hero.skills?.length && hero.stamina > TD.HERO.skillStaminaCost) {
    const tgt = hero._targetId != null ? world.monsters.find(m => m.id === hero._targetId) : null;
    const dir = hero.facing;
    const ahead = monsters.filter(m => { const rel = (m.x - hero.x) * dir; return rel > -40 && rel < 760; });
    const pressed = monsters.some(m => Math.abs(m.x - hero.x) < 170); // something on us
    // Sheltering at the base: keep ZONING the approach with projectiles even while
    // recovering/fleeing — a smart hero kites the incoming crowd from safety.
    const atBase = Math.abs(hero.x - world.playerTower.x) < TD.HERO.baseHealZone;
    for (const s of hero.skills) {
      if ((hero.powerCooldowns[s.id] ?? 0) > now) continue;
      if (s.kind === 'buff') {
        // Sharingan: pop it when pressured or hurt (defensive cooldown).
        if (!hero.status.active('sharingan', now) && (pressed || hero.hp < hero.maxHp * 0.5) && world.rng() < gate(skill, 0.25)) {
          intent.skill = s; break;
        }
      } else if (s.kind === 'heal') {
        if (hero.hp < hero.maxHp * 0.55 && world.rng() < gate(skill, 0.12)) { intent.skill = s; break; }
      } else { // projectile — fire when facing a target in range; ok at base
        const canFire = !recovering || atBase;
        if (canFire && ahead.length && tgt && Math.sign(tgt.x - hero.x) === dir
            && Math.abs(tgt.x - hero.x) < s.range && world.rng() < gate(skill, atBase ? 0.22 : 0.12)) {
          intent.skill = s; break;
        }
      }
    }
  }
  return intent;
}

// ── Monster brain ────────────────────────────────────────────────────────────
// Goal: KILL THE HERO FIRST, then the tower. Any monster within its aggro radius
// commits to the hero — turning around to chase if the hero slips past — and only
// marches on the tower when the hero is dead/down or out of range. Casters kite
// and fire skills; melee close in and strike.
const HEAVY = (m) => (m.scale || 1) > 1.2 ? ATTACK.axeKick : (m.typeKey === 'warlord' ? ATTACK.highKick : ATTACK.cross);

export function updateMonster(m, world, dt, now) {
  if (m.hp <= 0) return;
  // Smart enemies read and DODGE the hero's incoming projectiles too (symmetric
  // perception). Lighter monsters leap aside with i-frames; gated by intelligence.
  if (tryMonsterDodge(m, world, now)) return;
  const def = m.def;
  const hero = world.hero;
  const tower = world.playerTower;
  const towerEdge = tower.x + tower.w / 2;

  // Sense the hero via raycast (distance + clear line of sight) — same perception
  // primitive the hero uses, so enemies "see" rather than just know.
  const see = senseTarget(m, hero, world.obstacles);
  const heroTargetable = hero.hp > 0 && !world.heroDownUntil && see.clear;
  const aggro = (m.aggro ?? 320) * (0.85 + 0.4 * statT(m.intelligence || 5));
  const distHero = see.dist;
  const chaseHero = heroTargetable && distHero < aggro;
  const ranged = m.ranged;

  let goalX, mode, targetX, stopDist;
  if (chaseHero) {
    targetX = hero.x;
    if (ranged) {
      mode = 'rangedHero';
      const want = ranged.range * 0.65;
      const side = Math.sign(m.x - hero.x) || 1;        // hold/kite on its side
      goalX = (distHero < ranged.range * 0.4) ? hero.x + side * want : hero.x + side * want;
      stopDist = ranged.range;
    } else {
      mode = 'meleeHero';
      const side = Math.sign(m.x - hero.x) || (m.facing >= 0 ? 1 : -1);
      goalX = hero.x + side * def.atkRange * 0.55;       // approach from current side → turns around if hero passed
      stopDist = def.atkRange;
    }
  } else {
    mode = 'tower';
    targetX = towerEdge;
    goalX = towerEdge + (ranged ? ranged.range * 0.6 : def.atkRange * 0.6);
    stopDist = ranged ? ranged.range : def.atkRange;
  }

  // Wounded runners briefly recoil (scared) — symmetric to the hero's fear.
  if (m.typeKey === 'runner' && m.hp < m.maxHp * TD.MONSTER.runnerFleeHp && m.canAct(now) && now >= (m._flinchUntil || 0) && world.rng() < 0.02) {
    m._flinchUntil = now + 360;
  }
  const flinching = now < (m._flinchUntil || 0);

  m.facing = Math.sign(targetX - m.x) || m.facing;
  const distToTarget = Math.abs(m.x - targetX);
  const tooClose = ranged && chaseHero && distHero < ranged.range * 0.4; // kite back
  const arrived = !tooClose && distToTarget <= stopDist && !flinching;
  // Bolder (faster) while the hero is down — press the base relentlessly.
  const speedMul = world.heroDownUntil ? TD.MONSTER.downSpeedBoost : 1;
  const eventSpeed = world.waveEvent?.speed || 1;

  if (flinching && m.canAct(now)) {
    // Scared recoil: hop back from the threat.
    const away = Math.sign(m.x - targetX) || 1;
    m.vx += (away * def.speed * 1.3 - m.vx) * Math.min(1, dt * 8);
    if (m.onGround()) m.pose = POSE.walk;
  } else if ((!arrived || tooClose) && m.canAct(now)) {
    const dir = Math.sign(goalX - m.x);
    m.vx += (dir * def.speed * speedMul * eventSpeed - m.vx) * Math.min(1, dt * 6);
    if (m.onGround()) m.pose = POSE.walk;
    maybeAthleticMove(m, world, dir, distToTarget, now);
  } else if (m.canAct(now)) {
    m.vx *= 0.8;
    if (m.onGround() && m.pose !== POSE.punch && m.pose !== POSE.kick) m.pose = POSE.idle;
    if (now >= m.nextAtkAt) {
      m.nextAtkAt = now + (m.atkCdMs ?? def.atkCdMs) * (world.waveEvent?.atkCd || 1);
      if (mode === 'rangedHero') {
        m.pose = POSE.punch; m.poseTime = 0;
        castMonsterSkill(world, m, hero, now);
      } else if (mode === 'meleeHero') {
        m.startAttack(HEAVY(m), now);
        m._pendingHeroHit = true;
      } else if ((m.x - towerEdge) <= TD.TOWER_RANGE) {
        m.facing = -1;
        m.startAttack(HEAVY(m), now);
        m._pendingTowerHit = true;
      }
    }
  }
}

// Smart, agile monsters dodge the hero's bolts: a quick i-frame leap aside.
function tryMonsterDodge(m, world, now) {
  if (m.status.active('invincible', now)) return true;
  if (m.scale > 1.4 || !m.canAct(now) || now < (m._evadeAt || 0)) return false; // brutes can't
  const intel = statT(m.intelligence || 5);
  const threat = inboundProjectile(world, m, 'monster');
  if (!threat) return false;
  const tMs = threat.t * 1000;
  if (tMs > 90 + intel * 360 || tMs < 30) return false;
  if (world.rng() > gate(intel, 0.04)) return false; // less reliable than the hero
  m._evadeAt = now + 700;
  m.status.set('invincible', now + 170);
  if (m.onGround()) { m.vy = TD.MONSTER.jumpVy; m.pose = POSE.jump; m.needsDashDust = true; }
  return true;
}

// Athletic flourishes: smarter/quicker monsters LEAP to close a medium gap or
// LUNGE-dash when fairly close — makes the advance dynamic and unpredictable.
function maybeAthleticMove(m, world, dir, dist, now) {
  if (!m.onGround() || m.scale > 1.4) return; // brutes are too heavy to leap
  const M = TD.MONSTER;
  const smart = statT(m.intelligence || 5);
  const jumpy = world.waveEvent?.jumpy || 1;
  if (dist > M.jumpGapMin && dist < M.jumpGapMax && now >= (m._jumpAt || 0)
      && world.rng() < (0.010 + 0.035 * smart) * jumpy) {
    m._jumpAt = now + M.jumpCdMs;
    m.vy = M.jumpVy;
    m.vx = dir * M.jumpVx;
    m.pose = POSE.jump;
    m.needsDashDust = true;
  } else if (dist < M.lungeGap && now >= (m._lungeAt || 0)
      && world.rng() < (0.008 + 0.03 * smart)) {
    m._lungeAt = now + M.lungeCdMs;
    m.vx = dir * M.lungeVx;
    m.needsDashDust = true;
  }
}

export function nearestMonster(world, x) {
  let best = null, bd = Infinity;
  for (const m of world.monsters) {
    if (m.hp <= 0) continue;
    const d = Math.abs(m.x - x);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
