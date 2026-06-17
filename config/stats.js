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

// HP is derived from `power` so equal power → equal health.
export const HP_RANGE = { MIN: 200, MAX: 2000 };

export function clampStat(value, fallback = STAT.DEFAULT) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(STAT.MIN, Math.min(STAT.MAX, n));
}

// Normalize a 1–20 level to 0…1.
export const statT = (level) => (clampStat(level) - STAT.MIN) / (STAT.MAX - STAT.MIN);

// ── Power level → physical profile (linear, every step felt) ─────────────────
export function powerProfile(level) {
  const t = statT(level);
  return {
    hp: Math.round(HP_RANGE.MIN + t * (HP_RANGE.MAX - HP_RANGE.MIN)), // 200 … 2000
    damageMult: 1 + t * 1.5,       // melee dealt:  ×1.0 … ×2.5
    damageTakenMult: 1 - t * 0.5,  // melee taken:  ×1.0 … ×0.5
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
export const REACTION_MS = { SLOW: 520, FAST: 55 };

export function getAIStats(intelligence) {
  const lvl = clampStat(intelligence);
  const t = statT(lvl);
  const pct = Math.round(t * 100);
  const reactionMs = Math.round(REACTION_MS.FAST + (REACTION_MS.SLOW - REACTION_MS.FAST) * Math.pow(1 - t, 1.15));

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
