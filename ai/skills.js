import { scorePower } from '../entities/powers/index.js';
import { scorePowerWithBudget } from './staminaStrategy.js';
import { SKILL_AI } from '../config/constants.js';

// Global cooldown between any two casts, scaled by intelligence: a master fires
// jutsu ~5× more often than a novice. The single source for skill cadence.
export function skillGcdMs(skill) {
  const s = Math.max(0, Math.min(1, skill ?? 0));
  return SKILL_AI.GCD_NOVICE_MS + (SKILL_AI.GCD_MASTER_MS - SKILL_AI.GCD_NOVICE_MS) * s;
}

// Score a skill must beat to be worth casting, scaled by intelligence: a master
// casts readily (low bar), a novice only on a great opportunity (high bar).
export function skillThreshold(skill) {
  const s = Math.max(0, Math.min(1, skill ?? 0));
  return SKILL_AI.THRESHOLD_NOVICE + (SKILL_AI.THRESHOLD_MASTER - SKILL_AI.THRESHOLD_NOVICE) * s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill categorization — the single source of truth for "what kind of jutsu is
// this". The decider asks for a CATEGORY or a TAG ("give me a defensive skill",
// "give me a projectile") instead of hardcoding power-id lists in ten places.
//
// ADDING A NEW POWER (future-proof convention):
//   1. Register it in entities/powers/<name>.js with its own score(ctx).
//   2. Add ONE line to SKILLS below mapping it to a CATEGORY (+ optional tags).
// That's it — the decider already selects each category in the right context
// (PROJECTILE/CONTROL at range, MELEE_BURST/MOVEMENT/SETUP up close, RECOVERY
// when hurt & safe, DEFENSE under pressure), so the new skill is used correctly
// with no changes to decide.js. Tags compose across categories: 'evade' (answers
// a projectile), 'defense' (valid when under pressure).
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY = {
  PROJECTILE: 'projectile',   // ranged — fired across the gap
  MOVEMENT: 'movement',       // teleport / dash repositioning
  MELEE_BURST: 'meleeBurst',  // close-range damage / finisher
  CONTROL: 'control',         // freeze / pull — lock the opponent down
  DEFENSE: 'defense',         // wall / repel — protection
  SETUP: 'setup',             // clone — pressure / decoy
  RECOVERY: 'recovery',       // heal
  BUFF: 'buff'                // self-buff — sharingan and future stance/aura skills
};

const C = CATEGORY;

// One category per skill, plus optional tags used cross-category:
//   evade   — useful to escape an inbound projectile (i-frames / wall / repel)
//   defense — a valid answer when under pressure / on defense
const SKILLS = {
  fireball:        { category: C.PROJECTILE },
  shuriken:        { category: C.PROJECTILE },
  flameShower:     { category: C.PROJECTILE },
  spectralDash:    { category: C.MOVEMENT, tags: ['evade', 'defense'] }, // teleport + i-frames
  iceSpikes:       { category: C.CONTROL },
  earthWall:       { category: C.DEFENSE, tags: ['evade', 'defense'] },   // wall blocks projectiles
  cloneJutsu:      { category: C.SETUP, tags: ['defense'] },
  heal:            { category: C.RECOVERY },
  sharingan:       { category: C.BUFF, tags: ['defense'] } // activate when about to be hit
};

export function categoryOf(powerId) {
  return SKILLS[powerId]?.category ?? null;
}

// Power ids belonging to any of the given categories.
export function inCategories(categories) {
  return Object.keys(SKILLS).filter(id => categories.includes(SKILLS[id].category));
}

// Power ids carrying a given tag (e.g. 'evade', 'defense').
export function withTag(tag) {
  return Object.keys(SKILLS).filter(id => SKILLS[id].tags?.includes(tag));
}

// Pick the best affordable power for the situation. Each power scores itself
// (see each power's score(ctx)); we add only the stamina-budget gate, the global
// cooldown, and a repeat penalty. Filter via `categories`, `tags`, or `allowed`.
// `threshold` defaults to the intelligence-scaled bar (skillThreshold) so smart
// fighters cast far more readily — pass an explicit number to override.
export function pickPower(ctx, { categories = null, tags = null, allowed = null, threshold = null, emergency = false, finisher = false, allowRepeat = false } = {}) {
  const { fighter, now } = ctx;
  if (!fighter.powers?.length) return null;
  if (!emergency && fighter.lastGlobalSkillAt && now - fighter.lastGlobalSkillAt < skillGcdMs(ctx.skill)) return null;
  if (threshold == null) threshold = skillThreshold(ctx.skill);

  let allow = allowed;
  if (categories) allow = (allow || []).concat(inCategories(categories));
  if (tags) allow = (allow || []).concat(tags.flatMap(withTag));
  const allowSet = allow ? new Set(allow) : null;

  let best = null;
  let bestScore = threshold;
  for (const pid of fighter.powers) {
    if (allowSet && !allowSet.has(pid)) continue;
    const base = scorePower(pid, ctx);
    if (base <= 0) continue;
    let s = scorePowerWithBudget(ctx, pid, base, {
      emergency: emergency || ctx.hpCritical || ctx.cannotEvade,
      finisher: finisher || ctx.oppHpCritical
    });
    if (s <= 0) continue;
    if (!allowRepeat && pid === fighter.lastUsedPower) {
      const reps = (fighter.aiJutsuHistory || []).filter(id => id === pid).length;
      s -= 20 + reps * 12;
    }
    s += (ctx.rng?.() ?? 0) * 6;
    if (s > bestScore) {
      bestScore = s;
      best = pid;
    }
  }
  return best;
}

// Record a used jutsu for repeat-avoidance (called from behavior on cast).
export function recordJutsuUse(fighter, powerId) {
  fighter.aiJutsuHistory = fighter.aiJutsuHistory || [];
  fighter.aiJutsuHistory.unshift(powerId);
  if (fighter.aiJutsuHistory.length > 6) fighter.aiJutsuHistory.pop();
}
