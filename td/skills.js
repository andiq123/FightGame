import { POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { TD, opp } from './config.js';
import { castCreepBolt, fireBaseArrow } from './projectiles.js';
import { killCreep, tryTdRagdoll } from './combat.js';
import { skillChanceMul } from './emote.js';
import { inRadiusX } from '../core/hitbox.js';
import { spawnHitParticles, spawnFrost } from '../services/particleSystem.js';

// Lightweight creep skills — no stamina model, just cooldowns + rng gates.
const HEAVY = (c) => ((c.scale || 1) > 1.2 ? ATTACK.axeKick : ATTACK.cross);

function addHit(world, x, y, dmg, heavy = false) {
  world.hitEffects.push({ x, y, t: 0, dmg, heavy, crit: false, counter: false });
  spawnHitParticles(world.particles, x, y, heavy, world.rng);
  world.screenShake = Math.min(30, world.screenShake + (heavy ? 12 : 5));
}

function aoeCreeps(world, cx, radius, team, dmg, now, from) {
  for (const o of world.creeps) {
    if (o.hp <= 0 || o.team === team) continue;
    if (!inRadiusX(cx, radius, o)) continue;
    const dealt = o.takeDamage(dmg, true, cx, now);
    o.vx += Math.sign(o.x - cx) * 260;
    o.pose = POSE.hit; o.poseTime = 0;
    tryTdRagdoll(world, o, cx, Math.sign(o.x - cx) * 360, -240, now, {
      heavy: true, dmg: dealt, knockdown: true, attackerScale: from?.scale ?? 1,
    });
    addHit(world, o.x, TD.GROUND_Y + o.y - 70, dealt, true);
    if (o.hp <= 0) killCreep(world, o, team, now);
  }
}

const SKILLS = {
  fireBurst(c, world, foe, now) {
    if (!foe || !c.ranged) return false;
    c.pose = POSE.punch; c.poseTime = 0;
    if (c.flying) c._flyShootT = 0.32;
    for (let i = -1; i <= 1; i += 2) {
      const t = { ...foe, x: foe.x + i * 90 };
      castCreepBolt(world, c, t, now);
    }
    c.nextAtkAt = now + c.atkCdMs * (TD.ATTACK_CD_MUL ?? 1.35) * (TD.RANGED_CD_MUL ?? 1.85)
      * (c.flying ? (TD.FLY_RANGED_CD_MUL ?? 1.35) : 1);
    spawnHitParticles(world.particles, c.x, TD.GROUND_Y - 80, true, world.rng);
    return true;
  },
  healPulse(c, world, _foe, now) {
    const heal = Math.round(c.maxHp * 0.18);
    c.hp = Math.min(c.maxHp, c.hp + heal);
    c.pose = POSE.idle;
    addHit(world, c.x, TD.GROUND_Y + c.y - 90, heal, false);
    return true;
  },
  dashStrike(c, world, foe, now) {
    if (!foe) return false;
    const dir = Math.sign(foe.x - c.x) || c.dir;
    c.x = foe.x - dir * (c.attackRange * 0.45);
    c.vx = dir * 520; c.needsDashDust = true;
    c.startAttack(HEAVY(c), now);
    c._pendingHit = foe.id;
    return true;
  },
  slam(c, world, foe, now) {
    const cx = foe ? foe.x : c.x + c.dir * 80;
    aoeCreeps(world, cx, 160, c.team, Math.round(c.dmg * 2.4), now, c);
    const base = world.bases[opp(c.team)];
    if (base.hp > 0 && Math.abs(cx - base.x) <= base.w / 2 + 140) {
      const dmg = Math.round(c.baseDmg * 0.55);
      base.hp = Math.max(0, base.hp - dmg);
      addHit(world, base.x, TD.GROUND_Y - 120, dmg, true);
    }
    c.pose = POSE.kick; c.poseTime = 0;
    world.slowMo = Math.max(world.slowMo || 0, 280);
    return true;
  },
  iceLance(c, world, foe, now) {
    if (!foe || !c.ranged) return false;
    const r = { ...c.ranged, type: 'ice', slowMs: 900, damage: Math.round((c.rangedDmg ?? c.ranged.damage) * 1.35) };
    const saved = c.ranged;
    c.ranged = r;
    castCreepBolt(world, c, foe, now);
    c.ranged = saved;
    return true;
  },
};

export function skillsForType(typeKey, intel, rng) {
  const map = TD.SKILL_BY_TYPE?.[typeKey];
  if (!map) return [];
  const out = [];
  for (const id of map) {
    if (rng() < 0.55 + intel * 0.025) out.push(id);
  }
  return out;
}

export function tryCreepSkill(c, world, foe, now) {
  if (!c.skills?.length || c.hp <= 0 || c.staggerRagdoll) return false;
  if (now < (c._skillAt || 0) || !c.canAct(now)) return false;

  const cd = TD.SKILLS?.cooldownMs ?? 4200;
  const smart = (c.intelligence || 5) / 20;
  const dist = foe ? Math.abs(foe.x - c.x) : Infinity;
  const low = c.hp / c.maxHp < 0.45;

  for (const id of c.skills) {
    const fn = SKILLS[id];
    if (!fn) continue;
    let chance = 0.05 + smart * 0.08;
    if (id === 'healPulse' && low) chance += 0.25;
    if (id === 'slam' && dist < 220) chance += 0.15;
    if (id === 'dashStrike' && dist > 100 && dist < 420) chance += 0.18;
    if (id === 'iceLance' && dist > 180 && dist < 620) chance += 0.14;
    if (id === 'fireBurst' && dist > 200 && dist < 550) chance += 0.12;
    chance *= skillChanceMul(c, world.rng);
    if (world.rng() > chance) continue;
    if (fn(c, world, foe, now)) {
      c._skillAt = now + cd * (0.75 + world.rng() * 0.5);
      return true;
    }
  }
  return false;
}

function foesInRange(world, base, range) {
  const out = [];
  for (const o of world.creeps) {
    if (o.hp <= 0 || o.team === base.team) continue;
    const d = Math.abs(o.x - base.x);
    if (d > range) continue;
    out.push({ c: o, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.map(x => x.c);
}

function foesInBeam(world, base, dir, endX, halfW = 100) {
  const minX = Math.min(base.x, endX) - halfW;
  const maxX = Math.max(base.x, endX) + halfW;
  const out = [];
  for (const o of world.creeps) {
    if (o.hp <= 0 || o.team === base.team || o.role === 'miner') continue;
    if (o.x < minX || o.x > maxX) continue;
    if (dir > 0 ? o.x < base.x - 20 : o.x > base.x + 20) continue;
    out.push(o);
  }
  return out;
}

const BASE_SKILL_MAP = {
  volley(base, world, now, foes) {
    for (const t of foes.slice(0, 3)) fireBaseArrow(world, base, t, now);
    spawnHitParticles(world.particles, base.x, TD.GROUND_Y - 160, false, world.rng);
    return true;
  },
  bombard(base, world, now, foes) {
    const cx = foes[0].x;
    aoeCreeps(world, cx, 190, base.team, 44, now, null);
    spawnHitParticles(world.particles, cx, TD.GROUND_Y - 50, true, world.rng);
    world.screenShake = Math.min(28, world.screenShake + 14);
    return true;
  },
  frostBurst(base, world, now, foes) {
    for (const o of foes) {
      o.takeDamage(18, true, base.x, now);
      o.status.set('frozen', now + 1200);
      o.pose = POSE.hit; o.poseTime = 0;
      tryTdRagdoll(world, o, base.x, Math.sign(o.x - base.x || 1) * 200, -90, now, { dmg: 18, attackerScale: 2.2 });
    }
    spawnFrost(world.particles, base.x, TD.GROUND_Y, world.rng);
    return true;
  },
  shock(base, world, now, foes) {
    const v = foes[0];
    for (const o of foes) {
      if (Math.abs(o.x - v.x) > 150) continue;
      const dealt = o.takeDamage(34, true, v.x, now);
      o.vx += Math.sign(o.x - v.x) * 260;
      o.pose = POSE.hit; o.poseTime = 0;
      tryTdRagdoll(world, o, v.x, Math.sign(o.x - v.x) * 300, -200, now, {
        heavy: true, dmg: dealt, knockdown: true, attackerScale: 2.2,
      });
      addHit(world, o.x, TD.GROUND_Y + o.y - 70, dealt, true);
      if (o.hp <= 0) killCreep(world, o, base.team, now);
    }
    world.screenShake = Math.min(24, world.screenShake + 10);
    return true;
  },
  mend(base, world, now, foes) {
    if (foes?.length > 1) return false;
    const heal = Math.round(base.maxHp * 0.1);
    base.hp = Math.min(base.maxHp, base.hp + heal);
    addHit(world, base.x, TD.GROUND_Y - 150, heal, false);
    return true;
  },
  laser(base, world, now, foes) {
    const dir = Math.sign(foes[0]?.x - base.x) || (base.team === 'L' ? 1 : -1);
    const range = TD.BASE_LASER?.range ?? TD.STAGE_HALF;
    const endX = base.x + dir * range;
    const hits = foesInBeam(world, base, dir, endX, TD.BASE_LASER?.halfW ?? 100);
    if (!hits.length) return false;
    base._laserUntil = now + 520;
    base._laser = { dir, endX, until: base._laserUntil };
    base.emotion = 'infuriated';
    const dmg = TD.BASE_LASER?.dmg ?? 22;
    const push = TD.BASE_LASER?.pushVx ?? 780;
    for (const o of hits) {
      const dealt = o.takeDamage(o.role === 'boss' ? Math.round(dmg * 1.35) : dmg, true, base.x, now);
      o.pose = POSE.hit; o.poseTime = 0;
      o.vx = dir * push + Math.sign(o.x - base.x || dir) * 90;
      o.vy = Math.min(o.vy, o.flying ? -80 : -140);
      tryTdRagdoll(world, o, base.x, dir * 320, -180, now, {
        heavy: true, dmg: dealt, knockdown: true, attackerScale: 2.2,
      });
      addHit(world, o.x, TD.GROUND_Y + o.y - 70 * (o.scale || 1), dealt, true);
      if (o.hp <= 0) killCreep(world, o, base.team, now);
    }
    spawnHitParticles(world.particles, base.x + dir * 120, TD.GROUND_Y - 80, true, world.rng);
    world.screenShake = Math.min(32, world.screenShake + 18);
    world.slowMo = Math.max(world.slowMo || 0, 220);
    return true;
  },
};

function pickBaseSkill(base, foes, rng, beamHits = []) {
  const pool = TD.BASE_SKILLS?.skills || ['volley', 'shock'];
  const hpR = base.hp / base.maxHp;
  if (beamHits.length && pool.includes('laser')) {
    const L = TD.BASE_LASER ?? {};
    const chance = hpR < 0.2 ? (L.criticalHpPick ?? 0.34) : hpR < 0.42 ? (L.lowHpPick ?? 0.2) : (L.pick ?? 0.045);
    if (rng() < chance) return 'laser';
  }
  let opts = pool.filter(id => BASE_SKILL_MAP[id] && id !== 'laser');
  if (foes.length >= 5) opts = opts.filter(id => id === 'bombard' || id === 'frostBurst' || id === 'volley');
  else if (foes.length >= 3) opts = opts.filter(id => id !== 'mend');
  else if (foes.length <= 1) opts = opts.filter(id => id === 'shock' || id === 'volley' || id === 'mend');
  if (!opts.length) opts = pool.filter(id => BASE_SKILL_MAP[id]);
  return opts[Math.floor(rng() * opts.length)];
}

export function tryBaseSkill(base, world, now) {
  if (base.hp <= 0 || now < (base._skillAt || 0)) return false;
  const range = TD.BASE_FIRE.range;
  const foes = foesInRange(world, base, range);
  const dir = Math.sign(foes[0]?.x - base.x) || (base.team === 'L' ? 1 : -1);
  const laserRange = TD.BASE_LASER?.range ?? TD.STAGE_HALF;
  const beamHits = foesInBeam(world, base, dir, base.x + dir * laserRange, TD.BASE_LASER?.halfW ?? 100);
  const low = base.hp / base.maxHp < 0.52;
  if (!foes.length && !beamHits.length && !low) return false;

  const id = (low && foes.length <= 1 && !beamHits.length) ? 'mend' : pickBaseSkill(base, foes, world.rng, beamHits);
  const fn = BASE_SKILL_MAP[id];
  if (!fn?.(base, world, now, foes.length ? foes : beamHits)) return false;
  base._skillAt = now + (TD.BASE_SKILLS?.cooldownMs ?? 6800) * (0.88 + world.rng() * 0.24);
  base._lastSkill = id;
  return true;
}

export function tickBaseDefense(world, now) {
  const F = TD.BASE_FIRE;
  const teams = world.rng() < 0.5 ? ['L', 'R'] : ['R', 'L'];
  for (const team of teams) {
    const base = world.bases[team];
    if (base.hp <= 0) continue;
    tryBaseSkill(base, world, now);
    if (now < (base.nextFireAt || 0)) continue;
    const foes = foesInRange(world, base, F.range);
    if (!foes.length) continue;
    base.nextFireAt = now + F.cooldownMs;
    fireBaseArrow(world, base, foes[0], now);
  }
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('skills.js')) {
  console.assert(typeof BASE_SKILL_MAP.laser === 'function', 'laser skill');
  const base = { team: 'L', x: -1950, hp: 100, maxHp: 100 };
  const world = {
    creeps: [
      { id: 1, team: 'R', hp: 200, maxHp: 200, x: -400, y: 0, role: 'fighter', takeDamage(n) { this.hp -= n; return n; }, pose: 0, poseTime: 0 },
      { id: 2, team: 'R', hp: 200, maxHp: 200, x: 800, y: 0, role: 'fighter', takeDamage(n) { this.hp -= n; return n; }, pose: 0, poseTime: 0 },
    ],
  };
  const beam = foesInBeam(world, base, 1, -1950 + 2100, 120);
  console.assert(beam.length === 1 && beam[0].x === -400, 'beam hits in front only');
  console.log('skills ok');
}
