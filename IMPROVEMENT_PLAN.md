# Fight Game – Improvement Plan

## Current State

- **32 files**, stickman fighter game with AI vs AI, powers, 2D canvas
- Functional but dated: basic scene, simple ragdoll, RNG-heavy AI, generic visual style
- No parallax, limited feedback, rigid animations, flat hit reactions

---

## 1. Scene & Environment (engine/renderer.js `drawBackground`)

| Issue | Improvement |
|-------|-------------|
| Flat bamboo/lanterns | Add parallax layers: far mountains (0.3x), mid bamboo (0.6x), near floor (1x) |
| Static lighting | Ambient occlusion under fighters, subtle rim light from lanterns |
| Uniform fog | Depth haze: distant objects darker, layered atmosphere |
| Plain planks | Wood grain texture, wear marks, subtle normal illusion via gradients |
| No foreground | Add thin foreground silhouette layer (reeds/bamboo) for depth |
| Lanterns static | Soft glow pulse, hanging sway (light wind) |
| No dynamic lighting | Lantern radius lighting for nearby fighters |
| Flat sky | Star field at night, gradient clouds, subtle moon |

**Files:** `engine/renderer.js`, `config/constants.js`

---

## 2. Ragdoll (engine/ragdoll.js)

| Issue | Improvement |
|-------|-------------|
| Line limbs look crude | Draw limbs as tapered capsules, smooth joints |
| No hand/wrist points | Add wrists for arm hang, feet for ground contact |
| No impact point | Pass hit location; apply impulse at point of impact |
| Same reaction for all hits | Different reactions: jab (quick), heavy (fling), uppercut (arc) |
| Rigid torso | Add spine segments (3–4) for bending |
| Instant settle | Settle transition (e.g. 200ms) before get-up |
| No bounce on impact | Slight bounce when body hits ground |
| Hands/feet clip | Hand/wrist constraints, ankle limits |

**Files:** `engine/ragdoll.js`, `engine/combat.js`, `entities/powers/*.js`

---

## 3. Fighter Visuals (engine/renderer.js `drawStickman`)

| Issue | Improvement |
|-------|-------------|
| Stick figure look | Slightly thicker limbs, clearer silhouette |
| Hard pose snaps | Blend poses with easing |
| Idle static | Idle sway, breathing, weight shift |
| No anticipation | Wind-up frames for attacks (pull back before strike) |
| No follow-through | Brief overshoot then settle on attacks |
| Hit flash basic | Directional flash from impact side, stronger on heavy |
| No trails | Motion blur or trail on dodge/slide |
| Clone visual | Fading clone with distinct tint |

**Files:** `engine/renderer.js`, `entities/fighter.js`

---

## 4. AI Combat (ai/stateMachine.js, ai/behavior.js, ai/presets.js)

| Issue | Improvement |
|-------|-------------|
| RNG-heavy decisions | Weight by situation; reduce randomness |
| No attack prediction | Track opponent patterns, counter common strings |
| No frametrap logic | Use recovery frames to punish unsafe moves |
| Limited mixups | High/low mix, grab after block, dash-in grabs |
| No blockstrings | Recognize block, apply pressure with safe moves |
| Bad corner play | Corner-specific options (escape, pressure, traps) |
| Flat difficulty | Novice vs Expert: fewer options vs. full system |
| No combo memory | Remember recent combos to avoid repetition |
| Punish window underused | Clear whiff-punish windows, dash punish logic |

**Files:** `ai/stateMachine.js`, `ai/behavior.js`, `ai/presets.js`, `config/constants.js`

---

## 5. Hit Feedback (core/hitEffectFactory.js, services/particleSystem.js)

| Issue | Improvement |
|-------|-------------|
| Circular hit effects | Impact shape (line for slash, burst for punch) |
| Few particle types | Sparks, dust, screen shake by damage tier |
| Simple damage numbers | Pop, color, size by damage/type |
| No hitstop | Short freeze on heavy hits (5–15ms) |
| No slow-mo | Brief slow on KO or counter |
| Particles sparse | More particles, varied life/scale |
| No sound hooks | Emit events for future sound system |

**Files:** `core/hitEffectFactory.js`, `services/particleSystem.js`, `game.js`, `engine/renderer.js`

---

## 6. Physics (engine/physics.js, engine/combat.js)

| Issue | Improvement |
|-------|-------------|
| Knockback too uniform | Directional knockback from hit side |
| No wall splat | Special behavior when hitting arena walls |
| Slide on ground | Ground friction, slide distance by speed |
| Air control | Slight horizontal control in air |
| Corner bounce | Light wall bounce on corner hits |
| Hitbox scaling | Hitbox size by attack type |
| Combo scaling | Clearer damage scaling, UI hints |

**Files:** `engine/physics.js`, `engine/combat.js`, `config/constants.js`

---

## 7. HUD & UI (styles.css, services/hud.js, index.html)

| Issue | Improvement |
|-------|-------------|
| Generic fonts | Custom or stylized font |
| Plain bars | Glassy bars, glow, clearer hierarchy |
| No combo display | Combo counter, damage dealt this round |
| Round display basic | Round history, clearer transitions |
| Panel style | Stronger theme, color accents |
| Match-over screen | Stats, replay option, better layout |
| No tooltips | Short tips for powers and AI levels |

**Files:** `styles.css`, `services/hud.js`, `index.html`, `game.js`

---

## 8. Camera & Presentation (game.js `render`, `getCameraX`)

| Issue | Improvement |
|-------|-------------|
| Fixed zoom | Zoom to action on heavy hits, pull back on KO |
| No cinematic | KO cam, round-start zoom |
| Shake basic | Intensity from impact, directional |
| No focus | Slight focus on winning fighter at round end |

**Files:** `game.js`, `engine/renderer.js`

---

## 9. Audio (New)

| Item | Notes |
|------|-------|
| Hit sounds | Light / heavy / block / clash |
| Power sounds | Fireball, shuriken, lightning, etc. |
| Ambience | Background, crowd, wind |
| Music | Optional fight track |
| Volume | Mute/slider, per-category |

**Files:** Create `services/audio.js`, wire into `game.js` and combat/powers

---

## 10. Code & Architecture

| Issue | Improvement |
|-------|-------------|
| Magic numbers | Move to `config/constants.js` |
| No debug mode | Toggle for hitboxes, ragdoll, AI state |
| Hardcoded colors | Palette in config |
| Tight coupling | Clearer interfaces for renderer and physics |

**Files:** `config/constants.js`, `game.js`, relevant modules

---

## Priority Order

1. **High impact, low effort:** Scene parallax, hit feedback, HUD polish, ragdoll drawing
2. **High impact, medium effort:** AI improvements, camera effects, physics tweaks
3. **Medium impact:** Fighter animation polish, particle variety
4. **Later:** Audio, debug mode, full cinematic system

---

## Suggested Implementation Order

| Phase | Tasks | Status |
|-------|-------|--------|
| 1 | Parallax background, ragdoll capsules, hit effect burst shapes | Done |
| 2 | Hit particles, screen shake tiers, damage number styling, camera zoom on heavy | Done |
| 3 | AI: prediction, mixups, difficulty scaling | Pending |
| 4 | KO focus, round transition | Pending |
| 5 | Fighter anticipation/follow-through, idle motion | Pending |
| 6 | Physics: wall splat, sliding, directional knockback | Pending |
| 7 | HUD redesign, combo display, match-over redesign | Pending |
| 8 | Audio system skeleton | Pending |
