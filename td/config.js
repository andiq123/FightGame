// Two-base creep battler — all tunable values live here.
// Two AI bases earn gold (passive trickle + miner hauls + kill bounties) and spawn
// creeps. First base destroyed loses. Battles escalate in phases as time passes.

export const TD = {
  GROUND_Y: 810,            // logical floor line (shared with renderer primitives)
  STAGE_HALF: 2200,         // arena spans [-STAGE_HALF, +STAGE_HALF]
  GRAVITY: 1500,

  // sim-only cap (--seconds); live play ends when a base hits 0 HP
  MATCH_MAX_SEC: 300,

  // Escalation — level = floor(time / 30); spawner + stats use this.
  PHASES: ['Skirmish', 'Clash', 'War'],

  BASE_X: 1950,
  BASE_HP: 2200,
  BASE_W: 150,
  BASE_H: 360,
  BASE_RANGE: 150,          // how close a creep must be to start hitting a base

  // Bases auto-fire arrows at the nearest enemy creep in range (the only static
  // defence — there is no hero).
  BASE_FIRE: { range: 980, cooldownMs: 900, damage: 28, speed: 1180, arc: 1500 },

  // Base active skills — separate cooldown from normal arrow fire.
  BASE_SKILLS: {
    cooldownMs: 6800,
    skills: ['volley', 'bombard', 'frostBurst', 'shock', 'mend', 'laser'],
  },

  // ── Economy ────────────────────────────────────────────────────────────────
  ECONOMY: {
    startGold: 140,
    passivePerSec: 3,
    minerCarryMax: 28,
    killBountyMul: 1.15,
    minerCollectRate: 24,
    maxAlive: 16,
    decideEveryMs: 650,
    targetMiners: 4,
    bankChance: 0.22,
    defendDist: 900,
    scareDist: 500,
  },

  GOLD: { regenPerSec: 7, nodeMax: 90 },

  // Random world events — gold swings, bosses, comebacks. Keeps battles unpredictable.
  EVENTS: {
    minIntervalSec: 16,
    maxIntervalSec: 38,
    types: [
      { id: 'goldRush', weight: 4 },
      { id: 'meteor', weight: 2.5 },
      { id: 'berserk', weight: 3 },
      { id: 'fog', weight: 2 },
      { id: 'lightning', weight: 3 },
      { id: 'duel', weight: 2.5 },
      { id: 'boss', weight: 3.2 },
      { id: 'underdog', weight: 3.5 },
    ],
  },

  SKILLS: { cooldownMs: 4200 },

  // Which creep types can roll which skills (subset per spawn).
  SKILL_BY_TYPE: {
    warlord: ['slam', 'healPulse'],
    brute: ['dashStrike', 'slam'],
    giant: ['dashStrike', 'slam'],
    archer: ['fireBurst', 'iceLance'],
    bowman: ['iceLance'],
    ninja: ['dashStrike', 'fireBurst'],
    skyrider: ['iceLance', 'fireBurst'],
    pyro: ['fireBurst'],
    sprinter: ['dashStrike'],
    titan: ['slam', 'fireBurst'],
    shade: ['dashStrike', 'healPulse', 'iceLance'],
  },

  // ── Creep roster ─────────────────────────────────────────────────────────
  // power drives the STR plate + trait scaling; intelligence drives attack speed
  // and the AI feel. hp/dmg are explicit pools. `ranged` makes a caster. `role`
  // 'miner' = economy unit. `jitter` randomises power/int per spawn for variety.
  CREEPS: {
    runner:  { name: 'Runner',  role: 'fighter', scale: 0.78, power: 5,  int: 11, speed: 230, hp: 120, dmg: 10, range: 84,  atkCdMs: 700,  reward: 10, cost: 45,  weight: 2.5 },
    sprinter:{ name: 'Sprinter',role: 'fighter', scale: 0.68, power: 4,  int: 13, speed: 310, hp: 85,  dmg: 9,  range: 78,  atkCdMs: 620,  reward: 12, cost: 55,  weight: 2.8 },
    grunt:   { name: 'Grunt',   role: 'fighter', scale: 0.95, power: 9,  int: 8,  speed: 135, hp: 240, dmg: 16, range: 92,  atkCdMs: 860,  reward: 16, cost: 70,  weight: 4 },
    ninja:   { name: 'Ninja',   role: 'fighter', scale: 0.88, power: 7,  int: 16, speed: 210, hp: 130, dmg: 15, range: 96,  atkCdMs: 720,  reward: 28, cost: 95,  weight: 1.8, fixedTraits: ['blink', 'athletic'],
               ranged: { type: 'kunai', damage: 22, speed: 920, radius: 30, range: 500 } },
    brute:   { name: 'Brute',   role: 'fighter', scale: 1.55, power: 14, int: 6,  speed: 82,  hp: 820,  dmg: 36, range: 132, atkCdMs: 1320, reward: 48, cost: 155, weight: 2.2 },
    giant:   { name: 'Giant',   role: 'fighter', scale: 1.92, power: 17, int: 4,  speed: 58,  hp: 1350, dmg: 46, range: 148, atkCdMs: 1480, reward: 62, cost: 185, weight: 2.8, cape: true },
    archer:  { name: 'Archer',  role: 'fighter', scale: 1.0,  power: 8,  int: 14, speed: 110, hp: 260, dmg: 12, range: 120, atkCdMs: 1500, reward: 34, cost: 130, weight: 2, cape: true,
               ranged: { type: 'shuriken', damage: 30, speed: 620, radius: 46, range: 600 } },
    bowman:  { name: 'Bowman',  role: 'fighter', scale: 1.02, power: 9,  int: 12, speed: 98,  hp: 230, dmg: 11, range: 110, atkCdMs: 1350, reward: 32, cost: 115, weight: 2.2,
               ranged: { type: 'arrow', damage: 36, speed: 980, radius: 36, range: 720 } },
    skyrider:{ name: 'Skyrider',role: 'fighter', scale: 0.92, power: 8,  int: 15, speed: 145, hp: 175, dmg: 10, range: 100, atkCdMs: 1200, reward: 40, cost: 120, weight: 4.5, flying: true, hoverY: -240,
               ranged: { type: 'bolt', damage: 24, speed: 800, radius: 38, range: 640, stunMs: 160 } },
    hawk:    { name: 'Hawk',    role: 'fighter', scale: 0.74, power: 5,  int: 10, speed: 190, hp: 90,  dmg: 8,  range: 86,  atkCdMs: 1050, reward: 14, cost: 72,  weight: 3.6, flying: true, hoverY: -215,
               ranged: { type: 'bolt', damage: 14, speed: 760, radius: 26, range: 460 } },
    pyro:    { name: 'Pyro',    role: 'fighter', scale: 1.05, power: 10, int: 13, speed: 88,  hp: 210, dmg: 10, range: 105, atkCdMs: 1400, reward: 36, cost: 145, weight: 1.6,
               ranged: { type: 'fireball', damage: 40, speed: 460, radius: 52, range: 540 } },
    warlord: { name: 'Warlord', role: 'fighter', scale: 1.3,  power: 18, int: 17, speed: 155, hp: 760, dmg: 36, range: 124, atkCdMs: 760,  reward: 90, cost: 320, weight: 1, cape: true },
    bowler:  { name: 'Bowler',  role: 'bowler',  scale: 1.12, power: 12, int: 9,  speed: 118, hp: 340, dmg: 22, range: 86,  atkCdMs: 2200, reward: 40, cost: 118, weight: 1.5 },
    miner:   { name: 'Miner',   role: 'miner',   scale: 0.82, power: 4,  int: 9,  speed: 200, hp: 150, dmg: 6,  range: 80,  atkCdMs: 900,  reward: 25, cost: 110, weight: 0 },
  },

  // Boss roster — spawned by random events, not economy. High threat, unique skills.
  BOSSES: {
    titan: {
      name: 'Titan', role: 'boss', scale: 2.1, power: 20, int: 12, speed: 62, hp: 2800, dmg: 58,
      range: 160, atkCdMs: 1300, reward: 180, cost: 0, weight: 0, cape: true,
      ranged: { type: 'shuriken', damage: 42, speed: 540, radius: 52, range: 520 },
    },
    shade: {
      name: 'Shade', role: 'boss', scale: 1.55, power: 17, int: 18, speed: 175, hp: 1400, dmg: 44,
      range: 130, atkCdMs: 680, reward: 150, cost: 0, weight: 0, cape: true,
      ranged: { type: 'ice', damage: 38, speed: 680, radius: 44, range: 640, slowMs: 800 },
    },
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
    antiAirVyBase: 720, antiAirVyScale: 1.35, antiAirMs: 920,
    airWobbleY: -95, airWobbleChance: 0.042,
  },

  GRAB: { range: 94, cdMs: 1200, base: 0.032, smart: 0.05, antiAir: 0.32, big: 0.14, maxScaleRatio: 1.55 },

  RAGDOLL: {
    graceMs: 480, launchMs: 160, blendMs: 280, pushMul: 1.22,
    scaleMin: 1.1, dmgMin: 34, heavyChance: 0.78, lightChance: 0.2,
    projChance: 0.55, throwAlways: true,
  },

  FLY: {
    staminaMax: 100, hideDrain: 34, cruiseRegen: 12, hideMul: 1.52, hideMinMs: 1400,
    groundMs: 3200, knockVy: 130, landRagdollVy: 90, landRagdollChance: 0.62, reclimbHideMs: 900,
  },

  // Cannonball leap — long arc, landing slam, ragdoll bowling.
  BOWLER: {
    jumpVy: -400, jumpVxMax: 960, jumpFlight: 0.78, jumpCdMs: 2100,
    slamRadius: 80, slamDmgMul: 2.2, minSlamVy: 150, selfTumble: 0.52,
    wobbleMul: 3.4, minHitSpeed: 125, hitDmg: 26, hitSpdScale: 0.075,
  },

  CAMERA_SMOOTH: 9,
  CAMERA_ZOOM_MIN: 0.78,
  CAMERA_ZOOM_MAX: 1.26,
  CAMERA_FRAME_PAD: 380,
};

export const TEAM_COLOR = { L: '#4f9be8', R: '#e0664a' };
export const TEAM_CAPE  = { L: '#2f6fb0', R: '#9b2c2c' };
export const opp = (team) => (team === 'L' ? 'R' : 'L');

export function battlePhase(level = 0) {
  return TD.PHASES[Math.min(TD.PHASES.length - 1, Math.floor(level / 2))] || TD.PHASES[0];
}
