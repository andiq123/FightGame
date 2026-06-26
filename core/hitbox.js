import { COMBAT } from '../config/constants.js';
import { ATTACK } from '../entities/attacks.js';

// Stick-figure volumes in fighter logical space (feet at y=0, up is negative).
const GROUND_TOP = 106;
const GROUND_BOT = 8;
const FLY_TOP = 62;
const FLY_BOT = 22;
const CHEST = 68;
const FLY_CHEST = 28;
const CORE_HALF_W = 22;

export function bodyHalfW(u) {
  const s = u?.scale || 1;
  return (CORE_HALF_W + 4 * Math.min(s, 2.2)) * s;
}

export function bodyYSpan(u) {
  const s = u?.scale || 1;
  const y = u?.y || 0;
  if (u?.flying && !u?._hoverOff) {
    return { top: y - FLY_TOP * s, bot: y + FLY_BOT * s, mid: y - FLY_CHEST * s };
  }
  return { top: y - GROUND_TOP * s, bot: y + GROUND_BOT * s, mid: y - CHEST * s };
}

export function aimY(u) {
  return bodyYSpan(u).mid;
}

export function overlap1D(a0, a1, b0, b1, pad = 0) {
  return a0 - pad <= b1 + pad && a1 + pad >= b0 - pad;
}

export function bodyBox(u) {
  const hw = bodyHalfW(u);
  const { top, bot } = bodyYSpan(u);
  return { left: u.x - hw, right: u.x + hw, top, bot };
}

export function attackBox(attacker, hb) {
  const s = attacker?.scale || 1;
  const w = hb.w * (0.88 + s * 0.1);
  return { left: hb.x - w * 0.5, right: hb.x + w * 0.5 };
}

export function meleeOverlapX(hb, attacker, defender, pad = COMBAT.HITBOX_EXTRA * 0.35) {
  const ab = attackBox(attacker, hb);
  const db = bodyBox(defender);
  return overlap1D(ab.left, ab.right, db.left, db.right, pad);
}

export function arenaMeleeVertical(hb, attacker, defender) {
  const gap = Math.abs(bodyYSpan(attacker).mid - bodyYSpan(defender).mid);
  const launcher = hb.kickLaunch || hb.knockdown
    || hb.type === ATTACK.uppercut || hb.type === ATTACK.highKick;
  const reach = launcher ? (COMBAT.VERTICAL_REACH_HIGH ?? 180) : (COMBAT.VERTICAL_REACH ?? 95);
  return gap <= reach + 18 * (attacker?.scale || 1);
}

export function projHitsUnit(p, u) {
  const bb = bodyBox(u);
  const r = p.radius ?? 0;
  const pad = Math.min(r * 0.45, 14);
  return overlap1D(p.x - r, p.x + r, bb.left, bb.right, pad * 0.35)
    && p.y >= bb.top - pad && p.y <= bb.bot + pad;
}

export function projSegmentHitsUnit(prevX, prevY, x, y, radius, u) {
  const bb = bodyBox(u);
  const segMinX = Math.min(prevX, x);
  const segMaxX = Math.max(prevX, x);
  if (!overlap1D(segMinX, segMaxX, bb.left, bb.right, radius)) return false;
  const segMinY = Math.min(prevY, y);
  const segMaxY = Math.max(prevY, y);
  return overlap1D(segMinY, segMaxY, bb.top, bb.bot, radius);
}

export function baseBox(base) {
  const h = base.h ?? 360;
  const w = base.w ?? 150;
  return { left: base.x - w * 0.5, right: base.x + w * 0.5, top: -(h - 16), bot: 12 };
}

export function projHitsBase(p, base) {
  const bb = baseBox(base);
  const r = p.radius ?? 0;
  return overlap1D(p.x - r, p.x + r, bb.left, bb.right, 6)
    && p.y >= bb.top - r * 0.5 && p.y <= bb.bot;
}

export function inRadiusX(cx, radius, u) {
  return Math.abs(u.x - cx) <= radius + bodyHalfW(u);
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('hitbox.js')) {
  const ground = { x: 100, y: 0, scale: 1, flying: false };
  console.assert(!projHitsUnit({ x: 100, y: -200, radius: 26, flyBolt: true }, ground), 'overhead misses');
  console.assert(projHitsUnit({ x: 100, y: -58, radius: 26 }, ground), 'chest bolt hits');
  const hb = { x: 130, w: 60, type: ATTACK.jab, high: true };
  console.assert(meleeOverlapX(hb, { x: 100, scale: 1 }, ground), 'melee AABB reaches');
  const fly = { x: 100, y: -140, scale: 1, flying: true };
  const span = bodyYSpan(fly);
  console.assert(span.top < span.bot && span.top < -100, 'flyer box above ground');
  const base = { x: 1950, w: 150, h: 360 };
  console.assert(projHitsBase({ x: 1950, y: -120, radius: 40 }, base), 'base hit mid tower');
  console.log('hitbox ok');
}
