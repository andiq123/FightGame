// Per-unit animation profiles — merged into drawStickman via fighter.animProfile.

const HEAVY = {
  rest: { torsoLean: 0.12, lKneeAng: 0.48, rKneeAng: 0.42, lShoulderAng: 0.55, rShoulderAng: 0.25 },
  walk: { cycleMul: 0.68, bob: 0.8, leg: 0.72, arm: 0.85 },
  attack: { mult: 1.38, stretch: 1.42 },
  idleKind: 'heavy',
  limb: 1.18,
};

export const PROFILES = {
  _default: {},
  _heavy: HEAVY,
  _fast: {
    rest: { torsoLean: 0.14, lKneeAng: 0.28, rKneeAng: 0.32 },
    walk: { cycleMul: 1.38, bob: 1.05, leg: 1.12, arm: 1.15 },
    idleKind: 'alert',
  },
  _fly: { idleKind: 'hover', air: { bob: 6, lift: -6 }, walk: { cycleMul: 0.88, bob: 0.5 } },
  _boss: {
    rest: { torsoLean: 0.16, lKneeAng: 0.52, rKneeAng: 0.46, lShoulderAng: 0.48, rShoulderAng: 0.18 },
    walk: { cycleMul: 0.58, bob: 0.65, leg: 0.62, arm: 0.75 },
    attack: { mult: 1.52, stretch: 1.58 },
    idleKind: 'heavy',
    limb: 1.28,
  },
  runner: { walk: { cycleMul: 1.22, bob: 1.08, leg: 1.08 }, rest: { torsoLean: 0.11 } },
  sprinter: { walk: { cycleMul: 1.48, bob: 0.95, leg: 1.18, arm: 1.2 }, rest: { torsoLean: 0.18 }, idleKind: 'alert' },
  bowler: { walk: { cycleMul: 1.05, bob: 1.1, leg: 1.05 }, rest: { torsoLean: 0.16, lKneeAng: 0.38 }, idleKind: 'athletic', attack: { mult: 1.2 } },
  grunt: { walk: { cycleMul: 0.92, bob: 0.95 } },
  ninja: {
    rest: { torsoLean: 0.06, lKneeAng: 0.58, rKneeAng: 0.52, lShoulderAng: 0.95, rShoulderAng: 0.72 },
    walk: { cycleMul: 1.18, bob: 0.65, leg: 0.82, arm: 0.75 },
    idleKind: 'ninja',
    attack: { mult: 1.12, stretch: 1.15 },
  },
  brute: { ...HEAVY, walk: { cycleMul: 0.6, bob: 0.7, leg: 0.68, arm: 0.8 }, attack: { mult: 1.48, stretch: 1.55 }, limb: 1.22 },
  giant: { ...HEAVY, rest: { torsoLean: 0.2, lKneeAng: 0.58, rKneeAng: 0.5 }, walk: { cycleMul: 0.52, bob: 0.62, leg: 0.62, arm: 0.75 }, attack: { mult: 1.58, stretch: 1.68 }, idleKind: 'heavy', limb: 1.35 },
  archer: { idleKind: 'ranged', rest: { rShoulderAng: 0.15, rElbowAng: -0.55, lShoulderAng: 0.55 } },
  bowman: { idleKind: 'ranged', rest: { rShoulderAng: 0.05, rElbowAng: -0.35, lShoulderAng: 0.62, lElbowAng: -1.1 } },
  skyrider: { idleKind: 'hover', air: { bob: 8, lift: -8 }, walk: { cycleMul: 0.85, bob: 0.45 } },
  hawk: { idleKind: 'hover', air: { bob: 10, lift: -6 }, walk: { cycleMul: 1.05, bob: 0.5 } },
  pyro: { idleKind: 'cast', rest: { lShoulderAng: 1.05, lElbowAng: -1.15, rShoulderAng: 0.35 }, attack: { mult: 1.08 } },
  warlord: { walk: { cycleMul: 0.82, bob: 0.88, leg: 0.88 }, attack: { mult: 1.28, stretch: 1.32 }, idleKind: 'heavy', limb: 1.1 },
  miner: { idleKind: 'miner', walk: { cycleMul: 0.78, bob: 0.55, leg: 0.8 } },
  titan: { rest: { torsoLean: 0.18, lKneeAng: 0.55, rKneeAng: 0.48 }, walk: { cycleMul: 0.52, bob: 0.6, leg: 0.58 }, attack: { mult: 1.6, stretch: 1.65 }, idleKind: 'heavy', limb: 1.32 },
  shade: { idleKind: 'ninja', walk: { cycleMul: 1.08, bob: 0.75 }, attack: { mult: 1.22, stretch: 1.25 } },
};

function mergeProfile(a, b) {
  if (!b) return a;
  return {
    ...a, ...b,
    rest: { ...a.rest, ...b.rest },
    walk: { ...a.walk, ...b.walk },
    attack: { ...a.attack, ...b.attack },
    air: { ...a.air, ...b.air },
  };
}

export function profileFor(typeKey, def) {
  let p = PROFILES[typeKey] || PROFILES._default;
  if (!PROFILES[typeKey]) {
    if (def.role === 'boss') p = mergeProfile(PROFILES._boss, p);
    else if (def.flying) p = mergeProfile(PROFILES._fly, p);
    else if ((def.scale || 1) >= 1.5) p = mergeProfile(PROFILES._heavy, p);
    else if ((def.scale || 1) <= 0.72) p = mergeProfile(PROFILES._fast, p);
  }
  return p;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('anim.js')) {
  const giant = profileFor('giant', { scale: 1.92 });
  console.assert(giant.limb > 1.2 && giant.idleKind === 'heavy', 'giant profile');
  const fly = profileFor('unknown', { flying: true, scale: 1 });
  console.assert(fly.idleKind === 'hover', 'fly fallback');
  console.log('anim ok');
}
