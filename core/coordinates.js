import { GROUND_Y } from '../engine/physics.js';
import { RENDER } from '../config/constants.js';

export function getHitEffectY(entityY = 0) {
  return GROUND_Y - RENDER.HIT_EFFECT_OFFSET + entityY;
}

export function getCloneDissolveY(entityY = 0) {
  return GROUND_Y - RENDER.CLONE_DISSOLVE_OFFSET + entityY;
}

export function getRagdollOriginY(fighter) {
  return GROUND_Y - RENDER.STAGGER_ORIGIN_OFFSET + (fighter.y || 0);
}
