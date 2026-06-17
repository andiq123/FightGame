# Architecture & Design Principles

## Fighter attributes (config/stats.js)

A fighter has exactly **two** configurable levels, both on the same **1–20**
scale, defined once in `config/stats.js` and used everywhere. Both the hero and
the monster use the same two knobs (the monster's defaults are overridable).

| Level | Governs | 1 → 20 (linear) |
|---|---|---|
| `power` | HP **and** melee damage, defense, jutsu damage | HP 200→2000; dmg ×1.0→×2.5; taken ×1.0→×0.5; skill ×1.0→×2.5 |
| `intelligence` | AI decision quality (the only brain knob) | reaction 360ms→60ms; skill gates 0→1; lvl 16+ expert, lvl 20 nightmare |

Two fighters with the same `power` are physically identical (same HP, attack,
defense, skill damage); same `intelligence` → identical decisions.

**Intelligence is decisive.** Its primary lever is reaction time: a fighter
re-decides every ~520ms at level 1 vs ~55ms at level 20 (`reactionIntervalMs`),
so a slow brain literally eats combos it never sees. On top of that, the defense
and punish gates in `ai/decide.js` scale with raw skill (so even a few levels
sharply improve blocking/punishing), while mid-range separation uses
`execSkill = skill^1.4`. Measured head-to-head (equal Power, both sides
averaged): 20 vs 1 ≈ 100%, 20 vs 5 ≈ 98%, 10 vs 5 ≈ 81%, 5 vs 1 ≈ 71%,
10 vs 10 ≈ 50%. A maxed fighter is essentially untouchable by a novice.

**Skill counters scale with intelligence** (`ai/decide.js`): a smart fighter
*knows* the right answer to each jutsu, a dumb one doesn't. Clones are one-hit
decoys — `counterClone` makes a high-IQ fighter go pop them (awareness
`0.12 + skill·0.88`) while a low-IQ fighter ignores them and gets harassed.
`counterHeal` makes a smart fighter interrupt a healing opponent. Projectiles
(`evadeProjectile`) and walls (obstacle pre-processing) are likewise countered
only when skill is high enough. Mappings are
linear so every step is felt; intelligence adds tier flags so 20 ("nightmare")
feels distinct from 19. `Fighter.setStats({power, intelligence})` recomputes
everything via `deriveFromPower()`; `getSkillDamage(fighter, base)` applies the
power multiplier at each skill's damage site. The AI reads each fighter's own
`fighter.intelligence`.

## AI: one brain, not three

Concerns are split into focused modules:
- **`ai/context.js`** — perception: distance, vision, projectile threat, frame
  advantage, opponent + self state, all the awareness flags.
- **`ai/skills.js`** — every jutsu has one CATEGORY (projectile, movement/teleport,
  meleeBurst, control, defense/wall, setup, recovery) plus tags (`evade`,
  `defense`). `pickPower(ctx, {categories|tags})` selects by class instead of
  hardcoded id lists — the one reusable skill-selection pattern.
- **`ai/evasion.js`** — projectile-aware dodging: read the shot's height/timing/
  distance and answer optimally (teleport → duck a high shot → jump a low shot →
  sidestep → block), all gated by intelligence. Duck/jump actually whiff
  projectiles (height rules in `engine/projectileSystem.js`).
- **`ai/decide.js`** — orchestration only: the priority-ordered considerations.
- **`ai/behavior.js`** — turns an action into fighter state + locomotion.

The AI is a single utility-based decider. Each decision tick:
1. `ai/context.js` builds sensing data **once** (vision raycast, projectile
   threat, frame advantage, ranges, stamina/HP flags).
2. `decideAction(ctx)` walks a flat, priority-ordered list of considerations
   (evade → defend → punish → recover → survive → anti-air → clone → power →
   close/attack) and returns the first action that fires.
3. `ai/behavior.js` executes the action and briefly commits to it so the AI
   doesn't jitter; an urgent threat (`hasUrgentInterrupt`) breaks the commit.

Powers score themselves via each power's own `score(ctx)` — there is **no**
separate jutsu-profile table, strategy/mood layer, or state machine. `pickPower`
only adds a stamina-budget gate, the global cooldown, and a repeat penalty.

## Melee hit resolution (engine/combat.js)

`processHit` resolves a strike accurately, in order:
1. **Reach** — horizontal hitbox overlap AND vertical reach (`VERTICAL_REACH` 95;
   launchers `VERTICAL_REACH_HIGH` 180), so ground pokes whiff against an airborne
   opponent and only uppercut/high-kick reach into the air.
2. **Wall** — `wallBetween()` blocks the strike if a protective wall (earthWall)
   sits between the fighters, mirroring the projectile-vs-wall rule.
3. **Height evasion** — duck (`blockLow`) UNDER a high attack or jump OVER a low
   attack is a full whiff (attacker left punishable), matching projectile evasion.
4. **Guard** — standing block stops highs, crouch block stops lows.
5. **Crit** — `CRIT_CHANCE` 0.15 / `CRIT_MULT` 1.6, with extra stun, knockback and
   a guaranteed stagger; rendered as a gold "CRIT!" number.

Attack animations (`engine/fightAnimations.js`) are timed so the limb reaches full
extension across the 30–75% hitbox-active window (windup → strike → follow →
recovery), with per-attack variety (jab snap, hook arc, uppercut rise, axe chop,
spin kick).

## SOLID

### Single Responsibility (SRP)
- **game.js**: Orchestrates only - delegates to services. No HUD logic, particle logic, or combat resolution.
- **services/hud.js**: UI updates (HP, stamina, rounds, power cooldowns, jutsu slots).
- **services/particleSystem.js**: Particle spawn, tick, types.
- **services/projectileSystem.js**: Projectile movement, hit detection, removal.
- **services/cloneSystem.js**: Clone chase, attack, expiry.
- **engine/combat.js**: Hit resolution only.
- **entities/fighter.js**: Fighter state and actions only.

### Open/Closed (OCP)
- Powers register via `registerPower()` - new powers without modifying core.
- Spawn effects keyed by power's `spawnEffect` - extensible.

### Liskov Substitution
- Fighter is the single entity type; powers plug in via registry.

### Interface Segregation
- Power handlers receive only the context they need (`{ fighter, opponent, hitEffects, projectiles, clones }`).

### Dependency Inversion
- Game depends on abstractions (services); services receive dependencies via parameters.
- `rng`, `now` passed in rather than imported.

## DRY

- **Coordinate helpers**: `getHitEffectY()`, `getRagdollOriginY(fighter)` - avoid repeating `GROUND_Y - 83 + (y||0)`.
- **Fighter pair**: Use `[fighter1, fighter2]` and `getOpponent(fighter)`.
- **DOM IDs**: `getFighterDomId(index, suffix)` e.g. `hpSet1` → `getFighterDomId(0,'hpSet')`.
- **HUD**: Single `updateHUD(fighter1, fighter2)` called from both ragdoll phase and main loop.
- **Particle/HitEffect tick**: Single `tickParticles(particles, dt)`, `tickHitEffects(hitEffects, dt, maxT)`.
- **Speed buttons**: One handler that syncs both `.speed-control` and `.quick-speed-btn`.

## Structure

```
config/constants.js     - All tunable values
core/coordinates.js     - getHitEffectY, getRagdollOriginY, getCloneDissolveY
services/hud.js         - updateHUD, updatePowerCooldownUI, updateJutsuHUD
services/particleSystem.js - spawn*, tickParticles
engine/                 - physics, combat, renderer, ragdoll, projectileThreat, raycast
entities/               - fighter, attacks, powers/
ai/                     - context (perception/sensing), skills (categorization +
                          pickPower), evasion (projectile dodge/duck/jump/teleport),
                          decide (orchestration), behavior (execution + locomotion),
                          staminaStrategy, presets
game.js                 - minimal orchestrator
```

## Constants

Move magic numbers to config:
- `RENDER.STAGGER_ORIGIN_OFFSET: 83`
- `COMBAT.FIGHTER_OVERLAP_PUSH: 25`
- `COMBAT.FIGHTER_OVERLAP_DIST: 45`
- `EFFECT_DURATION.HITS_DECAY_MS: 5000`
