import { createCreep } from './units.js';
import { TD, opp } from './config.js';
import { spawnBoostFor } from './events.js';
import { tickGoldNodes } from './gold.js';

// ── Economy AI playbook (no LLM — weighted utility + personality) ─────────
//
// Each base re-evaluates every decideEveryMs. Decision inputs:
//   threat     enemy within defendDist OR base HP < 72% of opponent
//   personality rolled at spawn: aggression, bankChance, minerBias
//   buffs      random events (spawnBoost, berserk dmg, underdog comeback)
//   army scan  counter-picks vs enemy comp; miners when safe + veins rich

function weightedPick(list, rng) {
  const total = list.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  for (const e of list) { r -= e.w; if (r <= 0) return e; }
  return list[list.length - 1];
}

function countTeam(world, team, role) {
  let n = 0;
  for (const c of world.creeps) if (c.hp > 0 && c.team === team && (!role || c.role === role)) n++;
  return n;
}

function scanArmy(world, team) {
  const s = { fighters: 0, miners: 0, ranged: 0, fast: 0, flying: 0, heavies: 0 };
  for (const c of world.creeps) {
    if (c.hp <= 0 || c.team !== team) continue;
    if (c.role === 'miner') { s.miners++; continue; }
    s.fighters++;
    if (c.flying) s.flying++;
    if (c.ranged) s.ranged++;
    if ((c.scale || 1) >= 1.35) s.heavies++;
    if (c.moveSpeed > 260) s.fast++;
  }
  return s;
}

function veinWealth(world, team) {
  let g = 0;
  for (const n of world.goldNodes || []) if (n.team === team) g += n.gold;
  return g;
}

function counterWeight(key, def, enemy, self, underThreat) {
  let w = 1;
  if (key === 'miner') return w;
  if (enemy.heavies >= 2 && (key === 'archer' || key === 'bowman' || key === 'skyrider' || key === 'hawk')) w *= 1.55;
  if (enemy.ranged >= 2 && (key === 'sprinter' || key === 'ninja' || key === 'runner')) w *= 1.45;
  if (enemy.flying >= 1 && (key === 'archer' || key === 'bowman' || key === 'skyrider')) w *= 1.65;
  if (enemy.fast >= 2 && (key === 'grunt' || key === 'brute' || key === 'giant')) w *= 1.25;
  if (enemy.heavies >= 1 && key === 'giant') w *= 1.2;
  if (!underThreat && enemy.miners >= 2 && (key === 'sprinter' || key === 'ninja' || key === 'runner')) w *= 1.4;
  if (self.fighters >= 10 && def.cost >= 180) w *= 0.72;
  if (key === 'skyrider' && enemy.flying >= 1) w *= 0.75;
  else if (key === 'skyrider' && self.fighters >= 5) w *= 1.35;
  return w;
}

// Shared spawn evaluation — drives both maybeSpawn and the HUD.
function evaluateSpawn(world, base, team) {
  const E = TD.ECONOMY;
  const P = base.personality || {};
  const alive = countTeam(world, team);
  const prev = base.aiHud || {};

  if (base.hp <= 0) {
    return { mode: 'DOWN', plan: 'Base destroyed', top: [], last: prev.last || '—' };
  }
  if (alive >= E.maxAlive) {
    return { mode: 'FULL', plan: `Army full (${alive}/${E.maxAlive})`, top: [], last: prev.last || '—' };
  }

  const minersAlive = countTeam(world, team, 'miner');
  const enemyNear = world.creeps.some(c => c.hp > 0 && c.team !== team && c.role !== 'miner'
    && Math.abs(c.x - base.x) < E.defendDist);
  const oppBase = world.bases[opp(team)];
  const hpRatio = base.hp / Math.max(1, oppBase.hp);
  const losing = hpRatio < 0.72;
  const winning = hpRatio > 1.35;
  const underThreat = enemyNear || losing;
  const boost = spawnBoostFor(world, team);
  const minerTarget = Math.round(E.targetMiners * (P.minerBias || 1));
  const bankChance = P.bankChance ?? E.bankChance;
  const pricier = Object.values(TD.CREEPS).some(d => d.cost > base.gold);
  const enemy = scanArmy(world, opp(team));
  const self = scanArmy(world, team);
  const veins = veinWealth(world, team);
  const goldPoor = base.gold < 130;
  const economyPush = !underThreat && (minersAlive < minerTarget || goldPoor) && veins > 80;

  const opts = [];
  for (const [key, def] of Object.entries(TD.CREEPS)) {
    if (base.gold < def.cost) continue;
    let w = def.weight * (P.aggression || 1) * boost * counterWeight(key, def, enemy, self, underThreat);
    const phase = Math.floor((world.level || 0) / 2);
    if (phase >= 1 && def.cost >= 130) w *= 1 + phase * 0.08;
    if (phase >= 1 && (def.scale || 1) >= 1.85) w *= 1.25 + phase * 0.12;
    if (phase >= 2 && def.cost <= 80) w *= 0.85;
    if (key === 'miner') {
      if (underThreat) w = 0.02;
      else if (economyPush) w = Math.max(2.5, 4.8 - minersAlive * 0.85) * (P.minerBias || 1);
      else if (minersAlive >= minerTarget) w = 0.12;
      else w = Math.max(0.4, 2.2 - minersAlive * 0.55);
    } else if (underThreat) {
      if (losing) w *= def.cost <= 90 ? 1.55 : (def.cost >= 180 ? 1.4 + (1 - hpRatio) : 0.9);
      else w *= def.cost <= 90 ? 2.1 : 0.7;
    } else if (winning && def.cost >= 180) {
      w *= 1.3 + (P.aggression || 0) * 0.35;
    } else if (economyPush && def.cost >= 150 && !def.flying) {
      w *= (def.scale || 1) >= 1.35 ? 0.82 : 0.55;
    }
    if (key === 'hawk' || key === 'skyrider') w *= underThreat ? 0.85 : 1.6;
    if (key === 'skyrider' && !underThreat && base.gold >= def.cost + 20) w *= 1.5;
    if (w > 0) opts.push({ key, def, w });
  }

  if (!opts.length) {
    const cheapest = Math.min(...Object.values(TD.CREEPS).map(d => d.cost));
    return {
      mode: 'BROKE', plan: `Saving — need ${cheapest}g`, top: [], last: prev.last || '—',
      opts, underThreat, bankChance, pricier, boost,
    };
  }

  const totalW = opts.reduce((s, o) => s + o.w, 0);
  const top = [...opts].sort((a, b) => b.w - a.w).slice(0, 3).map(o => ({
    name: o.def.name, pct: Math.round(o.w / totalW * 100), cost: o.def.cost,
  }));

  let mode, plan;
  if (underThreat && losing) {
    mode = 'DEFEND';
    plan = enemyNear ? 'Siege — bodies + counter-picks' : 'Losing — emergency defense';
  } else if (underThreat) {
    mode = 'DEFEND';
    plan = enemyNear ? 'Gates threatened — hold line' : 'HP lead slipping — reinforce';
  } else if (economyPush) {
    mode = 'BUILD';
    plan = `Rush economy ${minersAlive}/${minerTarget} · veins ${Math.round(veins)}g`;
  } else if (winning) {
    mode = 'PUSH';
    plan = `Winning (${Math.round(hpRatio * 100)}% HP) — ${enemy.heavies ? 'anti-heavy' : 'elite'} push`;
  } else if (enemy.ranged >= 2 || enemy.fast >= 2) {
    mode = 'GROW';
    plan = `Counter ${enemy.ranged} ranged / ${enemy.fast} fast`;
  } else {
    mode = 'GROW';
    plan = 'Mixed army + skirmish';
  }
  if (boost > 1.05) plan += ' · comeback boost';
  if (!underThreat && pricier) plan += ` · bank ${Math.round(bankChance * 100)}%`;

  return {
    mode, plan, top, opts, underThreat, losing, winning, bankChance, pricier, boost,
    last: prev.last || '—', action: prev.action || 'Evaluating…',
  };
}

export function baseEmotion(base, ev, now = 0) {
  if (base.hp <= 0) return 'dead';
  if (base._laserUntil > now) return 'infuriated';
  if (ev.winning) return 'happy';
  if (ev.losing) return 'angry';
  if (ev.underThreat) return 'scared';
  if (ev.mode === 'BROKE' || ev.mode === 'FULL') return 'frustrated';
  return 'neutral';
}

export function refreshBaseHud(world, team, now) {
  const base = world.bases[team];
  const ev = evaluateSpawn(world, base, team);
  const ms = Math.max(0, (base.nextSpawnAt || 0) - now);
  base.aiHud = {
    ...ev,
    nextIn: ms > 0 ? `${(ms / 1000).toFixed(1)}s` : 'now',
  };
  base.emotion = baseEmotion(base, ev, now);
}

function teamOrder(world) {
  return world.rng() < 0.5 ? ['L', 'R'] : ['R', 'L'];
}

function ensureFlyer(world, base, team) {
  if (world.time < 20 || base._flyerDone) return;
  if (world.creeps.some(c => c.team === team && c.flying && c.hp > 0)) return;
  base._flyerDone = true;
  const c = createCreep(team, 'hawk', world.level || 0, world.rng, base);
  c.needsDashDust = true;
  world.creeps.push(c);
  base.aiHud = base.aiHud || {};
  base.aiHud.last = 'Hawk (air scout)';
}

function ensureHeavy(world, base, team) {
  if (world.time < 26 || base._heavyDone) return;
  if (world.creeps.some(c => c.team === team && c.hp > 0 && (c.scale || 1) >= 1.85)) return;
  base._heavyDone = true;
  const c = createCreep(team, 'giant', world.level || 0, world.rng, base);
  c.needsDashDust = true;
  world.creeps.push(c);
  base.aiHud = base.aiHud || {};
  base.aiHud.last = 'Giant (heavy)';
}

export function runEconomy(world, dt, now) {
  tickGoldNodes(world, dt);
  for (const team of teamOrder(world)) {
    const base = world.bases[team];
    if (base.hp <= 0) continue;
    ensureFlyer(world, base, team);
    ensureHeavy(world, base, team);
    base.gold += TD.ECONOMY.passivePerSec * dt;
    if (now >= (base.nextSpawnAt || 0)) {
      base.nextSpawnAt = now + TD.ECONOMY.decideEveryMs;
      maybeSpawn(world, base, team, now);
    }
  }
}

function maybeSpawn(world, base, team, now = performance.now()) {
  const ev = evaluateSpawn(world, base, team);
  base.aiHud = { ...ev, nextIn: base.aiHud?.nextIn || '—' };
  base.emotion = baseEmotion(base, ev, now);

  if (!ev.opts?.length || ev.mode === 'FULL' || ev.mode === 'DOWN') return;

  if (!ev.underThreat && ev.pricier && world.rng() < ev.bankChance) {
    base.aiHud.action = 'Banking gold for elite';
    base.aiHud.last = `Banking (${Math.floor(base.gold)}g)`;
    return;
  }

  const pick = weightedPick(ev.opts, world.rng);
  base.gold -= pick.def.cost;
  const c = createCreep(base.team, pick.key, world.level || 0, world.rng, base);
  c.needsDashDust = true;
  world.creeps.push(c);
  base.aiHud.action = `Deployed ${pick.def.name}`;
  base.aiHud.last = `${pick.def.name} −${pick.def.cost}g`;
}

export { createCreep };

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('spawner.js')) {
  console.assert(baseEmotion({ hp: 0 }, {}) === 'dead', 'dead');
  console.assert(baseEmotion({ hp: 100 }, { winning: true }) === 'happy', 'happy');
  console.assert(baseEmotion({ hp: 100 }, { losing: true }) === 'angry', 'angry');
  console.assert(baseEmotion({ hp: 100 }, { underThreat: true }) === 'scared', 'scared');
  console.assert(baseEmotion({ hp: 100 }, { mode: 'BROKE' }) === 'frustrated', 'frustrated');
  console.log('spawner ok');
}
