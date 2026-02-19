export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
export const easeInCubic = t => t * t * t;
export const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t, c = 1.5) => 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
export const easeOutElastic = (t, p = 0.4) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / p) + 1;

export const REST_STANCE = {
  headTilt: 0.1,
  torsoLean: 0.12,
  torsoTwist: 0.08,
  lShoulderAng: -0.82, // Tighter guard
  rShoulderAng: 0.45,
  lElbowAng: 1.1,
  rElbowAng: -0.75,
  lHipAng: 0.42,
  rHipAng: 0.38,
  lKneeAng: 0.35, // More "ready" crouch
  rKneeAng: 0.32,
  weightLead: 0.62,
  stanceWidth: 0.55, // Wider base
  breathAmplitude: 0.022,
  guardHeight: 1.05
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
  let w = 0.18, s = 0.35, f = 0.25; // Slower default windup, more follow
  if (attackType === 0) { w = 0.12; s = 0.32; f = 0.3; } // Jab still snappy but longer follow
  else if (attackType === 1) { w = 0.16; s = 0.38; f = 0.22; }
  else if (attackType === 2) { w = 0.22; s = 0.32; f = 0.25; }
  else if (attackType === 6) { w = 0.25; s = 0.35; f = 0.2; } // Uppercut clear windup
  else if (attackType === 5) { w = 0.32; s = 0.38; f = 0.2; } // Power punch heavy windup
  return phaseNorm(poseT, sec, w, s, f);
}

export function getKickPhase(poseT, durationMs, attackType) {
  const sec = durationMs / 1000;
  let w = 0.25, s = 0.38, f = 0.25;
  if (attackType === 3) { w = 0.18; s = 0.42; f = 0.22; }
  else if (attackType === 4) { w = 0.35; s = 0.35; f = 0.2; } // High kick coil
  else if (attackType === 10) { w = 0.15; s = 0.45; f = 0.22; }
  else if (attackType === 9) { w = 0.28; s = 0.38; f = 0.22; }
  else if (attackType === 8) { w = 0.38; s = 0.32; f = 0.22; } // Spinning kick big windup
  return phaseNorm(poseT, sec, w, s, f);
}

export function getWalkCycle(phase, face, weight = 0) {
  // Phase 0-2PI
  const swing = Math.sin(phase);
  const wMult = 1 + weight * 1.5; // More weight = exaggerated movement
  const hipRot = swing * 0.38;
  const oppositeHip = Math.sin(phase + Math.PI) * 0.38;

  // Stance vs Swing logic
  const leftLegStance = Math.cos(phase) > 0;
  const rightLegStance = Math.cos(phase + Math.PI) > 0;

  const lKnee = leftLegStance ? 0.05 : 0.6 + swing * 0.2;
  const rKnee = rightLegStance ? 0.05 : 0.6 - swing * 0.2;

  return {
    lHip: hipRot,
    rHip: oppositeHip,
    lKnee: lKnee,
    rKnee: rKnee,
    lArm: -0.2 - swing * 0.5,
    rArm: -0.2 + swing * 0.5,
    lElbow: 0.4 + Math.abs(swing) * 0.3,
    rElbow: 0.4 + Math.abs(swing) * 0.3,
    bob: Math.abs(Math.sin(phase * 2)) * 3.5 * wMult,
    torsoTwist: -swing * 0.12 * face * wMult,
    lean: 0.05 * face * wMult
  };
}

export function getRunCycle(phase, face, weight = 0) {
  const wMult = 1 + weight * 1.2;
  const swing = Math.sin(phase);
  const hipRot = swing * 0.75;
  const oppositeHip = Math.sin(phase + Math.PI) * 0.75;

  const leftSwing = Math.sin(phase) > 0;
  const rightSwing = Math.sin(phase + Math.PI) > 0;

  // High knees on swing, straight on stance
  const lKnee = leftSwing ? 1.05 : 0.1;
  const rKnee = rightSwing ? 1.05 : 0.1;

  return {
    lHip: hipRot,
    rHip: oppositeHip,
    lKnee: lKnee,
    rKnee: rKnee,
    lArm: -0.4 - swing * 1.1,
    rArm: -0.4 + swing * 1.1,
    lElbow: 1.1 + Math.abs(swing) * 0.4,
    rElbow: 1.1 + Math.abs(swing) * 0.4,
    bob: Math.abs(Math.sin(phase)) * 8.5 * wMult,
    torsoTwist: -swing * 0.25 * face * wMult,
    lean: 0.18 * face * wMult
  };
}

export function punchExtension(phase, localT, face, attackType, weaponId = 'fists') {
  if (phase === WINDUP) {
    const pull = easeOutCubic(localT);
    let twist = -0.35 * face * pull;
    let lean = -0.15 * face * pull;
    let shoulder = -0.55 - pull * 0.75 * face;
    let elbow = 0.7 * pull * face;

    if (attackType === ATTACK.hook) {
      twist = -0.5 * face * pull;
      shoulder = -0.2 - pull * 0.6 * face;
      elbow = 1.0 * pull * face;
    }
    return { arm: shoulder, forearm: elbow, torsoTwist: twist, lean, headTilt: 0.08 * pull };
  }
  if (phase === STRIKE) {
    const extRaw = easeOutElastic(localT, 0.48);
    const ext = localT < 0.8 ? extRaw : 1.0 + Math.sin((localT - 0.8) * Math.PI * 5) * 0.04;

    let armAng = -Math.PI / 2 + ext * Math.PI * 1.02 * face;
    let forearmAng = ext * 0.18 * face;
    let twist = 0.55 * face * ext;
    let lean = 0.25 * face * ext;

    if (attackType === ATTACK.jab) {
      armAng = -Math.PI / 2 + ext * Math.PI * 0.82 * face;
      forearmAng = ext * 0.25 * face;
      twist = 0.3 * face * ext;
      lean = 0.15 * face * ext;
    }
    if (attackType === ATTACK.hook) {
      armAng = -Math.PI / 2 + 0.5 + ext * 1.25 * face;
      twist = 0.75 * face * ext;
      lean = 0.18 * face * ext;
      forearmAng = 0.2 * face;
    }
    if (attackType === ATTACK.uppercut) {
      armAng = -Math.PI / 2 - 0.5 + ext * 1.35 * face;
      lean = 0.42 * face * ext;
      twist = 0.35 * face * ext;
      forearmAng = -0.15 * face;
    }

    // Weapon Overrides
    if (weaponId === 'katana') {
      if (attackType === ATTACK.jab) { // Thrust
        armAng = -Math.PI / 2 + ext * Math.PI * 0.75 * face;
        forearmAng = ext * 0.1 * face;
      } else { // Slash
        armAng = -Math.PI / 2 + ext * Math.PI * 1.15 * face;
        forearmAng = 0.05 * face;
      }
    } else if (weaponId === 'staff') {
      armAng = -Math.PI / 2 + ext * Math.PI * 0.85 * face;
      forearmAng = ext * 0.25 * face;
    } else if (weaponId === 'claymore') {
      armAng = -Math.PI / 2 + ext * Math.PI * 1.35 * face;
      forearmAng = 0.15 * face;
      twist *= 1.4;
      lean *= 1.2;
    } else if (weaponId === 'daggers') {
      armAng = -Math.PI / 2 + ext * Math.PI * 0.7 * face;
      forearmAng = ext * 0.6 * face;
    }

    return { arm: armAng, forearm: forearmAng, torsoTwist: twist, lean };
  }
  if (phase === FOLLOW) {
    const hold = 1 - easeInCubic(localT) * 0.35;
    return {
      arm: -Math.PI / 2 + Math.PI * 0.95 * face * hold,
      forearm: 0.12 * face * hold,
      torsoTwist: 0.45 * face * hold,
      lean: 0.2 * face * hold
    };
  }
  const ret = easeOutCubic(localT);
  const guardElbow = -0.75;
  return {
    arm: -0.65 + ret * 0.15,
    forearm: 0.15 * (1 - ret) + guardElbow * ret,
    torsoTwist: 0.3 * face * (1 - ret),
    lean: 0.15 * face * (1 - ret)
  };
}

export function kickExtension(phase, localT, face, attackType) {
  if (phase === WINDUP) {
    const chamber = easeOutCubic(localT);
    let hip = -0.7, knee = 1.5;
    let twist = -0.3 * face * chamber;
    let lean = -0.2 * face * chamber;

    if (attackType === ATTACK.lowKick) { hip = 0.2 + chamber * 0.45; knee = 0.55 + chamber * 0.75; }
    if (attackType === ATTACK.highKick || attackType === ATTACK.axeKick) { hip = -0.55 - chamber * 0.7; knee = 1.1 + chamber * 1.1; }
    if (attackType === ATTACK.frontKick) { hip = -0.35 + chamber * 0.4; knee = 0.7 + chamber * 0.8; }
    if (attackType === ATTACK.spinningKick) { hip = chamber * 0.85; knee = 0.45 + chamber * 0.75; twist = -0.8 * face * chamber; }

    return { leadHip: hip, leadKnee: knee, supportHip: 0.28 + chamber * 0.15, supportKnee: 0.18, torsoTwist: twist, lean };
  }
  if (phase === STRIKE) {
    const extRaw = easeOutElastic(localT, 0.48);
    const ext = localT < 0.8 ? extRaw : 1.0 + Math.sin((localT - 0.8) * Math.PI * 5) * 0.04;
    let leadHip = -0.7, leadKnee = 1.5;

    if (attackType === ATTACK.lowKick) { leadHip = 0.45 + ext * 0.6 * face; leadKnee = 1.2 + ext * 0.45 * face; }
    if (attackType === ATTACK.highKick || attackType === ATTACK.axeKick) { leadHip = -1.1 - ext * 0.85 * face; leadKnee = 0.35 + ext * 1.7 * face; }
    if (attackType === ATTACK.frontKick) { leadHip = 0.25 + ext * 0.7 * face; leadKnee = 0.8 + ext * 1.0 * face; }
    if (attackType === ATTACK.spinningKick) { leadHip = 0.9 + ext * 0.95 * face; leadKnee = 0.6 + ext * 1.2 * face; }

    const twist = 0.45 * face * ext;
    const lean = -0.35 * face * ext;
    return { leadHip, leadKnee, supportHip: 0.35, supportKnee: 0.12, torsoTwist: twist, lean };
  }
  if (phase === FOLLOW) {
    const hold = 1 - localT * 0.55;
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

export function idleFromRest(poseT, rest, weaponId = 'fists') {
  const phase = (poseT * 1.2) % (2 * Math.PI);
  const breath = Math.sin(phase) * rest.breathAmplitude;
  const weight = Math.sin(phase * 0.55) * 0.04;

  let lShoulderBase = rest.lShoulderAng;
  let rShoulderBase = rest.rShoulderAng;
  let lElbowBase = rest.lElbowAng;
  let rElbowBase = rest.rElbowAng;

  // Weapon-specific idle poses
  if (weaponId === 'katana') {
    // Lead hand near hip (iaido style), back hand ready
    lShoulderBase = -0.45;
    lElbowBase = 1.1;
    rShoulderBase = 0.35;
    rElbowBase = -0.65;
  } else if (weaponId === 'staff') {
    // Relaxed vertical hold
    lShoulderBase = -0.65;
    lElbowBase = 0.6;
    rShoulderBase = 0.25;
    rElbowBase = -0.3;
  } else if (weaponId === 'claymore') {
    // Heavier, lower stance, both hands down
    lShoulderBase = -0.25;
    lElbowBase = 1.35;
    rShoulderBase = 0.1;
    rElbowBase = -1.1;
  } else if (weaponId === 'daggers') {
    // Aggressive, tight guard, hands high
    lShoulderBase = -0.95;
    lElbowBase = 1.5;
    rShoulderBase = 0.65;
    rElbowBase = -1.4;
  }

  return {
    lShoulderAng: lShoulderBase - Math.sin(phase * 0.6) * 0.06,
    rShoulderAng: rShoulderBase + Math.sin(phase * 0.6) * 0.06,
    lElbowAng: lElbowBase + Math.sin(phase * 0.8) * 0.04,
    rElbowAng: rElbowBase - Math.sin(phase * 0.8) * 0.04,
    lHipAng: rest.lHipAng + weight + Math.sin(phase * 0.5) * 0.04,
    rHipAng: rest.rHipAng - weight - Math.sin(phase * 0.5) * 0.04,
    lKneeAng: rest.lKneeAng + Math.sin(phase * 0.5) * 0.03,
    rKneeAng: rest.rKneeAng - Math.sin(phase * 0.5) * 0.03,
    bob: breath * 14,
    weightLead: rest.weightLead + weight,
    torsoTwist: Math.sin(phase * 0.4) * 0.03,
    lean: 0
  };
}

export const ATTACK = { jab: 0, cross: 1, hook: 2, lowKick: 3, highKick: 4, powerPunch: 5, uppercut: 6, grab: 7, spinningKick: 8, axeKick: 9, frontKick: 10 };
