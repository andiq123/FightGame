export const HP = { MIN: 100, MAX: 5000, DEFAULT: 400 };
export const ARENA = { BOUNDS: 1200, START_OFFSET: 450, FIGHTER_MARGIN: 24 };
export const PHYSICS = {
  GRAVITY: 1500,
  GRAVITY_ASCENT: 0.9,
  GRAVITY_APEX: 0.82,
  GRAVITY_FALL_MULT: 1.08,
  TERMINAL_VY: 820,
  AIR_RESISTANCE: 0.992,
  HIT_FRICTION: 0.84,
  IMPACT_FRICTION_MS: 360,
  HIT_STOP_MS: 32,
  HIT_STOP_HEAVY_MS: 75,
  HIT_STOP_COUNTER_MS: 95,
  DODGE_PEAK_SPEED: 560,
  DODGE_INVULN_MS: 150,   // covers an incoming attack's active frames
  DODGE_DURATION_MS: 190,
  JUMP_VY: -620,         // normal jump apex ~125px — clears a standard wall
  WALL_VAULT_VY: -820,   // dedicated wall-vault leap, apex ~217px — clears any wall
  JUMP_FORWARD_VX: 340,  // horizontal drive for a directional (forward/back) hop
  JUMP_SHORT_VY: -380,
  DOUBLE_JUMP_VY: -430,
  WALL_JUMP_VY: -420,
  WALL_JUMP_VX: 360,
  KNOCKBACK_HEAVY_MULT: 2.35,
  KNOCKBACK_LIGHT_MULT: 1.85,
  KNOCKBACK_KICK_LAUNCH_MULT: 2.85,
  KNOCKBACK_UPWARD: 0.36,
  UPPERCUT_UPWARD: 0.76,
  ATTACKER_RECOIL: 0.28,
  WALK_SPEED: 280,
  RUN_SPEED: 540,
  WALK_FAST_THRESH: 220,
  RUN_SPEED_THRESH: 410,
  MOVE_BRAKE_PER_SEC: 2300,
  AIR_DRAG: 0.00055,
  WALK_STAMINA_PER_SEC: 6,
  RUN_STAMINA_PER_SEC: 16,
  MOVE_SPEED_MIN_RATIO: 0.18,
  MOVE_SPEED_MAX_RATIO: 1.08,
  RUN_STAMINA_MIN_RATIO: 0.28,
  SLIDE_SPEED: 380,
  COYOTE_TIME_MS: 80,
  JUMP_BUFFER_MS: 120,
  VELOCITY_DEADZONE: 10,
  WALK_RUN_IDLE_THRESHOLD: 18,
  WALL_BOUNCE: 0.25,
  FRICTION_AIR: 0.994,
  FRICTION_GROUND: 0.9,
  FRICTION_MIN: 0.5,
  APEX_VY_LOW: -90,
  APEX_VY_HIGH: 90,
};
export const FIGHTER = {
  STAMINA_REGEN_PER_SEC: 44,
  RECOVERY_STAMINA_REGEN_MULT: 1.65,
  POWER_BASE_COST: 20,
  POWER_STAMINA_RESERVE: 20,
  POWER_FINISHER_RESERVE: 12,
  ATTACK_STAMINA_MULT: 1.0,
  ATTACK_DAMAGE_STAMINA_MULT: 0.45,
  HEAVY_ATTACK_STAMINA_BONUS: 4,
  MOMENTUM_ATTACK_STAMINA_BONUS: 3,
  HIT_STAMINA_DAMAGE_MULT: 0.55,
  HEAVY_HIT_STAMINA_BONUS: 6,
  MAX_HIT_STAMINA_DAMAGE: 28,
  HITS_DECAY_MS: 5000,
  LANDING_SQUASH_MS: 150,
  WALL_JUMP_COOLDOWN_MS: 400,
  SLIDE_DURATION_MS: 280,
  SLIDE_INVULN_MS: 150,
  DEFAULT_MAX_STAMINA: 150,
  WHIFF_HIT_WINDOW: 100,
  JUMP_STAMINA: 14,
  DOUBLE_JUMP_STAMINA: 10,
  WALL_JUMP_STAMINA: 12,
  SLIDE_STAMINA: 18,
  DASH_STAMINA: 14, // cheap enough to dodge often in a close-combat exchange
};
export const COMBAT = {
  COMBO_DECAY_MS: 1200,
  STAGGER_DAMAGE: 13,
  STAGGER_COUNTER: 9,
  STAGGER_DURATION_MS: 2000,
  STAGGER_MIN_KNOCK_MS: 820,
  RAGDOLL_SETTLE_MS: 200,
  GET_UP_DURATION_MS: 640,
  COUNTER_BONUS: 1.35,
  COMBO_SCALE: [1, 0.97, 0.94, 0.91, 0.88, 0.85],
  HITBOX_EXTRA: 28,
  VERTICAL_REACH: 95,        // grounded pokes only reach ~body height
  VERTICAL_REACH_HIGH: 180,  // launchers (uppercut/high kick) reach into the air
  CRIT_CHANCE: 0.15,
  CRIT_MULT: 1.6,
  CANCEL_AFTER: 0.55,         // recovery cancels allowed after 55% of an attack
  CANCEL_HIT_WINDOW_MS: 280,  // hit-confirm combo-cancel window after a landed hit
  COMBO_KNOCKDOWN: 6,         // a light-hit combo this long also knocks down
  KNOCKDOWN_PUSH: 420,        // horizontal throw force on a knockdown finisher
  KNOCKDOWN_LIFT: 200,        // upward pop on a knockdown
  SERIOUS_PUNCH_MULT: 6,      // 'seriousPunch' character heavy-hit damage multiple
  UNTOUCHABLE_EVADE: 1.0,     // 'untouchable' character auto-slips EVERY hit (melee + projectile)
  HIT_FLASH_MS: 200,
  HIT_FLASH_COUNTER_MS: 250,
  RECOVERY_MS: 120,
  RUN_MOMENTUM_MULT: 1.28,
  FAST_MOVE_MOMENTUM_MULT: 1.12,
  AIR_ATTACK_MULT: 1.14,
  STAGGER_ACTIVE_MS: 850,
  STAGGER_TENSION_STRENGTH: 0.12,
};
export const SKILL_DAMAGE = {
  MIN_SKILL_DAMAGE: 28,
  FIREBALL: 58,
  SHINRA: 42,
  LIGHTNING_CUTTER: 48,
  SHURIKEN: 22,
  DRAGON_ROAR: 75,
  ICE_SPIKES: 32,
  VACUUM_PULL: 15,
};
export const AI = {
  REACT_BASE_MS: 12,
  REACT_SCALE: 2.1,
  ATTACK_RANGE: 122,
  GRAB_RANGE: 52,
  PREFERRED_DIST: 72,
  PREFERRED_DIST_MIN: 42,
  PREFERRED_DIST_MAX: 115,
  APPROACH_THRESHOLD: 160,
  COMBAT_ENTER: 185,
  COMBAT_EXIT: 260,
  STATE_MIN_MS: 180,
  STATE_COMBAT_MS: 300,
  STATE_APPROACH_MS: 460,
  STATE_PUNISH_MS: 280,
  STATE_DEFEND_MS: 240,
  DASH_FROM_DIST: 360,
  RANGED_POWER_MIN: 70,
  RANGED_POWER_MAX: 450,
  FIREBALL_MIN: 100,
  FIREBALL_MAX: 450,
  SHURIKEN_MIN: 55,
  SHURIKEN_MAX: 350,
  RETREAT_HP_RATIO: 0.06,
  RETREAT_STAMINA: 12,
  RETREAT_STOP_DIST: 300,
  STAMINA_CRITICAL_RATIO: 0.12,
  STAMINA_LOW_RATIO: 0.2,
  STAMINA_RECOVER_RATIO: 0.72,
  STAMINA_SAFE_REST_DIST: 330,
  STAMINA_RETREAT_DIST: 360,
  EVADE_MAX_MS: 3200,
  EVADE_PROJECTILE_REACTION_MIN: 0.68,
  DASH_THRESHOLD: 340,
  DASH_STAMINA_MIN: 48,
  SLIDE_STAMINA_MIN: 42,
  PROJECTILE_EVADE_TIME_MAX_MS: 820,
  PROJECTILE_EVADE_TIME_MAX_MS_FAR: 1600,
  PROJECTILE_EVADE_TIME_MIN_MS: 45,
  PROJECTILE_JUMP_WHEN_FAR_MS: 320,
  WHIFF_PUNISH_WINDOW_MS: 440,
  REGROUP_AFTER_STAGGER_MS: 3800,
  REGROUP_STAMINA_MIN: 75,
  REGROUP_HP_RATIO: 0.35,
  TIRED_STAMINA: 35,
  ENERGIZED_STAMINA: 95,
  PREPARE_DURATION_MS: 900,
  STAMINA_RESERVE_DEFENSE: 38,
  DECISION_INTERVAL_MS: 185,
  DASH_ONLY_WHEN_DIST: 420,
  SLIDE_MIN_DIST: 95,
  RECOVERY_DEFEND_MS: 900,
  TRANSITION: {
    RETREAT_BASE: 0.068,
    RETREAT_SPACING_MUL: 0.035,
    PREPARE_BASE: 0.12,
    PREPARE_REACTION_MUL: 0.08,
    REGROUP_CHANCE: 0.52,
    DEFEND_WINDUP: 0.78,
    DEFEND_ATTACK_BASE: 0.32,
    DEFEND_ATTACK_STAT_MUL: 0.48,
    EVADE_PROJECTILE_BASE: 0.35,
    EVADE_PROJECTILE_STAT_MUL: 0.45,
    PREPARE_CONDITION: 0.22,
    PUNISH_REACTION_MIN: 0.08,
  },
};

// ── Skill / jutsu usage — intelligence-scaled, all knobs in one place ─────────
// A smart fighter weaves jutsu into the fight constantly; a novice hardly knows
// how. Every value here interpolates novice → master by the caster's 0…1 skill
// (see config/stats.js gate()), so level 20 is a relentless skill user and the
// gap to lower levels is large. Tune skill behaviour HERE, not inline in the AI.
export const SKILL_AI = {
  GCD_NOVICE_MS: 1400,     // min gap between any two casts at intelligence 1
  GCD_MASTER_MS: 260,      // ...at intelligence 20 (casts ~5× more often)
  THRESHOLD_NOVICE: 80,    // a novice only casts on a golden opportunity
  THRESHOLD_MASTER: 24,    // a master casts readily / proactively
  PUNISH_THRESHOLD: 26,    // score needed to punish an opening with a skill
  EMERGENCY_THRESHOLD: 34, // score needed for a defensive/escape skill
  RANGE_FAR: 180,          // beyond → zone (projectile / control)
  RANGE_CLOSE: 120,        // within → burst / movement / control / buff
  FAR_SKIP_NOVICE: 0.85,   // chance a novice wastes a far-range skill window
  FAR_SKIP_MASTER: 0.0,    // a master never skips a free zoning window
  COOLDOWN_MULT_NOVICE: 1.25, // a novice's jutsu recharge slowly (clumsy chakra control)
  COOLDOWN_MULT_MASTER: 0.5,  // a master cycles jutsu ~2.5× faster — skills define their game
};
export const SHARINGAN = {
  DURATION_MS: 7000,      // buff lasts 7s
  COUNTER_CD_MS: 600,     // min gap between counter-warps (no infinite spam)
  TELEPORT_OFFSET: 78,    // warp this far behind the attacker
  TELEPORT_VX: 70,        // little drift toward the attacker's back
  STAMINA_GAIN: 35,       // bonus stamina to fuel the counter
  INVULN_MS: 240,         // brief safety during the warp
  BLIND_MS: 1000,         // attacker loses track of you for 1s
  REACQUIRE_CHANCE: 0.12, // per-decision chance the attacker "randomly looks" and finds you
  // Offensive pursuit: while active, blink onto a distant/fleeing opponent to pressure.
  PURSUE_CD_MS: 520,      // gap between offensive blinks (so it hits between warps)
  PURSUE_RANGE: 130,      // warp in when the opponent is farther than this
  PURSUE_OFFSET: 56,      // land this close to the opponent (inside attack range)
  PURSUE_FLEE_VX: 180,    // opponent counts as "fleeing" above this run speed
};

export const PROJECTILE = { HIT_RADIUS: 38, FIREBALL_HIT_RADIUS: 55 };
export const CLONE = {
  DURATION_MS: 5000,
  HP: 100,
  DAMAGE: 22,
  HIT_COOLDOWN_MS: 300,
  COMBO_COOLDOWN_MS: 200,
  HIT_RADIUS: 65, // Reduced from 110 for tighter combat
  WINDUP_MS: 120,
  CHASE_SPEED: 450,
  CHASE_SPEED_FAST: 520,
  TELEPORT_DIST: 380,
  TELEPORT_COOLDOWN_MS: 2500,
  TELEPORT_OFFSET: 70,
  SHARINGAN_SEE_DIST: 160 // a sharingan-holder destroys an enemy clone within this range
};
export const EFFECT_DURATION = { HIT: 0.8, HEAL: 1.1, SKILL: 1, CLASH: 0.6 };
export const RENDER = {
  HIT_EFFECT_OFFSET: 55,
  CLONE_DISSOLVE_OFFSET: 75,
  STAGGER_ORIGIN_OFFSET: 83,
  SHAKE_LIGHT: 7,
  SHAKE_HEAVY: 18,
  SHAKE_SKILL: 22,
  SHAKE_COUNTER: 16,
  ZOOM_HEAVY: 0.82,
  ZOOM_SKILL: 0.86,
  ZOOM_DECAY: 0.92,
  VIGNETTE_INTENSITY: 0.75,
  HIT_STOP_MS: 95,
  HIT_STOP_HEAVY_MS: 240,
  HIT_STOP_COUNTER_MS: 300,
  // Cinematic slow-motion
  SLOWMO_FACTOR: 0.3,        // sim runs at 30% speed during a beat
  CINEMATIC_ZOOM_SPEED: 10,  // how fast the zoom eases in/out
  SLOWMO_WARP_MS: 780,       // sharingan counter-warp — the headline beat
  SLOWMO_WARP_ZOOM: 1.36,
  SLOWMO_CRIT_MS: 300,
  SLOWMO_CRIT_ZOOM: 1.2,
  SLOWMO_COUNTER_MS: 260,
  SLOWMO_COUNTER_ZOOM: 1.16,
  SLOWMO_KO_ZOOM: 1.3,
};
export const COMBAT_EXTRA = {
  FIGHTER_OVERLAP_DIST: 45,
  FIGHTER_OVERLAP_PUSH: 25,
};

export const AI_STATE = {
  EVADING_PROJECTILE: 'evadingProjectile',
  SHINRA_DEFENSE: 'shinraDefense',
  REGROUPING: 'regrouping',
  PREPARING: 'preparing',
  RETREATING: 'retreating',
  DEFENDING: 'defending',
  PUNISHING: 'punishing',
  COMBAT: 'combat',
  APPROACHING: 'approaching',
  BAITING: 'baiting',
  PRESSURING: 'pressuring',
  RECHARGING: 'recharging'
};

export const PHYSICS_EXTRA = {
  IMPACT_DMG_THRESHOLD_WALL: 480,
  IMPACT_DMG_THRESHOLD_GROUND: 520,
  IMPACT_DMG_MULT: 0.035,
};
