import { SKILL_DAMAGE } from '../config/constants.js';

// Hero skills the player can equip. Ids/names come from the shared POWERS
// registry (entities/powers.js) so the chips reuse real data — these entries
// only add the tower-defense behaviour for each. Ranged skills fire a projectile
// at the nearest cluster; `heal` restores the hero.
export const SKILLS = {
  fireball:  { id: 'fireball',  kind: 'projectile', type: 'fireball', damage: SKILL_DAMAGE.FIREBALL, speed: 980, radius: 95, aoe: true,  cooldownMs: 4200, range: 1500 },
  shuriken:  { id: 'shuriken',  kind: 'projectile', type: 'shuriken', damage: SKILL_DAMAGE.SHURIKEN, speed: 1400, radius: 42, pierce: true, cooldownMs: 1500, range: 1800 },
  iceSpikes: { id: 'iceSpikes', kind: 'projectile', type: 'ice', damage: SKILL_DAMAGE.ICE_SPIKES, speed: 900, radius: 78, aoe: true, slowMs: 1600, cooldownMs: 5200, range: 1300 },
  heal:      { id: 'heal',      kind: 'heal', amount: 0.35, cooldownMs: 12000 },
  // Sharingan: a 7s buff — a clean incoming hit is negated and answered with a
  // counter-warp (brought back from the master fighting AI).
  sharingan: { id: 'sharingan', kind: 'buff', durationMs: 7000, counterCdMs: 650, cooldownMs: 15000, range: 0 },
};
export const SUPPORTED_SKILL_IDS = Object.keys(SKILLS);

// Tower-defense tuning. All gameplay magic numbers live here.
export const TD = {
  GROUND_Y: 810,            // logical floor line (shared with renderer primitives)
  STAGE_HALF: 2200,         // arena spans [-STAGE_HALF, +STAGE_HALF]
  PLAYER_TOWER_X: -1950,    // your base — defend this
  ENEMY_TOWER_X: 1950,      // enemy spawner — destroy this to win
  TOWER_HP: 1000,
  ENEMY_TOWER_HP: 16000,    // the keep is a fortress — you WIN by surviving, not rushing it
  WIN_WAVE: 20,             // survive (clear) this many waves → victory
  TOWER_W: 150,
  TOWER_H: 360,
  TOWER_RANGE: 150,         // how close a monster must be to start hitting a tower

  // ── Aegis Barrier ─────────────────────────────────────────────────────────
  // A hidden, automatic last-resort the base unleashes when it's about to fall: a
  // rising kinetic barrier that hurls EVERY enemy far down the lane on a ballistic
  // arc (gravity does the rest) and surges the base's structure back to 70%. A
  // scarce lifeline — only a few charges for the whole run — so a near-death base
  // can claw back into the fight, making each collapse a dramatic recovery.
  BASE_AEGIS: {
    hpThreshold: 0.25,       // fires when base HP drops below this fraction…
    healTo: 0.70,            // …and restores the base up to this fraction
    charges: 3,              // total uses for the whole run (~20 waves)
    cooldownMs: 3500,        // brief lockout so one trigger = one pulse
    pushVx: 1250,            // base horizontal launch (down-lane, away from base)
    pushVy: -720,            // upward launch → real ballistic arc under gravity
    proximityBoost: 0.7,     // extra fling for enemies right on top of the base
    damage: 30,              // a jolt of chip damage as they're flung
  },

  // Towers auto-fire arrows at threats in range (classic TD). Your base rains
  // arrows on monsters; the enemy keep snipes the hero (who can dodge them).
  TOWER_FIRE: {
    range: 720,            // how far a tower can shoot (close defence, not a sniper)
    cooldownMs: 1100,       // gap between shots
    damage: 26,            // arrow damage (scales the keep's a touch via mult below)
    enemyDamageMul: 0.7,   // keep's arrows hit the hero a bit softer
    speed: 1150,           // arrow flight speed
    arc: 1500,             // downward gravity on the arrow so it rains in
  },

  GRAVITY: 1500,

  HERO: {
    color: '#28d6c8',
    walk: 340,
    run: 600,
    accel: 4200,
    friction: 2600,
    jumpVy: -640,
    attackRange: 130,
    // Stamina pacing — the hero tires from fighting/running and must recover.
    maxStamina: 240,         // larger pool than the duel default so fights last
    windedRatio: 0.18,       // at/below this → break off and retreat to recover
    recoverRatio: 0.6,       // recover until here, then re-engage (hysteresis)
    windedRegen: 85,         // stamina/sec while catching breath (reliable recovery)
    restSafeDist: 300,       // retreat until this far from the nearest threat, then rest
    finishHp: 45,            // don't bail on recovery if a target is this close to death
    skillStaminaCost: 24,    // each power skill drains this (gated on having it)
    // Wounded → flee home. When hurt the hero gets scared and sprints to the
    // base, where it recovers HP (a safe zone) before charging back out.
    fleeHpRatio: 0.3,        // at/below this HP fraction → run home, scared
    fleeRecoverHp: 0.66,     // heal at base up to here, then re-engage
    baseHealZone: 380,       // within this distance of the base, the hero heals
    baseHealHpPerSec: 0.085, // fraction of max HP healed per second at the base
    baseHealStamPerSec: 70,  // bonus stamina/sec while sheltering at the base
  },

  // ── Allied reinforcements ────────────────────────────────────────────────
  // The base periodically musters friendly fighters who march out, intercept the
  // enemy column, and soak the front line — buying the hero time to farm gold and
  // invest in real upgrades instead of just band-aiding. Their kills credit the
  // hero's purse. Tuned to RELIEVE pressure, not trivialise the run.
  ALLY: {
    color: '#5bd6ff',          // friendly cyan-blue — distinct from hero teal & enemies
    capeColor: '#2f7fd0',
    power: 5, intelligence: 9, // base levels (scale up with the wave)
    powerPerWave: 0.5, intPerWave: 0.6,
    hp: 150, hpPerWave: 22,    // explicit HP pool (they're meant to trade and die)
    dmg: 15, dmgPerWave: 1.5,
    speed: 250,
    attackRange: 96,
    atkCdMs: 680,
    // The base MUSTERS power over time and only deploys a fighter once it's fully
    // charged — a deliberate, resource-paced trickle, not a fast timer. Charging a
    // single ally takes ~15s early on, easing a little as the battle escalates.
    startWave: 3,              // the base can only muster allies from this wave on
    musterCost: 100,           // power needed to deploy one ally
    musterRate: 6.5,           // power/sec the base generates… (~15s per ally)
    musterRatePerWave: 0.7,    // …growing slightly each wave
    musterStart: 30,           // small head start once mustering unlocks
    maxAlive: 3,               // hard concurrent cap — never more than this
    lineAhead: 720,            // hold this far ahead of the base when no enemy is near
  },

  // ── Enemy roster — deliberately diverse in intelligence, role and skills. ──
  // Strength (power) drives HP/damage, intelligence drives how aggressively and
  // smartly they hunt the hero. A `ranged` block makes that archetype a caster.
  MONSTERS: {
    runner: {
      name: 'Runner', color: '#d98a2b', scale: 0.78, power: 5, intelligence: 11,
      speed: 200, hp: 110, dmg: 9, towerDmg: 12, atkRange: 84, atkCdMs: 720, reward: 10, aggro: 360,
    },
    grunt: {
      name: 'Grunt', color: '#c0563a', scale: 0.9, power: 8, intelligence: 7,
      speed: 124, hp: 210, dmg: 14, towerDmg: 20, atkRange: 92, atkCdMs: 880, reward: 15, aggro: 320,
    },
    brute: {
      name: 'Brute', color: '#7d3fb0', scale: 1.7, power: 16, intelligence: 5,
      speed: 64, hp: 1000, dmg: 40, towerDmg: 78, atkRange: 142, atkCdMs: 1500, reward: 55, aggro: 240,
    },
    shaman: {
      name: 'Shaman', color: '#2fa86b', scale: 1.02, power: 10, intelligence: 16,
      speed: 92, hp: 300, dmg: 12, towerDmg: 18, atkRange: 120, atkCdMs: 1700, reward: 38, aggro: 600,
      ranged: { type: 'shuriken', damage: 34, speed: 560, radius: 46, range: 560, slowMs: 0 },
    },
    warlord: {
      name: 'Warlord', color: '#caa23a', cape: '#7a1f1f', scale: 1.28, power: 18, intelligence: 19,
      speed: 150, hp: 720, dmg: 34, towerDmg: 64, atkRange: 124, atkCdMs: 760, reward: 90, aggro: 560,
    },
  },

  // How wave N is composed (chaff early, casters/heavies/elites later).
  WAVE: {
    breatherMs: 4500,
    spawnGapMs: 1050,            // gap between spawns on wave 1…
    spawnGapDecayPerWave: 42,    // …tightening each wave so late waves arrive as a SWARM
    spawnGapMinMs: 300,          // floor on the gap (the densest a wave can pour in)
    // Per-wave level growth — monsters get smarter AND stronger each wave.
    strPerWave: 0.7,
    intPerWave: 0.95,
    hpPerStr: 0.15,
    rewardPerWave: 0.1,
    // SIEGE share: the fraction of each wave that ignores the hero and marches
    // straight for the BASE. Rising each wave, this is what actually threatens the
    // base in the late game — the hero can't be everywhere, so the base bleeds and
    // the Aegis barrier becomes the dramatic difference between holding and falling.
    siegeBase: 0.10,
    siegePerWave: 0.032,
    siegeMax: 0.62,
    siegeSpeedMul: 1.55,        // siege units sprint the lane so they reach the base
    siegeHpMul: 1.35,           // …and are tougher, so interception can't clear them all
  },

  MONSTER: {
    separation: 36,          // half-gap baseline for the marching column
    downSpeedBoost: 1.25,    // with the hero down, monsters press the base harder
    // Athleticism — monsters leap and lunge to close gaps (smarter ones more so).
    jumpGapMin: 120, jumpGapMax: 360, // leap when the target is this far
    jumpVy: -540, jumpVx: 420, jumpCdMs: 1700,
    lungeGap: 150, lungeVx: 560, lungeCdMs: 2200, // sudden dash-in
    runnerFleeHp: 0.22,      // wounded runners briefly recoil (scared)
  },

  // Random per-wave events that change how a wave plays — keeps runs surprising.
  EVENTS: [
    { id: 'frenzy', name: 'FRENZY — enemies enraged!', speed: 1.3, atkCd: 0.7, jumpy: 1.6 },
    { id: 'horde', name: 'HORDE — overwhelming numbers!', countMul: 1.6 },
    { id: 'champion', name: 'CHAMPION approaches!', addWarlord: 1 },
    { id: 'swift', name: 'SWIFT — a sprinting pack!', speed: 1.45, addRunner: 3 },
    { id: 'elite', name: 'ELITE GUARD — armoured vanguard!', addWarlord: 2, atkCd: 0.85 },
    { id: 'berserk', name: 'BERSERK — a relentless tide!', speed: 1.2, atkCd: 0.6, jumpy: 1.3 },
    { id: 'siege', name: 'SIEGE — they rush the base!', countMul: 1.3, speed: 1.15, addWarlord: 1 },
  ],
  EVENT_CHANCE: 0.55,        // chance a wave (from 2 on) rolls an event

  // Between-wave shop — spend gold on upgrades. Costs scale with current level.
  SHOP: {
    powerBase: 55, powerPerLevel: 18,   // power +1 cost = base + level*per
    intBase: 55, intPerLevel: 18,       // intelligence +1
    repairBase: 70, repairAmount: 350,  // restore base HP
    healHero: 45,                       // full-heal the hero
    staminaUp: 50, staminaAmount: 30,   // +max stamina
    learnSkill: 110,                    // unlock an unequipped power skill
  },

  CAMERA_SMOOTH: 6.5,
};
