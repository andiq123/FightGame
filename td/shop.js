// Optional upgrade shop. Spend gold (earned from kills) on permanent upgrades.
// Unlike a classic between-wave shop, this one never pauses the game: it's a
// transparent side panel you can pop open at any time. The hero also spends its
// own gold automatically (aiAutoBuy) on whatever helps it most right now.
import { getAIStats } from '../config/stats.js';
import { POWERS } from '../entities/powers.js';
import { SKILLS, SUPPORTED_SKILL_IDS, TD } from './config.js';

const POWER_LIST = Array.isArray(POWERS) ? POWERS : Object.values(POWERS);
const SKILL_NAME = Object.fromEntries(POWER_LIST.map(p => [p.id, p.name]));

let el, listEl, goldEl, waveEl, closeBtn;
let lastSig = '';

export function initShop() {
  el = document.getElementById('shop');
  if (!el) return;
  listEl = document.getElementById('shopItems');
  goldEl = document.getElementById('shopGold');
  waveEl = document.getElementById('shopWave');
  closeBtn = document.getElementById('shopClose');
  closeBtn && closeBtn.addEventListener('click', closeShop);
}

export function isShopOpen() { return !!(el && el.classList.contains('visible')); }

export function openShop(world) {
  if (!el) return;
  lastSig = '';
  render(world);
  el.classList.add('visible');
}

export function closeShop() { el && el.classList.remove('visible'); }

export function toggleShop(world) {
  isShopOpen() ? closeShop() : openShop(world);
}

// Re-render the open panel only when something it shows actually changed (gold,
// wave, kit) — the game keeps running behind it, so this is called every frame.
export function tickShop(world) {
  if (!isShopOpen()) return;
  render(world);
}

// Build the catalogue against the current hero/base state.
function items(world) {
  const S = TD.SHOP, h = world.hero, base = world.playerTower;
  const list = [
    {
      id: 'power', name: 'Strength +1', desc: `Power ${h.power} → ${h.power + 1} · more HP & damage`,
      cost: S.powerBase + h.power * S.powerPerLevel,
      can: () => h.power < 20,
      buy: () => { h.setStats({ power: h.power + 1 }); },
    },
    {
      id: 'int', name: 'Intelligence +1', desc: `INT ${h.intelligence} → ${h.intelligence + 1} · sharper AI`,
      cost: S.intBase + h.intelligence * S.intPerLevel,
      can: () => h.intelligence < 20,
      buy: () => { h.setStats({ intelligence: h.intelligence + 1 }); h.ai = getAIStats(h.intelligence); },
    },
    {
      id: 'stam', name: 'Max Stamina +' + S.staminaAmount, desc: `Stamina pool ${h.maxStamina} → ${h.maxStamina + S.staminaAmount}`,
      cost: S.staminaUp,
      can: () => true,
      buy: () => { h.maxStamina += S.staminaAmount; h.stamina = h.maxStamina; },
    },
    {
      id: 'heal', name: 'Heal Hero', desc: `Restore the hero to full HP (${Math.ceil(h.hp)}/${h.maxHp})`,
      cost: S.healHero,
      can: () => h.hp < h.maxHp,
      buy: () => { h.hp = h.maxHp; },
    },
    {
      id: 'repair', name: 'Repair Base +' + S.repairAmount, desc: `Base HP ${Math.ceil(base.hp)} → ${Math.min(base.maxHp, Math.ceil(base.hp) + S.repairAmount)}`,
      cost: S.repairBase,
      can: () => base.hp < base.maxHp,
      buy: () => { base.hp = Math.min(base.maxHp, base.hp + S.repairAmount); },
    },
  ];
  // Learn an unequipped power skill.
  const owned = new Set((h.skills || []).map(s => s.id));
  for (const id of SUPPORTED_SKILL_IDS) {
    if (owned.has(id)) continue;
    list.push({
      id: 'skill:' + id, name: 'Learn: ' + (SKILL_NAME[id] || id), desc: 'Add this power skill to the hero',
      cost: S.learnSkill, can: () => true,
      buy: () => { h.skills.push(SKILLS[id]); h.powerCooldowns[id] = 0; },
    });
  }
  return list;
}

// True if the player has gold to afford at least one useful upgrade right now.
export function hasAffordable(world) {
  return items(world).some(it => it.can() && world.gold >= it.cost);
}

// ── AI auto-buy ────────────────────────────────────────────────────────────
// The hero spends like an investor, not a patient. PERMANENT power — intelligence,
// strength, and a skill kit — is what actually wins the run: it compounds every
// wave, so the hero buys it first and hardest while the stats are still low. The
// two consumables are deliberately deprioritised:
//   • Heal is almost never worth gold — the hero already respawns at FULL HP when
//     downed and heals for free in the base zone, so a paid heal buys nothing the
//     game wasn't about to hand over. It's valued below the buy threshold, so the
//     hero banks that gold toward a real upgrade instead.
//   • Repair only matters when the base (the lose condition, which barely
//     self-heals) is genuinely in danger — then it spikes above everything.
// Returns a 0..~130 priority.
function valueOf(it, world) {
  const h = world.hero, base = world.playerTower;
  const skillCount = (h.skills || []).length;
  const baseRatio = base.hp / base.maxHp;
  switch (true) {
    // Intelligence first (reactions + decisions = survival), then strength
    // (HP + damage). Weighted highest when the level is low — early points
    // compound the most — and tapering as the stat climbs toward 20.
    case it.id === 'int':   return 60 + (20 - h.intelligence) * 2.6;   // ~110 @1 … ~60 @20
    case it.id === 'power': return 55 + (20 - h.power) * 2.3;          // ~99 @1 … ~55 @20
    // Filling out the kit — a hero with NO skills desperately needs one (AoE to
    // clear crowds, a heal/buff to survive); value tapers as the arsenal rounds out.
    case it.id.startsWith('skill:'):
      return skillCount === 0 ? 115 : skillCount === 1 ? 78 : skillCount === 2 ? 45 : 18;
    // Save a falling base — ramps hard so a critical base outranks even upgrades.
    case it.id === 'repair': return baseRatio < 0.45 ? (1 - baseRatio) * 120 : 0;
    // Consumable heal — kept below MIN_VALUE so it's effectively never auto-bought
    // (respawn + free base healing already cover HP). Tiny non-zero only as a
    // last-ditch tiebreak if the hero is somehow loaded and at death's door.
    case it.id === 'heal':  return h.hp < h.maxHp * 0.15 ? 16 : 0;
    case it.id === 'stam':  return 14;
    default: return 8;
  }
}
// Below this, the hero banks the gold and waits for a worthwhile upgrade instead
// of frittering it on a marginal buy (stamina, or a heal it doesn't really need).
const MIN_VALUE = 22;

// Let the hero spend its own gold on whatever improves it most. Buys greedily by
// priority until nothing worthwhile is affordable — otherwise it BANKS the gold
// toward the next real upgrade rather than wasting it. Returns the names bought.
export function aiAutoBuy(world) {
  const bought = [];
  for (let guard = 0; guard < 16; guard++) {
    const opts = items(world)
      .filter(it => it.can() && world.gold >= it.cost)
      .map(it => ({ it, v: valueOf(it, world) }))
      .filter(o => o.v >= MIN_VALUE)
      .sort((a, b) => b.v - a.v);
    if (!opts.length) break;
    const best = opts[0].it;
    world.gold -= best.cost;
    best.buy();
    bought.push(best.name);
  }
  return bought;
}

// ── Rendering ──────────────────────────────────────────────────────────────
function render(world) {
  const list = items(world);
  const sig = world.gold + '|' + world.waveState.wave + '|' + list.map(it => it.id + (world.gold >= it.cost && it.can() ? '1' : '0')).join(',');
  if (sig === lastSig) return; // nothing visible changed — keep DOM (and hover) stable
  lastSig = sig;

  goldEl.textContent = world.gold;
  if (waveEl) waveEl.textContent = world.waveState.wave;
  listEl.innerHTML = '';
  for (const it of list) {
    const afford = world.gold >= it.cost && it.can();
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'shop-item' + (afford ? '' : ' disabled');
    row.disabled = !afford;
    row.innerHTML = `<div class="si-text"><div class="si-name">${it.name}</div><div class="si-desc">${it.desc}</div></div>`
      + `<div class="si-cost">${it.cost}<span>g</span></div>`;
    row.addEventListener('click', () => {
      if (world.gold < it.cost || !it.can()) return;
      world.gold -= it.cost;
      it.buy();
      render(world); // refresh costs/affordability after the purchase
    });
    listEl.appendChild(row);
  }
}
