import { createCreep } from './units.js';
import { TD, opp } from './config.js';
import { spawnHitParticles } from '../services/particleSystem.js';

function weightedPick(list, rng) {
  const total = list.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of list) { r -= e.weight; if (r <= 0) return e; }
  return list[list.length - 1];
}

function teamPick(world) {
  return world.rng() < 0.5 ? 'L' : 'R';
}

function living(world, team) {
  let n = 0;
  for (const c of world.creeps) if (c.hp > 0 && c.team === team) n++;
  return n;
}

export function initEvents(world) {
  const E = TD.EVENTS;
  world.nextEventAt = world.time + E.minIntervalSec + world.rng() * (E.maxIntervalSec - E.minIntervalSec);
  world.activeBuffs = { L: {}, R: {} };
  world.eventLog = [];
}

function scheduleNext(world) {
  const E = TD.EVENTS;
  world.nextEventAt = world.time + E.minIntervalSec + world.rng() * (E.maxIntervalSec - E.minIntervalSec);
}

function log(world, text) {
  world.eventLog.push({ t: world.time, text });
  if (world.eventLog.length > 8) world.eventLog.shift();
  world._announce?.(text);
}

export function peekCamera(world, x, sec = 2.6) {
  world.camPeek = { x, until: world.time + sec, dur: sec };
}

function skyFlash(world, type, sec = 2.2, intensity = 0.7) {
  world.skyFocus = { type, until: world.time + sec, intensity };
}

function spawnBoss(world, team) {
  const keys = Object.keys(TD.BOSSES || {});
  if (!keys.length) return;
  const key = keys[Math.floor(world.rng() * keys.length)];
  const c = createCreep(team, key, world.level || 0, world.rng, world.bases[team]);
  c.role = 'boss';
  c.needsDashDust = true;
  world.creeps.push(c);
  world.screenShake = Math.min(36, world.screenShake + 18);
  peekCamera(world, world.bases[team].x);
  log(world, `${team === 'L' ? 'BLUE' : 'RED'} BOSS: ${TD.BOSSES[key].name}!`);
}

function spawnReinforcement(world, team) {
  const pool = ['warlord', 'giant', 'brute', 'archer', 'ninja', 'skyrider', 'hawk', 'pyro', 'sprinter'].filter(k => TD.CREEPS[k]);
  const key = pool[Math.floor(world.rng() * pool.length)];
  const c = createCreep(team, key, world.level + 1, world.rng, world.bases[team]);
  c.needsDashDust = true;
  world.creeps.push(c);
  peekCamera(world, world.bases[team].x, 1.8);
  log(world, `${team === 'L' ? 'BLUE' : 'RED'} REINFORCEMENTS!`);
}

const HANDLERS = {
  goldRush(world) {
    for (const t of ['L', 'R']) {
      const bonus = 80 + Math.floor(world.rng() * 120);
      world.bases[t].gold += bonus;
    }
    for (const n of world.goldNodes || []) n.gold = Math.min(n.max, n.gold + 35);
    log(world, 'GOLD RUSH!');
  },
  meteor(world) {
    const x = (world.rng() - 0.5) * TD.STAGE_HALF * 1.4;
    spawnHitParticles(world.particles, x, TD.GROUND_Y - 40, true, world.rng);
    world.screenShake = Math.min(40, world.screenShake + 22);
    for (const c of world.creeps) {
      if (c.hp <= 0) continue;
      if (Math.abs(c.x - x) > 220) continue;
      const dmg = Math.round(c.maxHp * (0.22 + world.rng() * 0.18));
      c.hp = Math.max(0, c.hp - dmg);
      if (c.flying) c.vx += (world.rng() - 0.5) * 480;
      else c.vy = -180;
    }
    for (const t of ['L', 'R']) {
      const b = world.bases[t];
      if (Math.abs(b.x - x) <= b.w / 2 + 180) {
        b.hp = Math.max(0, b.hp - Math.round(90 + world.rng() * 80));
      }
    }
    peekCamera(world, x);
    skyFlash(world, 'fire', 2.4, 0.85);
    log(world, 'METEOR STRIKE!');
  },
  berserk(world) {
    const team = teamPick(world);
    world.activeBuffs[team].dmgMul = 1.55;
    world.activeBuffs[team].until = world.time + 14;
    skyFlash(world, 'fire', 3, 0.55);
    log(world, `${team === 'L' ? 'BLUE' : 'RED'} BERSERK!`);
  },
  fog(world) {
    world.fogUntil = world.time + 12;
    skyFlash(world, 'vacuum', 4, 0.6);
    log(world, 'BATTLE FOG!');
  },
  lightning(world) {
    const live = world.creeps.filter(c => c.hp > 0 && c.role !== 'miner');
    if (!live.length) return;
    const v = live[Math.floor(world.rng() * live.length)];
    const dmg = Math.round(v.maxHp * 0.35);
    v.hp = Math.max(0, v.hp - dmg);
    v.poseTime = 0;
    spawnHitParticles(world.particles, v.x, TD.GROUND_Y - 60, true, world.rng);
    peekCamera(world, v.x, 1.4);
    skyFlash(world, 'shinra', 0.8, 0.9);
    log(world, 'LIGHTNING!');
  },
  duel(world) {
    const a = teamPick(world);
    const b = opp(a);
    spawnReinforcement(world, a);
    spawnReinforcement(world, b);
    peekCamera(world, 0, 2);
    log(world, 'DUEL!');
  },
  boss(world) {
    spawnBoss(world, teamPick(world));
  },
  underdog(world) {
    const L = world.bases.L, R = world.bases.R;
    const behind = L.hp < R.hp * 0.65 ? 'L' : R.hp < L.hp * 0.65 ? 'R' : null;
    if (!behind) { world.bases[teamPick(world)].gold += 140; log(world, 'WINDFALL!'); return; }
    world.bases[behind].gold += 180;
    world.activeBuffs[behind].spawnBoost = 1.6;
    world.activeBuffs[behind].until = world.time + 18;
    log(world, `${behind === 'L' ? 'BLUE' : 'RED'} COMEBACK!`);
  },
};

export function tickEvents(world, dt) {
  if (world.over) return;
  const now = world.time;

  for (const t of ['L', 'R']) {
    const buff = world.activeBuffs?.[t];
    if (buff?.until && now >= buff.until) {
      world.activeBuffs[t] = {};
    }
  }
  if (world.fogUntil && now >= world.fogUntil) world.fogUntil = 0;

  if (now < world.nextEventAt) return;

  const live = TD.EVENTS.types.filter(e => {
    if (e.id === 'boss' && living(world, 'L') + living(world, 'R') >= TD.ECONOMY.maxAlive * 2.2) return false;
    return HANDLERS[e.id];
  });
  const pick = weightedPick(live.length ? live : TD.EVENTS.types, world.rng);
  HANDLERS[pick.id]?.(world);
  scheduleNext(world);
}

export function dmgMulFor(world, team) {
  return world.activeBuffs?.[team]?.dmgMul || 1;
}

export function spawnBoostFor(world, team) {
  return world.activeBuffs?.[team]?.spawnBoost || 1;
}

export function aggroMul(world) {
  return world.fogUntil && world.time < world.fogUntil ? 0.55 : 1;
}
