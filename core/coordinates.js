import { GROUND_Y } from '../engine/physics.js';
import { RENDER } from '../config/constants.js';

export function getHitEffectY() {
  return GROUND_Y - RENDER.HIT_EFFECT_OFFSET;
}

export function getCloneDissolveY() {
  return GROUND_Y - RENDER.CLONE_DISSOLVE_OFFSET;
}

export function getRagdollOriginY(fighter) {
  return GROUND_Y - RENDER.STAGGER_ORIGIN_OFFSET + (fighter.y || 0);
}
