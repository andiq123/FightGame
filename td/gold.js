import { TD } from './config.js';

// Gold veins on each team's half of the lane — miners haul ore back to base.
export function initGoldNodes(world) {
  world.goldNodes = [];
  for (const team of ['L', 'R']) {
    const bx = world.bases[team].x;
    const dir = bx < 0 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      world.goldNodes.push({
        team,
        x: bx + dir * (170 + i * 118 + world.rng() * 55),
        gold: 50 + Math.floor(world.rng() * 40),
        max: 90,
      });
    }
  }
}

export function tickGoldNodes(world, dt) {
  const regen = TD.GOLD?.regenPerSec ?? 7;
  for (const n of world.goldNodes) {
    if (n.gold < n.max) n.gold = Math.min(n.max, n.gold + regen * dt);
  }
}

export function nearestGoldNode(world, miner) {
  const home = world.bases[miner.team];
  const dir = home.x < 0 ? 1 : -1;
  let best = null, bd = Infinity;
  for (const n of world.goldNodes) {
    if (n.team !== miner.team || n.gold < 5) continue;
    if ((n.x - home.x) * dir < 50) continue;
    const d = Math.abs(n.x - miner.x);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

export function collectGold(m, node, dt) {
  const rate = TD.ECONOMY.minerCollectRate ?? 24;
  const room = (m.carryMax || 28) - (m.carry || 0);
  const take = Math.min(rate * dt, node.gold, room);
  if (take <= 0) return;
  node.gold -= take;
  m.carry = (m.carry || 0) + take;
}

export function depositMiner(m, world) {
  const home = world.bases[m.team];
  if (!m.carry || Math.abs(m.x - home.x) > home.w / 2 + 75) return false;
  home.gold += m.carry;
  m.carry = 0;
  m._targetNode = null;
  return true;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('gold.js')) {
  const world = { rng: () => 0.5, bases: { L: { x: -1950 }, R: { x: 1950 } }, goldNodes: [] };
  initGoldNodes(world);
  console.assert(world.goldNodes.length === 12 && world.goldNodes[0].team === 'L', 'gold nodes');
  console.log('gold ok');
}
