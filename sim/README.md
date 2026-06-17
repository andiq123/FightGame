# Fight Simulation Harness

A headless, fast AI test harness. It runs the **real** game systems (AI, combat,
physics) with no rendering, at max speed, and reports stats — so the AI can be
tuned with data instead of guesswork.

## Usage

```bash
node sim/simulate.mjs                          # default matchup matrix
node sim/simulate.mjs 20v10                     # one matchup
node sim/simulate.mjs 20v1 15v10 10v5           # several matchups
node sim/simulate.mjs 15v10 --matches 60        # more matches = less noise
node sim/simulate.mjs 10v5 --powers none        # pure melee (no jutsu)
node sim/simulate.mjs 12v8 --power 4            # set both fighters' power level
```

Flags: `--matches N` (per matchup), `--power N` (both fighters, so intelligence is
isolated), `--seconds N` (timeout), `--powers all|none`, `--concurrency N`.

## What it reports (per matchup)

`higher win%` — win rate of the **higher-intelligence** fighter. KO wins, or the
higher-HP fighter on timeout (like a round timer). | `KO%` | `avgSec` |
`strong/weak dmgTaken` | `casts` + `distinct` skills used by the strong fighter.

## Why it's accurate

- Each match runs in a **fresh child process** — the game clock is
  `performance.now()` and module state must start clean, exactly like a page-load.
  (Running many matches in one process skews skill/cooldown stats.)
- Each matchup is run on **both sides** (strong fighter spawned left AND right) to
  cancel the small positional bias the AI update-order produces, so the win% is
  pure intelligence signal.

## Tuning the AI

Intelligence behaviour lives in `config/stats.js` (`INT_CURVE`, `MASTERY` floors,
`accuracyGate`, `agilityProfile`, reaction curve) and `config/constants.js`
(`SKILL_AI`). Change a value, re-run the harness, read the table. Target shape:
higher intelligence should win more as the gap widens, equal fights ~50/50.
