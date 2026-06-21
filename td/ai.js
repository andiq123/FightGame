import { POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { gate, statT } from '../config/stats.js';
import { castMonsterSkill } from './projectiles.js';
import { inboundProjectile, senseTarget, evasionStaminaFactor } from './perception.js';
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
  // ONE decision per bolt: the hero commits to dodge-or-eat the instant it reads
  // the shot, instead of re-rolling every frame (which let a tiny per-frame chance
  // accumulate into a near-certain dodge over the approach). Mark this bolt as
  // evaluated so a failed read isn't retried.
  const bolt = threat.projectile;
  if (bolt) {
    bolt._evadeRolledBy = bolt._evadeRolledBy || new Set();
    if (bolt._evadeRolledBy.has(hero.id)) return false;
    bolt._evadeRolledBy.add(hero.id);
  }
  // An exhausted hero can barely weave — stamina gates the evade chance, so near
  // empty (<5%) it almost always eats the bolt.
  if (world.rng() > gate(skill, 0.12) * evasionStaminaFactor(hero)) return false;
  hero._evadeAt = now + 320;
  if (!hero.startDash?.(threat.evadeDir, now)) {     // i-frame weave (DASH_STAMINA)
    hero.status.set('invincible', now + 160);        // fallback: brief slip if too tired to dash
    hero.pose = POSE.dodge; hero.dodgeStartAt = now; hero.dodgeDir = threat.evadeDir;
  }
  return true;
}

// ── Situational awareness ────────────────────────────────────────────────────
// One read of the battlefield the hero reasons about: how many enemies crowd it,
// how much RANGED pressure it's under, where the densest cluster sits (for AoE),
// and which enemy most threatens the base. Every decision site gates its use of
// this by intelligence, so a dull hero ignores most of it and a sharp one plays
// the whole board. Counts use lane distance; the cluster scan is the only O(n²)
// part and n (live monsters on screen) is small.
const LANE_NEAR = 780;        // "in my fight" window
function assess(hero, world) {
  const range = TD.HERO.attackRange;
  const baseX = world.playerTower.x;
  let melee = 0, near = 0, casters = 0, inbound = 0, baseThreat = null;
  const ahead = [];
  const dir = hero.facing;
  for (const m of world.monsters) {
    if (m.hp <= 0) continue;
    const d = Math.abs(m.x - hero.x);
    if (d <= range * 1.45) melee++;
    if (d <= LANE_NEAR) near++;
    if (m.ranged && d <= (m.ranged.range || 560) * 1.2) casters++;
    if (!baseThreat || m.x < baseThreat.x) baseThreat = m;       // smallest x = closest to base
    const rel = (m.x - hero.x) * dir;
    if (rel > -40 && rel < 1500) ahead.push(m);
  }
  for (const p of world.projectiles) {
    if (p.target !== 'hero') continue;
    if (Math.sign(hero.x - p.x) === Math.sign(p.vx)) inbound++;   // bearing down on the hero
  }
  // Densest AoE aim point: the enemy around which the most others sit within an
  // AoE-sized window — so the hero throws fireball/ice where it lands the most.
  let clusterCount = 0, clusterX = null;
  for (const a of ahead) {
    let c = 0;
    for (const b of ahead) if (Math.abs(b.x - a.x) <= 115) c++;
    if (c > clusterCount) { clusterCount = c; clusterX = a.x; }
  }
  return {
    melee, near, casters, inbound, baseThreat, clusterCount, clusterX,
    // Being swarmed in melee, or a big crowd with several already on us.
    overwhelmed: melee >= 3 || (near >= 5 && melee >= 2),
    // Under enough ranged fire that standing in the open is a bad idea.
    rangedPressure: inbound >= 2 || casters >= 2,
  };
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

  // ── TACTICAL REGROUP (intelligence-gated): a sharp hero that's being SWARMED or
  // pelted by ranged fire falls back toward the base — into the tower's covering
  // arrows and the heal zone — instead of brawling in the open and getting
  // collapsed on. It keeps zoning the crowd with skills on the way back (see
  // decide). A dull hero doesn't read the danger and stands its ground. ──
  const sit = assess(hero, world);
  const reads = skill >= 0.4;                    // INT ~lvl 9+ recognizes the trap
  // BASE IN DANGER: when the base is low a smart hero abandons the offence and
  // rushes home to hold the line (the dramatic last stand that buys the Aegis
  // barrier time to recharge the run).
  const baseLow = world.playerTower.hp < world.playerTower.maxHp * 0.35;
  if (reads && !finishing && (sit.overwhelmed || sit.rangedPressure || baseLow)) hero._regroup = true;
  else if (sit.melee === 0 && !sit.rangedPressure && !baseLow) hero._regroup = false; // danger passed
  const tacticalRetreat = reads && !!hero._regroup;
  const regroup = recovering || tacticalRetreat;

  hero._winded = recovering || fleeing; // drives the HUD dim
  hero._scared = fleeing;
  if (recovering && !fleeing) hero.stamina = Math.min(hero.maxStamina, hero.stamina + dt * TD.HERO.windedRegen);

  let intent = {};
  if (now >= (hero._nextDecisionAt || 0)) {
    hero._nextDecisionAt = now + (hero.ai?.reactionIntervalMs ?? 200);
    intent = decide(hero, world, skill, sit, regroup || fleeing, now);
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
  const nearestThreat = (fleeing || regroup) ? nearestMonster(world, hero.x) : null;
  const cornered = !!nearestThreat && Math.abs(nearestThreat.x - hero.x) <= range * 1.05 && Math.abs(hero.y) < 60;

  let goalX, faceX, inRange, retreating = false;
  if (cornered) {
    // Caught in melee. If we're trying to pull back (tacticalRetreat), do a
    // FIGHTING RETREAT — keep shuffling home toward the tower while swinging at
    // whatever's on us — instead of rooting in place and getting collapsed on.
    faceX = nearestThreat.x;
    inRange = true;
    if (tacticalRetreat && Math.abs(hero.x - baseSpot) > 40) { goalX = baseSpot; retreating = true; }
    else goalX = hero.x;
  } else if (fleeing) {
    // Sprint home, glancing back at the pursuers (scared backpedal read).
    const threat = nearestThreat;
    faceX = threat ? threat.x : hero.x + 1;
    goalX = baseSpot;
    inRange = false;
    retreating = true;
  } else if (regroup) {
    // Fall back toward the base, facing the crowd. When SWARMED or under ranged
    // fire (tacticalRetreat) the hero pulls all the way home into the tower's
    // covering arrows and heal zone; when merely catching its breath it just
    // backs off to a safe rest distance. Either way it keeps zoning on the way.
    const threat = nearestThreat;
    const gap = threat ? Math.abs(threat.x - hero.x) : Infinity;
    faceX = threat ? threat.x : hero.x + hero.facing;
    if (tacticalRetreat && Math.abs(hero.x - baseSpot) > 40) { goalX = baseSpot; retreating = true; }
    else if (gap >= TD.HERO.restSafeDist) { goalX = hero.x; }
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
    if (Math.abs(dx) > 14 && (!inRange || retreating)) {
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

// Intelligence-gated decision: choose a target and maybe cast a power skill, both
// informed by the situational read (`sit`). `defensive` = the hero is falling
// back (flee/regroup), so it only throws offensive skills from the safety of the
// base — zoning the crowd rather than committing forward.
function decide(hero, world, skill, sit, defensive, now) {
  const monsters = world.monsters.filter(m => m.hp > 0);
  const intent = {};
  hero._targetId = monsters.length ? pickTarget(hero, world, skill, now) : null;
  if (hero.skills?.length && hero.stamina > TD.HERO.skillStaminaCost) {
    intent.skill = chooseSkill(hero, world, skill, sit, defensive, now) || undefined;
  }
  return intent;
}

// Target choice. Dull hero: nearest body. Sharp hero: defend the base, but bump
// CASTERS (silence the ranged pelting) and nearly-dead enemies (finish to thin
// the crowd) up the priority order — encoded as a virtual "closer to base" shift.
function pickTarget(hero, world, skill, now) {
  const monsters = world.monsters.filter(m => m.hp > 0);
  // Anything already on the hero is answered first (base-ward of those on us).
  const onMe = monsters.filter(m => Math.abs(m.x - hero.x) < 150);
  if (onMe.length) return onMe.reduce((a, b) => (a.x < b.x ? a : b)).id;
  const lazy = monsters.reduce((a, b) => Math.abs(b.x - hero.x) < Math.abs(a.x - hero.x) ? b : a);
  if (world.rng() > gate(skill, 0.1)) return lazy.id;          // dull: just the nearest
  const baseX = world.playerTower.x;
  let best = lazy, bestKey = Infinity;
  for (const m of monsters) {
    let key = Math.abs(m.x - baseX);                            // closest to base wins
    if (m.ranged) key -= 360;                                   // prioritise casters
    if (m.hp <= TD.HERO.finishHp * 1.5) key -= 260;             // pick off the nearly-dead
    if (key < bestKey) { bestKey = key; best = m; }
  }
  return best.id;
}

// Power-skill selection — the heart of "melee vs skill, used correctly":
//   • Sharingan (buff): defensive panic button when SWARMED or hurt.
//   • Heal: when wounded and reasonably safe (or desperate).
//   • AoE projectile (fireball/ice): saved for a CLUSTER — thrown where it hits
//     the most enemies. Wasted on a lone target.
//   • Single-target projectile (shuriken): for a real target that's out of fist
//     range or when a crowd is closing — NOT a lone enemy already in melee, which
//     the hero simply punches (saves stamina & cooldowns).
function chooseSkill(hero, world, skill, sit, defensive, now) {
  const tgt = hero._targetId != null ? world.monsters.find(m => m.id === hero._targetId) : null;
  const dir = hero.facing;
  const atBase = Math.abs(hero.x - world.playerTower.x) < TD.HERO.baseHealZone;
  const range = TD.HERO.attackRange;
  const tgtAhead = tgt && Math.sign(tgt.x - hero.x) === dir;
  const tgtDist = tgt ? Math.abs(tgt.x - hero.x) : Infinity;
  const loneMeleeTarget = sit.near <= 1 && tgt && tgtDist <= range; // just punch it

  for (const s of hero.skills) {
    if ((hero.powerCooldowns[s.id] ?? 0) > now) continue;
    if (s.kind === 'buff') {
      if (!hero.status.active('sharingan', now) && (sit.melee >= 2 || hero.hp < hero.maxHp * 0.5)
          && world.rng() < gate(skill, 0.3)) return s;
    } else if (s.kind === 'heal') {
      const safeish = sit.melee === 0 || atBase;
      if (hero.hp < hero.maxHp * 0.55 && (safeish || hero.hp < hero.maxHp * 0.3)
          && world.rng() < gate(skill, 0.14)) return s;
    } else { // projectile
      if (defensive && !atBase) continue;                       // only zone from home while falling back
      const clusterHit = sit.clusterCount >= 2 && sit.clusterX != null
        && Math.sign(sit.clusterX - hero.x) === dir && Math.abs(sit.clusterX - hero.x) < s.range;
      let worth, eager;
      if (s.aoe) {
        worth = clusterHit;                                     // AoE only earns its cooldown on a crowd
        eager = 0.55;
      } else {
        worth = tgtAhead && tgtDist < s.range && !loneMeleeTarget; // chip ranged/incoming, not a lone brawl
        eager = atBase ? 0.24 : (sit.near >= 2 ? 0.2 : 0.12);
      }
      if (worth && world.rng() < gate(skill, eager)) return s;
    }
  }
  return null;
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
  // FLANKING: when the hero is already mobbed, smart back-line melee peel off and
  // rush the BASE instead of piling onto the same target — a pincer the hero must
  // answer by falling back (see the hero's tacticalRetreat). Casters always prefer
  // shooting the hero, so they don't flank.
  // SIEGE units ignore the hero entirely and bear down on the base; everyone else
  // hunts the hero (unless flanking). Either way they still stop to smash an ally
  // blocking the lane.
  const flank = shouldFlank(m, world, now);
  const chaseHero = !m.siege && heroTargetable && distHero < aggro && !flank;
  const ranged = m.ranged;

  // ALLIED FRONT LINE: a melee enemy fights the nearest friendly fighter blocking
  // its path — one that's closer than the hero, or that stands between it and the
  // base it's flanking toward — so the wall of allies actually soaks the column
  // instead of being walked past. Casters ignore the wall and keep shooting the hero.
  // Siege units are single-minded — they bypass the allied wall and bee-line for
  // the base, so the forward line can't simply soak them; only the base tower and
  // a hero who races home can stop them.
  const blockAlly = (ranged || m.siege) ? null : nearestAlly(world, m.x);
  const allyDist = blockAlly ? Math.abs(blockAlly.x - m.x) : Infinity;
  const engageAlly = !!blockAlly && allyDist < aggro
    && (allyDist <= distHero + 20 || !heroTargetable || flank);

  let goalX, mode, targetX, stopDist, foeAllyId = null;
  if (engageAlly) {
    mode = 'meleeAlly';
    foeAllyId = blockAlly.id;
    targetX = blockAlly.x;
    const side = Math.sign(m.x - blockAlly.x) || (m.facing >= 0 ? 1 : -1);
    goalX = blockAlly.x + side * def.atkRange * 0.55;
    stopDist = def.atkRange;
  } else if (chaseHero) {
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
    const siegeMul = m.siege ? (TD.WAVE.siegeSpeedMul || 1.5) : 1; // siege units sprint
    m.vx += (dir * def.speed * speedMul * eventSpeed * siegeMul - m.vx) * Math.min(1, dt * 6);
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
      } else if (mode === 'meleeAlly') {
        m.startAttack(HEAVY(m), now);
        m._pendingAllyHit = foeAllyId;
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

// Decide whether this monster should break off the hero and siege the base. Only
// back-line melee with enough wits flank, and only once the hero is genuinely
// mobbed (≥3 attackers on it) — so the front line keeps the hero pinned while the
// rest swing wide. The choice is sticky (a few seconds) so they commit instead of
// dithering at the threshold.
function shouldFlank(m, world, now) {
  if (m.ranged || m.scale > 1.4) return false;                 // casters shoot; brutes are too slow
  if (now < (m._flankUntil || 0)) return true;                 // committed
  const hero = world.hero;
  if (hero.hp <= 0 || world.heroDownUntil) return false;       // no hero to pin → just rush
  const reach = (m.def?.atkRange || 90) * 1.5;
  if (Math.abs(m.x - hero.x) < reach) return false;            // front-liner: keep the hero
  let attackers = 0;
  for (const o of world.monsters) {
    if (o.hp <= 0 || o.ranged) continue;
    if (Math.abs(o.x - hero.x) <= (o.def?.atkRange || 90) * 1.45) attackers++;
  }
  if (attackers < 3) return false;
  if (now < (m._flankCheckAt || 0)) return false;              // re-roll occasionally, not every frame
  m._flankCheckAt = now + 700;
  const intel = statT(m.intelligence || 5);
  if (world.rng() < 0.15 + 0.55 * intel) { m._flankUntil = now + 4200; return true; }
  return false;
}

// Agile monsters dodge the hero's bolts with a quick i-frame leap aside. Even the
// heavy brutes can now sidestep — clumsier and rarer, but no longer sitting ducks.
function tryMonsterDodge(m, world, now) {
  if (m.status.active('invincible', now)) return true;
  if (!m.canAct(now) || now < (m._evadeAt || 0)) return false;
  const big = (m.scale || 1) > 1.4;
  const intel = statT(m.intelligence || 5);
  const threat = inboundProjectile(world, m, 'monster');
  if (!threat) return false;
  const tMs = threat.t * 1000;
  if (tMs > 90 + intel * 360 || tMs < 30) return false;
  // Brutes are heavier and clumsier — a much lower chance and a longer recovery.
  if (world.rng() > gate(intel, 0.04) * (big ? 0.45 : 1)) return false;
  m._evadeAt = now + (big ? 1100 : 700);
  m.status.set('invincible', now + (big ? 150 : 170));
  if (m.onGround()) {
    m.vy = TD.MONSTER.jumpVy * (big ? 0.62 : 1);
    m.vx += (world.rng() < 0.5 ? -1 : 1) * 120 * (big ? 0.5 : 1); // weave sideways
    m.pose = POSE.jump; m.needsDashDust = true;
  }
  return true;
}

// Athletic flourishes that make the advance dynamic and hard to read: a randomised
// LEAP to close a medium gap, a sudden LUNGE-dash, a JUKE (hop back in the hero's
// face to bait a whiff and slip it), and — for the big brutes — a heavy crashing
// leap. Every velocity is jittered so no two moves look the same.
function maybeAthleticMove(m, world, dir, dist, now) {
  if (!m.onGround()) return;
  const M = TD.MONSTER;
  const smart = statT(m.intelligence || 5);
  const jumpy = world.waveEvent?.jumpy || 1;
  const big = (m.scale || 1) > 1.4;
  const r = world.rng;

  // JUKE — point-blank bait-and-slip. Usually hop backward (whiff bait), sometimes
  // dart through. This is what makes melee against them feel slippery.
  if (dist < M.jukeGap && now >= (m._jukeAt || 0) && r() < (0.013 + 0.05 * smart) * jumpy) {
    m._jukeAt = now + M.jukeCdMs;
    const back = r() < 0.62 ? -1 : 1;
    m.vx = back * dir * M.jukeVx * (0.7 + r() * 0.6);
    m.vy = M.jukeVy * (0.55 + r() * 0.6);
    m.pose = POSE.jump; m.needsDashDust = true;
    return;
  }

  if (big) {
    // Heavy crashing leap — brutes are agile in bursts, not lumbering.
    if (dist > M.bruteLeapGapMin && dist < M.bruteLeapGapMax && now >= (m._jumpAt || 0)
        && r() < (0.006 + 0.02 * smart) * jumpy) {
      m._jumpAt = now + M.bruteLeapCdMs;
      m.vy = M.bruteLeapVy * (0.85 + r() * 0.4);
      m.vx = dir * M.bruteLeapVx * (0.85 + r() * 0.5);
      m.pose = POSE.jump; m.needsDashDust = true;
    }
    return;
  }

  // Nimble types: springy leap or sudden lunge, both with randomised power.
  if (dist > M.jumpGapMin && dist < M.jumpGapMax && now >= (m._jumpAt || 0)
      && r() < (0.014 + 0.05 * smart) * jumpy) {
    m._jumpAt = now + M.jumpCdMs;
    m.vy = M.jumpVy * (0.8 + r() * 0.5);
    m.vx = dir * M.jumpVx * (0.8 + r() * 0.6);
    m.pose = POSE.jump; m.needsDashDust = true;
  } else if (dist < M.lungeGap && now >= (m._lungeAt || 0) && r() < (0.012 + 0.045 * smart)) {
    m._lungeAt = now + M.lungeCdMs;
    m.vx = dir * M.lungeVx * (0.85 + r() * 0.5);
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

export function nearestAlly(world, x) {
  let best = null, bd = Infinity;
  for (const a of world.allies || []) {
    if (a.hp <= 0) continue;
    const d = Math.abs(a.x - x);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
