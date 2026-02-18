import { POSE } from '../entities/fighter.js';
import { RENDER, COMBAT } from '../config/constants.js';

function darken(c, pct) {
  const m = c.match(/\w\w/g);
  if (!m) return c;
  return '#' + m.map(x => Math.max(0, Math.min(255, parseInt(x, 16) * (1 - pct))).toString(16).padStart(2, '0')).join('');
}

function drawLimb(ctx, x1, y1, x2, y2, r1, r2, fillColor, strokeColor) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 0.001;
  const ux = dx / len;
  const uy = dy / len;
  const ax = -uy * r1;
  const ay = ux * r1;
  const bx = -uy * r2;
  const by = ux * r2;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(x1 + ax, y1 + ay);
  ctx.lineTo(x2 + bx, y2 + by);
  ctx.lineTo(x2 - bx, y2 - by);
  ctx.lineTo(x1 - ax, y1 - ay);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawElasticLimb(ctx, x1, y1, x2, y2, r1, r2, fillColor, strokeColor, restLen, stretchMult = 1) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 0.001;
  const stretch = restLen > 0 ? len / restLen : 1;
  const squash = stretch > 1 ? 1 / Math.sqrt(stretch) : Math.sqrt(stretch);
  const rr1 = r1 * squash * stretchMult;
  const rr2 = r2 * squash * stretchMult;
  const ux = dx / len;
  const uy = dy / len;
  const ax = -uy * rr1;
  const ay = ux * rr1;
  const bx = -uy * rr2;
  const by = ux * rr2;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(x1 + ax, y1 + ay);
  ctx.lineTo(x2 + bx, y2 + by);
  ctx.lineTo(x2 - bx, y2 - by);
  ctx.lineTo(x1 - ax, y1 - ay);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawTaperedLimb(ctx, x1, y1, x2, y2, r1, r2) {
  drawLimb(ctx, x1, y1, x2, y2, r1, r2, ctx.fillStyle || '#888', ctx.strokeStyle || '#666');
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

function hexToRgba(hex, a) {
  const m = hex?.match(/\w\w/g);
  if (!m) return `rgba(160,200,255,${a})`;
  const [r, g, b] = m.map(x => parseInt(x, 16));
  return `rgba(${r},${g},${b},${a})`;
}

export function drawTeleportEffect(ctx, fighter, groundY, now) {
  if (fighter.pose !== POSE.teleport) return;
  const x = fighter.x;
  const y = groundY - RENDER.HIT_EFFECT_OFFSET;
  const t = (fighter.poseTime || 0) * 12;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2);
  const ringR = 28 + pulse * 18 + (fighter.poseTime || 0) * 8;
  const color = fighter.color || '#88aacc';
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, ringR + 30);
  g.addColorStop(0, hexToRgba(color, 0.35));
  g.addColorStop(0.4, hexToRgba(color, 0.15));
  g.addColorStop(0.7, hexToRgba(color, 0.04));
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, ringR + 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.6 + pulse * 0.3);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(color, 0.25);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, ringR * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawStickman(ctx, fighter, groundY, now) {
  const x = fighter.x;
  const flash = (fighter.hitFlashUntil || 0) > now;
  const baseColor = flash ? '#fff' : fighter.color;
  const strokeColor = flash ? '#fff' : darken(baseColor, 0.35);
  const shadowColor = flash ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)';
  const headR = 12;
  const neckH = 6;
  const torsoH = 44;
  let shoulderW = 22;
  const armLen = 26;
  const forearmLen = 22;
  const legLen = 28;
  const calfLen = 24;
  const footLen = 15;
  const waistW = 16;
  const baseY = groundY - 56;
  let headY = baseY - headR - neckH - torsoH - 2;
  let bodyY = baseY - torsoH - 2;
  let pelvisY = baseY;
  let headX = x;
  let bodyX = x;
  const pose = fighter.pose;
  const poseT = fighter.poseTime || 0;
  const face = fighter.facing || 1;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOutBack = t => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const blockT = easeOutCubic(Math.min(1, poseT * 9));
  const punchT = easeInOut(Math.min(1, poseT * 5.5));
  const kickT = easeInOut(Math.min(1, poseT * 4.8));
  const grabT = easeInOut(Math.min(1, poseT * 4.2));
  const slideT = easeOutCubic(Math.min(1, poseT * 5));
  const hitT = easeOutCubic(Math.min(1, poseT * 8));
  const getUpDuration = (COMBAT.GET_UP_DURATION_MS || 520) / 1000;
  const getUpT = easeInOut(Math.min(1, poseT / getUpDuration));
  let lArmAng = -0.38;
  let rArmAng = 0.38;
  let lForeArmAng = 0;
  let rForeArmAng = 0;
  let lLegAng = 0.26;
  let rLegAng = 0.26;
  let lean = 0;
  let bob = 0;
  let squashY = 1;
  let stretchX = 1;
  let torsoTwist = 0;
  if (pose === POSE.block) {
    const armUp = blockT * 1.15;
    lArmAng = -Math.PI / 2 - armUp;
    rArmAng = -Math.PI / 2 - armUp;
    lForeArmAng = 0.35;
    rForeArmAng = 0.35;
    lean = -face * 0.08 * blockT;
    lLegAng = 0.22 + blockT * 0.12;
    rLegAng = 0.22 + blockT * 0.12;
  } else if (pose === POSE.punch) {
    const windup = punchT < 0.18 ? punchT / 0.18 : 1;
    const pullBack = (1 - windup) * 0.55 * face;
    rArmAng = -Math.PI / 2 - pullBack + easeOutBack(punchT) * 1.75 * face;
    rForeArmAng = (punchT > 0.15 ? (punchT - 0.15) / 0.35 : 0) * 0.7 * face;
    torsoTwist = (1 - windup) * -0.12 * face + punchT * 0.28 * face;
    lean = face * (punchT * 0.24 + (1 - windup) * 0.08);
    bodyX = x + face * (punchT * 6 + (1 - windup) * -2);
    lArmAng = -0.5 + (1 - windup) * 0.15 - punchT * 0.1 * face;
  } else if (pose === POSE.kick) {
    const windup = kickT < 0.25 ? kickT / 0.25 : 1;
    const chamber = (1 - windup) * 0.5;
    rLegAng = -0.5 + chamber - kickT * 1.65 * face;
    lLegAng = 0.22 + (1 - windup) * 0.18 - kickT * 0.08 * face;
    lean = -face * (0.28 * kickT + (1 - windup) * 0.12);
    bodyX = x + face * kickT * 6;
    lArmAng = -0.55 - kickT * 0.2 * face;
    rArmAng = 0.5 + kickT * 0.25 * face;
  } else if (pose === POSE.grab) {
    rArmAng = -Math.PI / 2 + grabT * 1.25 * face;
    lArmAng = -0.55 + grabT * 0.4;
    lForeArmAng = grabT * 0.2;
    rForeArmAng = grabT * 0.35 * face;
    lean = face * grabT * 0.12;
    torsoTwist = grabT * 0.15 * face;
  } else if (pose === POSE.slide) {
    const t = slideT;
    bodyX = x + face * t * 16;
    lLegAng = -0.32 - t * 0.85;
    rLegAng = 0.5 + t * 0.4;
    lean = face * t * 0.25;
    lArmAng = -0.4 - t * 0.2;
    rArmAng = 0.35 + t * 0.3;
  } else if (pose === POSE.hit) {
    const impactStrength = Math.min(1.8, ((fighter.hitLastDmg || 5) / 10) + (Math.abs(fighter.vx || 0) / 400) * 0.5);
    lean = -face * 0.38 * hitT * impactStrength;
    bob = Math.sin(hitT * Math.PI) * (6 + impactStrength * 7);
    squashY = 1 - 0.22 * hitT * impactStrength;
    stretchX = 1 + 0.18 * hitT * impactStrength * Math.abs(face);
    lArmAng = -0.4 - hitT * 0.35 * face;
    rArmAng = 0.35 + hitT * 0.4 * face;
    torsoTwist = -face * 0.2 * hitT * impactStrength;
  } else if (pose === POSE.dodge) {
    const t = easeInOut(Math.min(1, poseT * 6));
    const dip = Math.sin(t * Math.PI) * 8;
    bodyX = x + face * t * 26;
    bodyY += dip;
    headY += dip;
    pelvisY += dip * 0.5;
    lean = face * (0.22 + t * 0.28);
    lArmAng = -0.6 - t * 0.2;
    rArmAng = 0.5 + t * 0.35 * face;
  } else if (pose === POSE.jump || pose === POSE.air) {
    const vy = fighter.vy || 0;
    const airT = vy < 0 ? 0.35 : (vy < 120 ? 0.55 : 0.82);
    lArmAng = -0.65 - airT * 1.1;
    rArmAng = 0.65 + airT * 1.1;
    lLegAng = 0.38 + Math.abs(vy) / 600;
    rLegAng = 0.38 + Math.abs(vy) / 600;
    const vx = fighter.vx || 0;
    lean = face * (vx * 0.0002 + airT * 0.08);
  } else if (pose === POSE.getUp) {
    const t = getUpT;
    lean = face * (1 - t) * 0.4;
    lLegAng = 0.15 + (1 - t) * 0.6;
    rLegAng = 0.15 + (1 - t) * 0.6;
    lArmAng = -0.3 - (1 - t) * 0.4;
    rArmAng = 0.3 + (1 - t) * 0.4;
  } else if (pose === POSE.teleport) {
    const t = easeInOut(Math.min(1, poseT * 12));
    const crouch = t * 0.52;
    lLegAng = 0.26 + crouch;
    rLegAng = 0.26 + crouch;
    bodyY += crouch * 16;
    headY += crouch * 10;
    lean = face * t * 0.2;
    lArmAng = -0.4 - t * 0.15;
    rArmAng = 0.4 + t * 0.15;
  } else if (pose === POSE.walk || pose === POSE.run) {
    const cycleSpeed = pose === POSE.run ? 12 : 7.5;
    const phase = (poseT * cycleSpeed) % (2 * Math.PI);
    const stride = pose === POSE.run ? 0.72 : 0.52;
    lLegAng = 0.26 + Math.sin(phase) * stride;
    rLegAng = 0.26 - Math.sin(phase) * stride;
    bob = Math.abs(Math.sin(phase)) * (pose === POSE.run ? 5.5 : 3.2);
    const armSwing = (pose === POSE.run ? 0.48 : 0.4) * Math.sin(phase);
    lArmAng = -0.4 - armSwing;
    rArmAng = 0.4 + armSwing;
    lForeArmAng = Math.sin(phase * 2) * 0.1;
    rForeArmAng = -Math.sin(phase * 2) * 0.1;
    lean = face * Math.sin(phase) * (pose === POSE.run ? 0.06 : 0.03);
  } else {
    const idlePhase = (poseT * 1.4) % (2 * Math.PI);
    const breath = Math.sin(idlePhase) * 1.8;
    bob = breath;
    const weightShift = Math.sin(idlePhase * 0.6) * 0.05;
    lArmAng = -0.38 - Math.sin(idlePhase * 0.65) * 0.08;
    rArmAng = 0.38 + Math.sin(idlePhase * 0.65) * 0.08;
    lLegAng = 0.26 + weightShift + Math.sin(idlePhase * 0.5) * 0.05;
    rLegAng = 0.26 - weightShift - Math.sin(idlePhase * 0.5) * 0.05;
    lForeArmAng = Math.sin(idlePhase * 0.8) * 0.04;
    rForeArmAng = -Math.sin(idlePhase * 0.8) * 0.04;
  }
  const landingT = (fighter.landingSquashUntil || 0) > now ? 1 - (fighter.landingSquashUntil - now) / 180 : 0;
  if (landingT > 0 && pose !== POSE.hit) {
    const landEase = 1 - (1 - landingT) * (1 - landingT);
    squashY = 1 - 0.26 * landEase;
    stretchX = 1 + 0.14 * landEase;
  }
  headX = bodyX + lean * 20 + bob + torsoTwist * 8;
  if (squashY < 1) {
    bodyY += (pelvisY - bodyY) * (1 - squashY) * 0.5;
    headY += (bodyY - headY) * (1 - squashY) * 0.38;
  }
  if (stretchX > 1) {
    const sw = shoulderW * (stretchX - 1) * 0.5;
    headX += face * sw * 0.5;
    shoulderW += sw * 0.7;
  }
  const twistOff = torsoTwist * 6;
  const lShX = bodyX - (shoulderW / 2) * Math.cos(lArmAng) - 4 - twistOff;
  const lShY = bodyY + 5 + (shoulderW / 2) * Math.sin(lArmAng);
  const rShX = bodyX + (shoulderW / 2) * Math.cos(rArmAng) + 4 + twistOff;
  const rShY = bodyY + 5 + (shoulderW / 2) * Math.sin(rArmAng);
  const lElbowX = lShX + armLen * Math.cos(lArmAng);
  const lElbowY = lShY + armLen * Math.sin(lArmAng);
  const rElbowX = rShX + armLen * Math.cos(rArmAng);
  const rElbowY = rShY + armLen * Math.sin(rArmAng);
  const lWristX = lElbowX + forearmLen * Math.cos(lArmAng + lForeArmAng);
  const lWristY = lElbowY + forearmLen * Math.sin(lArmAng + lForeArmAng);
  const rWristX = rElbowX + forearmLen * Math.cos(rArmAng + rForeArmAng);
  const rWristY = rElbowY + forearmLen * Math.sin(rArmAng + rForeArmAng);
  const lHipX = bodyX - waistW / 2;
  const rHipX = bodyX + waistW / 2;
  const lHipY = pelvisY;
  const rHipY = pelvisY;
  const lKneeX = lHipX + legLen * Math.sin(lLegAng) * face;
  const lKneeY = lHipY + legLen * Math.cos(lLegAng);
  const rKneeX = rHipX + legLen * Math.sin(rLegAng) * face;
  const rKneeY = rHipY + legLen * Math.cos(rLegAng);
  const lAnkleX = lKneeX + calfLen * Math.sin(lLegAng + 0.14) * face;
  const lAnkleY = lKneeY + calfLen * Math.cos(lLegAng + 0.14);
  const rAnkleX = rKneeX + calfLen * Math.sin(rLegAng + 0.14) * face;
  const rAnkleY = rKneeY + calfLen * Math.cos(rLegAng + 0.14);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.arc(headX, headY + headR, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  const neckTopY = headY + 2 * headR - 2;
  const neckBottomX = bodyX + lean * 6 + torsoTwist * 4;
  const neckBottomY = bodyY + 2;
  drawCapsule(ctx, headX, neckTopY, neckBottomX, neckBottomY, 4, baseColor, strokeColor);
  drawCapsule(ctx, bodyX - 6, bodyY, bodyX + 6, pelvisY - 2, 9, baseColor, strokeColor);
  drawElasticLimb(ctx, lShX, lShY, lElbowX, lElbowY, 4.5, 4, baseColor, strokeColor, armLen, 1.06);
  drawElasticLimb(ctx, lElbowX, lElbowY, lWristX, lWristY, 4, 3.2, baseColor, strokeColor, forearmLen, 1.06);
  drawElasticLimb(ctx, rShX, rShY, rElbowX, rElbowY, 4.5, 4, baseColor, strokeColor, armLen, 1.06);
  drawElasticLimb(ctx, rElbowX, rElbowY, rWristX, rWristY, 4, 3.2, baseColor, strokeColor, forearmLen, 1.06);
  drawElasticLimb(ctx, lHipX, lHipY, lKneeX, lKneeY, 5.5, 4.2, baseColor, strokeColor, legLen, 1.05);
  drawElasticLimb(ctx, rHipX, rHipY, rKneeX, rKneeY, 5.5, 4.2, baseColor, strokeColor, legLen, 1.05);
  drawElasticLimb(ctx, lKneeX, lKneeY, lAnkleX, lAnkleY, 4.2, 3.6, baseColor, strokeColor, calfLen, 1.05);
  drawElasticLimb(ctx, rKneeX, rKneeY, rAnkleX, rAnkleY, 4.2, 3.6, baseColor, strokeColor, calfLen, 1.05);

  const lToeX = lAnkleX + footLen * face;
  const lToeY = lAnkleY + 3;
  const rToeX = rAnkleX + footLen * face;
  const rToeY = rAnkleY + 3;
  drawLimb(ctx, lAnkleX, lAnkleY, lToeX, lToeY, 3.2, 2.6, baseColor, strokeColor);
  drawLimb(ctx, rAnkleX, rAnkleY, rToeX, rToeY, 3.2, 2.6, baseColor, strokeColor);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

const PARALLAX_FAR = 0.28;
const PARALLAX_MID = 0.58;

export function drawBackground(ctx, w, h, camX) {
  const floorY = 540;
  const baseX = camX - w / 2;
  const viewLeft = baseX;
  const viewRight = baseX + w;
  const farOff = camX * (1 - PARALLAX_FAR);
  const midOff = camX * (1 - PARALLAX_MID);

  const sky = ctx.createLinearGradient(baseX, 0, baseX, h);
  sky.addColorStop(0, '#0d1220');
  sky.addColorStop(0.35, '#151c2e');
  sky.addColorStop(0.65, '#1a2435');
  sky.addColorStop(0.85, '#1e2a28');
  sky.addColorStop(1, '#141c18');
  ctx.fillStyle = sky;
  ctx.fillRect(baseX, 0, w, h);

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
}

export function drawHitEffect(ctx, h) {
  const { x, y, t, block, shield, smoke, clash, counter, heavy, heal, shinra, lightning, fire, shinraDeflect } = h;
  const a = Math.max(0, 1 - t * 1.4);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
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
  } else if (shield) {
    ctx.strokeStyle = 'rgba(120,210,255,0.88)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 36, 0, Math.PI * 2);
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
  } else if (heavy) {
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
  } else {
    const baseR = 18 + (1 - t) * 14;
    ctx.strokeStyle = `rgba(255,200,130,${a})`;
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
  const byType = { heal: [], fire: [], shinra: [], lightning: [], smoke: [], hit: [], teleport: [] };
  particles.forEach(p => {
    if (p.life >= 1) return;
    const t = byType[p.type] || byType.hit;
    t.push(p);
  });
  ctx.lineCap = 'round';
  const drawCircle = (x, y, r) => { ctx.arc(x, y, r, 0, Math.PI * 2); };
  byType.teleport.forEach(p => {
    const a = (1 - p.life) * 0.9;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color ? hexToRgba(p.color, a) : `rgba(160,200,255,${a})`;
    ctx.beginPath();
    drawCircle(p.x, p.y, 4 + (1 - p.life) * 3);
    ctx.fill();
  });
  byType.heal.forEach(p => {
    const a = 1 - p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#70dd99';
    ctx.beginPath();
    drawCircle(p.x, p.y, 3.5);
    ctx.fill();
  });
  byType.fire.forEach(p => {
    const a = 1 - p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(255,${160 - p.life * 90},70,0.95)`;
    ctx.beginPath();
    drawCircle(p.x, p.y, 4);
    ctx.fill();
  });
  byType.shinra.forEach(p => {
    const a = 1 - p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(180,220,255,${a * 0.9})`;
    ctx.beginPath();
    drawCircle(p.x, p.y, 4);
    ctx.fill();
  });
  byType.lightning.forEach(p => {
    const a = 1 - p.life;
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgba(220,240,255,${a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 3, p.y);
    ctx.lineTo(p.x + 3, p.y);
    ctx.stroke();
  });
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
    const x = c.x;
    const dissolve = c.createdAt && (now - c.createdAt) > (3000 - 200) ? Math.min(1, (now - c.createdAt - 2800) / 200) : 0;
    if (dissolve >= 1) return;
    const face = c.facing || 1;
    const headR = 12;
    const torsoH = 40;
    const armLen = 24;
    const legLen = 28;
    const bodyY = groundY - 55 - torsoH;
    const pelvisY = groundY - 55;
    const attackPose = c.attackPoseUntil > now;
    ctx.save();
    ctx.globalAlpha = 1 - dissolve * 0.8;
    ctx.strokeStyle = c.color || '#888';
    ctx.fillStyle = c.color || '#888';
    ctx.lineWidth = 2;
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
    const capColor = c.color || '#888';
    drawCapsule(ctx, x, groundY - 55 - headR - torsoH, x, bodyY, headR, capColor, capColor);
    drawCapsule(ctx, x - 4, bodyY, x + 4, pelvisY, 8, capColor, capColor);
    drawTaperedLimb(ctx, lShoulderX, lShoulderY, lElbowX, lElbowY, 4, 3);
    drawTaperedLimb(ctx, rShoulderX, rShoulderY, rElbowX, rElbowY, 4, 3);
    drawTaperedLimb(ctx, x - 8, pelvisY, x - 8 + legLen * 0.5, pelvisY + legLen, 5, 4);
    drawTaperedLimb(ctx, x + 8, pelvisY, x + 8 + legLen * 0.5 * face, pelvisY + legLen, 5, 4);
    ctx.restore();
  });
}
