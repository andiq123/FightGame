export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
export const easeInCubic = t => t * t * t;
export const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t, c = 0.7) => 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
export const smoothStep = t => t * t * (3 - 2 * t);

const clamp01 = value => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);

export const REST_STANCE = {
  headTilt: 0,
  torsoLean: 0.03,
  torsoTwist: 0.02,
  lShoulderAng: 0.72,
  rShoulderAng: 0.38,
  lElbowAng: -1.68,
  rElbowAng: -1.45,
  lHipAng: -0.18,
  rHipAng: 0.28,
  lKneeAng: 0.36,
  rKneeAng: 0.24,
  lFootAng: -0.05,
  rFootAng: 0.02,
  weightLead: 0.56,
  stanceWidth: 0.48,
  breathAmplitude: 0.015,
  guardHeight: 0.98
};

// Strike extension profile: ease-IN acceleration into a SNAP that reaches full
// extension near the middle of the strike window (so contact lands mid active
// window), then HOLDS at ~1 through the rest of the window. Replaces the old
// linear smoothStep glide that peaked only at the very end of the strike.
const strikeExt = localT => {
  // Reach ~full by 50% of the strike phase, then OVERSHOOT and settle.
  const reach = clamp01(localT / 0.5);
  // easeInCubic gives the slow gather; easeOutBack adds the snappy overshoot.
  const accel = easeInCubic(reach);
  // Stronger back-overshoot (c=0.7) so the limb visibly punches PAST full
  // extension on the contact frame, then eases back — classic animation snap.
  const snap = easeOutBack(reach, 0.7);
  // Blend: mostly the snap, biased by the accel so it gathers before it fires.
  // Result can briefly exceed 1.0 (the overshoot) which reads as a crisp hit;
  // poses are authored with sane magnitudes so this never clips the rig.
  return Math.max(0, accel * 0.22 + snap * 0.78);
};

// IMPACT pop: a short spike that peaks right at the contact frame (~50% of the
// strike window) and fades fast. Used by the renderer to add a forward lunge +
// limb-stretch accent exactly when the hit lands, so the moment reads.
export const strikeImpactPulse = localT => {
  // Peak near localT≈0.5, narrow lobe.
  const t = clamp01(localT);
  const d = (t - 0.46) / 0.34;
  return Math.max(0, 1 - d * d);
};

const WINDUP = 0;
const STRIKE = 1;
const FOLLOW = 2;
const RECOVERY = 3;

function phaseNorm(poseT, durationSec, windup, strike, follow) {
  const t = poseT / durationSec;
  const w = windup || 0.12;
  const s = strike || 0.35;
  const f = follow || 0.25;
  const r = 1 - w - s - f;
  if (t < w) return { phase: WINDUP, localT: t / w };
  if (t < w + s) return { phase: STRIKE, localT: (t - w) / s };
  if (t < w + s + f) return { phase: FOLLOW, localT: (t - w - s) / f };
  return { phase: RECOVERY, localT: Math.min(1, (t - w - s - f) / (r || 0.01)) };
}

export function getPunchPhase(poseT, durationMs, attackType) {
  const sec = durationMs / 1000;
  // Hitbox is active 30%-75%. We want windup to end ~25% and STRIKE to span
  // roughly 25%-75% so FULL extension lands inside the active window and is
  // held through it. Default: w~0.25, s~0.5 (ends ~0.75), f~0.13, r~0.12.
  let w = 0.24, s = 0.5, f = 0.14;
  if (attackType === 0) { w = 0.22; s = 0.52; f = 0.14; }       // jab: snappy, slightly earlier contact
  else if (attackType === 1) { w = 0.24; s = 0.5; f = 0.14; }   // cross: rotational straight
  else if (attackType === 2) { w = 0.26; s = 0.48; f = 0.14; }  // hook: a touch more windup for the arc
  else if (attackType === 6) { w = 0.26; s = 0.48; f = 0.14; }  // uppercut: coil then rise
  else if (attackType === 5) { w = 0.28; s = 0.46; f = 0.14; }  // powerPunch: biggest chamber
  return phaseNorm(poseT, sec, w, s, f);
}

export function getKickPhase(poseT, durationMs, attackType) {
  const sec = durationMs / 1000;
  // Same sync target as punches: chamber ends ~25%, STRIKE spans the active
  // 30%-75% window, then a held follow + recovery.
  let w = 0.25, s = 0.5, f = 0.14;
  if (attackType === 3) { w = 0.22; s = 0.52; f = 0.14; }       // lowKick: fast low snap
  else if (attackType === 4) { w = 0.27; s = 0.47; f = 0.14; }  // highKick: more chamber to reach high
  else if (attackType === 10) { w = 0.22; s = 0.52; f = 0.14; } // frontKick: quick thrust
  else if (attackType === 9) { w = 0.26; s = 0.48; f = 0.14; }  // axeKick: lift then chop
  else if (attackType === 8) { w = 0.28; s = 0.46; f = 0.14; }  // spinningKick: longest wind/spin
  return phaseNorm(poseT, sec, w, s, f);
}

function gaitLeg(phase, cfg) {
  const stride = Math.sin(phase);
  const strideCos = Math.cos(phase);
  const swingT = clamp01((-strideCos + 0.12) / 1.12);
  const swingLift = Math.sin(swingT * Math.PI);
  const toeOff = clamp01((strideCos + 0.15) / 1.15);
  const trailing = clamp01((-stride + 0.05) / 1.05);
  const planted = strideCos > -0.2;
  const plant = planted ? 1 - swingLift * 0.42 : 1;

  return {
    hip: stride * cfg.hipAmp + cfg.hipBias - swingLift * cfg.swingHipBack,
    knee: (cfg.stanceKnee + trailing * cfg.trailKnee) * plant + swingLift * cfg.swingKnee,
    foot: -0.05 + toeOff * cfg.toeOff * plant + swingLift * cfg.footLift - Math.max(0, stride) * cfg.heelStrike,
  };
}

// Kung-fu advance: a rooted, low stance with deliberate steps. The hands stay
// UP in a bladed guard (they don't swing casually), the knees stay bent to keep
// a low centre of gravity, and the hips/shoulders rotate continuously for flow.
const WALK_GAIT = {
  hipAmp: 0.38,
  swingHipBack: 0.08,
  stanceKnee: 0.28,
  swingKnee: 0.58,
  trailKnee: 0.22,
  toeOff: 0.22,
  footLift: 0.28,
  heelStrike: 0.14,
};

export function getWalkCycle(phase, face) {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const rightLeg = gaitLeg(phase, { ...WALK_GAIT, hipBias: 0.02 });
  const leftLeg = gaitLeg(phase + Math.PI, { ...WALK_GAIT, hipBias: -0.02 });
  const contact = Math.pow(Math.max(0, c), 2);

  return {
    lHip: leftLeg.hip - s * 0.05,
    rHip: rightLeg.hip + s * 0.05,
    lKnee: leftLeg.knee,
    rKnee: rightLeg.knee,
    lFoot: leftLeg.foot,
    rFoot: rightLeg.foot,
    lArm: 0.46 - s * 0.24,
    rArm: 0.86 + s * 0.24,
    lElbow: -1.52 + Math.max(0, s) * 0.32,
    rElbow: -1.64 - Math.max(0, -s) * 0.32,
    bob: 0.7 + contact * 0.9 + (1 - Math.abs(s)) * 0.32,
    torsoTwist: -s * 0.18 * face,
    lean: (0.06 + contact * 0.03) * face,
    headTilt: 0.02 * face - s * 0.015,
  };
}

const RUN_GAIT = {
  hipAmp: 0.74,
  swingHipBack: 0.18,
  stanceKnee: 0.22,
  swingKnee: 1.05,
  trailKnee: 0.5,
  toeOff: 0.32,
  footLift: 0.4,
  heelStrike: 0.22,
};

export function getRunCycle(phase, face) {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const rightLeg = gaitLeg(phase, { ...RUN_GAIT, hipBias: 0.03 });
  const leftLeg = gaitLeg(phase + Math.PI, { ...RUN_GAIT, hipBias: -0.03 });
  const drive = Math.abs(s);
  const strike = Math.pow(Math.max(0, c), 2);

  return {
    lHip: leftLeg.hip - s * 0.08,
    rHip: rightLeg.hip + s * 0.08,
    lKnee: leftLeg.knee,
    rKnee: rightLeg.knee,
    lFoot: leftLeg.foot,
    rFoot: rightLeg.foot,
    lArm: 0.6 - s * 0.5,
    rArm: 1.04 + s * 0.5,
    lElbow: -1.18 - drive * 0.38,
    rElbow: -1.34 - drive * 0.38,
    bob: 1.2 + strike * 2.6 + drive * 0.55,
    torsoTwist: -s * 0.24 * face,
    lean: (0.18 + strike * 0.08) * face,
    headTilt: 0.04 * face - s * 0.025,
  };
}

function combatGuard() {
  return {
    leadArm: 0.34,
    leadForearm: -1.46,
    rearArm: 0.74,
    rearForearm: -1.68,
    leadHip: 0.28,
    leadKnee: 0.24,
    rearHip: -0.2,
    rearKnee: 0.36,
    leadFoot: 0.02,
    rearFoot: -0.05,
    lean: 0,
    torsoTwist: 0,
    headTilt: 0,
    pelvisShift: 0,
    bodyLift: 0
  };
}

function blendPose(from, to, t) {
  const out = {};
  Object.keys(to).forEach(key => {
    const a = from[key] ?? to[key];
    out[key] = lerp(a, to[key], t);
  });
  return out;
}

function punchStrikePose(attackType, ext, face) {
  const pose = combatGuard();
  const snap = Math.sin(ext * Math.PI);

  if (attackType === ATTACK.jab) {
    pose.leadArm = lerp(0.44, -0.06, ext);
    pose.leadForearm = lerp(-1.2, 0.08, ext);
    pose.rearArm = lerp(0.72, 0.48, ext);
    pose.rearForearm = lerp(-1.72, -1.58, ext);
    pose.lean = face * (0.08 + 0.08 * ext);
    pose.torsoTwist = face * 0.22 * ext;
    pose.pelvisShift = face * (3 + 7 * ext);
  } else if (attackType === ATTACK.hook) {
    pose.leadArm = lerp(0.88, -0.2, ext);
    pose.leadForearm = lerp(-1.55, 1.0, ext);
    pose.rearArm = lerp(0.74, 0.42, ext);
    pose.rearForearm = lerp(-1.7, -1.48, ext);
    pose.leadHip = lerp(0.2, 0.48, ext);
    pose.rearHip = lerp(-0.28, -0.08, ext);
    pose.lean = face * (0.08 + 0.11 * ext);
    pose.torsoTwist = face * 0.72 * ext;
    pose.pelvisShift = face * (4 + 6 * ext);
  } else if (attackType === ATTACK.uppercut) {
    pose.leadArm = lerp(0.36, 0.2, ext);
    pose.leadForearm = lerp(-1.45, -1.28, ext);
    pose.rearArm = lerp(1.12, -1.05, ext);
    pose.rearForearm = lerp(-1.72, 0.72, ext);
    pose.leadKnee = lerp(0.34, 0.2, ext);
    pose.rearKnee = lerp(0.62, 0.28, ext);
    pose.bodyLift = 5 * snap + 3 * ext;
    pose.lean = face * 0.2 * ext;
    pose.torsoTwist = face * 0.46 * ext;
    pose.pelvisShift = face * (2 + 6 * ext);
  } else {
    const power = attackType === ATTACK.powerPunch ? 1.18 : 1;
    pose.leadArm = lerp(0.38, 0.26, ext);
    pose.leadForearm = lerp(-1.46, -1.35, ext);
    pose.rearArm = lerp(1.05, -0.04, ext);
    pose.rearForearm = lerp(-1.8, 0.1, ext);
    pose.leadHip = lerp(0.24, 0.52, ext);
    pose.rearHip = lerp(-0.32, 0.02, ext);
    pose.rearKnee = lerp(0.48, 0.2, ext);
    pose.rearFoot = lerp(-0.12, 0.22, ext);
    pose.lean = face * (0.12 + 0.18 * ext) * power;
    pose.torsoTwist = face * 0.62 * ext * power;
    pose.pelvisShift = face * (4 + 9 * ext) * power;
  }

  pose.headTilt = face * (0.025 + 0.045 * ext);
  pose.bodyLift += 1.5 * snap;
  return pose;
}

function punchWindupPose(attackType, pull, face) {
  const pose = combatGuard();
  const rearStrike = attackType === ATTACK.cross || attackType === ATTACK.powerPunch || attackType === ATTACK.uppercut;
  const hook = attackType === ATTACK.hook;

  // Coil harder: a readable counter-rotation + weight shift onto the rear leg
  // and a deeper knee bend so the body visibly loads before firing.
  pose.lean = -face * (rearStrike ? 0.2 : 0.12) * pull;
  pose.torsoTwist = -face * (rearStrike ? 0.58 : hook ? 0.46 : 0.3) * pull;
  pose.bodyLift = -4.5 * pull;
  pose.leadKnee = lerp(0.24, 0.5, pull);
  pose.rearKnee = lerp(0.36, rearStrike ? 0.72 : 0.54, pull);
  pose.leadHip = lerp(0.28, 0.14, pull);
  pose.rearHip = lerp(-0.2, -0.46, pull);

  if (rearStrike) {
    // Pull the rear (striking) hand back and cocked further behind.
    pose.rearArm = lerp(0.74, 1.28, pull);
    pose.rearForearm = lerp(-1.68, -2.02, pull);
    pose.leadArm = lerp(0.34, 0.12, pull);
    pose.leadForearm = lerp(-1.46, -1.3, pull);
  } else if (hook) {
    // Wind the lead arm wide for the horizontal arc.
    pose.leadArm = lerp(0.34, 1.04, pull);
    pose.leadForearm = lerp(-1.46, -1.78, pull);
    pose.rearArm = lerp(0.74, 0.46, pull);
    pose.rearForearm = lerp(-1.68, -1.48, pull);
  } else {
    // Jab: small chamber pulling the lead hand back to load the straight.
    pose.leadArm = lerp(0.34, 0.62, pull);
    pose.leadForearm = lerp(-1.46, -1.22, pull);
  }

  pose.headTilt = -face * 0.06 * pull;
  pose.pelvisShift = -face * 4.5 * pull;
  return pose;
}

export function punchExtension(phase, localT, face, attackType) {
  if (phase === WINDUP) {
    return punchWindupPose(attackType, easeOutCubic(localT), face);
  }
  if (phase === STRIKE) {
    return punchStrikePose(attackType, strikeExt(localT), face);
  }
  if (phase === FOLLOW) {
    // Quick recoil snap back toward guard: easeOutCubic pulls fast off the
    // fully-extended pose right after contact (livelier than the old slow
    // easeInOutCubic*0.38 partial settle).
    const end = punchStrikePose(attackType, 1, face);
    const settle = easeOutCubic(localT) * 0.62;
    const guarded = blendPose(end, combatGuard(), settle);
    // Crisp recoil: a brief counter-twist hitch right after contact (peaks early
    // in FOLLOW) before the body unwinds, so the hand visibly "snaps back".
    const recoil = Math.sin(clamp01(localT / 0.45) * Math.PI) * 0.12;
    guarded.lean = end.lean * (1 - settle * 0.85);
    guarded.torsoTwist = end.torsoTwist * (1 - settle * 0.75) - face * recoil;
    guarded.pelvisShift = end.pelvisShift * (1 - settle);
    guarded.bodyLift = (end.bodyLift || 0) * (1 - settle) - recoil * 4;
    return guarded;
  }
  // RECOVERY: settle the remainder back into guard.
  return blendPose(punchStrikePose(attackType, 1, face), combatGuard(), easeOutCubic(localT));
}

export function kickExtension(phase, localT, face, attackType) {
  if (phase === WINDUP) {
    // Stronger chamber: deeper knee fold + more counter-twist/weight onto the
    // support leg so the wind-up reads before the leg fires.
    const chamber = easeOutCubic(localT);
    let hip = -0.7, knee = 1.5;
    let twist = -0.42 * face * chamber;
    let lean = -0.28 * face * chamber;

    if (attackType === ATTACK.lowKick) { hip = 0.2 + chamber * 0.5; knee = 0.55 + chamber * 0.9; }
    if (attackType === ATTACK.highKick) { hip = -0.55 - chamber * 0.8; knee = 1.1 + chamber * 1.25; }
    if (attackType === ATTACK.axeKick) { hip = -0.6 - chamber * 0.95; knee = 1.15 + chamber * 1.3; } // lift knee high to chop down
    if (attackType === ATTACK.frontKick) { hip = -0.35 + chamber * 0.45; knee = 0.7 + chamber * 0.95; }
    if (attackType === ATTACK.spinningKick) { hip = chamber * 0.9; knee = 0.45 + chamber * 0.85; twist = -1.0 * face * chamber; } // big pre-spin wind

    return { leadHip: hip, leadKnee: knee, supportHip: 0.28 + chamber * 0.2, supportKnee: 0.18, torsoTwist: twist, lean };
  }
  if (phase === STRIKE) {
    // Snap into full extension by mid-window and hold (matches punch profile).
    const ext = strikeExt(localT);
    let leadHip = -0.7, leadKnee = 1.5;

    let twist = 0.45 * face * ext;
    let lean = -0.35 * face * ext;

    if (attackType === ATTACK.lowKick) { leadHip = 0.45 + ext * 0.6 * face; leadKnee = 1.2 + ext * 0.45 * face; }       // low target, low sweep
    if (attackType === ATTACK.highKick) { leadHip = -1.1 - ext * 0.85 * face; leadKnee = 0.35 + ext * 1.7 * face; }     // high target, straight leg up
    if (attackType === ATTACK.axeKick) { leadHip = -1.05 - ext * 0.6 * face; leadKnee = 1.3 - ext * 1.05 * face; lean = -0.18 * face * ext; } // raised leg DROPS (knee straightens downward) for the chop
    if (attackType === ATTACK.frontKick) { leadHip = 0.25 + ext * 0.7 * face; leadKnee = 0.8 + ext * 1.0 * face; }      // forward thrust
    if (attackType === ATTACK.spinningKick) { leadHip = 0.9 + ext * 0.95 * face; leadKnee = 0.6 + ext * 1.2 * face; twist = 0.95 * face * ext; } // carries the spin through

    return { leadHip, leadKnee, supportHip: 0.35, supportKnee: 0.12, torsoTwist: twist, lean };
  }
  if (phase === FOLLOW) {
    // Faster recoil off the extended leg (easeOutCubic) instead of linear hold.
    const hold = 1 - easeOutCubic(localT) * 0.7;
    return {
      leadHip: -0.75 * hold,
      leadKnee: 1.3 * hold,
      supportHip: 0.3,
      supportKnee: 0.18,
      torsoTwist: 0.25 * face * hold,
      lean: -0.18 * face * hold
    };
  }
  const ret = easeOutCubic(localT);
  return {
    leadHip: -0.4 * (1 - ret),
    leadKnee: 0.4 * (1 - ret),
    supportHip: 0.25,
    supportKnee: 0.15,
    torsoTwist: 0.05 * face * (1 - ret),
    lean: 0
  };
}

export function idleFromRest(poseT, rest) {
  const phase = (poseT * 1.2) % (2 * Math.PI);
  const breath = Math.sin(phase) * rest.breathAmplitude;
  const weight = Math.sin(phase * 0.55) * 0.04;
  const guardFloat = Math.sin(phase * 0.8) * 0.05;

  return {
    lShoulderAng: rest.lShoulderAng + guardFloat,
    rShoulderAng: rest.rShoulderAng - guardFloat * 0.7,
    lElbowAng: rest.lElbowAng - guardFloat * 0.8,
    rElbowAng: rest.rElbowAng + guardFloat * 0.7,
    lHipAng: rest.lHipAng + weight + Math.sin(phase * 0.5) * 0.04,
    rHipAng: rest.rHipAng - weight - Math.sin(phase * 0.5) * 0.04,
    // Rooted, low stance with a subtle live bounce on the balls of the feet.
    lKneeAng: rest.lKneeAng + 0.12 + Math.sin(phase * 0.5) * 0.03,
    rKneeAng: rest.rKneeAng + 0.12 - Math.sin(phase * 0.5) * 0.03,
    lFootAng: rest.lFootAng + weight * 0.4,
    rFootAng: rest.rFootAng - weight * 0.3,
    bob: breath * 14 + Math.abs(Math.sin(phase)) * 1.2,
    weightLead: rest.weightLead + weight,
    torsoTwist: Math.sin(phase * 0.4) * 0.03,
    lean: 0
  };
}

// Bored, untouchable, hands-down stance — the One Strike vibe. Guard completely
// dropped, weight cocked on one hip, a slow relaxed sway and a lazy head tilt.
// Reads instantly as "this guy isn't even trying".
export function relaxedIdle(poseT, rest) {
  const phase = (poseT * 0.8) % (2 * Math.PI); // slow, unbothered tempo
  const breath = Math.sin(phase);
  const sway = Math.sin(phase * 0.5);
  return {
    // Arms hang loose and low — no guard at all.
    lShoulderAng: 1.46 + breath * 0.05,
    rShoulderAng: 1.52 + breath * 0.05,
    lElbowAng: 0.14 + sway * 0.06,
    rElbowAng: 0.20 - sway * 0.06,
    // Casual wide stance, weight rolling lazily between hips.
    lHipAng: -0.26 + sway * 0.05,
    rHipAng: 0.34 + sway * 0.05,
    lKneeAng: 0.16,
    rKneeAng: 0.30,
    lFootAng: -0.08,
    rFootAng: 0.06,
    bob: breath * 1.6,
    weightLead: 0.5 + sway * 0.06,
    torsoTwist: sway * 0.05,
    lean: -0.05 + sway * 0.02,    // relaxed slouch back
    headTilt: 0.08 + sway * 0.04, // lazy bored head tilt
  };
}

export function recoveryFromRest(poseT, rest) {
  const phase = (poseT * 2.1) % (2 * Math.PI);
  const breath = Math.sin(phase);
  const brace = 0.5 + Math.sin(phase * 0.5) * 0.08;

  return {
    lShoulderAng: 1.18 + brace * 0.18,
    rShoulderAng: 1.0 + brace * 0.16,
    lElbowAng: -0.42 - brace * 0.08,
    rElbowAng: -0.36 - brace * 0.08,
    lHipAng: rest.lHipAng - 0.18,
    rHipAng: rest.rHipAng + 0.08,
    lKneeAng: rest.lKneeAng + 0.52,
    rKneeAng: rest.rKneeAng + 0.42,
    lFootAng: rest.lFootAng - 0.08,
    rFootAng: rest.rFootAng + 0.05,
    bob: -5 + breath * 1.8,
    torsoTwist: breath * 0.025,
    lean: -0.22,
    headTilt: -0.08 + breath * 0.02
  };
}

// EVADE / dodge — a hard, expressive slip. A novice "step aside" reads as nothing;
// this is a committed martial weave: explode off the trailing leg into a deep
// lateral lean, counter-twist the shoulders, duck the head aside and sweep the
// arms — then snap crisply back to guard. The motion is a sharp bell (fast burst
// out, brief held extreme at the apex, quick recover) so the evade clearly POPS.
export function getDodgePose(elapsedMs, durationMs, dir, face) {
  const t = clamp01(elapsedMs / (durationMs || 190));
  const d = dir || face || 1;                       // travel direction (±1)
  const burst = easeOutBack(clamp01(t / 0.30), 1.1); // explosive launch w/ overshoot
  const recover = easeInOutCubic(clamp01((t - 0.55) / 0.45));
  const a = clamp01(burst) * (1 - recover);          // bell: peaks ~apex of the slip
  const apex = Math.sin(clamp01(t) * Math.PI);       // extra accent at mid-dodge

  return {
    // Hard lateral lean + aggressive shoulder counter-twist = a dynamic weave.
    lean: d * 0.62 * a,
    torsoTwist: -d * 0.7 * a,
    headTilt: d * 0.4 * a,                 // head ducks/snaps aside
    bob: -22 * a - 6 * apex,               // sink LOW under the attack, then rise
    pelvisShift: d * 22 * a,               // hips lead the slip (committed travel)
    // Lead arm sweeps across to parry the line, rear arm flares out for balance.
    lArm: lerp(REST_STANCE.lShoulderAng, 1.55, a),
    rArm: lerp(REST_STANCE.rShoulderAng, -1.35, a),
    lElbow: lerp(REST_STANCE.lElbowAng, -0.45, a),
    rElbow: lerp(REST_STANCE.rElbowAng, -0.55, a),
    // Drive off the trailing leg; lead leg reaches wide into the slip (deep coil).
    lHip: lerp(REST_STANCE.lHipAng, -0.62 * d, a),
    rHip: lerp(REST_STANCE.rHipAng, 0.62 * d, a),
    lKnee: REST_STANCE.lKneeAng + 0.85 * a,
    rKnee: REST_STANCE.rKneeAng + 0.6 * a,
    lFoot: -0.24 * a,
    rFoot: 0.24 * a,
  };
}

export function getHitReaction(poseT, damage, face, hitFromX, fighterX) {
  // Harder, more violent recoil — a hit should visibly SNAP the body.
  const impact = Math.min(2.2, Math.max(0.8, (damage || 5) / 8.5));
  const knockDir = Number.isFinite(hitFromX) && Number.isFinite(fighterX)
    ? (fighterX >= hitFromX ? 1 : -1)
    : -face;
  const snapT = clamp01(poseT / 0.12);
  const recoilT = clamp01((poseT - 0.08) / 0.28);
  const recoverT = clamp01((poseT - 0.26) / 0.32);
  const snapFade = 1 - clamp01((poseT - 0.1) / 0.22);
  const snap = Math.min(1.25, easeOutBack(snapT, 0.9)) * snapFade;
  const recoil = (1 - easeInOutCubic(recoverT)) * (0.55 + 0.45 * Math.sin(recoilT * Math.PI));
  const amount = impact * Math.max(0, snap, recoil);

  return {
    lean: knockDir * 0.36 * amount,
    torsoTwist: -knockDir * 0.34 * amount,
    headTilt: knockDir * 0.18 * amount,
    lArm: lerp(REST_STANCE.lShoulderAng, 2.2, clamp01(amount * 0.65)),
    rArm: lerp(REST_STANCE.rShoulderAng, -0.72, clamp01(amount * 0.55)),
    lElbow: lerp(REST_STANCE.lElbowAng, -0.72, clamp01(amount * 0.55)),
    rElbow: lerp(REST_STANCE.rElbowAng, 0.82, clamp01(amount * 0.6)),
    lHip: lerp(REST_STANCE.lHipAng, -0.5, clamp01(amount * 0.45)),
    rHip: lerp(REST_STANCE.rHipAng, 0.12, clamp01(amount * 0.4)),
    lKnee: lerp(REST_STANCE.lKneeAng, 0.74, clamp01(amount * 0.45)),
    rKnee: lerp(REST_STANCE.rKneeAng, 0.58, clamp01(amount * 0.35)),
    lFoot: -0.18,
    rFoot: 0.14,
    bob: Math.sin(clamp01(poseT / 0.32) * Math.PI) * -4 * impact
  };
}

export function mergeRest(base, patch) {
  return patch ? { ...base, ...patch } : base;
}

// Foot cadence tied to actual creep speed + scale (longer legs = slower cycle at same px/s).
export function gaitPhaseSpeed(velX, moveSpeed, scale, isRun, cycleMul = 1) {
  const target = moveSpeed || (isRun ? 420 : 220);
  const ratio = Math.min(1.45, Math.max(0.32, Math.abs(velX) / Math.max(28, target)));
  const base = isRun ? 12 : 7.4;
  return base * ratio * cycleMul / Math.sqrt(scale || 1);
}

export function getRangedShootPose(poseT, face, rest, flying = false) {
  const draw = easeOutCubic(Math.min(1, poseT * 7));
  const recoil = poseT > 0.1 ? Math.sin(Math.min(1, (poseT - 0.1) * 5.5) * Math.PI) * 0.38 : 0;
  return {
    lean: -face * (0.06 + draw * 0.06 + recoil * 0.05),
    torsoTwist: face * (0.1 * draw + recoil * 0.08),
    headTilt: face * 0.035,
    bob: (flying ? -5 : -1) * draw + recoil * (flying ? 4 : 2),
    lShoulderAng: lerp(rest.lShoulderAng, 0.78, draw),
    rShoulderAng: lerp(rest.rShoulderAng, -0.22 - recoil * 0.35, draw),
    lElbowAng: lerp(rest.lElbowAng, -1.75, draw),
    rElbowAng: lerp(rest.rElbowAng, -0.42 + recoil * 0.55, draw),
    lHipAng: rest.lHipAng + draw * 0.06,
    rHipAng: rest.rHipAng - recoil * 0.08,
    lKneeAng: rest.lKneeAng + draw * 0.1,
    rKneeAng: rest.rKneeAng + draw * 0.08 + recoil * 0.12,
    lFootAng: rest.lFootAng, rFootAng: rest.rFootAng,
  };
}

export function scaleWalkCycle(cycle, w = {}) {
  if (!w || !Object.keys(w).length) return cycle;
  const m = (v, k, d = 1) => (v ?? 0) * (w[k] ?? d);
  return {
    ...cycle,
    bob: m(cycle.bob, 'bob'),
    lean: m(cycle.lean, 'lean'),
    lHip: m(cycle.lHip, 'leg'), rHip: m(cycle.rHip, 'leg'),
    lKnee: m(cycle.lKnee, 'leg'), rKnee: m(cycle.rKnee, 'leg'),
    lArm: m(cycle.lArm, 'arm'), rArm: m(cycle.rArm, 'arm'),
    torsoTwist: m(cycle.torsoTwist, 'arm', 1),
  };
}

function heavyIdle(poseT, rest) {
  const phase = (poseT * 0.85) % (2 * Math.PI);
  const sway = Math.sin(phase * 0.45);
  const base = idleFromRest(poseT, rest);
  return {
    ...base,
    lShoulderAng: rest.lShoulderAng + 0.15 + sway * 0.04,
    rShoulderAng: rest.rShoulderAng - 0.1,
    lKneeAng: rest.lKneeAng + 0.18 + Math.abs(sway) * 0.06,
    rKneeAng: rest.rKneeAng + 0.16,
    lean: rest.torsoLean + sway * 0.03,
    bob: base.bob * 0.7 + 2,
  };
}

function ninjaIdle(poseT, rest) {
  const phase = (poseT * 1.4) % (2 * Math.PI);
  const s = Math.sin(phase);
  return {
    lShoulderAng: 0.92 + s * 0.06,
    rShoulderAng: 0.68 - s * 0.05,
    lElbowAng: -1.35 - Math.abs(s) * 0.08,
    rElbowAng: -1.55 + Math.abs(s) * 0.06,
    lHipAng: rest.lHipAng + 0.22 + s * 0.04,
    rHipAng: rest.rHipAng + 0.18 - s * 0.04,
    lKneeAng: 0.62 + Math.abs(s) * 0.05,
    rKneeAng: 0.54 + Math.abs(s) * 0.04,
    lFootAng: -0.06, rFootAng: 0.04,
    bob: 1.2 + Math.abs(s) * 0.8,
    torsoTwist: s * 0.08,
    lean: rest.torsoLean + 0.04,
    headTilt: s * 0.05,
  };
}

function minerIdle(poseT, rest) {
  const phase = (poseT * 1.1) % (2 * Math.PI);
  const swing = Math.sin(phase);
  const pick = Math.max(0, Math.sin(phase * 2));
  return {
    lShoulderAng: 0.35 + pick * 0.55,
    rShoulderAng: 0.55,
    lElbowAng: -1.1 - pick * 0.4,
    rElbowAng: -1.45,
    lHipAng: rest.lHipAng + swing * 0.03,
    rHipAng: rest.rHipAng - swing * 0.03,
    lKneeAng: rest.lKneeAng + 0.08,
    rKneeAng: rest.rKneeAng + 0.1,
    lFootAng: rest.lFootAng, rFootAng: rest.rFootAng,
    bob: pick * 4 + Math.abs(swing) * 0.6,
    torsoTwist: pick * 0.12,
    lean: 0.06 + pick * 0.08,
    headTilt: pick * 0.06,
  };
}

function hoverIdle(poseT, rest, air = {}) {
  const phase = (poseT * 1.6) % (2 * Math.PI);
  const flap = Math.sin(poseT * (air.flapSpeed ?? 4.8));
  const up = Math.max(0, flap);
  const down = Math.max(0, -flap);
  const bob = Math.sin(phase) * (air.bob ?? 4);
  const wing = air.flapAmp ?? 0.45;
  return {
    lShoulderAng: 0.55 + flap * wing,
    rShoulderAng: 0.48 - flap * wing,
    lElbowAng: -1.05 - up * 0.35, rElbowAng: -1.15 - up * 0.35,
    lHipAng: -0.35 - up * 0.12, rHipAng: 0.25 + up * 0.1,
    lKneeAng: 0.72 + up * 0.15, rKneeAng: 0.55 + up * 0.12,
    lFootAng: -0.15, rFootAng: 0.1,
    bob: (air.lift ?? -18) + bob + down * (air.flapLift ?? 4),
    torsoTwist: Math.sin(phase * 0.7) * 0.05,
    lean: 0.04,
    headTilt: Math.sin(phase * 0.4) * 0.03,
  };
}

function rangedIdle(poseT, rest) {
  const phase = (poseT * 0.9) % (2 * Math.PI);
  const draw = 0.5 + Math.sin(phase * 0.6) * 0.15;
  const base = idleFromRest(poseT, rest);
  return {
    ...base,
    rShoulderAng: lerp(0.2, -0.35, draw),
    rElbowAng: lerp(-0.5, -1.05, draw),
    lShoulderAng: lerp(0.5, 0.72, draw),
    lElbowAng: lerp(-1.4, -1.65, draw),
    lean: -0.04 * draw,
    headTilt: 0.03,
  };
}

function alertIdle(poseT, rest) {
  const phase = (poseT * 1.8) % (2 * Math.PI);
  const bounce = Math.abs(Math.sin(phase));
  const base = idleFromRest(poseT, rest);
  return {
    ...base,
    bob: base.bob + bounce * 2.5,
    lean: rest.torsoLean + 0.06,
    lKneeAng: rest.lKneeAng + bounce * 0.08,
    rKneeAng: rest.rKneeAng + bounce * 0.06,
  };
}

function castIdle(poseT, rest) {
  const phase = (poseT * 1.2) % (2 * Math.PI);
  const charge = 0.5 + Math.sin(phase) * 0.25;
  return {
    lShoulderAng: 0.95 + charge * 0.15,
    rShoulderAng: 0.42,
    lElbowAng: -1.05 - charge * 0.25,
    rElbowAng: -1.5,
    lHipAng: rest.lHipAng + 0.1,
    rHipAng: rest.rHipAng + 0.08,
    lKneeAng: rest.lKneeAng + 0.14,
    rKneeAng: rest.rKneeAng + 0.12,
    lFootAng: rest.lFootAng, rFootAng: rest.rFootAng,
    bob: charge * 2,
    torsoTwist: charge * 0.06,
    lean: -0.03,
    headTilt: -0.04,
  };
}

export function getProfileIdle(kind, poseT, rest, chill, air) {
  if (chill) return relaxedIdle(poseT, rest);
  switch (kind) {
    case 'heavy': return heavyIdle(poseT, rest);
    case 'ninja': return ninjaIdle(poseT, rest);
    case 'miner': return minerIdle(poseT, rest);
    case 'hover': return hoverIdle(poseT, rest, air);
    case 'ranged': return rangedIdle(poseT, rest);
    case 'alert': return alertIdle(poseT, rest);
    case 'cast': return castIdle(poseT, rest);
    default: return idleFromRest(poseT, rest);
  }
}

export function getFlyPose(poseT, face, prof, velX = 0, shooting = false) {
  const air = prof?.air || {};
  const flap = Math.sin(poseT * (air.flapSpeed ?? 5.4));
  const up = Math.max(0, flap);
  const down = Math.max(0, -flap);
  const hover = Math.sin(poseT * 1.6) * (air.bob ?? 3);
  const spd = Math.min(0.28, Math.abs(velX) / 700);
  const snap = shooting ? Math.sin(Math.min(1, poseT * 5) * Math.PI) : 0;
  const cruise = velX !== 0 ? Math.sign(velX) : face;
  const flapMul = shooting ? 0.22 : 1;
  const wing = (air.flapAmp ?? 0.62) * flapMul;
  return {
    lean: cruise * (0.04 + spd) + face * 0.02,
    torsoTwist: Math.sin(poseT * 2.1) * 0.06 * face + down * 0.05 * flapMul,
    headTilt: Math.sin(poseT * 1.4) * 0.05 - snap * 0.04 - up * 0.03,
    bob: hover + down * (air.flapLift ?? 6) * flapMul - up * 2,
    lArmAng: shooting ? (0.28 + snap * 0.35) : (-0.15 + flap * wing),
    rArmAng: shooting ? (0.62 + snap * 0.85) : (-0.15 - flap * wing),
    lForeArmAng: shooting ? (-1.05 - snap * 0.15) : (-0.72 - up * 0.58 * flapMul),
    rForeArmAng: shooting ? (-0.65 - snap * 0.75) : (-0.72 - up * 0.58 * flapMul),
    lLegAng: -0.48 - up * 0.4 * flapMul - spd * 0.35,
    rLegAng: 0.2 + up * 0.3 * flapMul + spd * 0.25,
    lKneeOff: 0.6 + up * 0.24 * flapMul,
    rKneeOff: 0.46 + up * 0.2 * flapMul,
    lFootAng: -0.12 - up * 0.08, rFootAng: 0.08,
  };
}

export function getGrabPose(poseT, face, throwing = false) {
  const throwT = throwing ? Math.sin(Math.min(1, Math.max(0, poseT - 0.22) * 3.8) * Math.PI) : 0;
  return {
    lean: face * (0.12 + throwT * 0.38),
    torsoTwist: face * (0.1 + throwT * 0.22),
    headTilt: throwT * face * 0.07,
    bob: -throwT * 24,
    lArmAng: 1.05 + throwT * 0.55, rArmAng: -0.12 - throwT * 0.35,
    lForeArmAng: -0.32 - throwT * 0.6, rForeArmAng: -0.92,
    lLegAng: 0.2 + throwT * 0.28, rLegAng: -0.16,
    lKneeOff: 0.4, rKneeOff: 0.36,
    lFootAng: 0.06, rFootAng: -0.08,
  };
}

export function getAntiAirPose(poseT, face) {
  const t = Math.min(1, poseT * 3.8);
  const strike = Math.sin(Math.min(1, poseT * 2.6) * Math.PI);
  return {
    lean: face * (0.16 + strike * 0.24),
    torsoTwist: face * t * 0.14,
    headTilt: -strike * 0.09,
    bob: -16 - t * 38 - strike * 14,
    lArmAng: -0.4 - strike * 1.15, rArmAng: 0.5 + strike * 0.55,
    lForeArmAng: -0.95 - strike * 0.45, rForeArmAng: -1.2,
    lLegAng: -0.62 * t, rLegAng: 0.48 * t,
    lKneeOff: 0.8 * t, rKneeOff: 0.52 * t,
    lFootAng: -0.2 * t, rFootAng: 0.14 * t,
  };
}

export function getJumpAirPose(poseT, pose, face, prof) {
  const air = prof?.air || {};
  if (pose === 'jump') {
    const t = easeOutCubic(Math.min(1, poseT * 3.5));
    return {
      lean: face * (0.12 + t * 0.14),
      torsoTwist: face * t * 0.12,
      headTilt: -t * 0.06,
      bob: -6 - t * 14,
      lArmAng: -0.6 - t * 0.7, rArmAng: 0.5 + t * 0.35,
      lForeArmAng: -0.9 - t * 0.3, rForeArmAng: -1.2,
      lLegAng: -0.55 * t, rLegAng: 0.45 * t,
      lKneeOff: 0.85 * t, rKneeOff: 0.55 * t,
      lFootAng: -0.2 * t, rFootAng: 0.15 * t,
    };
  }
  const hover = Math.sin(poseT * 2.8) * (air.bob ?? 4);
  return {
    lean: face * 0.06,
    torsoTwist: Math.sin(poseT * 2) * 0.06 * face,
    headTilt: Math.sin(poseT * 1.5) * 0.04,
    bob: (air.lift ?? -20) + hover,
    lArmAng: 0.55, rArmAng: 0.42,
    lForeArmAng: -1.2, rForeArmAng: -1.35,
    lLegAng: -0.28, rLegAng: 0.18,
    lKneeOff: 0.48, rKneeOff: 0.38,
    lFootAng: -0.1, rFootAng: 0.08,
  };
}

export const ATTACK = { jab: 0, cross: 1, hook: 2, lowKick: 3, highKick: 4, powerPunch: 5, uppercut: 6, grab: 7, spinningKick: 8, axeKick: 9, frontKick: 10 };

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('fightAnimations.js')) {
  const cruise = getFlyPose(0.4, 1, { air: { bob: 6 } }, -240, false);
  const shot = getFlyPose(0.15, 1, {}, 0, true);
  console.assert(cruise.lean < 0, 'fly lean follows velocity');
  console.assert(shot.rArmAng > 0.9, 'fly shoot raises bow arm');
  const f0 = getFlyPose(0, 1, { air: { flapAmp: 0.62 } }, 0, false);
  const f1 = getFlyPose(0.22, 1, { air: { flapAmp: 0.62 } }, 0, false);
  console.assert(Math.abs(f0.lArmAng - f1.lArmAng) > 0.12, 'fly arms flap');
  const walk = getWalkCycle(0, 1);
  const walkMid = getWalkCycle(Math.PI * 0.5, 1);
  console.assert(walk.bob > walkMid.bob, 'walk dips mid-stride');
  const slow = gaitPhaseSpeed(58, 58, 1.92, false, 0.52);
  const fast = gaitPhaseSpeed(280, 280, 0.78, true, 1.2);
  console.assert(slow < fast, 'giant gait slower than sprinter run');
  const bow = getRangedShootPose(0.12, 1, REST_STANCE, false);
  console.assert(bow.rShoulderAng < REST_STANCE.rShoulderAng, 'ranged draw pulls bow arm back');
  console.log('fightAnimations ok');
}
