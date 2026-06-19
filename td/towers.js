import { TD } from './config.js';

export function createTower(side) {
  const isPlayer = side === 'player';
  return {
    side,
    x: isPlayer ? TD.PLAYER_TOWER_X : TD.ENEMY_TOWER_X,
    maxHp: isPlayer ? TD.TOWER_HP : TD.ENEMY_TOWER_HP,
    hp: isPlayer ? TD.TOWER_HP : TD.ENEMY_TOWER_HP,
    w: TD.TOWER_W,
    h: isPlayer ? TD.TOWER_H : TD.TOWER_H + 60,
    color: isPlayer ? '#3a86c8' : '#9b2c4a',
  };
}

export function towerAlive(t) { return t.hp > 0; }
