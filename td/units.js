import { Fighter, POSE } from '../entities/fighter.js';
import { ATTACK } from '../entities/attacks.js';
import { buildTraits } from '../config/traits.js';
import { getAIStats, clampStat, statT } from '../config/stats.js';
import { TD, SKILLS, SUPPORTED_SKILL_IDS } from './config.js';

let _idSeq = 1;

// The hero: a full-featured Fighter, configured from the player's chosen loadout
// (power, intelligence, traits, passives, skills). Reuses the shared trait/stat
// systems so every existing rendering + combat flourish applies automatically.
export function createHero(loadout = {}) {
  const power = loadout.power ?? 12;
  const intelligence = loadout.intelligence ?? 12;

  const h = new Fighter(_idSeq++, TD.HERO.color, TD.PLAYER_TOWER_X + 220, 1);
  h.setStats({ power, intelligence });

  const { traits, style } = buildTraits(loadout.traits ?? ['athletic', 'caped']);
  h.traits = traits;
  h.style = style;
  h.capeColor = style === 'caped' ? '#1f9b91' : null;
  h.passives = loadout.passives ?? [];

  // Equip only skills we actually implement in the TD; keep the chosen order.
  const skillIds = (loadout.skills ?? []).filter(id => SUPPORTED_SKILL_IDS.includes(id));
  h.skills = skillIds.map(id => SKILLS[id]);
  h.setPowers(skillIds); // primes powerCooldowns used by skill gating

  h.ai = getAIStats(intelligence); // cached behavioural profile
  h.maxStamina = TD.HERO.maxStamina;
  h.stamina = h.maxStamina;
  h.groundY = 0;
  h.isHero = true;
  h._nextDecisionAt = 0;
  h.hp = h.maxHp;
  return h;
}

// A marching monster. Driven by the same Fighter body (for animation + hit
// resolution) but with a lightweight walk-and-attack brain in td/ai.js. Every
// wave it spawns at a higher STRENGTH and INTELLIGENCE level: strength scales
// HP + damage, intelligence speeds up its attacks.
export function createMonster(typeKey, wave = 1) {
  const def = TD.MONSTERS[typeKey];
  const W = TD.WAVE;
  const strLevel = clampStat(def.power + Math.floor((wave - 1) * W.strPerWave));
  const intLevel = clampStat(def.intelligence + Math.floor((wave - 1) * W.intPerWave));
  const strGain = strLevel - def.power;                 // levels above this type's base
  const strFac = 1 + strGain * W.hpPerStr;

  const m = new Fighter(_idSeq++, def.color, TD.ENEMY_TOWER_X - 120, -1);
  if (def.cape) { m.style = 'caped'; m.capeColor = def.cape; }
  m.setStats({ power: strLevel, intelligence: intLevel }); // m.power / m.intelligence shown above the head
  // def.hp is the literal HP pool — neutralise the power-curve damage-taken
  // multiplier so HP numbers stay honest, then scale by strength gained.
  m.damageTakenMult = 1;
  m.maxHp = m.hp = Math.round(def.hp * strFac);

  // Per-instance combat stats (combat/ai read these, falling back to def).
  m.dmg = Math.round(def.dmg * strFac);
  m.towerDmg = Math.round(def.towerDmg * strFac);
  m.atkCdMs = Math.round(def.atkCdMs * (1 - statT(intLevel) * 0.45)); // smarter = attacks faster
  m.reward = Math.round(def.reward * (1 + (wave - 1) * W.rewardPerWave));

  m.scale = def.scale;
  m.aggro = def.aggro;
  m.ranged = def.ranged || null; // caster archetypes fire projectiles at the hero
  if (m.ranged) m.rangedDmg = Math.round(m.ranged.damage * strFac);
  m.groundY = 0;
  m.isMonster = true;
  m.typeKey = typeKey;
  m.def = def;
  m.nextAtkAt = 0;
  m.facing = -1; // marching left toward the player tower
  return m;
}

export { POSE, ATTACK };
