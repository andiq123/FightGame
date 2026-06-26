import { TD } from './config.js';

// A base: HP to defend, a gold purse it spends spawning creeps, and timers for
// its spawn decisions + defensive arrows.
export function createBase(team) {
  return {
    team,
    x: team === 'L' ? -TD.BASE_X : TD.BASE_X,
    maxHp: TD.BASE_HP, hp: TD.BASE_HP,
    w: TD.BASE_W, h: TD.BASE_H,
    color: team === 'L' ? '#3a6fc8' : '#9b2c4a',
    gold: TD.ECONOMY.startGold,
    kills: 0,
    nextSpawnAt: 0,
    nextFireAt: 0,
  };
}
