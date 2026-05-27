import { POSE } from '../entities/fighter.js';
import { ARENA, RENDER, COMBAT, FIGHTER, CLONE } from '../config/constants.js';
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
  getWalkCycle,
  getRunCycle,
  getHitReaction
} from './fightAnimations.js';

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

  ctx.save();
  // Global Scale for Bosses
  if (scale !== 1) {
    const cy = groundY + fighter.y;
    ctx.translate(fighter.x, cy);
    ctx.scale(scale, scale);
    ctx.translate(-fighter.x, -cy);
  }

  // 0. Premium Visual Overlays
  // Spectral / After-image Trails
  if (fighter.status.active('invincible', now)) {
    fighter.poseHistory.forEach((p, idx) => {
      if (idx % 3 !== 0) return; // Only draw some frames
      const alpha = 0.25 * (1 - idx / 10);
      if (alpha <= 0.05) return;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#9c27b0'; // Spectral Purple
      ctx.beginPath();
      ctx.arc(p.x, groundY + p.y - 45, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
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
  const poseT = fighter.poseTime || 0;
  const rest = REST_STANCE;

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
  if (pose === POSE.walk || pose === POSE.run) {
    const baseSpeed = pose === POSE.run ? 11.5 : 7.2;
    const expectedSpeed = pose === POSE.run ? 500 : 230;
    const speedRatio = Math.min(1.25, Math.max(0.55, Math.abs(velX) / expectedSpeed));
    const cycleSpeed = baseSpeed * speedRatio;
    const phase = (poseT * cycleSpeed) % (2 * Math.PI);
    const cycle = pose === POSE.run ? getRunCycle(phase, face) : getWalkCycle(phase, face);

    bob = cycle.bob;
    lean = cycle.lean;
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
  } else if (pose === POSE.idle) {
    const idle = idleFromRest(poseT, rest);
    bob = idle.bob;
    torsoTwist = idle.torsoTwist * face;
    lean = idle.lean + (rest.torsoLean || 0) * face;
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
  } else if (pose === POSE.slide) {
    pelvisX = x + face * slideT * 22;
    lean = face * slideT * 0.28;
    bob = -15 * slideT;
    lLegAng = 1.2 * slideT;
    rLegAng = -0.4 * slideT;
    lKneeOff = 1.4 * slideT;
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
    lean = -face * 0.12 * blockT;
    bob = 4 * blockT;
    const armUp = blockT * 1.25;
    lArmAng = -Math.PI / 2 - armUp;
    rArmAng = -Math.PI / 2 - armUp;
    lForeArmAng = 0.9;
    rForeArmAng = 0.65;
  }

  // Calculate Limb Bulge & Stretch
  let limbBulge = 0;
  let limbStretch = 0;
  if (fighter.currentAttack) {
    const isPunch = pose === POSE.punch;
    const isKick = pose === POSE.kick;
    const a = fighter.currentAttack;
    const { phase, localT } = isPunch ? getPunchPhase(poseT, a.data.duration, a.type) : getKickPhase(poseT, a.data.duration, a.type);

    const STRIKE = 1;
    if (phase === STRIKE) {
      const snap = Math.sin(localT * Math.PI);
      limbBulge = 0.45 * snap;
      limbStretch = 10 * snap;
    }
  }

  // Combat Override
  if (pose === POSE.punch && fighter.currentAttack) {
    const a = fighter.currentAttack;
    const { phase, localT } = getPunchPhase(poseT, a.data.duration, a.type);
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
  } else if (pose === POSE.kick && fighter.currentAttack) {
    const a = fighter.currentAttack;
    const { phase, localT } = getKickPhase(poseT, a.data.duration, a.type);
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
      const { phase, localT } = isPunch ? getPunchPhase(poseT, a.data.duration, a.type) : getKickPhase(poseT, a.data.duration, a.type);

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
      }
    }
  }

  // 3. Impact Reaction
  if (pose === POSE.hit) {
    const impact = Math.min(1.5, ((fighter.hitLastDmg || 5) / 15));
    squashY += 0.15 * impact * Math.sin(hitT * Math.PI);
    stretchX -= 0.1 * impact * Math.sin(hitT * Math.PI);
  }

  pelvisY -= bob;

  // Dual Bone Positioning
  const spineLen = 42 * squashY;
  const ribsX = pelvisX + (lean * 24 + torsoTwist * 10) * stretchX;
  const ribsY = pelvisY - spineLen;
  const headX = ribsX + (lean * 12 + headTilt * 6) * stretchX;
  const headY = ribsY - 18 * squashY;

  // 2. Render Motion Effects (Smeared Shadows & Trails)
  if (Math.abs(fighter.vx) > 400) {
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

  if (fighter.attackTrail?.length > 2) {
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

  // 3. Render Fighter Body
  ctx.lineCap = 'round';
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;

  // Legs
  const thighLen = 30, calfLen = 26;
  const lHipX = pelvisX - 7 * face, rHipX = pelvisX + 7 * face;
  const lKneeX = lHipX + Math.sin(lLegAng) * thighLen * face;
  const lKneeY = pelvisY + Math.cos(lLegAng) * thighLen;
  const rKneeX = rHipX + Math.sin(rLegAng) * thighLen * face;
  const rKneeY = pelvisY + Math.cos(rLegAng) * thighLen;

  const lAnkleX = lKneeX + Math.sin(lLegAng + lKneeOff) * calfLen * face;
  const lAnkleY = lKneeY + Math.cos(lLegAng + lKneeOff) * calfLen;
  const rAnkleX = rKneeX + Math.sin(rLegAng + rKneeOff) * calfLen * face;
  const rAnkleY = rKneeY + Math.cos(rLegAng + rKneeOff) * calfLen;

  drawAdvancedLimb(ctx, lHipX, pelvisY, lKneeX, lKneeY, 6, 5, baseColor, strokeColor, limbBulge * 0.5, limbStretch * 0.3);
  drawAdvancedLimb(ctx, lKneeX, lKneeY, lAnkleX, lAnkleY, 5, 4, baseColor, strokeColor, limbBulge, limbStretch);
  drawAdvancedLimb(ctx, rHipX, pelvisY, rKneeX, rKneeY, 6, 5, baseColor, strokeColor, limbBulge * 0.5, limbStretch * 0.3);
  drawAdvancedLimb(ctx, rKneeX, rKneeY, rAnkleX, rAnkleY, 5, 4, baseColor, strokeColor, limbBulge, limbStretch);

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

  // Head
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.arc(headX, headY, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  // Visor
  ctx.fillStyle = "#0c0c0c";
  const vX = headX + face * 6;
  const vY = headY - 2;
  ctx.beginPath();
  ctx.ellipse(vX, vY, 7, 3.5, headTilt, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fighter.color;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.ellipse(vX + face * 2, vY, 2.5, 1.2, headTilt, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

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

  // Ensure full coverage for zoom-out (0.8x zoom needs ~1.25x width)
  const overscan = w * 0.4;
  const drawW = w + overscan * 2;
  const drawX = baseX - overscan;

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

  const farLeft = viewLeft * PARALLAX_FAR + farOff;
  const farRight = viewRight * PARALLAX_FAR + farOff;
  const step = 320;
  let sx = Math.floor(farLeft / step) * step;
  ctx.fillStyle = '#0e1412';
  while (sx < farRight + step) {
    const x = sx;
    const peak = floorY - 380 - (Math.sin(sx * 0.002) * 40);
    ctx.beginPath();
    ctx.moveTo(x - 80, floorY + 20);
    ctx.lineTo(x - 20, peak + 80);
    ctx.lineTo(x + 40, peak + 40);
    ctx.lineTo(x + 100, floorY + 15);
    ctx.closePath();
    ctx.fill();
    sx += step;
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
    const top = floorY - 220;
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

  ctx.fillStyle = '#121a14';
  ctx.fillRect(baseX, floorY + plankH, w, h - floorY - plankH);

  const lanternSpacing = 380;
  let lx = Math.floor(midWorldLeft / lanternSpacing) * lanternSpacing - lanternSpacing;
  while (lx < midWorldRight + lanternSpacing) {
    const x = lx * PARALLAX_MID + midOff;
    const y = floorY - 120;
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

  drawObstacles(ctx, world.obstacles);
  drawAtmosphere(ctx, w, h, camX, now, world);
}

function drawObstacles(ctx, obstacles) {
  if (!obstacles) return;
  obstacles.forEach(o => {
    ctx.save();
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

      // Draw jagged rock
      ctx.beginPath();
      ctx.moveTo(x - 5, groundY);
      ctx.lineTo(x + 5, y + h * 0.2);
      ctx.lineTo(x + 15, y);
      ctx.lineTo(x + 30, y + h * 0.15);
      ctx.lineTo(x + 45, y - h * 0.05);
      ctx.lineTo(x + 60, y + h * 0.2);
      ctx.lineTo(x + o.width + 5, groundY);
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

export function drawDamageNumber(ctx, x, y, dmg, alpha, counter) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const size = counter ? 22 : (dmg >= 15 ? 18 : 15);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeText(String(dmg), x, y);
  ctx.fillStyle = counter ? '#ff9a8a' : (dmg >= 15 ? '#ffc98a' : '#fff');
  ctx.fillText(String(dmg), x, y);
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
