import { POSE } from '../entities/fighter.js';
import { ARENA, RENDER, COMBAT, FIGHTER, CLONE, PHYSICS } from '../config/constants.js';
import {
  REST_STANCE,
  easeOutCubic,
  easeInOutCubic,
  easeOutBack,
  getPunchPhase,
  getKickPhase,
  punchExtension,
  kickExtension,
  idleFromRest,
  relaxedIdle,
  recoveryFromRest,
  getWalkCycle,
  getRunCycle,
  getHitReaction,
  getDodgePose,
  strikeImpactPulse,
  mergeRest,
  scaleWalkCycle,
  getProfileIdle,
  getFlyPose,
  getGrabPose,
  getAntiAirPose,
  getJumpAirPose,
  gaitPhaseSpeed,
  getRangedShootPose,
} from './fightAnimations.js';

// Tint the swipe arc + anticipation glow by attack "weight" (its base damage).
// Light/fast strikes read cool white→cyan; heavy strikes read hot orange→red.
function attackWeightTint(damage) {
  const d = damage || 5;
  const t = Math.max(0, Math.min(1, (d - 5) / 16)); // 5dmg→light … 21dmg→heavy
  // Lerp cyan-white (light) → orange-red (heavy).
  const r = Math.round(180 + t * 75);   // 180 → 255
  const g = Math.round(245 - t * 145);  // 245 → 100
  const b = Math.round(255 - t * 215);  // 255 → 40
  return { r, g, b, t };
}

// Draw a bright crescent MOTION SWIPE that traces the striking limb's recent
// path during the active window. This is the primary telegraph for an attack:
// a fading swoosh from the limb's earlier position to its current tip.
function drawAttackSwipe(ctx, tips, tint, intensity) {
  if (!tips || tips.length < 2 || intensity <= 0) return;
  const { r, g, b } = tint;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Layered strokes: a wide soft glow underneath, a bright thin core on top.
  const layers = [
    { w: 22, a: 0.18 },
    { w: 12, a: 0.30 },
    { w: 4.5, a: 0.85 }
  ];

  for (const layer of layers) {
    ctx.beginPath();
    for (let i = 0; i < tips.length; i++) {
      const p = tips[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    // Width tapers along the trail via the stroke alpha gradient feel; we keep a
    // single width per layer but fade the whole swipe by `intensity` (drops to 0
    // outside the active window) so it appears on the hit and vanishes fast.
    const newest = tips[tips.length - 1];
    const oldest = tips[0];
    const grad = ctx.createLinearGradient(oldest.x, oldest.y, newest.x, newest.y);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${layer.a * intensity})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = layer.w;
    ctx.stroke();
  }

  // A bright leading "spark" at the current limb tip to punctuate the strike.
  const tip = tips[tips.length - 1];
  const sparkR = 7 + 5 * intensity;
  const sg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, sparkR);
  sg.addColorStop(0, `rgba(255,255,255,${0.9 * intensity})`);
  sg.addColorStop(0.5, `rgba(${r},${g},${b},${0.5 * intensity})`);
  sg.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, sparkR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawDecals(ctx, decals, now) {
  decals.forEach(d => {
    const life = (now - (d.createdAt || now)) / 1000;
    if (life > d.maxLife) return;
    const a = Math.max(0, 1 - life / d.maxLife);
    ctx.globalAlpha = a * 0.6;

    if (d.type === 'scorch') {
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 60 * d.size);
      g.addColorStop(0, 'rgba(20, 10, 0, 0.8)');
      g.addColorStop(0.5, 'rgba(40, 20, 0, 0.4)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 60 * d.size, 15 * d.size, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.type === 'frost') {
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 50 * d.size);
      g.addColorStop(0, 'rgba(180, 230, 255, 0.5)');
      g.addColorStop(0.7, 'rgba(100, 180, 255, 0.25)');
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 50 * d.size, 12 * d.size, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
}

export function drawHitVignette(ctx, width, height, intensity) {
  if (intensity <= 0) return;
  const g = ctx.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, width * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${intensity * 0.6})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function darken(c, pct) {
  const m = c.match(/\w\w/g);
  if (!m) return c;
  return '#' + m.map(x => Math.max(0, Math.min(255, parseInt(x, 16) * (1 - pct))).toString(16).padStart(2, '0')).join('');
}

function drawAdvancedLimb(ctx, x1, y1, x2, y2, r1, r2, fillColor, strokeColor, bulge = 0, stretch = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 0.001;
  const ux = dx / len;
  const uy = dy / len;

  // Apply stretch along the bone axis
  const sx2 = x2 + ux * stretch;
  const sy2 = y2 + uy * stretch;

  // Tapering and muscular "bulge"
  const midX = (x1 + sx2) / 2;
  const midY = (y1 + sy2) / 2;
  const midR = Math.max(r1, r2) * (1.15 + bulge * 0.4); // Bulge effect

  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(x1 - uy * r1, y1 + ux * r1);
  ctx.quadraticCurveTo(midX - uy * midR, midY + ux * midR, sx2 - uy * r2, sy2 + ux * r2);
  ctx.arc(sx2, sy2, r2, Math.atan2(uy, ux) - Math.PI / 2, Math.atan2(uy, ux) + Math.PI / 2);
  ctx.quadraticCurveTo(midX + uy * midR, midY - ux * midR, x1 + uy * r1, y1 - ux * r1);
  ctx.arc(x1, y1, r1, Math.atan2(uy, ux) + Math.PI / 2, Math.atan2(uy, ux) - Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  // Highlight for 3D feel
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1 - uy * (r1 * 0.4), y1 + ux * (r1 * 0.4));
  ctx.quadraticCurveTo(midX - uy * (midR * 0.4), midY + ux * (midR * 0.4), sx2 - uy * (r2 * 0.4), sy2 + ux * (r2 * 0.4));
  ctx.stroke();

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawLimb(ctx, x1, y1, x2, y2, r1, r2, fillColor, strokeColor) {
  drawAdvancedLimb(ctx, x1, y1, x2, y2, r1, r2, fillColor, strokeColor);
}

function drawTaperedLimb(ctx, x1, y1, x2, y2, r1, r2) {
  drawAdvancedLimb(ctx, x1, y1, x2, y2, r1, r2, ctx.fillStyle || '#888', ctx.strokeStyle || '#666');
}

export function drawStickman(ctx, fighter, groundY, now) {
  const x = fighter.x;
  const flash = (fighter.hitFlashUntil || 0) > now;
  const baseColor = flash ? '#fff' : fighter.color;
  const strokeColor = flash ? '#fff' : darken(baseColor, 0.35);
  const shadowColor = flash ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)';

  const face = fighter.facing || 1;
  const pose = fighter.pose;
  const scale = fighter.scale || 1;
  const lite = !!fighter.tdCreep;

  ctx.save();
  // Global Scale for Bosses
  if (scale !== 1) {
    const cy = groundY + fighter.y;
    ctx.translate(fighter.x, cy);
    ctx.scale(scale, scale);
    ctx.translate(-fighter.x, -cy);
  }

  // 0. Premium Visual Overlays
  if (!lite) {
  // Spectral / After-image Trails
  if (fighter.status.active('invincible', now)) {
    const hist = fighter.poseHistory || [];
    const dir = fighter.dodgeDir || fighter.facing || 1;
    const cy = groundY + fighter.y - 45;
    // 1. Motion-blur ghost streaks — the fighter's OWN colour with a hot white
    // core, stretched along the travel axis so the evade reads as a fast slip.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    hist.forEach((p, idx) => {
      if (idx % 2 !== 0 || idx > 12) return;
      const f = 1 - idx / 13;
      const alpha = 0.5 * f;
      if (alpha <= 0.04) return;
      const gy = groundY + p.y - 45;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fighter.color;
      ctx.beginPath();
      ctx.ellipse(p.x, gy, 26 * (0.6 + f * 0.6), 30, 0, 0, Math.PI * 2); // stretched along X
      ctx.fill();
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = '#ffffff';                                          // hot core
      ctx.beginPath();
      ctx.ellipse(p.x, gy, 11 * f, 16 * f, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    // 2. Sharp speed lines trailing behind the slip — sells the "whoosh".
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = fighter.color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      const ly = cy + i * 13;
      ctx.beginPath();
      ctx.moveTo(fighter.x - dir * 10, ly);
      ctx.lineTo(fighter.x - dir * (46 + Math.abs(i) * 8), ly);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Combat Aura
  if (fighter.stamina > fighter.maxStamina * 0.85) {
    ctx.save();
    const auraAlpha = 0.05 + Math.sin(now * 0.01) * 0.03;
    ctx.shadowBlur = 15;
    ctx.shadowColor = fighter.color;
    ctx.globalAlpha = auraAlpha;
    ctx.fillStyle = fighter.color;
    ctx.beginPath();
    ctx.arc(fighter.x, groundY + fighter.y - 45, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Burning Status Overlay
  if (fighter.status.active('burning', now)) {
    ctx.save();
    const fireAlpha = 0.25 + Math.sin(now * 0.015) * 0.1;
    ctx.globalAlpha = fireAlpha;
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff4500';
    ctx.fillStyle = '#ff8c00';
    const rays = 4;
    for (let i = 0; i < rays; i++) {
      const shift = Math.sin(now * 0.005 + i) * 6;
      ctx.beginPath();
      ctx.arc(fighter.x + shift, groundY + fighter.y - 45 + (i * -12), 16 - i * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Frozen Status Overlay
  const isDeepFrozen = fighter.status.active('deepFreeze', now);
  if (isDeepFrozen || fighter.status.active('frozen', now)) {
    ctx.save();
    ctx.globalAlpha = isDeepFrozen ? 0.45 : 0.25;
    ctx.shadowBlur = isDeepFrozen ? 25 : 15;
    ctx.shadowColor = isDeepFrozen ? '#8be9fd' : '#00ffff';
    ctx.fillStyle = isDeepFrozen ? '#8be9fd' : '#b0e0e6';
    ctx.beginPath();
    ctx.arc(fighter.x, groundY + fighter.y - 45, isDeepFrozen ? 42 : 36, 0, Math.PI * 2);
    ctx.fill();

    if (isDeepFrozen) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Anchored Status Overlay (Heavy feet)
  if (fighter.status.active('anchored', now)) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(now * 0.01) * 0.2;
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath();
    ctx.ellipse(fighter.x, groundY + fighter.y - 5, 40, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Phased Status Overlay (Cyan Ghost Trails)
  if (fighter.status.active('phased', now)) {
    const history = fighter.poseHistory || [];
    history.slice(0, 8).forEach((p, idx) => {
      if (idx % 2 !== 0) return;
      const alpha = 0.3 * (1 - idx / 12);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#8be9fd';
      ctx.beginPath();
      ctx.arc(p.x, groundY + p.y - 45, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // Shocked Status Overlay (Electric Arcs)
  if (fighter.status.active('shocked', now)) {
    ctx.save();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 1.5;
    const arcCount = 3;
    for (let i = 0; i < arcCount; i++) {
      const t = now * 0.02 + i;
      if (Math.sin(t * 15) > 0.7) { // Flickering intensity
        const ox = (Math.random() - 0.5) * 35;
        const oy = (Math.random() - 0.5) * 70;
        ctx.beginPath();
        ctx.moveTo(fighter.x + ox, groundY + fighter.y - 45 + oy);
        ctx.lineTo(fighter.x + ox + (Math.random() - 0.5) * 25, groundY + fighter.y - 45 + oy + (Math.random() - 0.5) * 25);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  }

  const prof = fighter.animProfile;
  const poseT = fighter.poseTime || 0;
  const atkPoseT = poseT * (prof?.attack?.speed ?? 1);
  const rest = mergeRest(REST_STANCE, prof?.rest);
  const atkMul = prof?.attack?.mult ?? 1;
  const limbScale = prof?.limb ?? 1;

  // 1. Calculate Core Joints (Dual-Bone Torso)
  let pelvisX = x;
  let pelvisY = groundY - 54 + (fighter.y || 0);

  // Procedural Lean & Weight
  const velX = fighter.vx || 0;
  let lean = (rest.torsoLean || 0) * face + (velX / 1000) * 0.2; // Lean into velocity
  lean += (fighter.momentumAtAttackStart || 0) * 0.15; // Bracing for impact

  let bob = Math.abs(Math.sin(now / 150)) * (Math.abs(velX) / 400) * 4;
  let torsoTwist = (rest.torsoTwist || 0) * face + (velX / 1000) * 0.16;
  let headTilt = rest.headTilt || 0;
  headTilt += lean * 0.5; // Look where you're leaning

  const slideT = easeOutCubic(Math.min(1, poseT * 5));
  const hitT = easeOutCubic(Math.min(1, poseT * 7));
  const blockT = easeOutCubic(Math.min(1, poseT * 8));

  // 2. Initialize Limb Variables from Rest Stance
  let lArmAng = rest.lShoulderAng || 0.4;
  let rArmAng = rest.rShoulderAng || -0.4;
  let lForeArmAng = rest.lElbowAng || 0.6;
  let rForeArmAng = rest.rElbowAng || -0.6;
  let lLegAng = rest.lHipAng || 0.2;
  let rLegAng = rest.rHipAng || -0.2;
  let lKneeOff = rest.lKneeAng || 0;
  let rKneeOff = rest.rKneeAng || 0;
  let lFootAng = rest.lFootAng || 0;
  let rFootAng = rest.rFootAng || 0;

  // Basic Animation Logic
  // Flying units — hover / cruise / air-shot / air-hit (never ground stomp poses).
  if (fighter.flying && pose !== POSE.stagger) {
    const shooting = pose === POSE.punch || (fighter._flyShootT || 0) > 0;
    let f = getFlyPose(poseT, face, prof, velX, shooting && pose !== POSE.hit);
    if (pose === POSE.hit) {
      const hit = getHitReaction(poseT, fighter.hitLastDmg, face, fighter.hitFromX, fighter.x);
      f = {
        ...f,
        lean: f.lean + hit.lean * 0.55,
        torsoTwist: f.torsoTwist + hit.torsoTwist * 0.5,
        headTilt: (f.headTilt ?? 0) + hit.headTilt * 0.5,
        bob: f.bob + hit.bob * 0.3,
      };
    }
    lean = f.lean; torsoTwist = f.torsoTwist; headTilt = f.headTilt ?? headTilt; bob = f.bob;
    lArmAng = f.lArmAng; rArmAng = f.rArmAng; lForeArmAng = f.lForeArmAng; rForeArmAng = f.rForeArmAng;
    lLegAng = f.lLegAng; rLegAng = f.rLegAng; lKneeOff = f.lKneeOff; rKneeOff = f.rKneeOff;
    lFootAng = f.lFootAng; rFootAng = f.rFootAng;
  } else if (pose === POSE.walk || pose === POSE.run) {
    const isRun = pose === POSE.run;
    const cycleSpeed = gaitPhaseSpeed(velX, fighter.moveSpeed, fighter.scale, isRun, prof?.walk?.cycleMul ?? 1);
    const phase = (poseT * cycleSpeed) % (2 * Math.PI);
    let cycle = isRun ? getRunCycle(phase, face) : getWalkCycle(phase, face);
    cycle = scaleWalkCycle(cycle, prof?.walk);

    bob = cycle.bob;
    lean = cycle.lean + (velX / Math.max(40, fighter.moveSpeed || 200)) * 0.08 * face;
    torsoTwist = cycle.torsoTwist;
    headTilt = cycle.headTilt ?? headTilt;
    lArmAng = cycle.lArm;
    rArmAng = cycle.rArm;
    lForeArmAng = cycle.lElbow;
    rForeArmAng = cycle.rElbow;
    lLegAng = cycle.lHip;
    rLegAng = cycle.rHip;
    lKneeOff = cycle.lKnee;
    rKneeOff = cycle.rKnee;
    lFootAng = cycle.lFoot ?? lFootAng;
    rFootAng = cycle.rFoot ?? rFootAng;
  } else if (pose === POSE.punch && fighter.ranged && !fighter.currentAttack) {
    const shot = getRangedShootPose(poseT, face, rest, fighter.flying);
    bob = shot.bob;
    lean = shot.lean;
    torsoTwist = shot.torsoTwist;
    headTilt = shot.headTilt ?? headTilt;
    lArmAng = shot.lShoulderAng;
    rArmAng = shot.rShoulderAng;
    lForeArmAng = shot.lElbowAng;
    rForeArmAng = shot.rElbowAng;
    lLegAng = shot.lHipAng;
    rLegAng = shot.rHipAng;
    lKneeOff = shot.lKneeAng;
    rKneeOff = shot.rKneeAng;
    lFootAng = shot.lFootAng ?? lFootAng;
    rFootAng = shot.rFootAng ?? rFootAng;
  } else if (pose === POSE.idle) {
    const idle = getProfileIdle(prof?.idleKind, poseT, rest, fighter.traits?.chill, prof?.air);
    bob = idle.bob;
    torsoTwist = idle.torsoTwist * face;
    lean = idle.lean + (rest.torsoLean || 0) * face;
    if (idle.headTilt != null) headTilt = idle.headTilt * face;
    lArmAng = idle.lShoulderAng;
    rArmAng = idle.rShoulderAng;
    lForeArmAng = idle.lElbowAng;
    rForeArmAng = idle.rElbowAng;
    lLegAng = idle.lHipAng;
    rLegAng = idle.rHipAng;
    lKneeOff = idle.lKneeAng;
    rKneeOff = idle.rKneeAng;
    lFootAng = idle.lFootAng ?? lFootAng;
    rFootAng = idle.rFootAng ?? rFootAng;
  } else if (pose === POSE.grab) {
    const throwing = !!(fighter._grabbing && poseT > 0.28);
    const g = getGrabPose(poseT, face, throwing);
    lean = g.lean; torsoTwist = g.torsoTwist; headTilt = g.headTilt ?? headTilt; bob = g.bob;
    lArmAng = g.lArmAng; rArmAng = g.rArmAng; lForeArmAng = g.lForeArmAng; rForeArmAng = g.rForeArmAng;
    lLegAng = g.lLegAng; rLegAng = g.rLegAng; lKneeOff = g.lKneeOff; rKneeOff = g.rKneeOff;
    lFootAng = g.lFootAng; rFootAng = g.rFootAng;
  } else if (pose === POSE.jump || pose === POSE.air) {
    const j = (fighter._antiAirUntil || 0) > now
      ? getAntiAirPose(poseT, face)
      : getJumpAirPose(poseT, pose, face, prof);
    lean = j.lean; torsoTwist = j.torsoTwist; headTilt = j.headTilt ?? headTilt; bob = j.bob;
    lArmAng = j.lArmAng; rArmAng = j.rArmAng; lForeArmAng = j.lForeArmAng; rForeArmAng = j.rForeArmAng;
    lLegAng = j.lLegAng; rLegAng = j.rLegAng; lKneeOff = j.lKneeOff; rKneeOff = j.rKneeOff;
    lFootAng = j.lFootAng; rFootAng = j.rFootAng;
  } else if (pose === POSE.recover) {
    const recovery = recoveryFromRest(poseT, rest);
    bob = recovery.bob;
    torsoTwist = recovery.torsoTwist * face;
    lean = recovery.lean * face;
    headTilt = recovery.headTilt * face;
    lArmAng = recovery.lShoulderAng;
    rArmAng = recovery.rShoulderAng;
    lForeArmAng = recovery.lElbowAng;
    rForeArmAng = recovery.rElbowAng;
    lLegAng = recovery.lHipAng;
    rLegAng = recovery.rHipAng;
    lKneeOff = recovery.lKneeAng;
    rKneeOff = recovery.rKneeAng;
    lFootAng = recovery.lFootAng;
    rFootAng = recovery.rFootAng;
  } else if (pose === POSE.slide) {
    pelvisX = x + face * slideT * 22;
    lean = face * slideT * 0.28;
    bob = -15 * slideT;
    lLegAng = 1.2 * slideT;
    rLegAng = -0.4 * slideT;
    lKneeOff = 1.4 * slideT;
  } else if (pose === POSE.dodge) {
    // Expressive EVADE: a committed lateral weave (see getDodgePose).
    const dir = fighter.dodgeDir || face;
    const elapsed = now - (fighter.dodgeStartAt ?? now);
    const dodge = getDodgePose(elapsed, PHYSICS.DODGE_DURATION_MS ?? 190, dir, face);
    lean = dodge.lean;
    torsoTwist = dodge.torsoTwist;
    headTilt = dodge.headTilt;
    bob = dodge.bob;
    pelvisX += dodge.pelvisShift;
    lArmAng = dodge.lArm;
    rArmAng = dodge.rArm;
    lForeArmAng = dodge.lElbow;
    rForeArmAng = dodge.rElbow;
    lLegAng = dodge.lHip;
    rLegAng = dodge.rHip;
    lKneeOff = dodge.lKnee;
    rKneeOff = dodge.rKnee;
    lFootAng = dodge.lFoot;
    rFootAng = dodge.rFoot;
  } else if (pose === POSE.hit) {
    const hit = getHitReaction(poseT, fighter.hitLastDmg, face, fighter.hitFromX, fighter.x);
    lean = hit.lean;
    torsoTwist = hit.torsoTwist;
    headTilt = hit.headTilt;
    bob = hit.bob;
    lArmAng = hit.lArm;
    rArmAng = hit.rArm;
    lForeArmAng = hit.lElbow;
    rForeArmAng = hit.rElbow;
    lLegAng = hit.lHip;
    rLegAng = hit.rHip;
    lKneeOff = hit.lKnee;
    rKneeOff = hit.rKnee;
    lFootAng = hit.lFoot;
    rFootAng = hit.rFoot;
  } else if (pose === POSE.block) {
    // Two readable defensive shapes: HIGH guard (arms up & forward, covering the
    // head) vs LOW block / crouch (compact, lowered, arms down across the body).
    const isLow = fighter.status?.active?.('blockLow', now);
    if (isLow) {
      // Deep crouch (horse stance): sink the centre of mass hard, splay the legs
      // wide and fold the knees so the head drops ~40px and it clearly reads as
      // ducking UNDER a high attack — the feet stay planted on the ground.
      lean = face * 0.22 * blockT;
      bob = -40 * blockT;                  // sink the pelvis low
      lLegAng = 0.68 * blockT;             // wide leg splay
      rLegAng = -0.68 * blockT;
      lKneeOff = 0.36 + 1.06 * blockT;     // deep knee fold to keep feet grounded
      rKneeOff = 0.30 + 1.02 * blockT;
      // Forearms tucked low across the body to guard, head ducked down-forward.
      lArmAng = -0.2 + blockT * 0.5;
      rArmAng = -0.2 + blockT * 0.5;
      lForeArmAng = -0.65 * blockT;
      rForeArmAng = -0.85 * blockT;
      headTilt = face * 0.18 * blockT;
    } else {
      // High guard: both fists driven UP and slightly FORWARD to cover the face,
      // shoulders raised, weight rocked back — a clear "I'm defending" silhouette.
      lean = -face * 0.14 * blockT;
      bob = 5 * blockT;
      const armUp = blockT * 1.35;
      lArmAng = -Math.PI / 2 - armUp;
      rArmAng = -Math.PI / 2 - armUp;
      // Forearms cross slightly forward of the face rather than straight up.
      lForeArmAng = 1.0 + face * 0.15;
      rForeArmAng = 0.7 + face * 0.15;
      headTilt = -face * 0.06 * blockT;   // chin tucked behind the guard
    }
  }

  // Calculate Limb Bulge & Stretch — and gather the attack-phase context the
  // swipe / anticipation / impact accents below all share.
  let limbBulge = 0;
  let limbStretch = 0;
  // Accent state used after the body is positioned.
  let attackCtx = null;        // { phase, localT, isPunch, weapon, tint, active }
  let anticipationGlow = 0;    // 0..1 windup chamber-glow strength
  if (fighter.currentAttack) {
    const isPunch = pose === POSE.punch;
    const isKick = pose === POSE.kick;
    const a = fighter.currentAttack;
    const { phase, localT } = isPunch ? getPunchPhase(atkPoseT, a.data.duration, a.type) : getKickPhase(atkPoseT, a.data.duration, a.type);

    const WINDUP = 0, STRIKE = 1;
    if (phase === STRIKE) {
      const snap = Math.sin(localT * Math.PI);
      limbBulge = 0.52 * snap * atkMul;
      limbStretch = 12 * snap * (prof?.attack?.stretch ?? atkMul);
      // Extra IMPACT stretch spike right on the contact frame (~50%) — harder hit.
      limbStretch += 10 * strikeImpactPulse(localT);
    }

    // ANTICIPATION: faint chamber-glow that builds through the windup so the
    // wind-up is visible just before the hand/foot fires.
    if (phase === WINDUP) anticipationGlow = Math.sin(localT * Math.PI * 0.5);

    // Active window for the swipe is 30%–75% of the whole attack (matches the
    // melee hitbox). Compute a global progress fraction to gate it.
    const progress = atkPoseT / (a.data.duration / 1000);
    const inActive = progress >= 0.3 && progress <= 0.75;
    // Fade the swipe in/out smoothly at the window edges so it never pops.
    const edge = Math.min(1, (progress - 0.3) / 0.12, (0.75 - progress) / 0.12);
    attackCtx = {
      phase, localT, progress, isPunch,
      tint: attackWeightTint(a.data.damage),
      swipeIntensity: inActive ? Math.max(0, edge) : 0
    };
  }

  // Combat Override
  if (pose === POSE.punch && fighter.currentAttack) {
    const a = fighter.currentAttack;
    const { phase, localT } = getPunchPhase(atkPoseT, a.data.duration, a.type);
    const ext = punchExtension(phase, localT, face, a.type);
    lean = ext.lean;
    torsoTwist = ext.torsoTwist;
    headTilt = ext.headTilt ?? headTilt;
    rArmAng = ext.leadArm;
    rForeArmAng = ext.leadForearm;
    lArmAng = ext.rearArm;
    lForeArmAng = ext.rearForearm;
    rLegAng = ext.leadHip ?? rLegAng;
    rKneeOff = ext.leadKnee ?? rKneeOff;
    lLegAng = ext.rearHip ?? lLegAng;
    lKneeOff = ext.rearKnee ?? lKneeOff;
    rFootAng = ext.leadFoot ?? rFootAng;
    lFootAng = ext.rearFoot ?? lFootAng;
    pelvisX += ext.pelvisShift || 0;
    bob += ext.bodyLift || 0;
    if (atkMul !== 1) { pelvisX += face * (atkMul - 1) * 6; limbBulge *= atkMul; }
  } else if (pose === POSE.kick && fighter.currentAttack) {
    const a = fighter.currentAttack;
    const { phase, localT } = getKickPhase(atkPoseT, a.data.duration, a.type);
    const ext = kickExtension(phase, localT, face, a.type);
    lean = ext.lean;
    torsoTwist = ext.torsoTwist;
    if (face === 1) {
      rLegAng = ext.leadHip; rKneeOff = 0.18 + (ext.leadKnee - 0.5) * 0.43;
      lLegAng = ext.supportHip; lKneeOff = ext.supportKnee || 0.18;
    } else {
      lLegAng = ext.leadHip; lKneeOff = 0.18 + (ext.leadKnee - 0.5) * 0.43;
      rLegAng = ext.supportHip; rKneeOff = ext.supportKnee || 0.18;
    }
    if (atkMul !== 1) limbBulge *= atkMul;
  }

  // SQUASH & STRETCH
  const landingT = (fighter.landingSquashUntil || 0) > now ? 1 - (fighter.landingSquashUntil - now) / 180 : 0;
  let squashY = 1.0;
  let stretchX = 1.0;

  // 1. Landing Squash
  if (landingT > 0 && pose !== POSE.hit) {
    squashY = 1 - 0.28 * Math.sin(landingT * Math.PI);
    stretchX = 1 + 0.15 * Math.sin(landingT * Math.PI);
  }

  // 2. Combat Elasticity
  if (fighter.currentAttack) {
    const isPunch = pose === POSE.punch;
    const isKick = pose === POSE.kick;
    if (isPunch || isKick) {
      const a = fighter.currentAttack;
      const { phase, localT } = isPunch ? getPunchPhase(atkPoseT, a.data.duration, a.type) : getKickPhase(atkPoseT, a.data.duration, a.type);

      const WINDUP = 0, STRIKE = 1;
      if (phase === WINDUP) {
        // Coil/Squash before strike
        const coil = Math.sin(localT * Math.PI * 0.5);
        squashY -= 0.12 * coil;
        stretchX += 0.08 * coil;
      } else if (phase === STRIKE) {
        // Stretch out during hit
        const snap = Math.sin(localT * Math.PI);
        squashY += 0.05 * snap;
        stretchX += 0.15 * snap;
        pelvisX += face * snap * 8; // Extra reach/lean
        // IMPACT emphasis: a brief forward lunge spike on the contact frame so
        // the exact moment of the hit reads as a committed push.
        pelvisX += face * strikeImpactPulse(localT) * 7;
      }
    }
  }

  // 3. Impact Reaction
  if (pose === POSE.hit) {
    const impact = Math.min(1.5, ((fighter.hitLastDmg || 5) / 15));
    squashY += 0.15 * impact * Math.sin(hitT * Math.PI);
    stretchX -= 0.1 * impact * Math.sin(hitT * Math.PI);
  }

  pelvisY -= fighter.flying ? Math.sin((poseT || 0) * 3.2) * 6 : bob;

  // Dual Bone Positioning
  const spineLen = 42 * squashY;
  const ribsX = pelvisX + (lean * 24 + torsoTwist * 10) * stretchX;
  const ribsY = pelvisY - spineLen;
  const headX = ribsX + (lean * 12 + headTilt * 6) * stretchX;
  const headY = ribsY - 18 * squashY;

  // 2. Render Motion Effects (Smeared Shadows & Trails)
  if (!lite && Math.abs(fighter.vx) > 400) {
    ctx.save();
    const smearCount = 8;
    fighter.poseHistory.forEach((h, i) => {
      if (i % 2 !== 0 || i >= smearCount) return;
      const alpha = 0.12 * (1 - i / smearCount);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fighter.color;

      const nextH = fighter.poseHistory[i + 1] || h;
      // Draw dynamic shadow smear
      ctx.beginPath();
      ctx.ellipse(h.x, groundY, 20 * (1 - i / smearCount), 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Draw body smear
      ctx.globalAlpha = alpha * 0.5;
      drawCapsule(ctx, h.x, groundY - 45, nextH.x, groundY - 45, 16 * (1 - i / smearCount), fighter.color, fighter.color);
    });
    ctx.restore();
  }

  if (!lite && fighter.attackTrail?.length > 2) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.strokeStyle = fighter.color;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    fighter.attackTrail.forEach((p, i) => {
      const alpha = 0.25 * (1 - i / fighter.attackTrail.length);
      ctx.strokeStyle = hexToRgba(fighter.color, alpha);
      if (i === 0) ctx.moveTo(p.x, groundY - 50);
      else ctx.lineTo(p.x, groundY - 50);
    });
    ctx.stroke();
    ctx.restore();
  }

  // ── CAPE (caped style) — flows behind the body and billows with motion/lean ──
  if (fighter.style === 'caped') {
    const capeColor = fighter.capeColor || '#e23b3b';
    const neckX = ribsX - face * 3;
    const neckY = ribsY - 1;
    const vx = fighter.vx || 0;
    // Trails opposite to facing; billows out harder when moving or leaning.
    const billow = -face * (12 + Math.min(46, Math.abs(vx) * 0.07)) - lean * 16 * face;
    const flutter = Math.sin(now * 0.006 + fighter.id) * 5;
    const len = 54;
    ctx.save();
    ctx.fillStyle = capeColor;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(neckX - 11 * face, neckY);
    ctx.quadraticCurveTo(neckX + billow * 0.5 - 16 * face, neckY + len * 0.55, neckX + billow - 18 * face, neckY + len + flutter);
    ctx.quadraticCurveTo(neckX + billow * 0.85, neckY + len * 0.92 + flutter * 0.6, neckX + billow * 0.7 + 18 * face, neckY + len - flutter);
    ctx.quadraticCurveTo(neckX + billow * 0.4 + 16 * face, neckY + len * 0.5, neckX + 11 * face, neckY);
    ctx.closePath();
    ctx.fill();
    // Inner shade for depth.
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }

  // 3. Render Fighter Body
  ctx.lineCap = 'round';
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = lite ? 0 : 6;
  ctx.shadowOffsetY = lite ? 0 : 3;

  // Legs
  const thighLen = 30 * limbScale, calfLen = 26 * limbScale;
  const lHipX = pelvisX - 7 * face, rHipX = pelvisX + 7 * face;
  const lKneeX = lHipX + Math.sin(lLegAng) * thighLen * face;
  const lKneeY = pelvisY + Math.cos(lLegAng) * thighLen;
  const rKneeX = rHipX + Math.sin(rLegAng) * thighLen * face;
  const rKneeY = pelvisY + Math.cos(rLegAng) * thighLen;

  const lAnkleX = lKneeX + Math.sin(lLegAng + lKneeOff) * calfLen * face;
  const lAnkleY = lKneeY + Math.cos(lLegAng + lKneeOff) * calfLen;
  const rAnkleX = rKneeX + Math.sin(rLegAng + rKneeOff) * calfLen * face;
  const rAnkleY = rKneeY + Math.cos(rLegAng + rKneeOff) * calfLen;

  drawAdvancedLimb(ctx, lHipX, pelvisY, lKneeX, lKneeY, 6 * limbScale, 5 * limbScale, baseColor, strokeColor, limbBulge * 0.5, limbStretch * 0.3);
  drawAdvancedLimb(ctx, lKneeX, lKneeY, lAnkleX, lAnkleY, 5 * limbScale, 4 * limbScale, baseColor, strokeColor, limbBulge, limbStretch);
  drawAdvancedLimb(ctx, rHipX, pelvisY, rKneeX, rKneeY, 6 * limbScale, 5 * limbScale, baseColor, strokeColor, limbBulge * 0.5, limbStretch * 0.3);
  drawAdvancedLimb(ctx, rKneeX, rKneeY, rAnkleX, rAnkleY, 5 * limbScale, 4 * limbScale, baseColor, strokeColor, limbBulge, limbStretch);

  // Feet
  const footLen = 14;
  const lToeX = lAnkleX + Math.cos(lFootAng) * footLen * face;
  const lToeY = lAnkleY + Math.sin(lFootAng) * footLen;
  const rToeX = rAnkleX + Math.cos(rFootAng) * footLen * face;
  const rToeY = rAnkleY + Math.sin(rFootAng) * footLen;
  drawAdvancedLimb(ctx, lAnkleX, lAnkleY, lToeX, lToeY, 4, 3, baseColor, strokeColor);
  drawAdvancedLimb(ctx, rAnkleX, rAnkleY, rToeX, rToeY, 4, 3, baseColor, strokeColor);

  // Torso
  drawCapsule(ctx, pelvisX, pelvisY, ribsX, ribsY, 11, baseColor, strokeColor);


  // Shoulders & Arms
  const shoulderW = 28;
  const twistOff = torsoTwist * 7;
  const lShX = ribsX - (shoulderW / 2) * face - twistOff;
  const rShX = ribsX + (shoulderW / 2) * face + twistOff;
  const lShY = ribsY + 5;
  const rShY = ribsY + 5;

  const armLen = 28, forearmLen = 24;
  const lElbowX = lShX + Math.cos(lArmAng) * armLen * face;
  const lElbowY = lShY + Math.sin(lArmAng) * armLen;
  const rElbowX = rShX + Math.cos(rArmAng) * armLen * face;
  const rElbowY = rShY + Math.sin(rArmAng) * armLen;

  const lWristX = lElbowX + Math.cos(lArmAng + lForeArmAng) * forearmLen * face;
  const lWristY = lElbowY + Math.sin(lArmAng + lForeArmAng) * forearmLen;
  const rWristX = rElbowX + Math.cos(rArmAng + rForeArmAng) * forearmLen * face;
  const rWristY = rElbowY + Math.sin(rArmAng + rForeArmAng) * forearmLen;

  drawAdvancedLimb(ctx, lShX, lShY, lElbowX, lElbowY, 5, 4.2, baseColor, strokeColor, limbBulge * 0.5, limbStretch * 0.4);
  drawAdvancedLimb(ctx, lElbowX, lElbowY, lWristX, lWristY, 4.2, 3.5, baseColor, strokeColor, limbBulge, limbStretch);
  drawAdvancedLimb(ctx, rShX, rShY, rElbowX, rElbowY, 5, 4.2, baseColor, strokeColor, limbBulge * 0.5, limbStretch * 0.4);
  drawAdvancedLimb(ctx, rElbowX, rElbowY, rWristX, rWristY, 4.2, 3.5, baseColor, strokeColor, limbBulge, limbStretch);

  // ── MOTION SWIPE ARC + ANTICIPATION GLOW ──────────────────────────────────
  // Telegraph the strike: trace the striking limb's tip path with a bright
  // crescent during the active window, and show a faint chamber-glow on windup.
  if (attackCtx && !lite) {
    // Pick the striking weapon tip. Punches drive the LEAD hand (rendered as the
    // right arm wrist); kicks drive the LEAD foot's toe (side depends on facing).
    let tipX, tipY;
    if (attackCtx.isPunch) {
      tipX = rWristX; tipY = rWristY;
    } else if (face === 1) {
      tipX = rToeX; tipY = rToeY;
    } else {
      tipX = lToeX; tipY = lToeY;
    }

    // Per-fighter ring buffer of recent tip positions (world space) for the arc.
    if (!fighter._swipeTips) fighter._swipeTips = [];
    const tips = fighter._swipeTips;

    if (attackCtx.swipeIntensity > 0) {
      // Record the current tip while the strike is active.
      tips.push({ x: tipX, y: tipY });
      if (tips.length > 7) tips.shift();
      drawAttackSwipe(ctx, tips, attackCtx.tint, attackCtx.swipeIntensity);
    } else {
      // Outside the active window: let the trail decay so it's fresh next strike.
      if (tips.length) tips.length = 0;
    }

    // ANTICIPATION chamber-glow: a soft pulse at the striking hand/foot as it
    // loads, hinting where the strike will come from before it fires.
    if (anticipationGlow > 0.02) {
      const { r, g, b } = attackCtx.tint;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gr = 10 + 8 * anticipationGlow;
      const gg = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, gr);
      gg.addColorStop(0, `rgba(${r},${g},${b},${0.35 * anticipationGlow})`);
      gg.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(tipX, tipY, gr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (fighter._swipeTips && fighter._swipeTips.length) {
    fighter._swipeTips.length = 0; // not attacking → clear stale tips
  }

  // Head
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.arc(headX, headY, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  const vX = headX + face * 6;
  const vY = headY - 2;
  if (fighter.style === 'caped') {
    // Bald, bored face: no visor — two small flat eyes and an unimpressed mouth.
    // Reads as the deadpan "this is boring" expression of the archetype.
    ctx.fillStyle = '#101012';
    ctx.beginPath(); ctx.arc(headX + face * 3, vY - 1, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(headX + face * 8, vY - 1, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#101012';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(headX + face * 3, vY + 5);
    ctx.lineTo(headX + face * 8, vY + 5); // flat, deadpan mouth
    ctx.stroke();
  } else {
    // Visor
    ctx.fillStyle = "#0c0c0c";
    ctx.beginPath();
    ctx.ellipse(vX, vY, 7, 3.5, headTilt, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fighter.color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(vX + face * 2, vY, 2.5, 1.2, headTilt, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (fighter.tdCreep && fighter.emotion && fighter.emotion !== 'neutral' && fighter.emotion !== 'dead') {
    const em = fighter.emotion;
    ctx.save();
    ctx.strokeStyle = '#101012';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    if (em === 'scared' || em === 'worried') {
      ctx.beginPath();
      ctx.moveTo(headX - 4 * face, headY - 10); ctx.quadraticCurveTo(headX - 1 * face, headY - 13, headX + 1 * face, headY - 10);
      ctx.moveTo(headX + 1 * face, headY - 10); ctx.quadraticCurveTo(headX + 4 * face, headY - 13, headX + 7 * face, headY - 10);
      ctx.stroke();
      if (em === 'scared') {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(headX + face * 3, headY - 1, 2, 0, Math.PI * 2); ctx.arc(headX + face * 8, headY - 1, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.ellipse(headX + face * 5.5, headY + 4, 2, 2.8, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (em === 'angry') {
      ctx.beginPath(); ctx.moveTo(headX - 5 * face, headY - 9); ctx.lineTo(headX - 1 * face, headY - 6);
      ctx.moveTo(headX + 5 * face, headY - 9); ctx.lineTo(headX + 1 * face, headY - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(headX + face * 3, headY + 5); ctx.lineTo(headX + face * 8, headY + 5); ctx.stroke();
    } else if (em === 'confused') {
      ctx.beginPath(); ctx.moveTo(headX - 5 * face, headY - 8); ctx.lineTo(headX - 1 * face, headY - 11);
      ctx.moveTo(headX + 1 * face, headY - 11); ctx.lineTo(headX + 5 * face, headY - 8); ctx.stroke();
      ctx.font = '700 9px system-ui,sans-serif'; ctx.fillStyle = '#101012';
      ctx.fillText('?', headX + face * 10, headY - 8);
      ctx.beginPath(); ctx.moveTo(headX + face * 3, headY + 5); ctx.quadraticCurveTo(headX + face * 5.5, headY + 2, headX + face * 8, headY + 6); ctx.stroke();
    } else if (em === 'happy') {
      ctx.beginPath(); ctx.arc(headX + face * 5.5, headY + 3, 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    } else if (em === 'hurt') {
      ctx.fillStyle = 'rgba(255,70,70,0.55)';
      ctx.beginPath(); ctx.arc(headX - 3 * face, headY - 11, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Sharingan: a glowing red eye while the buff is active.
  if (fighter.status?.active?.('sharingan', now)) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.012);
    const ex = vX + face * 2;
    const glow = ctx.createRadialGradient(ex, vY, 0, ex, vY, 8);
    glow.addColorStop(0, `rgba(255,45,45,${0.95 * pulse})`);
    glow.addColorStop(0.6, `rgba(220,0,0,${0.35 * pulse})`);
    glow.addColorStop(1, 'rgba(180,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ex, vY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(ex, vY, 2.6, 0, Math.PI * 2);
    ctx.fill();
    // tiny tomoe dot
    ctx.fillStyle = '#7a0000';
    ctx.beginPath();
    ctx.arc(ex + face * 1.2, vY - 0.8, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.shadowColor = 'transparent';
  ctx.restore();
}

function hexToRgba(hex, a) {
  const m = hex?.match(/\w\w/g);
  if (!m) return `rgba(160,200,255,${a})`;
  const [r, g, b] = m.map(x => parseInt(x, 16));
  return `rgba(${r},${g},${b},${a})`;
}

function drawCapsule(ctx, x1, y1, x2, y2, r, fillColor, strokeColor) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 0.001;
  const ux = dx / len;
  const uy = dy / len;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(x1 - uy * r, y1 + ux * r);
  ctx.lineTo(x2 - uy * r, y2 + ux * r);
  ctx.arc(x2, y2, r, Math.atan2(uy, ux) - Math.PI / 2, Math.atan2(uy, ux) + Math.PI / 2);
  ctx.lineTo(x1 + uy * r, y1 - ux * r);
  ctx.arc(x1, y1, r, Math.atan2(uy, ux) + Math.PI / 2, Math.atan2(uy, ux) - Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();
}


const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const PARALLAX_FAR = 0.28;
const PARALLAX_MID = 0.58;

export function drawBackground(ctx, w, h, camX, now, world, floorY = 810) {
  const baseX = camX - w / 2;
  const viewLeft = baseX;
  const viewRight = baseX + w;
  const farOff = camX * (1 - PARALLAX_FAR);
  const midOff = camX * (1 - PARALLAX_MID);

  if (!Number.isFinite(baseX) || !Number.isFinite(h)) {
    ctx.fillStyle = '#111';
    ctx.fillRect(baseX || 0, 0, w, h);
    return;
  }

  // Extra width when zoomed out so edges never show empty canvas
  const overscan = w * (0.4 + Math.max(0, w / LOGICAL_WIDTH - 1) * 0.35);
  const drawW = w + overscan * 2;
  const drawX = baseX - overscan;
  const vScale = Math.max(1, h / LOGICAL_HEIGHT);

  const sky = ctx.createLinearGradient(drawX, 0, drawX, h);
  sky.addColorStop(0, '#0d1220');
  sky.addColorStop(0.35, '#151c2e');
  sky.addColorStop(0.65, '#1a2435');
  sky.addColorStop(0.85, '#1e2a28');
  sky.addColorStop(1, '#141c18');
  ctx.fillStyle = sky;
  ctx.fillRect(drawX, 0, drawW, h);

  // Burning Sky Effect
  if (world?.skyFocus?.type === 'fire' && now < world.skyFocus.expiry) {
    const focus = world.skyFocus;
    const timeRemaining = focus.expiry - now;
    const fade = Math.min(1, timeRemaining / 800); // 800ms fade out
    const intensity = focus.intensity * fade;
    const pulse = 1 + Math.sin(now * 0.005) * 0.05;

    ctx.save();
    const fireGlow = ctx.createRadialGradient(baseX + w / 2, -200, 100, baseX + w / 2, 0, h * 0.8);
    fireGlow.addColorStop(0, `rgba(255, 100, 0, ${0.45 * intensity * pulse})`);
    fireGlow.addColorStop(0.4, `rgba(255, 60, 0, ${0.25 * intensity})`);
    fireGlow.addColorStop(1, 'rgba(255, 30, 0, 0)');

    ctx.fillStyle = fireGlow;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillRect(drawX, 0, drawW, h);
    ctx.restore();
  } else if (world?.skyFocus?.type === 'shinra' && now < world.skyFocus.expiry) {
    const intensity = Math.min(1, (world.skyFocus.expiry - now) / 200);
    ctx.save();
    ctx.globalAlpha = 0.3 * intensity;
    ctx.fillStyle = '#b4deff';
    ctx.fillRect(drawX, 0, drawW, h);
    ctx.restore();
  } else if (world?.skyFocus?.type === 'glitch' && now < world.skyFocus.expiry) {
    const intensity = Math.min(1, (world.skyFocus.expiry - now) / 250);
    const offset = (Math.random() - 0.5) * 20 * intensity;
    ctx.save();
    ctx.globalAlpha = 0.2 * intensity;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(drawX + offset, 0, drawW, h);
    ctx.fillStyle = '#00ffff';
    ctx.fillRect(drawX - offset, 0, drawW, h);
    ctx.restore();
  } else if (world?.skyFocus?.type === 'vacuum' && now < world.skyFocus.expiry) {
    const intensity = Math.min(1, (world.skyFocus.expiry - now) / 300);
    const g = ctx.createRadialGradient(baseX + w / 2, h / 2, 0, baseX + w / 2, h / 2, w * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${0.5 * intensity})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(drawX, 0, drawW, h);
    ctx.restore();
  }

  // Subtle horizontal gradient banding for atmospheric depth in the sky
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let b = 0; b < 4; b++) {
    const by = h * (0.12 + b * 0.11);
    const band = ctx.createLinearGradient(drawX, by, drawX, by + h * 0.06);
    band.addColorStop(0, 'rgba(40,58,78,0.05)');
    band.addColorStop(1, 'rgba(40,58,78,0)');
    ctx.fillStyle = band;
    ctx.fillRect(drawX, by, drawW, h * 0.06);
  }
  ctx.restore();

  // --- Layer 0: DISTANT PEAKS (deepest, slowest parallax) ---
  const farLeft = viewLeft * PARALLAX_FAR + farOff;
  const farRight = viewRight * PARALLAX_FAR + farOff;
  const deepStep = 540;
  let dsx = Math.floor(farLeft / deepStep) * deepStep;
  ctx.fillStyle = '#0a0f14';
  while (dsx < farRight + deepStep) {
    const x = dsx;
    const peak = floorY - 560 * vScale - (Math.sin(dsx * 0.0013) * 70 * vScale) - (Math.cos(dsx * 0.0007) * 40 * vScale);
    ctx.beginPath();
    ctx.moveTo(x - 220, floorY + 20);
    ctx.lineTo(x - 60, peak + 120);
    ctx.lineTo(x + 30, peak);
    ctx.lineTo(x + 140, peak + 90);
    ctx.lineTo(x + 260, floorY + 20);
    ctx.closePath();
    ctx.fill();
    dsx += deepStep;
  }
  // soft haze where distant peaks meet the sky
  const hazeG = ctx.createLinearGradient(drawX, floorY - 560 * vScale, drawX, floorY - 280);
  hazeG.addColorStop(0, 'rgba(30,44,60,0)');
  hazeG.addColorStop(1, 'rgba(30,44,60,0.25)');
  ctx.fillStyle = hazeG;
  ctx.fillRect(drawX, floorY - 560 * vScale, drawW, 300 * vScale);

  // --- Layer 1: nearer ridge silhouettes ---
  const step = 320;
  let sx = Math.floor(farLeft / step) * step;
  ctx.fillStyle = '#0e1412';
  while (sx < farRight + step) {
    const x = sx;
    const peak = floorY - 380 * vScale - (Math.sin(sx * 0.002) * 40 * vScale);
    ctx.beginPath();
    ctx.moveTo(x - 80, floorY + 20);
    ctx.lineTo(x - 20, peak + 80);
    ctx.lineTo(x + 40, peak + 40);
    ctx.lineTo(x + 100, floorY + 15);
    ctx.closePath();
    ctx.fill();
    sx += step;
  }

  // --- Layer 1.5: distant temple + torii silhouettes (FAR parallax) ---
  const templeStep = 900;
  let tsx = Math.floor(farLeft / templeStep) * templeStep;
  while (tsx < farRight + templeStep) {
    const x = tsx + 200;
    const baseY = floorY - 40;
    const variant = Math.floor((Math.sin(tsx * 0.01) * 0.5 + 0.5) * 2);
    ctx.fillStyle = '#0c1311';
    if (variant === 0) {
      // pagoda silhouette
      const pw = 120;
      for (let tier = 0; tier < 3; tier++) {
        const ty = baseY - (60 + tier * 70) * vScale;
        const tw = pw - tier * 28;
        ctx.fillRect(x - tw / 2, ty, tw, 50 * vScale);
        // eaves
        ctx.beginPath();
        ctx.moveTo(x - tw / 2 - 18, ty);
        ctx.lineTo(x + tw / 2 + 18, ty);
        ctx.lineTo(x + tw / 2, ty - 14);
        ctx.lineTo(x - tw / 2, ty - 14);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // torii gate silhouette
      const gw = 150, gh = 200 * vScale;
      ctx.fillRect(x - gw / 2, baseY - gh, 16, gh);
      ctx.fillRect(x + gw / 2 - 16, baseY - gh, 16, gh);
      ctx.fillRect(x - gw / 2 - 26, baseY - gh + 6, gw + 52, 22);
      ctx.fillRect(x - gw / 2 - 14, baseY - gh + 46, gw + 28, 16);
    }
    tsx += templeStep;
  }

  // --- Layer 1.6: mid-distance scattered boulders (MID parallax, behind bamboo) ---
  const boulderSpacing = 260;
  const midWL = (viewLeft - midOff) / PARALLAX_MID;
  const midWR = (viewRight - midOff) / PARALLAX_MID;
  let rbx = Math.floor(midWL / boulderSpacing) * boulderSpacing - boulderSpacing;
  while (rbx < midWR + boulderSpacing) {
    const x = rbx * PARALLAX_MID + midOff;
    const s = Math.sin(rbx * 0.017) * 0.5 + 0.5;
    const bw = 70 + s * 60;
    const bh = 36 + s * 30;
    const by = floorY - 6;
    const bg = ctx.createLinearGradient(x, by - bh, x, by);
    bg.addColorStop(0, '#23302a');
    bg.addColorStop(1, '#141d18');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(x - bw / 2, by);
    ctx.lineTo(x - bw * 0.3, by - bh * 0.7);
    ctx.lineTo(x, by - bh);
    ctx.lineTo(x + bw * 0.34, by - bh * 0.6);
    ctx.lineTo(x + bw / 2, by);
    ctx.closePath();
    ctx.fill();
    rbx += boulderSpacing;
  }

  const fog = ctx.createLinearGradient(baseX, floorY - 200, baseX, h);
  fog.addColorStop(0, 'transparent');
  fog.addColorStop(0.5, 'rgba(28,38,42,0.15)');
  fog.addColorStop(1, 'rgba(18,24,22,0.4)');
  ctx.fillStyle = fog;
  ctx.fillRect(baseX, 0, w, h);

  const bambooSpacing = 140;
  const midWorldLeft = (viewLeft - midOff) / PARALLAX_MID;
  const midWorldRight = (viewRight - midOff) / PARALLAX_MID;
  let bx = Math.floor(midWorldLeft / bambooSpacing) * bambooSpacing - bambooSpacing;
  while (bx < midWorldRight + bambooSpacing) {
    const x = bx * PARALLAX_MID + midOff;
    const top = floorY - 220 * vScale;
    ctx.strokeStyle = '#1a241a';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x + 4, top);
    ctx.stroke();
    ctx.fillStyle = '#1c2e1e';
    ctx.beginPath();
    ctx.ellipse(x + 2, top - 8, 12, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    bx += bambooSpacing;
  }

  const plankW = 100;
  const plankH = 10;
  const firstPlank = Math.floor(viewLeft / plankW) * plankW;
  for (let px = firstPlank; px < viewRight + plankW; px += plankW) {
    const alt = Math.floor(px / plankW) % 2;
    ctx.fillStyle = alt ? '#2c2218' : '#352a1c';
    ctx.fillRect(px, floorY, plankW, plankH);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, floorY, plankW, plankH);
  }

  // Ground plane base
  const groundG = ctx.createLinearGradient(baseX, floorY + plankH, baseX, h);
  groundG.addColorStop(0, '#16211a');
  groundG.addColorStop(1, '#0c120e');
  ctx.fillStyle = groundG;
  ctx.fillRect(baseX, floorY + plankH, w, h - floorY - plankH);

  // Ground texture: subtle seed-stable speckle + cracks (foreground detail)
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  const gTex = 90;
  const gFirst = Math.floor(viewLeft / gTex) * gTex;
  for (let gx = gFirst; gx < viewRight + gTex; gx += gTex) {
    const s = Math.sin(gx * 0.05) * 0.5 + 0.5;
    const gy = floorY + plankH + 14 + s * (h - floorY - plankH - 30);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + 30 + s * 30, gy + 6);
    ctx.stroke();
    // small pebble highlight
    ctx.fillStyle = 'rgba(120,140,120,0.06)';
    ctx.fillRect(gx + 50, gy + 10, 4 + s * 6, 2);
  }
  // foreground grass/debris tufts along the plank edge
  ctx.strokeStyle = 'rgba(40,60,40,0.55)';
  ctx.lineWidth = 2;
  const tuftStep = 70;
  const tFirst = Math.floor(viewLeft / tuftStep) * tuftStep;
  for (let tx = tFirst; tx < viewRight + tuftStep; tx += tuftStep) {
    const s = Math.sin(tx * 0.08) * 0.5 + 0.5;
    if (s < 0.45) continue;
    const ty = floorY + plankH + 2;
    for (let b = -1; b <= 1; b++) {
      ctx.beginPath();
      ctx.moveTo(tx + b * 3, ty);
      ctx.quadraticCurveTo(tx + b * 6, ty - 10 - s * 6, tx + b * 10, ty - 14 - s * 8);
      ctx.stroke();
    }
  }
  ctx.restore();

  const lanternSpacing = 380;
  let lx = Math.floor(midWorldLeft / lanternSpacing) * lanternSpacing - lanternSpacing;
  while (lx < midWorldRight + lanternSpacing) {
    const x = lx * PARALLAX_MID + midOff;
    const y = floorY - 120 * vScale;
    const pulse = 1 + Math.sin(lx * 0.01) * 0.05;
    const r = 22 * pulse;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#ffb86c');
    g.addColorStop(0.35, '#e89b4a');
    g.addColorStop(0.7, '#b87230');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffaa5c';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3d2816';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#1a1208';
    ctx.fillRect(x - 2, y + 10, 4, 18);
    lx += lanternSpacing;
  }

  // Render Arena Walls (Visual boundaries)
  const wallX = ARENA.BOUNDS ?? 1200;
  [-wallX, wallX].forEach(wx => {
    ctx.save();
    ctx.fillStyle = '#1c241c';
    ctx.strokeStyle = '#0a0e0a';
    ctx.lineWidth = 12;

    // Main Pillar
    ctx.beginPath();
    ctx.rect(wx - 25, floorY - 500, 50, 500);
    ctx.fill();
    ctx.stroke();

    // Decorative Torii Cross-beams
    ctx.fillStyle = '#2d1c1c';
    ctx.fillRect(wx - 60, floorY - 450, 120, 25);
    ctx.fillRect(wx - 50, floorY - 485, 100, 20);

    // Glow near pillar base
    const g = ctx.createRadialGradient(wx, floorY, 0, wx, floorY, 150);
    g.addColorStop(0, 'rgba(255,184,108,0.12)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(wx - 150, floorY - 400, 300, 400);

    ctx.restore();
  });

  drawObstacles(ctx, world.obstacles, now);
  drawAtmosphere(ctx, w, h, camX, now, world);
}

function drawObstacles(ctx, obstacles, now = 0) {
  if (!obstacles) return;
  obstacles.forEach(o => {
    ctx.save();
    if (o.type === 'env') {
      drawEnvObstacle(ctx, o, now);
      ctx.restore();
      return;
    }
    if (o.type === 'earth') {
      const lifePct = o.life / 6; // Assume 6s base life
      const rise = Math.min(1, (6 - o.life) * 2.5); // Fast rise
      const alpha = Math.min(1, o.life * 2);
      ctx.globalAlpha = alpha;

      const x = o.x - o.width / 2;
      const groundY = 810;
      const h = o.height * rise;
      const y = groundY - h;

      // Rock Texture Gradient
      const rockG = ctx.createLinearGradient(x, y, x + o.width, groundY);
      rockG.addColorStop(0, '#5a4d41');
      rockG.addColorStop(1, '#2a2015');
      ctx.fillStyle = rockG;
      ctx.strokeStyle = '#1a1005';
      ctx.lineWidth = 3;

      // Draw jagged rock — points scale with the wall's width so a thicker wall
      // renders as a wider, more imposing barrier.
      const w = o.width;
      ctx.beginPath();
      ctx.moveTo(x - 6, groundY);
      ctx.lineTo(x + w * 0.07, y + h * 0.2);
      ctx.lineTo(x + w * 0.22, y);
      ctx.lineTo(x + w * 0.42, y + h * 0.12);
      ctx.lineTo(x + w * 0.62, y - h * 0.05);
      ctx.lineTo(x + w * 0.8, y + h * 0.1);
      ctx.lineTo(x + w * 0.93, y + h * 0.22);
      ctx.lineTo(x + w + 6, groundY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Detail Cracks/Shading
      if (rise > 0.8) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 10);
        ctx.lineTo(x + 20, y + 40);
        ctx.stroke();
      }
    }
    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// Dynamic environment obstacles (rock / crate / log / pillar)
// ---------------------------------------------------------------------------
function drawEnvObstacle(ctx, o, now) {
  const groundY = 810;
  const seed = (typeof o.seed === 'number' ? o.seed : 0.5);

  // RISE animation: first ~0.35s after createdAt, height scales 0 -> 1 with ease-out
  const age = (typeof o.createdAt === 'number' && now) ? (now - o.createdAt) / 1000 : 99;
  const riseT = Math.max(0, Math.min(1, age / 0.35));
  const rise = 1 - Math.pow(1 - riseT, 3); // ease-out cubic

  // FADE / crumble as life runs out (life is in seconds)
  const life = (typeof o.life === 'number') ? o.life : 99;
  const fade = life < 1.5 ? Math.max(0, life / 1.5) : 1;
  const sink = (1 - fade) * 14; // slight sink into the ground as it crumbles

  if (rise <= 0.001 || fade <= 0.001) return;

  const w = o.width;
  const fullH = o.height;
  const h = fullH * rise;
  const x = o.x - w / 2;
  const cx = o.x;
  const topY = groundY - h + sink;

  ctx.globalAlpha = fade;

  // --- Contact shadow on the ground (all kinds) ---
  ctx.save();
  const shW = w * (0.62 + seed * 0.12);
  const shadG = ctx.createRadialGradient(cx, groundY + 4, 0, cx, groundY + 4, shW);
  shadG.addColorStop(0, 'rgba(0,0,0,0.4)');
  shadG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadG;
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 6, shW, 12 + h * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const kind = o.kind || 'rock';
  if (kind === 'rock') drawRock(ctx, x, topY, w, h, groundY, seed);
  else if (kind === 'crate') drawCrate(ctx, x, topY, w, h, groundY, seed);
  else if (kind === 'log') drawLog(ctx, x, topY, w, h, groundY, seed);
  else if (kind === 'pillar') drawPillar(ctx, x, topY, w, h, groundY, seed);
  else drawRock(ctx, x, topY, w, h, groundY, seed);
}

function drawRock(ctx, x, topY, w, h, groundY, seed) {
  const cx = x + w / 2;
  // seed-based silhouette variation
  const j = (n) => Math.sin(seed * 31.7 + n) * 0.5;
  ctx.beginPath();
  ctx.moveTo(x - 4, groundY);
  ctx.lineTo(x + w * (0.05 + 0.04 * j(1)), topY + h * (0.35 + 0.1 * j(2)));
  ctx.lineTo(x + w * (0.24 + 0.05 * j(3)), topY + h * (0.08 + 0.06 * j(4)));
  ctx.lineTo(x + w * 0.5, topY + h * (0.02 + 0.05 * j(5)));
  ctx.lineTo(x + w * (0.74 + 0.05 * j(6)), topY + h * (0.1 + 0.06 * j(7)));
  ctx.lineTo(x + w * (0.95 + 0.03 * j(8)), topY + h * (0.4 + 0.1 * j(9)));
  ctx.lineTo(x + w + 4, groundY);
  ctx.closePath();

  const g = ctx.createLinearGradient(x, topY, x, groundY);
  g.addColorStop(0, '#7d7468');
  g.addColorStop(0.45, '#5c5247');
  g.addColorStop(1, '#332a20');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#1c150d';
  ctx.lineWidth = 3;
  ctx.stroke();

  // facet highlights
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,245,225,0.10)';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.18, topY + h * 0.18);
  ctx.lineTo(cx + w * 0.05, topY + h * 0.05);
  ctx.lineTo(cx - w * 0.02, topY + h * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.1, topY + h * 0.15);
  ctx.lineTo(cx + w * 0.22, groundY - h * 0.1);
  ctx.stroke();
  ctx.restore();

  // top ledge highlight (standable)
  ctx.strokeStyle = 'rgba(255,250,235,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.24, topY + h * 0.08 + 1);
  ctx.lineTo(x + w * 0.5, topY + h * 0.02 + 1);
  ctx.lineTo(x + w * 0.74, topY + h * 0.1 + 1);
  ctx.stroke();
}

function drawCrate(ctx, x, topY, w, h, groundY, seed) {
  const topFace = Math.min(14, h * 0.18);
  // body
  const g = ctx.createLinearGradient(x, topY, x, groundY);
  g.addColorStop(0, '#8a6235');
  g.addColorStop(1, '#523c20');
  ctx.fillStyle = g;
  ctx.fillRect(x, topY + topFace, w, groundY - topY - topFace);
  ctx.strokeStyle = '#241803';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, topY + topFace, w, groundY - topY - topFace);

  // lighter top face (reads as standable)
  ctx.fillStyle = '#a8804c';
  ctx.beginPath();
  ctx.moveTo(x, topY + topFace);
  ctx.lineTo(x + topFace * 0.8, topY);
  ctx.lineTo(x + w + topFace * 0.0, topY);
  ctx.lineTo(x + w, topY + topFace);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,210,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 2, topY + topFace - 1);
  ctx.lineTo(x + w - 2, topY + topFace - 1);
  ctx.stroke();

  // plank lines
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1.5;
  const planks = 3;
  for (let i = 1; i < planks; i++) {
    const py = topY + topFace + (groundY - topY - topFace) * (i / planks);
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x + w, py);
    ctx.stroke();
  }
  // diagonal brace
  ctx.beginPath();
  ctx.moveTo(x, topY + topFace);
  ctx.lineTo(x + w, groundY);
  ctx.stroke();

  // corner braces
  ctx.fillStyle = '#3a2a14';
  const b = Math.min(8, w * 0.08);
  ctx.fillRect(x, topY + topFace, b, groundY - topY - topFace);
  ctx.fillRect(x + w - b, topY + topFace, b, groundY - topY - topFace);
}

function drawLog(ctx, x, topY, w, h, groundY, seed) {
  const cy = (topY + groundY) / 2;
  const ry = (groundY - topY) / 2;
  const endR = ry; // end ellipse radius
  // barrel body
  const g = ctx.createLinearGradient(x, topY, x, groundY);
  g.addColorStop(0, '#6e4f30');
  g.addColorStop(0.5, '#56391f');
  g.addColorStop(1, '#3a2614');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x + w, topY);
  ctx.lineTo(x + w, groundY);
  ctx.lineTo(x, groundY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#241404';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x + w, topY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x + w, groundY); ctx.stroke();

  // bark texture along top
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const lx = x + w * (0.12 + i * 0.14);
    ctx.beginPath();
    ctx.moveTo(lx, topY + 2);
    ctx.lineTo(lx + 4, groundY - 4);
    ctx.stroke();
  }
  // top ledge highlight (standable)
  ctx.strokeStyle = 'rgba(255,235,200,0.45)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x + endR, topY + 2);
  ctx.lineTo(x + w - endR, topY + 2);
  ctx.stroke();

  // rounded end with end-grain rings
  ctx.fillStyle = '#7a5836';
  ctx.beginPath();
  ctx.ellipse(x + w - 2, cy, endR * 0.6, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2c1a08';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let r = 1; r <= 3; r++) {
    ctx.strokeStyle = `rgba(40,24,8,${0.5 - r * 0.1})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x + w - 2, cy, endR * 0.6 * (r / 3.5), ry * (r / 3.5), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // far end (shaded)
  ctx.fillStyle = '#4a3320';
  ctx.beginPath();
  ctx.ellipse(x + 1, cy, endR * 0.55, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2c1a08';
  ctx.stroke();
}

function drawPillar(ctx, x, topY, w, h, groundY, seed) {
  const capH = Math.min(18, h * 0.1);
  const bodyTop = topY + capH;
  // body gradient — jade-grey stone
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#3f4a44');
  g.addColorStop(0.5, '#5c6b62');
  g.addColorStop(1, '#2c352f');
  ctx.fillStyle = g;
  ctx.fillRect(x, bodyTop, w, groundY - bodyTop);
  ctx.strokeStyle = '#161c19';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, bodyTop, w, groundY - bodyTop);

  // vertical segments
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 3; i++) {
    const vx = x + w * (i / 3);
    ctx.beginPath();
    ctx.moveTo(vx, bodyTop);
    ctx.lineTo(vx, groundY);
    ctx.stroke();
  }
  // horizontal segment bands
  const bands = 4;
  for (let i = 1; i < bands; i++) {
    const by = bodyTop + (groundY - bodyTop) * (i / bands);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w, by); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(x, by + 1.5); ctx.lineTo(x + w, by + 1.5); ctx.stroke();
  }
  // seed-based crack
  ctx.strokeStyle = 'rgba(10,14,12,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const crackX = x + w * (0.3 + seed * 0.4);
  ctx.moveTo(crackX, bodyTop + h * 0.15);
  ctx.lineTo(crackX + w * 0.12, bodyTop + h * 0.4);
  ctx.lineTo(crackX - w * 0.05, groundY - h * 0.15);
  ctx.stroke();

  // capital at top (slightly wider, ominous)
  const capOv = w * 0.22;
  const capG = ctx.createLinearGradient(x, topY, x, bodyTop);
  capG.addColorStop(0, '#6b7a70');
  capG.addColorStop(1, '#34403a');
  ctx.fillStyle = capG;
  ctx.fillRect(x - capOv, topY, w + capOv * 2, capH);
  ctx.strokeStyle = '#161c19';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - capOv, topY, w + capOv * 2, capH);
  // faint top rim light
  ctx.strokeStyle = 'rgba(180,222,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(x - capOv + 2, topY + 1);
  ctx.lineTo(x + w + capOv - 2, topY + 1);
  ctx.stroke();
}

function drawAtmosphere(ctx, w, h, camX, now, world) {
  const baseX = camX - w / 2;
  const fighters = [world?.fighter1, world?.fighter2].filter(Boolean);
  ctx.save();

  // 1. Floating Energy Motes
  const moteCount = 20;
  for (let i = 0; i < moteCount; i++) {
    const time = now * 0.0008;
    // Base position
    let x = baseX + (Math.sin(i * 1.5 + time) * 0.5 + 0.5) * w;
    let y = (Math.cos(i * 0.7 + time * 0.5) * 0.5 + 0.5) * h;

    // Interactive reaction: attract to fighters
    fighters.forEach(f => {
      const dx = f.x - x;
      const dy = (810 - 54 + f.y) - y; // Adjust fighter Y to be closer to their center/chest
      const dist = Math.hypot(dx, dy);
      if (dist < 300) {
        const force = (1 - dist / 300) * 15; // Stronger force closer to fighter
        x += (dx / dist) * force;
        y += (dy / dist) * force;
      }
    });

    const f1Lead = (world.fighter1?.hp || 0) > (world.fighter2?.hp || 0);
    const intensity = Math.abs((world.fighter1?.hp || 0) - (world.fighter2?.hp || 0)) / 200;
    const size = 1.2 + Math.sin(time + i) * 0.8;

    // Dynamic Color Strategy
    let red = 120, green = 210, blue = 255;
    if (f1Lead) { green += intensity * 40; blue -= intensity * 50; }
    else { red += intensity * 100; green -= intensity * 80; blue -= intensity * 120; }

    ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${0.2 + Math.sin(time + i) * 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    if (size > 1.8) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = `rgba(${red}, ${green}, ${blue}, 0.5)`;
    }
  }

  // 2. Distant Light Rays
  ctx.globalCompositeOperation = 'screen';
  const rayG = ctx.createLinearGradient(baseX, 0, baseX + w, h);
  rayG.addColorStop(0, 'rgba(100, 150, 255, 0.02)');
  rayG.addColorStop(0.5, 'rgba(120, 220, 255, 0.05)');
  rayG.addColorStop(1, 'rgba(100, 150, 255, 0.02)');
  ctx.fillStyle = rayG;
  ctx.fillRect(baseX, 0, w, h);

  // 2b. Volumetric god-rays slanting from upper-left, drifting gently
  ctx.save();
  ctx.translate(baseX + w * 0.3, 0);
  ctx.rotate(0.32);
  const rayCount = 5;
  for (let i = 0; i < rayCount; i++) {
    const drift = Math.sin(now * 0.0003 + i * 1.3) * 30;
    const rx = -w * 0.5 + i * (w / rayCount) + drift;
    const rw = 40 + Math.sin(i * 2.1) * 20;
    const lg = ctx.createLinearGradient(rx, 0, rx, h * 1.4);
    lg.addColorStop(0, 'rgba(150,200,255,0.05)');
    lg.addColorStop(0.6, 'rgba(120,180,255,0.02)');
    lg.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(rx, -h * 0.2, rw, h * 1.6);
  }
  ctx.restore();

  // 3. Drifting dust motes (slow, large, depth haze) — seed via index, no per-frame random
  ctx.globalCompositeOperation = 'screen';
  const dustCount = 14;
  for (let i = 0; i < dustCount; i++) {
    const t = now * 0.00015;
    const dx = baseX + ((Math.sin(i * 2.3) * 0.5 + 0.5) * w + Math.sin(t + i) * 40);
    const dy = (Math.cos(i * 1.7) * 0.5 + 0.5) * h * 0.8 + Math.cos(t * 1.3 + i) * 30;
    const ds = 1.5 + (Math.sin(i * 0.9) * 0.5 + 0.5) * 3;
    ctx.fillStyle = `rgba(180,200,220,${0.04 + Math.sin(t * 2 + i) * 0.02})`;
    ctx.beginPath();
    ctx.arc(dx, dy, ds, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // 4. Edge vignette — frames the larger stage, focuses center
  ctx.save();
  const vig = ctx.createRadialGradient(
    baseX + w / 2, h * 0.45, h * 0.3,
    baseX + w / 2, h * 0.45, w * 0.75
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.7, 'rgba(0,0,0,0.12)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(baseX - w * 0.4, 0, w * 1.8, h);
  ctx.restore();
}

export function drawHitEffect(ctx, h) {
  const { x, y, t, block, smoke, clash, counter, heavy, heal, shinra, lightning, fire, ice, dragon, shinraDeflect, splatter, splatterDir, splatterColor } = h;
  const a = Math.max(0, 1 - t * 1.4);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  if (splatter && splatterDir != null) {
    const dir = splatterDir;
    const color = splatterColor || '#e85555';
    const baseAng = dir > 0 ? 0 : Math.PI;
    const rays = 9;
    for (let i = 0; i < rays; i++) {
      const spread = (i / (rays - 1) - 0.5) * 0.7;
      const ang = baseAng + spread * Math.PI;
      const len = 22 + (1 - t) * 32 + (i % 3) * 6;
      const ex = x + Math.cos(ang) * len;
      const ey = y + Math.sin(ang) * len * 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 + (1 - t) * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5 + (1 - t) * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (h.crit) {
    // Critical-hit impact: a gold flash, an expanding ring, and a sharp star burst.
    const ringR = 16 + (1 - t) * 42;
    const flash = ctx.createRadialGradient(x, y, 0, x, y, ringR);
    flash.addColorStop(0, `rgba(255,238,160,${0.6 * a})`);
    flash.addColorStop(0.5, `rgba(255,200,60,${0.28 * a})`);
    flash.addColorStop(1, 'transparent');
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,216,90,${a})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    const spikes = 8;
    ctx.lineCap = 'round';
    for (let i = 0; i < spikes; i++) {
      const an = (i / spikes) * Math.PI * 2 + t * 0.6;
      const inner = 5;
      const outer = 14 + (1 - t) * 38 + (i % 2) * 9;
      ctx.strokeStyle = `rgba(255,244,190,${a})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * inner, y + Math.sin(an) * inner);
      ctx.lineTo(x + Math.cos(an) * outer, y + Math.sin(an) * outer);
      ctx.stroke();
    }
  }
  if (h.miss || h.evaded) {
    // A faint swish for the whiff...
    ctx.strokeStyle = `rgba(180,190,200,${0.45 * a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 40, 18 + (1 - t) * 10, -0.7, 0.7);
    ctx.stroke();
    // ...plus a bold floating "MISS" — styled like CRIT but cool cyan, rising up.
    const rise = (1 - a) * 14;
    const my = y - 52 - rise;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(0,0,0,${0.6 * a})`;
    ctx.strokeText('MISS', x, my);
    ctx.fillStyle = `rgba(120,220,255,${a})`;
    ctx.fillText('MISS', x, my);
  }
  if (h.sharingan) {
    // Red awakening flash where the buff is cast.
    const r = 20 + (1 - t) * 34;
    const g = ctx.createRadialGradient(x, y - 40, 0, x, y - 40, r);
    g.addColorStop(0, `rgba(255,50,50,${0.55 * a})`);
    g.addColorStop(0.6, `rgba(210,0,0,${0.25 * a})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - 40, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,70,70,${a})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (h.sharinganWarp) {
    // Red after-image streaks at the warp destination.
    ctx.strokeStyle = `rgba(255,45,45,${a})`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const an = (i / 6) * Math.PI * 2 + t * 0.8;
      const inner = 6;
      const outer = 12 + (1 - t) * 30;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * inner, y - 40 + Math.sin(an) * inner);
      ctx.lineTo(x + Math.cos(an) * outer, y - 40 + Math.sin(an) * outer);
      ctx.stroke();
    }
  }
  if (block) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 36);
    g.addColorStop(0, 'rgba(100,170,220,0.25)');
    g.addColorStop(0.6, 'rgba(80,150,210,0.12)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,200,240,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (smoke) {
    ctx.fillStyle = `rgba(90,95,105,${0.3 * a})`;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
  } else if (clash) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 46);
    g.addColorStop(0, 'rgba(255,200,120,0.4)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffb86c';
    ctx.lineWidth = 4;
    ctx.stroke();
  } else if (heal) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 40);
    g.addColorStop(0, 'rgba(120,255,160,0.5)');
    g.addColorStop(0.7, 'rgba(80,220,130,0.2)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 40, 0, Math.PI * 2);
    ctx.fill();
  } else if (h.vacuum) {
    const rot = t * 12;
    const radius = 60 * (1 - t);
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.7)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const ang = rot + (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x, y, radius, ang, ang + Math.PI * 0.6);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, 'rgba(0, 100, 255, 0.2)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (shinra || shinraDeflect) {
    const baseR = h.radius != null ? h.radius : 48;
    const expandR = h.shinraCircle ? baseR * (0.25 + t * 0.85) : 44 + t * 16;
    const g = ctx.createRadialGradient(x, y, 0, x, y, expandR);
    g.addColorStop(0, 'rgba(200,230,255,0.2)');
    g.addColorStop(0.5, 'rgba(160,210,250,0.08)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, expandR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,225,255,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (lightning) {
    const g = ctx.createLinearGradient(x - 30, y, x + 30, y);
    g.addColorStop(0, 'transparent');
    g.addColorStop(0.4, 'rgba(220,240,255,0.6)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'transparent');
    ctx.strokeStyle = g;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 26, y);
    ctx.lineTo(x + 26, y);
    ctx.stroke();
  } else if (fire) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 40);
    g.addColorStop(0, `rgba(255,180,90,${0.5 * a})`);
    g.addColorStop(0.5, `rgba(255,120,50,${0.25 * a})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 40, 0, Math.PI * 2);
    ctx.fill();
  } else if (counter) {
    ctx.strokeStyle = `rgba(230,80,80,${a})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.stroke();
    const rays = 6;
    for (let i = 0; i < rays; i++) {
      const an = (i / rays) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12);
      ctx.lineTo(x + Math.cos(an) * (36 + t * 8), y + Math.sin(an) * (36 + t * 8));
      ctx.stroke();
    }
  } else if (heavy && !splatter) {
    const r = 24 + (1 - t) * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,100,80,${0.35 * a})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(240,90,70,${a})`;
    ctx.lineWidth = 4;
    ctx.stroke();
  } else if (!splatter) {
    const baseR = 18 + (1 - t) * 14;
    ctx.strokeStyle = `rgba(255,220,180,${a})`;
    ctx.lineWidth = 2.5;
    const rays = 5;
    for (let i = 0; i < rays; i++) {
      const an = (i / rays) * Math.PI * 2 + t * 0.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(an) * baseR, y + Math.sin(an) * baseR);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (ice) {
    const rise = Math.max(0, Math.min(1, (t + 0.15) * 4));
    const h = 65 * rise;
    const w = 18 * (1 - t);

    // Ice Spike Body
    const g = ctx.createLinearGradient(x - w, y - h, x + w, y);
    g.addColorStop(0, '#e0faff');
    g.addColorStop(0.5, '#4dd0e1');
    g.addColorStop(1, '#0097a7');

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();

    // Frost highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.5, y);
    ctx.lineTo(x, y - h * 0.8);
    ctx.stroke();

    ctx.shadowBlur = 15;
    ctx.shadowColor = '#b2ebf2';
  }

  if (dragon) {
    const scale = (1 - t) * 2;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, 80 * scale);
    grad.addColorStop(0, 'rgba(255,215,0,0.8)');
    grad.addColorStop(0.4, 'rgba(255,140,0,0.4)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;

    // Massive fiery shockwave
    ctx.beginPath();
    ctx.ellipse(x, y, 90 * scale, 60 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Core glow
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 15 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 30;
    ctx.shadowColor = '#ffd700';
  }

  ctx.restore();
}

export function drawDamageNumber(ctx, x, y, dmg, alpha, counter, crit) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Crits pop bigger, gold, and rise faster with a "CRIT!" flourish.
  const rise = crit ? (1 - alpha) * 10 : 0;
  const size = crit ? 28 : counter ? 22 : (dmg >= 15 ? 18 : 15);
  ctx.font = `${crit ? 800 : 600} ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = crit ? 4 : 3;
  ctx.strokeText(String(dmg), x, y - rise);
  ctx.fillStyle = crit ? '#ffd24a' : counter ? '#ff9a8a' : (dmg >= 15 ? '#ffc98a' : '#fff');
  ctx.fillText(String(dmg), x, y - rise);
  if (crit) {
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillStyle = '#ffec99';
    ctx.strokeText('CRIT!', x, y - rise - size * 0.8);
    ctx.fillText('CRIT!', x, y - rise - size * 0.8);
  }
  ctx.restore();
}

export function drawParticles(ctx, particles) {
  const byType = { heal: [], fire: [], shinra: [], lightning: [], smoke: [], hit: [] };
  particles.forEach(p => {
    if (p.life >= 1) return;
    const t = byType[p.type] || byType.hit;
    t.push(p);
  });
  ctx.lineCap = 'round';
  const drawCircle = (x, y, r) => { ctx.arc(x, y, r, 0, Math.PI * 2); };
  byType.heal.forEach(p => {
    const a = 1 - p.life;
    const s = (p.size ?? 3.5) + p.life * (p.growth ?? 0) * 10;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#70dd99';
    ctx.beginPath();
    drawCircle(p.x, p.y, s);
    ctx.fill();
  });

  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // Glow effect

  byType.fire.forEach(p => {
    const a = (1 - p.life);
    const s = (p.size ?? 4) + p.life * (p.growth ?? 0) * 15;
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(255,${160 - p.life * 100},60,0.95)`;
    ctx.beginPath();
    drawCircle(p.x, p.y, s);
    ctx.fill();
    // Inner core for fire
    if (a > 0.4) {
      ctx.fillStyle = `rgba(255,255,200,${a * 0.5})`;
      ctx.beginPath();
      drawCircle(p.x, p.y, s * 0.45);
      ctx.fill();
    }
  });

  byType.shinra.forEach(p => {
    const a = 1 - p.life;
    const s = (p.size ?? 4) + p.life * (p.growth ?? 0) * 12;
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(180,220,255,${a * 0.9})`;
    ctx.beginPath();
    drawCircle(p.x, p.y, s);
    ctx.fill();
  });

  byType.lightning.forEach(p => {
    const a = 1 - p.life;
    const s = (p.size ?? 3) + p.life * (p.growth ?? 0) * 8;
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgba(220,240,255,${a})`;
    ctx.lineWidth = 1.5 + a * 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + (p.vx * 0.05), p.y + (p.vy * 0.05));
    ctx.stroke();
  });

  ctx.restore();

  byType.smoke.forEach(p => {
    const a = (1 - p.life) * 0.5;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(110,115,125,0.8)';
    ctx.beginPath();
    drawCircle(p.x, p.y, 4);
    ctx.fill();
  });
  byType.hit.forEach(p => {
    const a = 1 - p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(255,220,180,${a})`;
    ctx.beginPath();
    drawCircle(p.x, p.y, 2.5);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

export function drawProjectiles(ctx, projectiles, groundY, now) {
  const y = groundY - RENDER.HIT_EFFECT_OFFSET - 15;
  projectiles.forEach(p => {
    const y = groundY - RENDER.HIT_EFFECT_OFFSET - 15 + (p.y || 0);
    const dir = p.vx > 0 ? 1 : -1;
    ctx.save();
    ctx.translate(p.x, y);
    ctx.scale(dir, 1);
    if (p.type === 'fireball') {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
      g.addColorStop(0, '#ffb86c');
      g.addColorStop(0.5, '#e88a40');
      g.addColorStop(1, '#c85a28');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,140,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#6b7a8a';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(12, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4a5566';
      ctx.stroke();
    }
    ctx.restore();
  });
}

export function drawClones(ctx, clones, groundY, now) {
  clones.forEach(c => {
    const lifeTime = CLONE.DURATION_MS;
    const dissolve = c.createdAt && (now - c.createdAt) > (lifeTime - 200) ? Math.min(1, (now - c.createdAt - (lifeTime - 200)) / 200) : 0;
    if (dissolve >= 1) return;

    const face = c.facing || 1;
    const headR = 12;
    const torsoH = 40;
    const bodyY = groundY - 55 - torsoH;
    const pelvisY = groundY - 55;
    const attackPose = c.attackPoseUntil > now;

    // Spectral Glitch Jitter
    const jitter = Math.random() < 0.1 ? (Math.random() - 0.5) * 15 : 0;
    const x = c.x + jitter;

    ctx.save();
    ctx.globalAlpha = (1 - dissolve) * 0.7;

    // Clone HP Bar (Simplified)
    if (c.hp < c.maxHp) {
      const barW = 30;
      const pct = Math.max(0, c.hp / c.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(c.x - barW / 2, bodyY - 30, barW, 4);
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(c.x - barW / 2, bodyY - 30, barW * pct, 4);
    }

    // Echo Silhouette
    ctx.save();
    ctx.globalAlpha *= 0.3;
    ctx.strokeStyle = '#00ffff';
    ctx.translate(x + (Math.random() - 0.5) * 10, 0);
    drawStickmanFigure(ctx, 0, groundY, face, attackPose); // Need to use a drawing helper
    ctx.restore();

    ctx.strokeStyle = c.color || '#00ced1';
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ffff';

    drawStickmanFigure(ctx, x, groundY, face, attackPose);
    ctx.restore();
  });
}

function drawStickmanFigure(ctx, x, groundY, face, attackPose) {
  const headR = 12;
  const torsoH = 40;
  const armLen = 24;
  const legLen = 28;
  const bodyY = groundY - 55 - torsoH;
  const pelvisY = groundY - 55;
  const rArmAng = attackPose ? -Math.PI / 2 + 0.8 * face : 0.4;
  const lArmAng = -0.4;
  const lShoulderX = x - 6;
  const lShoulderY = bodyY + 4;
  const rShoulderX = x + 6;
  const rShoulderY = bodyY + 4;
  const lElbowX = lShoulderX + armLen * Math.cos(lArmAng);
  const lElbowY = lShoulderY + armLen * Math.sin(lArmAng);
  const rElbowX = rShoulderX + armLen * Math.cos(rArmAng);
  const rElbowY = rShoulderY + armLen * Math.sin(rArmAng);
  const capColor = ctx.strokeStyle;
  drawCapsule(ctx, x, groundY - 55 - headR - torsoH, x, bodyY, headR, capColor, capColor);
  drawCapsule(ctx, x - 4, bodyY, x + 4, pelvisY, 8, capColor, capColor);
  drawTaperedLimb(ctx, lShoulderX, lShoulderY, lElbowX, lElbowY, 4, 3);
  drawTaperedLimb(ctx, rShoulderX, rShoulderY, rElbowX, rElbowY, 4, 3);
  drawTaperedLimb(ctx, x - 8, pelvisY, x - 8 + legLen * 0.5, pelvisY + legLen, 5, 4);
  drawTaperedLimb(ctx, x + 8, pelvisY, x + 8 + legLen * 0.5 * face, pelvisY + legLen, 5, 4);
}
