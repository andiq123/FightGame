import { getValidPowerIds } from '../entities/powers/index.js';

export const INTELLIGENCE_LEVELS = [
  { value: 12, label: 'Novice' },
  { value: 28, label: 'Amateur' },
  { value: 48, label: 'Competent' },
  { value: 68, label: 'Skilled' },
  { value: 88, label: 'Expert' },
  { value: 98, label: 'Nightmare' }
];

export function getAIStats(intelligence) {
  const i = Math.max(0, Math.min(100, intelligence)) / 100;
  const steep = Math.pow(i, 1.7);
  return {
    aggression: Math.round(8 + steep * 52),
    defense: Math.round(18 + steep * 78),
    reaction: Math.round(14 + steep * 84),
    riskTolerance: Math.round(8 + steep * 62),
    comboTendency: Math.round(4 + steep * 52),
    spacing: Math.round(18 + steep * 78)
  };
}

const SETTINGS_KEY = 'fightGame_settings';

const DEFAULT_SETTINGS = {
  hp1: 400, hp2: 400,
  intelligence1: 48, intelligence2: 48,
  powers1: [], powers2: [],
  gameSpeed: 1
};

const INTELLIGENCE_VALUES = [12, 28, 48, 68, 88, 98];

function legacyToIntelligence(aiStats) {
  if (!aiStats || typeof aiStats !== 'object') return 55;
  const r = (aiStats.reaction ?? 50) / 100;
  const d = (aiStats.defense ?? 50) / 100;
  const c = (aiStats.comboTendency ?? 50) / 100;
  const raw = Math.round(((r + d + c) / 3) * 100);
  return INTELLIGENCE_VALUES.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
}

export function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (!s) return { ...DEFAULT_SETTINGS };
    const loaded = JSON.parse(s);
    const clamp = (v, min, max, def) => {
      const n = parseInt(v, 10);
      return isNaN(n) ? def : Math.max(min, Math.min(max, n));
    };
    const int1 = loaded.intelligence1 != null ? clamp(loaded.intelligence1, 0, 100, 55) : legacyToIntelligence(loaded.aiStats1);
    const int2 = loaded.intelligence2 != null ? clamp(loaded.intelligence2, 0, 100, 55) : legacyToIntelligence(loaded.aiStats2);
    return {
      hp1: clamp(loaded.hp1, 100, 5000, 400),
      hp2: clamp(loaded.hp2, 100, 5000, 400),
      intelligence1: int1,
      intelligence2: int2,
      powers1: Array.isArray(loaded.powers1) ? loaded.powers1.filter(p => getValidPowerIds().includes(p)) : [],
      powers2: Array.isArray(loaded.powers2) ? loaded.powers2.filter(p => getValidPowerIds().includes(p)) : [],
      gameSpeed: [0.5, 1, 2].includes(loaded.gameSpeed) ? loaded.gameSpeed : 1
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
    } catch {}
  }, 300);
}
