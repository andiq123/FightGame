import { POSE } from '../entities/fighter.js';

function localScan(c, world) {
  let foes = 0, friends = 0;
  for (const o of world.creeps) {
    if (o.hp <= 0 || Math.abs(o.x - c.x) > 280) continue;
    if (o.team === c.team) { if (o.role !== 'miner') friends++; }
    else if (o.role !== 'miner') foes++;
  }
  return { foes, friends };
}

export function refreshCreepEmotion(c, world, now) {
  if (c.hp <= 0) { c.emotion = 'dead'; return; }
  if (c.staggerRagdoll) { c.emotion = 'hurt'; c._emoUntil = now + 700; return; }
  if ((c._emoUntil || 0) > now) return;
  if (c.pose === POSE.hit) { c.emotion = 'hurt'; c._emoUntil = now + 380; return; }

  const { foes, friends } = localScan(c, world);
  const hpR = c.hp / c.maxHp;
  const fighting = foes > 0;
  const pressing = c.currentAttack || c.pose === POSE.punch || c.pose === POSE.kick || c.pose === POSE.grab;

  if (hpR <= 0.3 && fighting) c.emotion = 'scared';
  else if (foes >= friends + 2) c.emotion = 'scared';
  else if (fighting && friends >= foes && hpR > 0.48 && (pressing || (c.comboCount || 0) > 0)) c.emotion = 'angry';
  else if (fighting && friends > 0 && Math.abs(foes - friends) <= 1 && hpR > 0.32 && hpR < 0.78) c.emotion = 'confused';
  else if (hpR < 0.5 && fighting) c.emotion = 'worried';
  else if (pressing) c.emotion = 'angry';
  else if (hpR > 0.88 && !fighting && c.role !== 'miner') c.emotion = 'happy';
  else c.emotion = 'neutral';
}

export function moodMoveMul(c) {
  if (c.emotion === 'scared') return 0.65;
  if (c.emotion === 'worried') return 0.84;
  if (c.emotion === 'confused') return 0.92;
  if (c.emotion === 'angry') return 1.16;
  return 1;
}

export function moodAggroMul(c) {
  if (c.emotion === 'angry') return 1.24;
  if (c.emotion === 'scared') return 0.72;
  if (c.emotion === 'confused') return 0.9;
  return 1;
}

/** Multiply atkCd — lower = swings/shots sooner. */
export function moodAtkMul(c) {
  if (c.emotion === 'angry') return 0.74;
  if (c.emotion === 'scared') return 1.38;
  if (c.emotion === 'worried') return 1.12;
  if (c.emotion === 'confused') return 1.05;
  return 1;
}

export function skillChanceMul(c, rng = Math.random) {
  if (c.emotion === 'angry') return 1.45;
  if (c.emotion === 'scared') return 0.5;
  if (c.emotion === 'confused') return 0.55 + rng() * 0.55;
  return 1;
}

export function confusedTactics(c, world, now, t) {
  if (c.emotion !== 'confused' || !t.foe) return t;
  if ((c._confusedUntil || 0) > now) return c._confusedPlan || t;
  if (world.rng() > 0.38) return t;
  const plan = { ...t };
  if (t.useRanged && world.rng() < 0.45) {
    plan.mode = 'melee';
    const side = Math.sign(t.foe.x - c.x) || -c.dir;
    plan.goalX = t.foe.x + side * t.range * 0.42;
    plan.stopDist = t.range;
  } else {
    plan.goalX = t.goalX + (world.rng() - 0.5) * 180;
  }
  c._confusedPlan = plan;
  c._confusedUntil = now + 750;
  return plan;
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('emote.js')) {
  const c = { hp: 30, maxHp: 100, team: 'L', x: 0, emotion: 'neutral' };
  const world = { creeps: [{ hp: 100, team: 'R', x: 80, role: 'fighter' }] };
  refreshCreepEmotion(c, world, 1000);
  console.assert(c.emotion === 'scared', 'low hp + foe = scared');
  c.hp = 90; c.comboCount = 2;
  world.creeps.push({ hp: 100, team: 'L', x: 40, role: 'fighter' });
  refreshCreepEmotion(c, world, 2000);
  console.assert(c.emotion === 'angry', 'winning scuffle = angry');
  console.assert(moodAtkMul({ emotion: 'angry' }) < 1, 'angry attacks faster');
  console.log('emote ok');
}
