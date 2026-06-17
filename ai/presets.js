import { getValidPowerIds } from '../entities/powers/index.js';
import { STAT, clampStat } from '../config/stats.js';
import { getPassiveIds } from '../config/passives.js';
import { AZURE_ASSASSIN } from './monsters.js';

// getAIStats now lives in the attribute schema (config/stats.js). Re-exported
// here so existing importers don't need to change their import paths.
export { getAIStats } from '../config/stats.js';

const SETTINGS_KEY = 'fightGame_settings';

export const DEFAULT_SETTINGS = {
  power: STAT.DEFAULT,
  intelligence: STAT.DEFAULT,
  monsterPower: AZURE_ASSASSIN.power,
  monsterIntelligence: AZURE_ASSASSIN.intelligence,
  powers1: [],
  passives1: [],
  monsterPowers: [...AZURE_ASSASSIN.powers],
  monsterPassives: [...AZURE_ASSASSIN.passives],
  gameSpeed: 1,
};

export function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (!s) return { ...DEFAULT_SETTINGS };
    const loaded = JSON.parse(s);
    return {
      power: clampStat(loaded.power, DEFAULT_SETTINGS.power),
      intelligence: clampStat(loaded.intelligence, DEFAULT_SETTINGS.intelligence),
      monsterPower: clampStat(loaded.monsterPower, DEFAULT_SETTINGS.monsterPower),
      monsterIntelligence: clampStat(loaded.monsterIntelligence, DEFAULT_SETTINGS.monsterIntelligence),
      powers1: Array.isArray(loaded.powers1) ? loaded.powers1.filter(p => getValidPowerIds().includes(p)) : [],
      passives1: Array.isArray(loaded.passives1) ? loaded.passives1.filter(p => getPassiveIds().includes(p)) : [],
      monsterPowers: Array.isArray(loaded.monsterPowers)
        ? loaded.monsterPowers.filter(p => getValidPowerIds().includes(p))
        : [...DEFAULT_SETTINGS.monsterPowers],
      monsterPassives: Array.isArray(loaded.monsterPassives)
        ? loaded.monsterPassives.filter(p => getPassiveIds().includes(p))
        : [...DEFAULT_SETTINGS.monsterPassives],
      gameSpeed: [0.5, 1, 2].includes(loaded.gameSpeed) ? loaded.gameSpeed : 1,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let _saveTimeout;
export function saveSettings(settings) {
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { }
  }, 300);
}
