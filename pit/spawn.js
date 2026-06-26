import { Fighter, POSE } from '../entities/fighter.js';
import { PIT, TEAM_COLOR } from './config.js';
import { clampStat } from '../config/stats.js';

let _id = 1;

const SLOTS = [-210, -70, 70, 210];

export function spawnTeam(world, team, rng) {
  const n = PIT.TEAM_SIZE;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = (team === 'L' ? -1 : 1) * (340 + rng() * 40);
    const dir = team === 'L' ? 1 : -1;
    const f = new Fighter(_id++, TEAM_COLOR[team], x + (rng() - 0.5) * 30, dir);
    const power = clampStat(7 + Math.floor(rng() * 8));
    const intel = clampStat(6 + Math.floor(rng() * 9));
    f.setStats({ power, intelligence: intel });
    f.maxHp = f.hp = Math.round(120 + power * 8 + rng() * 30);
    f.dmg = Math.round(10 + power * 0.9);
    f.baseDmg = f.dmg;
    f.atkCdMs = Math.round(880 - intel * 18);
    f.attackRange = 78;
    f.moveSpeed = 125 + power * 2;
    f.scale = 0.88 + rng() * 0.22;
    f.aggro = 900;
    f.team = team;
    f.role = 'fighter';
    f.groundY = 0;
    f.y = 0;
    f.tdCreep = true;
    f.spawnSlot = SLOTS[i % SLOTS.length];
    f.pose = POSE.idle;
    f.nextAtkAt = 0;
    out.push(f);
  }
  world.creeps.push(...out);
  return out;
}

export function resetArena(world, rng) {
  world.creeps = [];
  spawnTeam(world, 'L', rng);
  spawnTeam(world, 'R', rng);
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('spawn.js')) {
  const w = { creeps: [] };
  resetArena(w, () => 0.5);
  console.assert(w.creeps.length === PIT.TEAM_SIZE * 2, 'pit roster');
  console.log('pit spawn ok');
}
