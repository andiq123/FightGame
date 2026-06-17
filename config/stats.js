// ─────────────────────────────────────────────────────────────────────────────
// Fighter attribute schema — the single source of truth.
//
// A fighter has exactly TWO configurable levels, both on the same 1–20 scale:
//
//   power         → physical might: HP, melee damage, defense, and jutsu damage
//   intelligence  → combat decision-making quality (the AI "brain")
//
// Two fighters with the same `power` are physically identical (same HP, attack,
// defense, skill damage); two fighters with the same `intelligence` think
// identically. The 1–20 limit is defined ONCE here (STAT) and reused everywhere.
// All mappings are linear, so every step is felt — including 19 → 20 — and
// intelligence unlocks tiers so level 20 has a distinct, "incredible" top end.
// ─────────────────────────────────────────────────────────────────────────────

export const STAT = { MIN: 1, MAX: 20, DEFAULT: 5 };

// HP is derived from `power` so equal power → equal health. The ceiling is kept
// modest so fights actually resolve in a reasonable time instead of grinding —
// HP must not outscale damage output (see damageTakenMult below).
export const HP_RANGE = { MIN: 180, MAX: 780 };

export function clampStat(value, fallback = STAT.DEFAULT) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(STAT.MIN, Math.min(STAT.MAX, n));
}

// Normalize a 1–20 level to 0…1.
export const statT = (level) => (clampStat(level) - STAT.MIN) / (STAT.MAX - STAT.MIN);

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── Intelligence → mastery (ONE harmonious model, no scattered magic numbers) ──
// Every intelligence-driven probability in the AI flows through here so the stat
// scales as a single coherent system. A lone 0…1 `skill` (= statT(intelligence))
// feeds named gates, each rising from a novice `floor` to a perfect 1.0 at level
// 20 — "clean perfection". Tune behaviour HERE, never inline in the AI rules.
//
//   gate(skill, floor)  → floor … 1.0   (perfection at lvl 20)
//   sharp(skill, exp)   → skill^exp     (widens mid-level separation; decisive)
//   accuracyGate(skill) → steep curve so a novice barely connects, a master
//                         never misses (the headline "lvl5 whiffs, lvl20 lands").
//
// INT_CURVE is THE master decisiveness knob: every gate raises skill to this
// power first, so the gap between a mid fighter and a master is huge while a
// novice stays near the floor and lvl 20 stays exactly 1.0. Raise it to make
// intelligence even more extreme; 1.0 = linear.
export const INT_CURVE = 1.9;
export const gate = (skill, floor) => floor + (1 - floor) * Math.pow(clamp01(skill), INT_CURVE);
export const sharp = (skill, exp = INT_CURVE) => Math.pow(clamp01(skill), exp);
// Accuracy is the headline intelligence stat. A LOW floor (novice almost never
// connects) plus a moderate exponent keeps EVERY level distinct — int8 lands far
// more than int4, int15 far more than int10 — rising to a perfect 1.0 at lvl 20.
export const accuracyGate = (skill) => MASTERY.ACCURACY_FLOOR + (1 - MASTERY.ACCURACY_FLOOR) * Math.pow(clamp01(skill), 2.2);

// Per-behaviour novice floors. Each gate hits 1.0 at intelligence 20 (perfection).
// Lower floor = a wider gulf between a novice and a master for that skill.
export const MASTERY = {
  REACT_HEAVY: 0.10,    // read & answer a telegraphed heavy in time
  REACT_LIGHT: 0.02,    // read & answer a fast jab in time (novice almost never)
  DODGE_COMMIT: 0.10,   // slip with an i-frame dodge vs a plain block
  PROJECTILE_DODGE: 0.12, // weave a projectile rather than eat/block it
  PROJECTILE_READ: 0.20,  // jump/duck a projectile on read
  ACCURACY_FLOOR: 0.02, // hit-chance floor — a novice almost never connects
  PUNISH: 0.08,         // capitalize on an opening (whiff / stagger / recovery)
  COUNTER_HEAL: 0.06,   // recognize & punish a healing opponent
  COUNTER_CLONE: 0.08,  // recognize a clone decoy and pop it
  HEAL_EAGER: 0.42,     // value own HP enough to take a safe heal
  POWER_USE: 0.32,      // use the right jutsu at the right moment
  FINISH_COMBO: 0.55,   // cap a combo with a knockdown finisher
  WALL_AWARE: 0.22,     // notice a wall and vault/redirect instead of bonking
};

// Intelligence → body control (agility). A master accelerates crisply, holds a
// touch more top speed, and brakes almost instantly to plant a strike; a novice
// is sluggish and slides like ice. All three derive from the SAME skill value.
export function agilityProfile(skill) {
  // Sharpen so body control improves decisively with intelligence — a mid fighter
  // is still notably sluggish, only a near-master gets crisp control.
  const s = sharp(clamp01(skill));
  return {
    accelMult: 0.30 + s * 1.30,  // ×0.30 (sluggish) … ×1.60 (instant, capped by caller)
    brakeMult: 0.16 + s * 1.80,  // ×0.16 (slides far) … ×1.96 (stops on a dime)
    speedMult: 0.86 + s * 0.24,  // ×0.86 … ×1.10 top-speed edge
  };
}

// ── Power level → physical profile (linear, every step felt) ─────────────────
export function powerProfile(level) {
  const t = statT(level);
  return {
    hp: Math.round(HP_RANGE.MIN + t * (HP_RANGE.MAX - HP_RANGE.MIN)), // 200 … 2000
    damageMult: 1.35 + t * 1.35,   // melee dealt:  ×1.35 … ×2.7 (even low power hits real)
    damageTakenMult: 1 - t * 0.35, // melee taken:  ×1.0 … ×0.65 (defense doesn't cancel damage growth)
    skillMult: 1 + t * 1.5,        // jutsu damage: ×1.0 … ×2.5
  };
}

// Apply a caster's power to a base skill damage value.
export const getSkillDamage = (fighter, base) => Math.round(base * (fighter?.powerMult ?? 1));

// ── Intelligence level → AI behavioral profile ───────────────────────────────
// Intelligence is the ONLY brain knob. Higher = sharper decisions AND a more
// confident, aggressive, combo-oriented style. Returned values are on a 0–100
// scale because the decision code reads them as `/ 100`.
// Reaction time is THE skill differentiator: a smart fighter sees and answers an
// attack far sooner. Level 1 thinks every ~460ms (sluggish — eats combos, never
// reacts in time); level 20 every ~55ms (near frame-perfect). The curve keeps the
// low end genuinely slow so even a few levels of intelligence matter a lot.
export const REACTION_MS = { SLOW: 680, FAST: 45 };

export function getAIStats(intelligence) {
  const lvl = clampStat(intelligence);
  const t = statT(lvl);
  const pct = Math.round(t * 100);
  // Sharpened so mid-level intelligence is still distinctly slow — only a near-
  // master reacts quickly. (1 - sharp(t)) keeps the low/mid end sluggish; lvl 20
  // hits FAST exactly. Reaction is the single biggest intelligence differentiator.
  const reactionMs = Math.round(REACTION_MS.FAST + (REACTION_MS.SLOW - REACTION_MS.FAST) * (1 - sharp(t)));

  return {
    level: lvl,
    skill: t,
    reaction: pct,
    aggression: pct,
    defense: pct,
    spacing: pct,
    comboTendency: pct,
    riskTolerance: pct,
    parkourTendency: pct,
    // Per-fighter decision cadence (ms). Smarter = reacts sooner.
    reactionIntervalMs: reactionMs,
    isExpert: lvl >= 16,
    isNightmare: lvl >= 20
  };
}
