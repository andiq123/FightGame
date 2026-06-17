import { ATTACK, ATTACK_POWER_PUNCH, GRAB, COMBO_CHAINS } from '../entities/attacks.js';
import { AI, FIGHTER, SHARINGAN, SKILL_AI } from '../config/constants.js';
import { gate, sharp, MASTERY } from '../config/stats.js';
import { shouldPrioritizeRecovery, filterAffordableAttacks } from './staminaStrategy.js';
import { pickPower, recordJutsuUse, CATEGORY, skillGcdMs } from './skills.js';
import { evadeProjectile } from './evasion.js';

// ─────────────────────────────────────────────────────────────────────────────
// AI decision orchestration.
//
// One pass per decision tick over a flat, priority-ordered list of considerations;
// the first that returns an action wins. Concerns are kept separate:
//   - perception/sensing      → ai/context.js
//   - skill categorization    → ai/skills.js (pickPower by category/tag)
//   - projectile evasion      → ai/evasion.js
//   - basic combat + movement → here
// Every power scores itself (each power's score(ctx)); tactics here are readable
// rules. Everything is gated by `ctx.skill` (0…1 from intelligence).
// ─────────────────────────────────────────────────────────────────────────────

export { pickPower, recordJutsuUse };
const C = CATEGORY;

// Linear novice→master interpolation by skill (0…1). Used for intelligence-scaled
// skill tuning that isn't a 0→1 probability gate (e.g. the far-range skip chance).
const lerpSkill = (skill, novice, master) => novice + (master - novice) * Math.max(0, Math.min(1, skill));

// Effective skill for execution gates — the sharpened curve widens the gap
// between mid levels (e.g. 5 vs 10) so every intelligence step is decisive.
function execSkill(ctx) {
  return sharp(ctx.skill);
}

// Attach a HUD/label hint to an action without extra bookkeeping.
function as(action, label) {
  if (action) action.aiLabel = label;
  return action;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function getNextComboAttack(fighter, rng) {
  const n = fighter.comboCount;
  if (n === 0 || fighter.lastLandingAttackType == null) return null;
  const last = fighter.lastLandingAttackType;
  const candidates = COMBO_CHAINS
    .filter(chain => chain.length > n && chain[n - 1] === last)
    .map(chain => chain[n]);
  return candidates.length ? pick(candidates, rng) : null;
}

function shouldRun(ctx, threshold = AI.PREFERRED_DIST_MAX) {
  if (ctx.tired || ctx.staminaLow) return false;
  if ((ctx.staminaRatio ?? 0) < 0.28) return false;
  return ctx.dist > threshold || ctx.oppStaggered || ctx.oppRecovering || ctx.oppHpCritical || ctx.isNightmare;
}

// Light combo builders (small dizzy, never knock down — chain these) and the
// hard FINISHERS (knock the opponent down) used to end a combo.
const LIGHT_ATTACKS = [ATTACK.jab, ATTACK.cross, ATTACK.frontKick, ATTACK.lowKick, ATTACK.hook, ATTACK.uppercut];
const FINISHERS = [ATTACK_POWER_PUNCH, ATTACK.highKick, ATTACK.spinningKick, ATTACK.axeKick];

function buildAttackPool(ctx) {
  const { fighter, tired, aggression, rng, isNightmare } = ctx;
  const combo = fighter.comboCount;
  const comboNext = getNextComboAttack(fighter, rng);

  // FINISH the combo: after stringing a few light hits, end with a hard knockdown.
  // Don't open with one — build the combo first (2-3 lights), then close it out.
  // A frozen opponent (can't escape) gets the finisher immediately.
  const buildTarget = ctx.isExpert ? 3 : 2;
  const readyToFinish = combo >= buildTarget || (combo >= 1 && ctx.oppFrozen);
  if (!tired && readyToFinish && rng() < gate(ctx.skill, MASTERY.FINISH_COMBO)) {
    const fin = filterAffordableAttacks(ctx, FINISHERS, ctx.staminaLow ? 8 : 0);
    if (fin.length) return fin;
  }

  // Guaranteed chain continuation when we have frame advantage.
  if (combo >= 1 && comboNext != null && ctx.frameAdvantage >= 0) {
    const c = filterAffordableAttacks(ctx, [comboNext], ctx.staminaLow ? 10 : 0);
    if (c.length) return c;
  }

  // Otherwise BUILD the combo with fast light attacks (barely dizzy → chain more).
  let pool = tired ? [ATTACK.jab, ATTACK.lowKick, ATTACK.frontKick] : [...LIGHT_ATTACKS];
  if (ctx.opponent.stamina < 40) pool.unshift(ATTACK.lowKick);
  // Mix-ups vs a guard: go LOW under a high block, or throw a turtling opponent.
  if (ctx.oppBlocking) {
    pool.unshift(ATTACK.lowKick, ATTACK.frontKick);
    if (ctx.grabRange && rng() < gate(ctx.skill, MASTERY.PUNISH)) pool.unshift(GRAB);
  }
  if (ctx.oppBlockingALot && aggression > 0.4) pool.unshift(GRAB);
  if (comboNext != null) pool.unshift(comboNext);
  return filterAffordableAttacks(ctx, pool, ctx.staminaLow ? 14 : 0);
}

// ── Considerations (priority order) ─────────────────────────────────────────
// (evadeProjectile lives in ai/evasion.js and is first in the list below.)

function emergencyDefense(ctx) {
  const { oppAttacking, oppHeavyWindup, oppHitbox, opponent, dist, fighter, rng } = ctx;
  if (!(oppAttacking || oppHeavyWindup) || dist > AI.COMBAT_ENTER) return null;
  // Sharingan: don't flinch — eat the hit, warp behind, and punish. Stay aggressive.
  if (ctx.hasSharingan) return null;

  const heavy = oppHeavyWindup || (oppHitbox?.damage >= 12);
  const skill = ctx.skill;

  // SMART THREAT ASSESSMENT — true mastery is conserving actions, not flinching.
  // A skilled fighter reads whether the attack will actually CONNECT: if the
  // opponent is mis-spaced (out of their own reach — common vs a slidey novice),
  // the master ignores the whiff and keeps pressing/punishing rather than wasting
  // a stamina-costly dodge on a strike that misses anyway. A novice panics and
  // defends against everything.
  const oppReach = (oppHitbox?.range ?? opponent?.currentAttack?.data?.range ?? AI.ATTACK_RANGE) + 34;
  if (dist > oppReach && rng() < sharp(skill)) return null;

  // Reacting to an attack is the core skill check. At level 20 it reaches 1.0 —
  // a master reads EVERYTHING (perfection); a novice barely registers it. Heavies
  // are telegraphed, so they're read better than a fast jab.
  const reactChance = heavy ? gate(skill, MASTERY.REACT_HEAVY) : gate(skill, MASTERY.REACT_LIGHT);
  if (rng() > reactChance) return null;

  // NINJA DODGE — the PREFERRED close-combat evasion: a quick i-frame step that
  // slips the incoming attack and leaves the attacker whiffing into a counter.
  // Costs stamina (canAffordDodge), so even a perfect fighter must eventually
  // block/eat when worn down — that attrition is what resolves mirror matches.
  if (fighter.onGround() && ctx.canAffordDodge && rng() < gate(skill, MASTERY.DODGE_COMMIT)) {
    // Mostly backstep out of range; sometimes slip THROUGH to flank (i-frames
    // carry us past) — keeps the exchange flowing and unpredictable.
    const toward = ctx.faceToward();
    const dir = rng() < 0.35 ? toward : -toward;
    return as({ type: 'dodge', dir }, 'evadingProjectile');
  }

  // Defensive jutsu (wall/teleport) if a dodge isn't on.
  const power = pickPower(ctx, {
    tags: ['defense'],
    threshold: heavy ? 40 : 60,
    emergency: heavy
  });
  if (power && (power !== 'earthWall' || dist > 95)) return as({ type: 'power', powerId: power }, 'defending');

  // Block fallback (less preferred than the dodge above).
  const highIncoming = oppHitbox?.high !== false;
  return as({ type: 'block', duration: heavy ? 340 : 240, low: !highIncoming }, 'defending');
}

function punishOpening(ctx) {
  const { oppStaggered, oppGettingUp, oppRecovering, oppJustWhiffed, dist, inRange, rng } = ctx;
  const opening = oppStaggered || oppJustWhiffed || (oppGettingUp && dist < 160) || (oppRecovering && dist < 165);
  if (!opening || ctx.tired) return null;

  // Capitalizing on an opening is a skill: low intelligence lets punishes slip.
  if (rng() > gate(ctx.skill, MASTERY.PUNISH)) return null;

  const power = pickPower(ctx, {
    categories: [C.MELEE_BURST, C.PROJECTILE, C.CONTROL],
    threshold: ctx.oppHpCritical ? 34 : 48,
    finisher: ctx.oppHpCritical
  });
  if (power) return as({ type: 'power', powerId: power }, 'punishing');

  if (!inRange) return as({ type: 'move', dir: ctx.faceToward(), run: true, commitMs: 420 }, 'punishing');

  const heavies = filterAffordableAttacks(ctx, [ATTACK.cross, ATTACK.uppercut, ATTACK.hook, ATTACK.highKick, ATTACK_POWER_PUNCH], ctx.staminaLow ? 12 : 0);
  if (heavies.length) return as({ type: 'attack', attack: pick(heavies, rng) }, 'punishing');
  return null;
}

function recoverStamina(ctx) {
  // Sharingan confidence: keep pressing unless genuinely exhausted.
  if (ctx.hasSharingan && !ctx.staminaCritical) return null;
  if (!shouldPrioritizeRecovery(ctx)) return null;
  if (ctx.dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330) || ctx.isSafe) return as({ type: 'recover' }, 'recharging');
  return as({ type: 'move', dir: -ctx.faceToward(), run: false, commitMs: 600 }, 'retreating');
}

// Is there a safe window to commit to a (cast-locked) recovery skill?
// Safe = no incoming threat, and the opponent can't punish the cast.
function isSafeToHeal(ctx) {
  if (ctx.inboundThreat || ctx.oppAttacking || ctx.oppHeavyWindup) return false;
  if (ctx.isSafe) return true;                                   // behind own wall
  if (ctx.dist >= (AI.STAMINA_SAFE_REST_DIST ?? 330)) return true; // far enough to cast
  if ((ctx.oppStaggered || ctx.oppGettingUp) && ctx.dist > 200) return true; // opponent down & away
  return false;
}

// Proactive recovery: heal when hurt AND safe — not only at death's door. A
// smart fighter values its HP and takes safe windows to top up; a dumb one
// rarely bothers. Selects any RECOVERY-category skill (future-proof).
function recoverHealth(ctx) {
  if (ctx.hasSharingan) return null; // protected & aggressive — don't stop to heal
  if (!ctx.hpLow && !ctx.hpCritical) return null;
  if (!isSafeToHeal(ctx)) return null;
  const { fighter, now } = ctx;
  if (fighter.lastGlobalSkillAt && now - fighter.lastGlobalSkillAt < skillGcdMs(ctx.skill)) return null;
  // Eagerness: always at critical, otherwise scales with intelligence.
  const eager = ctx.hpCritical ? 0.95 : gate(ctx.skill, MASTERY.HEAL_EAGER);
  if (ctx.rng() > eager) return null;
  const power = pickPower(ctx, {
    categories: [C.RECOVERY],
    threshold: 22,
    emergency: ctx.hpCritical,
    allowRepeat: true
  });
  if (power) return as({ type: 'power', powerId: power }, 'recharging');
  return null;
}

// Last-ditch survival when critically hurt and NOT safe enough to heal: use a
// defensive escape (wall / teleport / clone), then create space.
function survive(ctx) {
  if (!ctx.hpCritical) return null;
  if (ctx.hasSharingan) return null; // counter-warp protects us — keep attacking, don't flee
  const power = pickPower(ctx, { tags: ['defense'], threshold: 34, emergency: true, allowRepeat: true });
  if (power) return as({ type: 'power', powerId: power }, 'defending');
  if (ctx.dist < 200) return as({ type: 'move', dir: -ctx.faceToward(), run: true, commitMs: 500 }, 'retreating');
  return null;
}

function antiAir(ctx) {
  const { opponent, fighter, dist, rng } = ctx;
  if (opponent.onGround() || (opponent.vy || 0) >= 0) return null; // only catch a rising jump-in
  if (dist > AI.ATTACK_RANGE + 20 || !fighter.hasStamina(10)) return null;
  if (rng() > 0.35 + ctx.defense * 0.4) return null;
  const aa = filterAffordableAttacks(ctx, [ATTACK.uppercut, ATTACK.highKick], 0);
  if (aa.length) return as({ type: 'attack', attack: aa[0] }, 'combat');
  return null;
}

// COUNTER: clone jutsu. A clone is a one-hit decoy — recognizing that and going
// to pop it (instead of being baited/chipped by it) is knowledge that scales with
// intelligence. A low-IQ fighter doesn't know and lets clones harass it.
function counterClone(ctx) {
  const { nearestEnemyClone, cloneDist, dist, fighter } = ctx;
  if (!nearestEnemyClone) return null;
  if (ctx.rng() > gate(ctx.skill, MASTERY.COUNTER_CLONE)) return null; // awareness scales with intelligence
  if (cloneDist > 240) return null;                      // not worth diverting for a far decoy
  const dir = ctx.faceTowardClone(nearestEnemyClone);
  if (cloneDist <= AI.ATTACK_RANGE && fighter.hasStamina(6)) return as({ type: 'attack', attack: ATTACK.jab }, 'combat'); // pop it
  if (cloneDist < dist + 30) return as({ type: 'move', dir, run: true }, 'approaching');
  return null;
}

// COUNTER: heal jutsu. A healing opponent is wide open — smart fighters punish it
// hard (interrupt at range or rush in); weak ones let the heal go off.
function counterHeal(ctx) {
  if (!ctx.oppHealing) return null;
  if (ctx.rng() > gate(ctx.skill, MASTERY.COUNTER_HEAL)) return null;
  const power = pickPower(ctx, { categories: [C.PROJECTILE, C.MELEE_BURST, C.CONTROL], threshold: 28, finisher: true });
  if (power) return as({ type: 'power', powerId: power }, 'punishing');
  if (ctx.inRange && ctx.fighter.hasStamina(8)) {
    const pool = filterAffordableAttacks(ctx, [ATTACK.cross, ATTACK.hook, ATTACK.uppercut], 0);
    if (pool.length) return as({ type: 'attack', attack: pick(pool, ctx.rng) }, 'punishing');
  }
  return as({ type: 'move', dir: ctx.faceToward(), run: true, commitMs: 300 }, 'punishing');
}

// Sharingan offensive pursuit: while active, blink onto a distant or fleeing
// opponent (repeatedly, on a short cooldown) to keep the pressure relentless.
function sharinganPursue(ctx) {
  if (!ctx.hasSharingan) return null;
  const { fighter, opponent, dist, now } = ctx;
  if (fighter.status.active('sharinganPursueCd', now)) return null;
  const fleeing = Math.abs(opponent.vx || 0) > (SHARINGAN.PURSUE_FLEE_VX ?? 180)
    && Math.sign(opponent.vx || 0) === Math.sign(opponent.x - fighter.x); // running away from us
  if (dist > (SHARINGAN.PURSUE_RANGE ?? 130) || fleeing) {
    return as({ type: 'sharinganWarp' }, 'pressuring');
  }
  return null;
}

// Bait / feint — a skilled ninja neutral game: hover just out of range to draw a
// whiff, then punishOpening cashes in the counter. Only smart fighters do this.
function bait(ctx) {
  if (!ctx.isExpert || ctx.hasSharingan) return null;
  const { dist, rng } = ctx;
  if (dist < 95 || dist > 200 || ctx.staminaLow || ctx.oppAttacking || ctx.oppStaggered) return null;
  // Don't bait a weaker/passive opponent — just go in and pressure.
  if (ctx.oppHpCritical || ctx.oppRecovering) return null;
  if (rng() < 0.05 + ctx.skill * 0.06) {
    return as({ type: 'move', dir: -ctx.faceToward(), run: false, commitMs: 260 }, 'baiting');
  }
  return null;
}

function useOffensivePower(ctx) {
  const { rng, isNightmare, skill } = ctx;
  // A novice often wastes a skill window and just shuffles forward; a master
  // never does. (Intelligence decides how OFTEN skills get woven into the fight.)
  if (rng() < lerpSkill(skill, SKILL_AI.FAR_SKIP_NOVICE, SKILL_AI.FAR_SKIP_MASTER)) return null;
  // No category range-gating: every power's own score(ctx) already knows the
  // range/situation it wants (fireball wants distance, clone/ice work up close).
  // We just pick the best-scoring affordable one — threshold scales with skill.
  const power = pickPower(ctx);
  // Smart fighters weave jutsu constantly; weak ones rarely commit. Final gate
  // reaches 1.0 at level 20 — a master always cashes in a worthwhile skill.
  if (power && (isNightmare || ctx.hasSharingan || rng() < gate(execSkill(ctx), MASTERY.POWER_USE))) return as({ type: 'power', powerId: power }, 'combat');
  return null;
}

function closeOrAttack(ctx) {
  const { inRange, fighter, dist, tired } = ctx;
  const toward = ctx.faceToward();
  const confident = ctx.hasSharingan; // protected → press the attack, never back off

  if (!confident && (tired || (fighter.stamina < 15 && dist < 110))) {
    return as({ type: 'move', dir: -toward, run: false, commitMs: 400 }, 'retreating');
  }
  if (inRange && fighter.hasStamina(8)) {
    // Low intelligence sometimes mistimes the hit — but a confident fighter commits.
    if (!confident && ctx.rng() < 0.3 * (1 - execSkill(ctx))) return as({ type: 'move', dir: toward, run: false, commitMs: 140 }, 'approaching');
    const pool = buildAttackPool(ctx);
    if (pool.length) return as({ type: 'attack', attack: pick(pool, ctx.rng) }, 'combat');
  }
  if (!inRange) {
    const skill = ctx.skill;
    const rng = ctx.rng;
    // Low intelligence mis-spaces — lunges with an attack from just out of range,
    // so it WHIFFS (and gets punished). Smart fighters wait until they're in range.
    if (dist < AI.ATTACK_RANGE + 50 && fighter.hasStamina(8) && rng() < (1 - execSkill(ctx)) * 0.38) {
      const pool = buildAttackPool(ctx);
      if (pool.length) return as({ type: 'attack', attack: pick(pool, rng) }, 'combat');
    }
    // Ninja approach — close with style, not just a walk:
    //  · slide low into mid-range,  · leap the gap from far (directional hop).
    if (confident && dist > 100 && dist < 240 && fighter.onGround() && ctx.canAffordSlide && rng() < 0.4) {
      return as({ type: 'slide', dir: toward }, 'pressuring');
    }
    if (fighter.onGround() && dist > 95 && dist < 200 && ctx.canAffordSlide && rng() < 0.1 + skill * 0.2) {
      return as({ type: 'slide', dir: toward }, 'approaching');
    }
    if (fighter.onGround() && dist > 230 && fighter.hasStamina(FIGHTER.JUMP_STAMINA ?? 14) && rng() < 0.07 + skill * 0.12) {
      return as({ type: 'jump', dir: toward }, 'approaching'); // leap forward over the gap
    }
    const run = confident || shouldRun(ctx);
    return as({ type: 'move', dir: toward, run, commitMs: run ? 560 : 380 }, confident ? 'pressuring' : 'approaching');
  }
  return as({ type: 'move', dir: toward, run: false, commitMs: 240 }, 'pressuring');
}

const CONSIDERATIONS = [
  evadeProjectile, // 1. survive incoming projectiles (defense first)
  emergencyDefense,// 2. answer an incoming melee attack
  survive,         // 3. desperate escape when critical & unsafe
  recoverHealth,   // 4. heal when hurt & safe
  counterHeal,     // 5. punish a healing/cloning opponent
  counterClone,
  sharinganPursue, // 6. blink onto a fleeing/distant foe while sharingan is up
  // Skill use is a PRIMARY part of a smart fighter's game — woven into melee AND
  // neutral, NOT a last resort. It sits above the basic punish/approach/attack so
  // masters actually USE jutsu (freeze→combo, clone, fireball) instead of always
  // throwing a punch. Frequency scales hard with intelligence inside the function
  // (far-skip, GCD, threshold, cooldown all interpolate novice→master).
  useOffensivePower,
  punishOpening,   // basic-melee punish when no skill is the right call
  recoverStamina,
  antiAir,
  bait,            // skilled neutral game — draw a whiff, then punish
  closeOrAttack
];

// A wall can't be walked through. If a move heads into a near wall, a smart
// fighter vaults over it (jump) or redirects; a dumb one may still bonk into it.
function avoidWall(ctx, action) {
  if (action?.type !== 'move') return action;
  const fighter = ctx.fighter;
  if (!fighter.onGround()) return action; // already mid-vault — don't fight the jump
  const obs = ctx.nearestObstacle;
  if (!obs || action.dir !== obs.dir || obs.d > 95) return action;

  // Awareness of the obstacle scales with intelligence.
  if (ctx.rng() > gate(ctx.skill, MASTERY.WALL_AWARE)) return action;

  if (fighter.hasStamina(FIGHTER.JUMP_STAMINA ?? 14)) {
    return { type: 'jump', wallVault: true, dir: obs.dir, aiLabel: action.aiLabel || 'approaching' };
  }
  return { ...action, dir: -action.dir }; // can't jump → don't push into it, go around
}

export function decideAction(ctx) {
  for (const consider of CONSIDERATIONS) {
    const action = consider(ctx);
    if (action) return avoidWall(ctx, action);
  }
  return avoidWall(ctx, as({ type: 'move', dir: ctx.faceToward(), run: false }, 'approaching'));
}

// Should the AI interrupt a committed move to re-decide right now?
export function hasUrgentInterrupt(ctx) {
  return !!(ctx.inboundThreat
    || ((ctx.oppAttacking || ctx.oppHeavyWindup) && ctx.dist <= AI.COMBAT_ENTER)
    || ctx.oppStaggered
    || ctx.oppJustWhiffed);
}
