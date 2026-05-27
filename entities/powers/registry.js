import { FIGHTER } from '../../config/constants.js';

const registry = new Map();

export function registerPower(id, meta, handlers) {
  registry.set(id, { id, ...meta, ...handlers });
}

export function getPower(id) {
  return registry.get(id);
}

export function getPowerStaminaCost(id) {
  const p = registry.get(id);
  return p?.staminaCost ?? FIGHTER.POWER_BASE_COST;
}

export function getAllPowers() {
  return Object.fromEntries([...registry.entries()].map(([k, v]) => [k, { id: v.id, name: v.name, cooldown: v.cooldown, tip: v.tip, staminaCost: getPowerStaminaCost(k) }]));
}

export function getValidPowerIds() {
  return [...registry.keys()];
}

export function scorePower(pid, ctx) {
  const p = registry.get(pid);
  return p?.score ? p.score(ctx) : 0;
}

export function executePower(pid, ctx) {
  const p = registry.get(pid);
  return p?.execute ? p.execute({ ...ctx, world: ctx.world }) : false;
}

export function getSpawnEffect(pid) {
  const p = registry.get(pid);
  return p?.spawnEffect || null;
}
