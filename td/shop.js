// Between-wave upgrade shop. Spend gold earned from kills on permanent upgrades.
// Pure DOM + world mutation; the orchestrator pauses the sim while it's open.
import { getAIStats, clampStat } from '../config/stats.js';
import { POWERS } from '../entities/powers.js';
import { SKILLS, SUPPORTED_SKILL_IDS, TD } from './config.js';

const POWER_LIST = Array.isArray(POWERS) ? POWERS : Object.values(POWERS);
const SKILL_NAME = Object.fromEntries(POWER_LIST.map(p => [p.id, p.name]));

let el, listEl, goldEl, waveEl, contBtn;

export function initShop(onContinue) {
  el = document.getElementById('shop');
  if (!el) return;
  listEl = document.getElementById('shopItems');
  goldEl = document.getElementById('shopGold');
  waveEl = document.getElementById('shopWave');
  contBtn = document.getElementById('shopContinue');
  contBtn.addEventListener('click', () => { hideShop(); onContinue(); });
}

export function isShopOpen() { return el && el.classList.contains('visible'); }

export function openShop(world) {
  if (!el) return;
  waveEl.textContent = world.waveState.wave;
  render(world);
  el.classList.add('visible');
}

function hideShop() { el && el.classList.remove('visible'); }

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

function render(world) {
  goldEl.textContent = world.gold;
  listEl.innerHTML = '';
  for (const it of items(world)) {
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
