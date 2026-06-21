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
// How badly the hero wants each upgrade *right now*. Context-sensitive: a heal
// is worthless at full HP but the top priority when nearly dead; repairing the
// base climbs as the base (the lose condition) drops. Steady upgrades have a
// flat-ish value that tapers as the stat climbs. Returns a 0..~140 priority.
function valueOf(it, world) {
  const h = world.hero, base = world.playerTower;
  if (it.id === 'repair') return (1 - base.hp / base.maxHp) * 140; // base falling = game over
  if (it.id === 'heal')   return (1 - h.hp / h.maxHp) * 110;       // urgent only when hurt
  if (it.id === 'power')  return 62 - h.power * 1.6;               // tapers with level
  if (it.id === 'int')    return 60 - h.intelligence * 1.6;
  if (it.id.startsWith('skill:')) return 48;                       // strong one-time pickup
  if (it.id === 'stam')   return 18;
  return 10;
}
// Below this, the hero would rather bank the gold than buy something marginal.
const MIN_VALUE = 24;

// Let the hero spend its own gold on whatever helps it most. Buys greedily by
// priority until nothing worthwhile is affordable. Returns the names bought.
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
