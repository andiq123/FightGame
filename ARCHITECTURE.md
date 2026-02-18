# Architecture & Design Principles

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
ai/                     - behavior, stateMachine, presets
game.js                 - minimal orchestrator
```

## Constants

Move magic numbers to config:
- `RENDER.STAGGER_ORIGIN_OFFSET: 83`
- `COMBAT.FIGHTER_OVERLAP_PUSH: 25`
- `COMBAT.FIGHTER_OVERLAP_DIST: 45`
- `EFFECT_DURATION.HITS_DECAY_MS: 5000`
