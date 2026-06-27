// ─────────────────────────────────────────────────────────────────────────────
// Character traits — special, mix-and-match fighter abilities (the "One Strike"
// kit). Any subset can be attached to a fighter's `traits: {}`; the engine reads
// each one in the file noted below. This registry drives the toggle UI so a trait
// shows up automatically for both the hero and the enemy with no UI changes.
//
// Each trait is ONE clear, non-overlapping ability. Where it's implemented:
//   untouchable   decide.js + combat.js  DEFENSE: avoids incoming attacks (weaves
//                                        out, and hits that connect MISS ~99%).
//   unbreakable   engine/combat.js       DEFENSE: never staggered / knocked down.
//   perfectStrike engine/combat.js       OFFENSE: own attacks never miss.
//   seriousPunch  engine/combat.js       OFFENSE: heavy hits are one-shot lethal.
//   tireless      fighter.js + decide.js STAMINA: infinite; never rests/retreats.
//   athletic      ai/behavior.js         MOVE: instant accel + dead stops, no slide.
//   blink         decide.js + behavior   MOVE: teleports to close a far gap.
//   chill         decide.js + renderer   STYLE: relaxed stance; attacks rarely.
//   caped         engine/renderer.js     LOOK: cape + bald deadpan appearance.
// ─────────────────────────────────────────────────────────────────────────────

export const TRAITS = {
  // ── Defense ──
  untouchable:   { name: 'Untouchable', tip: 'Avoids almost every incoming attack — weaves out, and hits that land MISS ~99% of the time' },
  unbreakable:   { name: 'Unbreakable', tip: 'Can never be staggered or knocked down' },
  // ── Offense ──
  perfectStrike: { name: 'Perfect Strike', tip: 'Own attacks never miss — every blow connects clean' },
  seriousPunch:  { name: 'Serious Punch', tip: 'Heavy hits land for massive, near one-shot damage' },
  // ── Stamina ──
  tireless:      { name: 'Tireless', tip: 'Infinite stamina; never rests or retreats' },
  // ── Movement ──
  athletic:      { name: 'Athletic', tip: 'Instant acceleration and dead stops — never slides' },
  blink:         { name: 'Blink', tip: 'Short hop to close a gap in a fight' },
  // ── Style / look ──
  chill:         { name: 'Chill', tip: 'Relaxed, bored stance; strikes only now and then' },
  caped:         { name: 'Caped Look', tip: 'Cosmetic: flowing cape + bald deadpan look' },
};

// 'caped' is a visual style, not a behavioural boolean; everything else maps to
// fighter.traits[id] = true.
export const STYLE_TRAITS = { caped: 'caped' };

export function getTraitIds() {
  return Object.keys(TRAITS);
}

// A character's traits object (e.g. {untouchable:true, style:'caped'}) → the id
// list the toggle UI / buildTraits use ('style' maps to its value, e.g. 'caped').
export function traitsToIds(traitsObj = {}) {
  return Object.entries(traitsObj).flatMap(([k, v]) => (k === 'style' ? [v] : (v ? [k] : [])));
}

// Build a fighter's traits object + style from a list of selected trait ids.
export function buildTraits(selectedIds = []) {
  const traits = {};
  let style = null;
  for (const id of selectedIds) {
    if (STYLE_TRAITS[id]) style = STYLE_TRAITS[id];
    else traits[id] = true;
  }
  return { traits, style };
}
