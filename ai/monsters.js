// Default enemy build. Power & Intelligence are 1–20 levels (see config/stats.js)
// and can be overridden in the monster setup screen; the rest are fixed traits.
export const AZURE_ASSASSIN = {
  id: 'assassin',
  name: 'Azure Assassin',
  power: 18,        // ≈ 1810 HP, ×2.34 damage, ×0.55 taken
  intelligence: 20, // nightmare-tier decision making
  powers: ['spectralDash', 'cloneJutsu', 'lightningCutter'],
  passives: ['vampirism', 'blur'],
  scale: 1.12,
  color: '#00008b',
};
