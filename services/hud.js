import { POWERS } from '../entities/powers.js';
import { AZURE_ASSASSIN } from '../ai/monsters.js';

const DOM_SUFFIX = { hpSet: 'hpSet', intelligence: 'intelligence', powers: 'powers', jutsuSlots: 'jutsuSlots' };

export function getFighterDomId(idx, key) {
  return `${DOM_SUFFIX[key] || key}${idx + 1}`;
}

export function updateBars(f1, f2, hp1, hp2, stam1, stam2) {
  if (hp1) hp1.style.width = `${(f1.hp / f1.maxHp) * 100}%`;
  if (hp2) hp2.style.width = `${(f2.hp / f2.maxHp) * 100}%`;
  if (stam1) stam1.style.width = `${(f1.stamina / f1.maxStamina) * 100}%`;
  if (stam2) stam2.style.width = `${(f2.stamina / f2.maxStamina) * 100}%`;
}

export function updateHealthNumbers(f1, f2, health1, health2) {
  if (health1) health1.textContent = `${Math.ceil(Math.max(0, f1.hp))} / ${Math.ceil(f1.maxHp)}`;
  if (health2) health2.textContent = `${Math.ceil(Math.max(0, f2.hp))} / ${Math.ceil(f2.maxHp)}`;
}

export function updateRounds(el, f1, f2, max) {
  if (el) el.textContent = `${f1.roundsWon} - ${f2.roundsWon} | R${f1.roundsWon + f2.roundsWon + 1}/${max}`;
}

export function updatePowerCooldownUI(f1, f2, now) {
  if (!f1 || !f2) return;
  [f1, f2].forEach((f, i) => {
    const el = document.getElementById(getFighterDomId(i, 'powers'));
    if (!el) return;
    el.querySelectorAll('.power-btn').forEach(btn => {
      const pid = btn.dataset.power;
      const remain = Math.max(0, (f.powerCooldowns[pid] || 0) - now);
      const maxCd = POWERS[pid]?.cooldown || 20000;
      btn.dataset.cooldown = remain > 0 ? Math.ceil(remain / 1000) : '';
      btn.style.setProperty('--cd-pct', remain > 0 ? (remain / maxCd) * 100 : 0);
      btn.classList.toggle('on-cooldown', remain > 0);
    });
  });
}

export function updateJutsuHUD(f1, f2, skillFeed, now) {
  if (!f1 || !f2) return;
  [f1, f2].forEach((f, i) => {
    const el = document.getElementById(getFighterDomId(i, 'jutsuSlots'));
    if (!el) return;
    if (!f.powers?.length) {
      el.innerHTML = '<div class="jutsu-slot"><span class="jutsu-slot-name">—</span></div>';
      return;
    }
    el.innerHTML = f.powers.map(pid => {
      const p = POWERS[pid];
      const remain = Math.max(0, (f.powerCooldowns[pid] || 0) - now);
      const maxCd = p?.cooldown || 20000;
      const pct = remain > 0 ? 100 - (remain / maxCd) * 100 : 100;
      const tip = p?.tip ? ` title="${p.tip} (${maxCd / 1000}s cd)"` : '';
      return `<div class="jutsu-slot ${remain <= 0 ? 'ready' : ''}"${tip}>
        <span class="jutsu-slot-name">${p?.name || pid}</span>
        <div class="jutsu-slot-cd"><div class="jutsu-slot-cd-fill ${remain > 0 ? 'depleted' : ''}" style="width:${pct}%"></div></div>
        <span class="jutsu-slot-time">${remain > 0 ? Math.ceil(remain / 1000) + 's' : '✓'}</span>
      </div>`;
    }).join('');
  });
  const feedEl = document.getElementById('jutsuFeed');
  if (feedEl) {
    const filtered = skillFeed.filter(s => now - s.at < 3500);
    feedEl.innerHTML = filtered.map(s => {
      const name = POWERS[s.powerId]?.name || s.powerId;
      const actorName = s.fighterId === 0 ? 'Hero' : AZURE_ASSASSIN.name.split(' ').pop();
      return `<div class="jutsu-feed-item f${s.fighterId + 1}">${actorName}: ${name}</div>`;
    }).join('');
  }
}
const STATUS_ICONS = {
  deepFreeze: '🧊',
  frozen: '❄️',
  burning: '🔥',
  shocked: '⚡',
  phased: '👻',
  anchored: '⚓',
  sharingan: '🔴'
};

export function updateStatusIcons(f1, f2, s1, s2, now) {
  if (!s1 || !s2) return;
  [f1, f2].forEach((f, i) => {
    const container = i === 0 ? s1 : s2;
    const active = f.status.activeKeys(now);

    // Simple diffing to avoid heavy innerHTML rewrites
    const currentIcons = container.querySelectorAll('.status-icon');
    const activeValid = active.filter(k => STATUS_ICONS[k]);

    if (currentIcons.length !== activeValid.length || [...currentIcons].some((el, idx) => !el.classList.contains(activeValid[idx]))) {
      container.innerHTML = activeValid.map(k => `<div class="status-icon ${k}" title="${k}">${STATUS_ICONS[k]}</div>`).join('');
    }
  });
}


// ─── AI State Tag ────────────────────────────────────────────────────────────
const AI_STATE_META = {
  combat: { label: 'Engaged', emoji: '⚔️', cls: 'state-combat' },
  approaching: { label: 'Approaching', emoji: '→', cls: 'state-approach' },
  pressuring: { label: 'Pressuring', emoji: '🔥', cls: 'state-pressure' },
  punishing: { label: 'Punishing', emoji: '💥', cls: 'state-punish' },
  baiting: { label: 'Baiting', emoji: '🎣', cls: 'state-bait' },
  defending: { label: 'Defending', emoji: '🛡️', cls: 'state-defend' },
  evadingProjectile: { label: 'Evading', emoji: '💨', cls: 'state-evade' },
  shinraDefense: { label: 'Counter!', emoji: '🌀', cls: 'state-shinra' },
  regrouping: { label: 'Regrouping', emoji: '⏸', cls: 'state-regroup' },
  retreating: { label: 'Retreating', emoji: '🏃', cls: 'state-retreat' },
  preparing: { label: 'Preparing', emoji: '🎯', cls: 'state-prepare' },
  recharging: { label: 'Exhausted', emoji: '😮‍💨', cls: 'state-recharge' },
};

export function updateAIStateTag(fighter, el) {
  if (!el) return;
  // If no AI property or human controlled, hide the tag
  if (!fighter || !fighter.aiState) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'flex';
  const state = fighter.aiState;
  if (el.dataset.state === state) return;
  el.dataset.state = state;

  const meta = AI_STATE_META[state] ?? { label: state, emoji: '•', cls: '' };

  // Clear all state classes
  Array.from(el.classList).forEach(c => {
    if (c.startsWith('state-')) el.classList.remove(c);
  });
  if (meta.cls) el.classList.add(meta.cls);

  el.innerHTML = `<span class="ai-state-emoji">${meta.emoji}</span><span class="ai-state-label">${meta.label}</span>`;
}

export function updateHUD(f1, f2, els, maxRounds, skillFeed) {
  const now = performance.now();
  updateBars(f1, f2, els.hp1, els.hp2, els.stam1, els.stam2);
  updateHealthNumbers(f1, f2, els.health1, els.health2);
  updateRounds(els.rounds, f1, f2, maxRounds);
  updatePowerCooldownUI(f1, f2, now);
  updateJutsuHUD(f1, f2, skillFeed, now);
  updateStatusIcons(f1, f2, els.statusIcons1, els.statusIcons2, now);

  updateAIStateTag(f1, els.aiState1);
  updateAIStateTag(f2, els.aiState2);
}
