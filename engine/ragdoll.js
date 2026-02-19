import { GROUND_Y } from './physics.js';
import { ARENA, COMBAT } from '../config/constants.js';

const GRAVITY = 1820;
const AIR_DAMPING = 0.995;
const GROUND_FRICTION = 0.84;
const GROUND_RESTITUTION = 0.15;
const WALL_RESTITUTION = 0.25;
const CONSTRAINT_ITERATIONS = 10;
const CONSTRAINT_STIFFNESS = 0.58;
const SETTLE_THRESHOLD = 0.95;
const MAX_POINT_VEL = 3500;
const WALL_MARGIN = 18;

function makePoint(x, y, vx = 0, vy = 0, mass = 1) {
  const dt = 0.016;
  return { x, y, prevX: x - vx * dt, prevY: y - vy * dt, mass };
}

function spreadVelocity(vx, vy, hitDir, upward, side, isImpactSide) {
  const h = Math.abs(vx) + Math.abs(vy) * 0.3;
  const impactMult = isImpactSide ? 1.15 : 0.85;
  const sideBias = side * hitDir;
  const rot = sideBias * h * 0.25 * impactMult;
  let dx = vx * (0.5 + 0.5 * (1 - Math.abs(sideBias))) * impactMult + rot;
  let dy = vy * (upward ? (0.9 + 0.3 * (1 - Math.abs(side))) : (0.6 + 0.2 * Math.abs(side))) * impactMult;
  return { vx: dx, vy: dy };
}

export function createRagdoll(x, y, facing, vx, vy, hitFromX = null, upwardHit = false, startTime = 0, dt = 0.016) {
  const dir = facing || 1;
  const hitDir = hitFromX != null ? (x > hitFromX ? 1 : -1) : 0;
  const headR = 14;
  const torsoH = 48;
  const armLen = 28;
  const legLen = 32;
  const hv = vx * 0.85;
  const vv = vy * 0.9;
  const hvL = hitDir === 1 ? 1.1 : 0.75;
  const hvR = hitDir === -1 ? 1.1 : 0.75;
  const hh = spreadVelocity(hv, vv, hitDir, upwardHit, -1, hitDir === 1);
  const hr = spreadVelocity(hv, vv, hitDir, upwardHit, 1, hitDir === -1);
  const head = makePoint(x, y - headR - torsoH, hh.vx * 0.7, (upwardHit ? vv * 1.2 : hh.vy) * 0.8, 0.35); // Lighter head
  const chest = makePoint(x, y - torsoH * 0.6, hv * 0.9, vv * 0.95, 1.2);
  const pelvis = makePoint(x, y, vx, vy, 1.8); // Heavier pelvis for stability
  const lShoulder = makePoint(x - 12, y - torsoH * 0.7, hv * hvL * 0.75, vv * 0.85, 0.4);
  const rShoulder = makePoint(x + 12, y - torsoH * 0.7, hv * hvR * 0.75, vv * 0.85, 0.4);
  const lElbow = makePoint(x - 12 - armLen * dir, y - torsoH * 0.4, hv * hvL * 0.5, vv * 0.7, 0.3);
  const rElbow = makePoint(x + 12 + armLen * dir, y - torsoH * 0.4, hv * hvR * 0.5, vv * 0.7, 0.3);
  const lHip = makePoint(x - 10, y, vx * 0.95, vy, 0.8);
  const rHip = makePoint(x + 10, y, vx * 0.95, vy, 0.8);
  const lKnee = makePoint(x - 10 + legLen * 0.4 * dir, y + legLen * 0.6, vx * 0.75, vy * 0.95, 0.5);
  const rKnee = makePoint(x + 10 + legLen * 0.4 * dir, y + legLen * 0.6, vx * 0.75, vy * 0.95, 0.5);
  const lFoot = makePoint(x - 10 + legLen * 0.9 * dir, y + legLen * 1.2, vx * 0.6, vy * 0.85, 0.4);
  const rFoot = makePoint(x + 10 + legLen * 0.9 * dir, y + legLen * 1.2, vx * 0.6, vy * 0.85, 0.4);
  return {
    points: [head, chest, pelvis, lShoulder, rShoulder, lElbow, rElbow, lHip, rHip, lKnee, rKnee, lFoot, rFoot],
    groundY: GROUND_Y + 6,
    leftBound: -ARENA.BOUNDS + WALL_MARGIN,
    rightBound: ARENA.BOUNDS - WALL_MARGIN,
    startTime,
    facing: dir,
    lastDt: dt // Track dt for stable variable-time-step Verlet
  };
}

function applyAngularTension(p1, p2, p3, targetAng, strength) {
  const ang1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const ang2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
  const currentRel = ang2 - ang1;
  let diff = targetAng - currentRel;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  const move = diff * strength;
  const cos = Math.cos(ang2 + move);
  const sin = Math.sin(ang2 + move);
  const len = Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const nextX = p2.x + cos * len;
  const nextY = p2.y + sin * len;

  // Maintain velocity while shifting position
  const dx = nextX - p3.x;
  const dy = nextY - p3.y;
  p3.x = nextX;
  p3.y = nextY;
  p3.prevX += dx;
  p3.prevY += dy;
}

function applyAngleLimit(p1, p2, p3, minAng, maxAng, strength = 0.5) {
  const ang1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const ang2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
  let rel = ang2 - ang1;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;

  if (rel < minAng || rel > maxAng) {
    const target = rel < minAng ? minAng : maxAng;
    let diff = target - rel;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const move = diff * strength;
    const cos = Math.cos(ang2 + move);
    const sin = Math.sin(ang2 + move);
    const len = Math.hypot(p3.x - p2.x, p3.y - p2.y);
    const nextX = p2.x + cos * len;
    const nextY = p2.y + sin * len;

    // Energy Neutral Shift: maintain existing velocity
    const dx = nextX - p3.x;
    const dy = nextY - p3.y;
    p3.x = nextX;
    p3.y = nextY;
    p3.prevX += dx;
    p3.prevY += dy;
  }
}

function constrainSegment(p1, p2, restLen, stiffness = CONSTRAINT_STIFFNESS) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const diff = (restLen - d) / d * stiffness;
  const m1 = p1.mass || 1;
  const m2 = p2.mass || 1;
  const t = m2 / (m1 + m2);
  const mx = dx * diff * t;
  const my = dy * diff * t;
  p1.x -= mx;
  p1.y -= my;
  p2.x += dx * diff * (1 - t);
  p2.y += dy * diff * (1 - t);
}

function applyWall(p, leftBound, rightBound) {
  if (p.x < leftBound || p.x > rightBound) {
    const vx = p.x - p.prevX;
    p.x = p.x < leftBound ? leftBound : rightBound;
    p.prevX = p.x + vx * WALL_RESTITUTION;
  }
}

function applyGround(p, groundY) {
  if (p.y >= groundY) {
    const velY = p.y - p.prevY;
    p.y = groundY;
    if (velY > 0) {
      const bounce = -velY * GROUND_RESTITUTION;
      p.prevY = p.y - bounce;
    } else {
      p.prevY = Math.min(p.prevY, groundY);
    }
    const vx = p.x - p.prevX;
    p.prevX = p.x - vx * GROUND_FRICTION;
  }
}

function applyObstacles(p, obstacles) {
  if (!obstacles || obstacles.length === 0) return;
  obstacles.forEach(o => {
    const dx = p.x - o.x;
    const halfW = o.width / 2;
    const margin = 18;
    if (Math.abs(dx) < halfW + margin) {
      const disp = p.x - p.prevX;
      if (p.x < o.x) {
        p.x = o.x - halfW - margin;
        p.prevX = p.x + disp * WALL_RESTITUTION;
      } else {
        p.x = o.x + halfW + margin;
        p.prevX = p.x + disp * WALL_RESTITUTION;
      }
    }
  });
}

export function updateRagdoll(ragdoll, dt, now, obstacles = []) {
  if (dt <= 0) return;
  const { points, groundY, leftBound, rightBound, startTime, facing, lastDt } = ragdoll;
  const physicsDt = lastDt || dt; // Use previous dt for velocity derivation
  const elapsed = startTime ? now - startTime : 0;
  const activeT = Math.max(0, 1 - elapsed / (COMBAT.STAGGER_ACTIVE_MS || 850));
  const tension = activeT * (COMBAT.STAGGER_TENSION_STRENGTH || 0.12);

  points.forEach(p => {
    let velX = (p.x - p.prevX) / physicsDt;
    let velY = (p.y - p.prevY) / physicsDt;
    const inAir = p.y < groundY - 2;
    if (inAir) {
      velY += GRAVITY * dt;
      velX *= AIR_DAMPING;
      velY *= AIR_DAMPING;
    }
    p.prevX = p.x;
    p.prevY = p.y;

    // Velocity Clamp to prevent explosion
    const speed = Math.hypot(velX, velY);
    if (speed > MAX_POINT_VEL) {
      const mult = MAX_POINT_VEL / speed;
      velX *= mult;
      velY *= mult;
    }

    p.x += velX * dt;
    p.y += velY * dt;
    applyWall(p, leftBound, rightBound);
    applyGround(p, groundY);
    applyObstacles(p, obstacles);
  });

  ragdoll.lastDt = dt; // Save dt for next frame

  const [head, chest, pelvis, lSh, rSh, lEl, rEl, lHip, rHip, lKn, rKn, lFt, rFt] = points;

  for (let i = 0; i < CONSTRAINT_ITERATIONS; i++) {
    // Basic Skeleton Constraints
    constrainSegment(head, chest, 22);
    constrainSegment(chest, pelvis, 28);
    constrainSegment(chest, lSh, 10);
    constrainSegment(chest, rSh, 10);
    constrainSegment(lSh, lEl, 28);
    constrainSegment(rSh, rEl, 28);
    constrainSegment(pelvis, lHip, 10);
    constrainSegment(pelvis, rHip, 10);
    constrainSegment(lHip, lKn, 32);
    constrainSegment(rHip, rKn, 32);
    constrainSegment(lKn, lFt, 24);
    constrainSegment(rKn, rFt, 24);

    // Joint Angle Limits (The Euphoria Skeleton Feel)
    const f = facing || 1;
    // Knees: Only bend backward, never forward
    applyAngleLimit(lHip, lKn, lFt, 0.1, 1.8, 0.4);
    applyAngleLimit(rHip, rKn, rFt, 0.1, 1.8, 0.4);
    // Elbows: Use Chest, Shoulder, Elbow chain
    applyAngleLimit(chest, lSh, lEl, -2.1, 0.4, 0.3);
    applyAngleLimit(chest, rSh, rEl, -2.1, 0.4, 0.3);
    // Neck: Don't let head rotate 180 degrees
    applyAngleLimit(pelvis, chest, head, -0.6 * f, 0.6 * f, 0.2);

    // Active Muscle Tension (Euphoria Feel)
    if (tension > 0) {
      // Head/Neck tension (keep upright-ish)
      applyAngularTension(pelvis, chest, head, 0.05 * f, tension * 2.0);

      // Active Fall Protection: Reaching arms toward the ground
      const chestVy = (chest.y - chest.prevY);
      if (chestVy > 5 && (groundY - chest.y) < 120) {
        // Falling fast and close to ground: reach out
        applyAngularTension(chest, lSh, lEl, -0.8 * f, tension * 1.5);
        applyAngularTension(chest, rSh, rEl, -0.8 * f, tension * 1.5);
        applyAngularTension(chest, lHip, lKn, 0.4 * f, tension);
        applyAngularTension(chest, rHip, rKn, 0.4 * f, tension);
      } else {
        // Fetal position/tensed limbs on impact
        applyAngularTension(chest, rSh, rEl, -0.4 * f, tension);
        applyAngularTension(chest, lSh, lEl, -0.4 * f, tension);
        applyAngularTension(pelvis, rHip, rKn, 0.5 * f, tension);
        applyAngularTension(pelvis, lHip, lKn, 0.5 * f, tension);
        applyAngularTension(rHip, rKn, rFt, 1.2 * f, tension);
        applyAngularTension(lHip, lKn, lFt, 1.2 * f, tension);
      }
    }

    points.forEach(p => {
      applyWall(p, leftBound, rightBound);
      applyGround(p, groundY);
      applyObstacles(p, obstacles);
    });
  }
}


export function drawRagdoll(ctx, ragdoll, color) {
  const { points, facing, groundY } = ragdoll;
  const [head, chest, pelvis, lSh, rSh, lEl, rEl, lHip, rHip, lKn, rKn, lFt, rFt] = points;
  const strokeColor = darken(color, 0.35);
  const baseColor = color;
  const face = facing || 1;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Shadow
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(pelvis.x, groundY - 6, 40, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Legs
  drawAdvancedLimb(ctx, pelvis.x, pelvis.y, lHip.x, lHip.y, 6, 5, baseColor, strokeColor);
  drawAdvancedLimb(ctx, lHip.x, lHip.y, lKn.x, lKn.y, 5, 4, baseColor, strokeColor);
  drawAdvancedLimb(ctx, lKn.x, lKn.y, lFt.x, lFt.y, 4, 3, baseColor, strokeColor);

  drawAdvancedLimb(ctx, pelvis.x, pelvis.y, rHip.x, rHip.y, 6, 5, baseColor, strokeColor);
  drawAdvancedLimb(ctx, rHip.x, rHip.y, rKn.x, rKn.y, 5, 4, baseColor, strokeColor);
  drawAdvancedLimb(ctx, rKn.x, rKn.y, rFt.x, rFt.y, 4, 3, baseColor, strokeColor);

  // Torso
  drawCapsule(ctx, chest.x, chest.y, pelvis.x, pelvis.y, 11, baseColor, strokeColor);

  // Arms
  drawAdvancedLimb(ctx, chest.x, chest.y, lSh.x, lSh.y, 5, 4, baseColor, strokeColor);
  drawAdvancedLimb(ctx, lSh.x, lSh.y, lEl.x, lEl.y, 4, 3.5, baseColor, strokeColor);

  drawAdvancedLimb(ctx, chest.x, chest.y, rSh.x, rSh.y, 5, 4, baseColor, strokeColor);
  drawAdvancedLimb(ctx, rSh.x, rSh.y, rEl.x, rEl.y, 4, 3.5, baseColor, strokeColor);

  // Head
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Visor on ragdoll
  ctx.fillStyle = "#0c0c0c";
  const vX = head.x + face * 6;
  const vY = head.y - 2;
  const headVelX = head.x - head.prevX;
  const headVelY = head.y - head.prevY;
  const headRot = Math.atan2(headVelY, headVelX) * 0.2;
  ctx.beginPath();
  ctx.ellipse(vX, vY, 7, 3.5, headRot, 0, Math.PI * 2);
  ctx.fill();
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

function darken(c, pct) {
  const m = c.match(/\w\w/g);
  if (!m) return c;
  return '#' + m.map(x => Math.max(0, Math.min(255, parseInt(x, 16) * (1 - pct))).toString(16).padStart(2, '0')).join('');
}

function drawAdvancedLimb(ctx, x1, y1, x2, y2, r1, r2, fillColor, strokeColor) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 0.001;
  const ux = dx / len;
  const uy = dy / len;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const midR = Math.max(r1, r2) * 1.15;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(x1 - uy * r1, y1 + ux * r1);
  ctx.quadraticCurveTo(midX - uy * midR, midY + ux * midR, x2 - uy * r2, y2 + ux * r2);
  ctx.arc(x2, y2, r2, Math.atan2(uy, ux) - Math.PI / 2, Math.atan2(uy, ux) + Math.PI / 2);
  ctx.quadraticCurveTo(midX + uy * midR, midY - ux * midR, x1 + uy * r1, y1 - ux * r1);
  ctx.arc(x1, y1, r1, Math.atan2(uy, ux) + Math.PI / 2, Math.atan2(uy, ux) - Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function isRagdollSettled(ragdoll) {
  const { points } = ragdoll;
  for (const p of points) {
    const vx = p.x - p.prevX;
    const vy = p.y - p.prevY;
    if (Math.abs(vx) > SETTLE_THRESHOLD || Math.abs(vy) > SETTLE_THRESHOLD) return false;
  }
  return true;
}
