
import { getValidPowerIds } from '../entities/powers/index.js';

export const AI_INTELLIGENCE_MAX = 500;
const BASE_AI_INTELLIGENCE_MAX = 100;

export function getAIStats(intelligence) {
  const raw = Math.max(0, Math.min(AI_INTELLIGENCE_MAX, intelligence));
  const i = Math.min(raw, BASE_AI_INTELLIGENCE_MAX) / BASE_AI_INTELLIGENCE_MAX;
  const overdrive = Math.max(0, raw - BASE_AI_INTELLIGENCE_MAX) / (AI_INTELLIGENCE_MAX - BASE_AI_INTELLIGENCE_MAX);
  // Intelligence improves tactical choices only. Movement speed and decision cadence stay fixed elsewhere.
  const steep = Math.pow(i, 2.2);
  const linear = i;
  const boost = Math.pow(overdrive, 0.85);

  return {
    aggression: Math.round(5 + linear * 25 + steep * 65 + boost * 45),
    defense: Math.round(10 + linear * 15 + steep * 73 + boost * 50),
    reaction: Math.round(10 + linear * 10 + steep * 78 + boost * 40),
    riskTolerance: Math.round(5 + linear * 45 + steep * 45 + boost * 35),
    comboTendency: Math.round(2 + linear * 20 + steep * 76 + boost * 50),
    spacing: Math.round(10 + linear * 20 + steep * 68 + boost * 50),
    parkourTendency: Math.round(10 + linear * 30 + steep * 58 + boost * 40)
  };
}

/**
 * Level 1-20 Scaling
 * Level 1: HP 200, Intelligence 12, Damage Mult 1.0, Defense Mult 1.0
 * Level 20: HP 1000, Intelligence 98, Damage Mult 2.0, Defense Mult 2.0
 */
export function getLevelStats(level) {
  const lvl = Math.max(1, Math.min(20, level));
  const t = (lvl - 1) / 19; // 0 to 1 normalize

  return {
    hp: Math.round(200 + t * 800),
    damageMult: 1 + t * 1.0,
    defenseMult: 1 + t * 1.0
  };
}

const SETTINGS_KEY = 'fightGame_settings';

export const DEFAULT_SETTINGS = {
  level1: 1,
  hp1: 200,
  intelligence1: 12, // User selected Hero AI level
  powers1: [],
  monsterPowers: ['spectralDash', 'cloneJutsu', 'lightningCutter'],
  gameSpeed: 1,
};

export function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (!s) return { ...DEFAULT_SETTINGS };
    const loaded = JSON.parse(s);
    const clamp = (v, min, max, def) => {
      const n = parseInt(v, 10);
      return isNaN(n) ? def : Math.max(min, Math.min(max, n));
    };
    return {
      level1: clamp(loaded.level1, 1, 20, 1),
      hp1: clamp(loaded.hp1, 100, 5000, 200),
      intelligence1: clamp(loaded.intelligence1, 0, AI_INTELLIGENCE_MAX, DEFAULT_SETTINGS.intelligence1),
      powers1: Array.isArray(loaded.powers1) ? loaded.powers1.filter(p => getValidPowerIds().includes(p)) : [],
      monsterPowers: Array.isArray(loaded.monsterPowers)
        ? loaded.monsterPowers.filter(p => getValidPowerIds().includes(p))
        : [...DEFAULT_SETTINGS.monsterPowers],
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
