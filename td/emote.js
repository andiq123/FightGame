import { POSE } from '../entities/fighter.js';

export function refreshCreepEmotion(c, world, now) {
  if (c.hp <= 0) { c.emotion = 'dead'; return; }
  if (c.staggerRagdoll) { c.emotion = 'hurt'; c._emoUntil = now + 700; return; }
  if ((c._emoUntil || 0) > now) return;
  if (c.pose === POSE.hit) { c.emotion = 'hurt'; c._emoUntil = now + 380; return; }

  let foes = 0, friends = 0;
  for (const o of world.creeps) {
    if (o.hp <= 0 || Math.abs(o.x - c.x) > 240) continue;
    if (o.team === c.team) friends++;
    else if (o.role !== 'miner') foes++;
  }
  const hpR = c.hp / c.maxHp;
  if (hpR <= 0.3 && foes > 0) c.emotion = 'scared';
  else if (foes > friends + 1) c.emotion = 'scared';
  else if (hpR < 0.52 && foes > 0) c.emotion = 'worried';
  else if (c.currentAttack || c.pose === POSE.punch || c.pose === POSE.kick || c.pose === POSE.grab) c.emotion = 'angry';
  else if (hpR > 0.88 && foes === 0 && c.role !== 'miner') c.emotion = 'happy';
  else c.emotion = 'neutral';
}

export function scaredMoveMul(c) {
  if (c.emotion === 'scared') return 0.68;
  if (c.emotion === 'worried') return 0.86;
  return 1;
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('emote.js')) {
  const c = { hp: 30, maxHp: 100, team: 'L', x: 0, emotion: 'neutral' };
  const world = { creeps: [{ hp: 100, team: 'R', x: 80, role: 'fighter' }] };
  refreshCreepEmotion(c, world, 1000);
  console.assert(c.emotion === 'scared', 'low hp + foe = scared');
  console.log('emote ok');
}
