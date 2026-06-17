// ─────────────────────────────────────────────────────────────────────────────
// Passive abilities — always-on traits a fighter can carry. Selectable in setup.
// To add a passive: add one entry here, then implement its effect where marked
// (combat.js / fighter.js). The setup UI renders every entry automatically, so
// new passives show up with no UI changes.
// ─────────────────────────────────────────────────────────────────────────────

export const PASSIVES = {
  vampirism: { name: 'Vampirism', tip: 'Heal 15% of melee damage dealt' },
  blur:      { name: 'Blur', tip: '15% chance to auto-dodge a melee hit' },
  thorns:    { name: 'Thorns', tip: 'Reflect 25% of melee damage back at the attacker' },
  ironSkin:  { name: 'Iron Skin', tip: 'Take 18% less damage from everything' },
  regen:     { name: 'Regeneration', tip: 'Slowly recover HP over time' },
  swift:     { name: 'Swift', tip: 'Move 15% faster' },
};

export const PASSIVE = {
  VAMPIRISM_LIFESTEAL: 0.15,
  BLUR_DODGE_CHANCE: 0.15,
  THORNS_REFLECT: 0.25,
  IRON_SKIN_REDUCTION: 0.18,
  REGEN_HP_PER_SEC: 6,
  SWIFT_SPEED_MULT: 1.15,
};

export function getPassiveIds() {
  return Object.keys(PASSIVES);
}
