// Selectable enemy roster. Power & Intelligence are 1–20 levels (see
// config/stats.js) and can be overridden in the monster setup screen; the rest
// are fixed character traits. Add a character here and it appears in the picker.
//
// ─── REUSABLE CHARACTER TRAITS ───────────────────────────────────────────────
// Mix and match any of these on a character's `traits` (see config/traits.js for
// the full registry + UI labels). Each is ONE distinct ability:
//   DEFENSE  untouchable (avoid hits) · unbreakable (no knockdown)
//   OFFENSE  perfectStrike (never whiff) · seriousPunch (one-shot heavies)
//   STAMINA  tireless (infinite, no retreat)
//   MOVE     athletic (instant stop) · blink (teleport to close)
//   STYLE    chill (relaxed, sparse attacks) · style:'caped' (cape + bald look)
// `cape` (hex) sets the cape colour for the 'caped' style.

export const AZURE_ASSASSIN = {
  id: 'assassin',
  name: 'Azure Assassin',
  power: 18,        // ≈ high HP, heavy damage
  intelligence: 20, // nightmare-tier decision making
  powers: ['spectralDash', 'cloneJutsu', 'shuriken'],
  passives: ['vampirism', 'blur'],
  scale: 1.12,
  color: '#00008b',
  traits: {},
  blurb: 'A relentless teleporting duelist — clones, shuriken and lifesteal.',
};

// Original homage to the "bored, unbeatable bald hero" archetype: he can't be
// touched, barely tries, and ends fights with a single slow, cataclysmic punch.
export const ONE_STRIKE = {
  id: 'oneStrike',
  name: 'One Strike',
  power: 12,        // not especially tanky — the gimmick is the punch, not HP
  intelligence: 20, // flawless reads; combined with untouchable he slips everything
  powers: [],       // no jutsu — he doesn't need them
  passives: ['ironSkin'],
  scale: 1.06,
  color: '#f2c14e', // plain gold suit
  cape: '#e23b3b',  // red cape
  traits: {
    untouchable: true,    // avoids almost everything (weaves + ~99% auto-miss)
    perfectStrike: true,  // his own punches never miss — every blow is clean
    unbreakable: true,    // never staggered or knocked down
    seriousPunch: true,   // heavies charge slow, then hit for a lethal multiple
    chill: true,          // relaxed, bored posture & sparse aggression
    tireless: true,       // never tires (infinite stamina) and never retreats
    athletic: true,       // instant accel + dead stops — never slides a pixel
    blink: true,          // teleports to close the gap when the enemy is far
    style: 'caped',
  },
  blurb: 'Bored and untouchable. Slips every blow, then ends it with one slow, world-ending punch.',
};

export const MONSTERS = [AZURE_ASSASSIN, ONE_STRIKE];

export function getMonster(id) {
  return MONSTERS.find(m => m.id === id) || AZURE_ASSASSIN;
}
