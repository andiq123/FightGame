import { ARENA } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic environment obstacles. Two behaviours:
//   standable (short)  → solid box you can JUMP ON and stand on top of
//   passOver  (tall)   → solid cover you JUMP OVER (clear it while airborne)
// Both block ground movement and projectiles, so the AI treats them as terrain
// (vault / go around / use as cover) via its existing obstacle awareness.
// To add a new obstacle: add one entry here — the spawner, physics, AI and
// renderer all read these flags, so nothing else needs to change.
// ─────────────────────────────────────────────────────────────────────────────

export const OBSTACLE_TYPES = {
  rock:   { width: [86, 132], height: [52, 78],  standable: true,  blocksProjectiles: true },
  crate:  { width: [64, 84],  height: [62, 82],  standable: true,  blocksProjectiles: true },
  log:    { width: [120, 168], height: [42, 56], standable: true,  blocksProjectiles: true },
  pillar: { width: [52, 74],  height: [128, 176], passOver: true,  blocksProjectiles: true },
};

const TYPE_KEYS = Object.keys(OBSTACLE_TYPES);

const ENV = {
  MAX_OBSTACLES: 4,        // cap on concurrent dynamic obstacles
  MIN_SPAWN_GAP_MS: 4500,  // throttle between spawns
  SPAWN_CHANCE: 0.6,       // per-eligible-tick roll
  FIGHTER_CLEARANCE: 90,   // don't spawn on/near a fighter
  OBSTACLE_SPACING: 70,    // keep obstacles apart
  LIFE: [14, 26],          // seconds before it crumbles away
};
export { ENV };

const randRange = ([a, b], rng) => a + (b - a) * rng();

// Try to place one obstacle at a smart random spot. Returns the obstacle or null.
export function spawnRandomObstacle(world, rng, now) {
  if (!world?.fighters?.length) return null;
  const live = world.obstacles.filter(o => o.type === 'env');
  if (live.length >= ENV.MAX_OBSTACLES) return null;

  const bound = ARENA.BOUNDS - 140;
  const fighters = world.fighters.filter(Boolean);

  for (let attempt = 0; attempt < 10; attempt++) {
    const kind = TYPE_KEYS[Math.floor(rng() * TYPE_KEYS.length)];
    const t = OBSTACLE_TYPES[kind];
    const width = Math.round(randRange(t.width, rng));
    const height = Math.round(randRange(t.height, rng));
    const x = Math.round((rng() * 2 - 1) * bound);

    // Smart placement: clear of both fighters and any existing obstacle.
    if (fighters.some(f => Math.abs(f.x - x) < width / 2 + ENV.FIGHTER_CLEARANCE)) continue;
    if (world.obstacles.some(o => Math.abs(o.x - x) < (o.width + width) / 2 + ENV.OBSTACLE_SPACING)) continue;

    const obstacle = {
      x, y: 0, width, height,
      kind, type: 'env',
      standable: t.standable === true,
      passOver: t.passOver === true,
      blocksProjectiles: t.blocksProjectiles !== false,
      life: randRange(ENV.LIFE, rng),
      createdAt: now,
      ownerId: null,
      seed: rng()  // for varied rendering
    };
    world.addObstacle(obstacle);
    return obstacle;
  }
  return null;
}
