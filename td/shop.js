// Optional upgrade shop. Spend gold (earned from kills) on permanent upgrades.
// Unlike a classic between-wave shop, this one never pauses the game: it's a
// transparent side panel you can pop open at any time. The hero also spends its
// own gold automatically (aiAutoBuy) on whatever helps it most right now.
import { getAIStats } from '../config/stats.js';
import { POWERS } from '../entities/powers.js';
import { SKILLS, SUPPORTED_SKILL_IDS, TD } from './config.js';
import { createAlly } from './units.js';

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
  const S = TD.SHOP, h = world.hero;
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
      id: 'ally', name: 'Recruit Ally', desc: `Summon an allied fighter (${world.allies.length}/${TD.ALLY.maxAlive})`,
      cost: S.recruitAlly + world.allies.length * S.recruitAllyPerOwned,
      can: () => world.allies.length < TD.ALLY.maxAlive,
      buy: () => { const a = createAlly(world.waveState.wave); a.needsDashDust = true; world.allies.push(a); },
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
// The hero spends like an investor with a taste for variety. PERMANENT power —
// intelligence, strength, the skill kit — compounds every wave, so it's bought
// first and hardest while the stats are low; allies and stamina round out the
// build. Crucially NOTHING is parked below the buy threshold, so given enough gold
// the hero EVENTUALLY buys everything on offer (every stat to 20, every skill,
// a full squad of allies, deeper stamina). Returns a 0..~130 base priority that
// the buy loop then jitters, so the order of acquisition varies run to run.
function valueOf(it, world) {
  const h = world.hero;
  const skillCount = (h.skills || []).length;
  switch (true) {
    // Intelligence first (reactions + decisions = survival), then strength
    // (HP + damage). Weighted highest when the level is low — early points
    // compound the most — and tapering as the stat climbs toward 20.
    case it.id === 'int':   return 60 + (20 - h.intelligence) * 2.6;   // ~110 @1 … ~60 @20
    case it.id === 'power': return 55 + (20 - h.power) * 2.3;          // ~99 @1 … ~55 @20
    // Filling out the kit — a hero with NO skills desperately needs one (AoE to
    // clear crowds); value tapers but stays buyable so the WHOLE kit is learned.
    case it.id.startsWith('skill:'):
      return skillCount === 0 ? 115 : skillCount === 1 ? 80 : skillCount === 2 ? 56 : 36;
    // Recruit allies — extra bodies on the line. Worth more the fewer you have and
    // the more your base is hurting (they soak the siege that bleeds it).
    case it.id === 'ally': {
      const count = world.allies.length;
      const baseDanger = 1 - world.playerTower.hp / world.playerTower.maxHp;
      return (74 - count * 14) + baseDanger * 70;
    }
    // Deeper stamina pool — modest, but well above the floor so it's steadily
    // stocked once the big-ticket upgrades are in.
    case it.id === 'stam':  return 30;
    default: return 12;
  }
}
// A low floor: anything genuinely useful clears it, so surplus gold keeps flowing
// into the build rather than sitting idle — everything gets bought in time.
const MIN_VALUE = 18;

// Let the hero spend its own gold on the build. Each option's desire is JITTERED
// (±~25%) and there's a chance it splurges on something other than the strict best
// — so the acquisition order is a little random and varied run to run, while still
// favouring the highest-impact upgrades. Buys until nothing worthwhile is
// affordable. Returns the names bought.
export function aiAutoBuy(world) {
  const bought = [];
  for (let guard = 0; guard < 20; guard++) {
    const opts = items(world)
      .filter(it => it.can() && world.gold >= it.cost)
      .map(it => ({ it, v: valueOf(it, world) * (0.8 + world.rng() * 0.45) })) // jittered desire
      .filter(o => o.v >= MIN_VALUE)
      .sort((a, b) => b.v - a.v);
    if (!opts.length) break;
    // Usually take the best; ~20% of the time grab a random other affordable pick
    // — keeps builds varied and guarantees the long tail eventually gets bought.
    const pick = (opts.length > 1 && world.rng() < 0.2)
      ? opts[1 + Math.floor(world.rng() * (opts.length - 1))]
      : opts[0];
    world.gold -= pick.it.cost;
    pick.it.buy();
    bought.push(pick.it.name);
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
