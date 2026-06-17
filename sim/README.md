# Fight Simulation Harness

A headless, fast AI test harness. It runs the **real** game systems (AI, combat,
physics) with no rendering and reports stats — so the AI/balance can be tuned with
data instead of guesswork. ~150 matches run in a couple of seconds.

## Quick start

```bash
node sim/simulate.mjs            # default spread of intelligence matchups
node sim/simulate.mjs --help     # full usage + examples
```

## Common scenarios (copy-paste)

```bash
# Intelligence matchups (left vs right), any number of them:
node sim/simulate.mjs 20v1 15v10 10v5

# More samples / a fixed power level / a time limit:
node sim/simulate.mjs 20v1 --matches 50 --power 8 --seconds 60

# Per-side power (left=10, right=18):
node sim/simulate.mjs 12v18 --powerA 10 --powerB 18

# Pure melee (no jutsu) or everyone with all jutsu:
node sim/simulate.mjs 10v5 --powers none
node sim/simulate.mjs 10v5 --powers all

# Roster character vs character (loads their power/int/jutsu/traits):
node sim/simulate.mjs --charA oneStrike --charB assassin

# Attach traits to either side (left = A, right = B):
node sim/simulate.mjs 1v18 --traitsA untouchable,perfectStrike,unbreakable,seriousPunch
node sim/simulate.mjs 18v1 --traitsB untouchable,unbreakable
```

**Trait ids:** `untouchable, unbreakable, perfectStrike, seriousPunch, tireless,
athletic, blink, chill, caped` (see `config/traits.js`).
**Character ids:** `assassin, oneStrike` (see `ai/monsters.js`).

## What it reports (per matchup)

`A win%` — win rate of the LEFT fighter ("A"). KO wins, or the higher-HP fighter
on timeout (like a round timer). Plus `KO%`, `avgSec`, `A/B dmgTaken`, and `A casts`
(jutsu the left fighter used). A `⚠ N NaN` flag appears if any match went unstable.

## Why the numbers are trustworthy

- Each match runs in a **fresh child process** — the game clock is
  `performance.now()` and module state must start clean, like a page-load.
  (Many matches in one process leaks state and skews skill/cooldown stats.)
- Each matchup is run on **both sides** (A spawned left AND right) to cancel the
  small positional bias the AI update order produces — so `A win%` is pure signal.

## Tuning loop

Intelligence behaviour lives in `config/stats.js` (`INT_CURVE`, `MASTERY` floors,
`accuracyGate`, `agilityProfile`, reaction curve), skill cadence in
`config/constants.js` (`SKILL_AI`), and trait magnitudes in `config/constants.js`
(`SERIOUS_PUNCH_MULT`, `UNTOUCHABLE_EVADE`). Change a value, re-run the harness,
read the table. Target shape: higher intelligence wins more as the gap widens,
equal fights ~50/50.
