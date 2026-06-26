// Two-base creep battler — all tunable values live here.
// Two AI bases (L and R) earn gold and spend it spawning creeps that march out
// and fight. Kills pay gold; miners generate it passively. First base destroyed
// loses. Every creep gets randomised stats + traits, so no two battles are alike.

export const TD = {
  GROUND_Y: 810,            // logical floor line (shared with renderer primitives)
  STAGE_HALF: 2200,         // arena spans [-STAGE_HALF, +STAGE_HALF]
  GRAVITY: 1500,

  BASE_X: 1950,             // bases sit at ±BASE_X; L marches right, R marches left
  BASE_HP: 2200,
  BASE_W: 150,
  BASE_H: 360,
  BASE_RANGE: 150,          // how close a creep must be to start hitting a base

  // Bases auto-fire arrows at the nearest enemy creep in range (the only static
  // defence — there is no hero).
  BASE_FIRE: { range: 720, cooldownMs: 1000, damage: 26, speed: 1150, arc: 1500 },

  // ── Economy ────────────────────────────────────────────────────────────────
  ECONOMY: {
    startGold: 140,
    passivePerSec: 5,        // each base's baseline trickle
    minerPerSec: 10,         // extra gold/sec each living miner adds to its team
    killBountyMul: 1,        // killer team earns this × the victim's reward
    maxAlive: 16,            // hard concurrent creep cap per team
    decideEveryMs: 700,      // how often a base re-evaluates what to spawn
    targetMiners: 3,         // an unpressured base invests up to this many miners
    bankChance: 0.35,        // chance to save gold for a pricier unit this tick
    defendDist: 900,         // an enemy creep closer than this = base under threat
  },

  // ── Creep roster ─────────────────────────────────────────────────────────
  // power drives the STR plate + trait scaling; intelligence drives attack speed
  // and the AI feel. hp/dmg are explicit pools. `ranged` makes a caster. `role`
  // 'miner' = economy unit. `jitter` randomises power/int per spawn for variety.
  CREEPS: {
    runner:  { name: 'Runner',  role: 'fighter', scale: 0.78, power: 5,  int: 11, speed: 230, hp: 120, dmg: 10, range: 84,  atkCdMs: 700,  reward: 10, cost: 45,  weight: 3 },
    grunt:   { name: 'Grunt',   role: 'fighter', scale: 0.95, power: 9,  int: 8,  speed: 135, hp: 240, dmg: 16, range: 92,  atkCdMs: 860,  reward: 16, cost: 70,  weight: 4 },
    brute:   { name: 'Brute',   role: 'fighter', scale: 1.6,  power: 16, int: 5,  speed: 70,  hp: 1100, dmg: 42, range: 140, atkCdMs: 1450, reward: 55, cost: 200, weight: 1.4 },
    archer:  { name: 'Archer',  role: 'fighter', scale: 1.0,  power: 8,  int: 14, speed: 110, hp: 260, dmg: 12, range: 120, atkCdMs: 1500, reward: 34, cost: 130, weight: 2, cape: true,
               ranged: { type: 'shuriken', damage: 30, speed: 620, radius: 46, range: 600 } },
    warlord: { name: 'Warlord', role: 'fighter', scale: 1.3,  power: 18, int: 17, speed: 155, hp: 760, dmg: 36, range: 124, atkCdMs: 760,  reward: 90, cost: 320, weight: 1, cape: true },
    miner:   { name: 'Miner',   role: 'miner',   scale: 0.82, power: 4,  int: 9,  speed: 200, hp: 150, dmg: 6,  range: 80,  atkCdMs: 900,  reward: 25, cost: 110, weight: 0 },
  },

  // Random trait pool. Each creep rolls a few; weights make strong traits rare.
  // 'caped' is cosmetic; the rest are wired in td/combat.js + td/ai.js.
  TRAIT_POOL: [
    { id: 'athletic',      weight: 5 },
    { id: 'chill',         weight: 3 },
    { id: 'blink',         weight: 2.5 },
    { id: 'unbreakable',   weight: 2.5 },
    { id: 'tireless',      weight: 2.5 },
    { id: 'untouchable',   weight: 1.2 },
    { id: 'perfectStrike', weight: 1.5 },
    { id: 'seriousPunch',  weight: 1 },
  ],
  TRAIT_COUNT_WEIGHTS: [3, 4, 2, 1], // P(0 traits), P(1), P(2), P(3)

  // Athleticism — leaps/lunges/jukes make the advance dynamic and hard to read.
  MOVE: {
    separation: 36,
    jumpGapMin: 110, jumpGapMax: 380, jumpVy: -560, jumpVx: 470, jumpCdMs: 1300,
    lungeGap: 165, lungeVx: 600, lungeCdMs: 1700,
    jukeGap: 135, jukeVx: 420, jukeVy: -360, jukeCdMs: 1300,
    bruteLeapGapMin: 180, bruteLeapGapMax: 560, bruteLeapVy: -480, bruteLeapVx: 400, bruteLeapCdMs: 2400,
  },

  CAMERA_SMOOTH: 6.5,
};

export const TEAM_COLOR = { L: '#4f9be8', R: '#e0664a' };
export const TEAM_CAPE  = { L: '#2f6fb0', R: '#9b2c2c' };
export const opp = (team) => (team === 'L' ? 'R' : 'L');
