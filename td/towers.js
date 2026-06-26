import { TD } from './config.js';

// A base: HP to defend, a gold purse it spends spawning creeps, and timers for
// its spawn decisions + defensive arrows. Personality randomises each battle.
export function createBase(team, rng = Math.random) {
  return {
    team,
    x: team === 'L' ? -TD.BASE_X : TD.BASE_X,
    maxHp: TD.BASE_HP, hp: TD.BASE_HP,
    w: TD.BASE_W, h: TD.BASE_H,
    color: team === 'L' ? '#3a6fc8' : '#9b2c4a',
    gold: TD.ECONOMY.startGold + Math.floor(rng() * 40),
    kills: 0,
    nextSpawnAt: 0,
    nextFireAt: 0,
    _skillAt: 0,
    personality: {
      aggression: 0.75 + rng() * 0.65,
      bankChance: 0.12 + rng() * 0.28,
      minerBias: 0.7 + rng() * 0.9,
    },
  };
}
