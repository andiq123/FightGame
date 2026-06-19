// Pre-launch loadout chooser. Builds its controls from the SHARED registries
// (traits, passives, powers, stat curve) so there is one source of truth — no
// duplicated ability lists. Persists the choice to localStorage.
import { TRAITS } from '../config/traits.js';
import { PASSIVES } from '../config/passives.js';
import { POWERS } from '../entities/powers.js';
import { clampStat } from '../config/stats.js';
import { SUPPORTED_SKILL_IDS } from './config.js';

const LS_KEY = 'td.loadout.v1';
const DEFAULT = {
  power: 14, intelligence: 14,
  traits: ['athletic', 'caped'],
  passives: ['regen'],
  skills: ['fireball', 'shuriken'],
};

const POWER_LIST = Array.isArray(POWERS) ? POWERS : Object.values(POWERS);
let els = null;

function loadSaved() {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; }
  catch { return { ...DEFAULT }; }
}

function buildChips(container, entries, selected) {
  container.innerHTML = '';
  entries.forEach(([id, meta]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (selected.includes(id) ? ' on' : '');
    b.dataset.id = id;
    b.textContent = meta.name;
    b.title = meta.tip || '';
    b.addEventListener('click', () => { b.classList.toggle('on'); persist(); });
    container.appendChild(b);
  });
}

const chipValues = (c) => [...c.querySelectorAll('.chip.on')].map(b => b.dataset.id);

export function initSetup() {
  els = {
    power: document.getElementById('ldPower'),
    powerVal: document.getElementById('ldPowerVal'),
    int: document.getElementById('ldInt'),
    intVal: document.getElementById('ldIntVal'),
    traits: document.getElementById('ldTraits'),
    passives: document.getElementById('ldPassives'),
    skills: document.getElementById('ldSkills'),
  };
  if (!els.power) return; // markup absent → fall back to hero defaults

  const s = loadSaved();
  els.power.value = s.power; els.powerVal.textContent = s.power;
  els.int.value = s.intelligence; els.intVal.textContent = s.intelligence;
  els.power.addEventListener('input', () => { els.powerVal.textContent = els.power.value; persist(); });
  els.int.addEventListener('input', () => { els.intVal.textContent = els.int.value; persist(); });

  buildChips(els.traits, Object.entries(TRAITS), s.traits);
  buildChips(els.passives, Object.entries(PASSIVES), s.passives);
  const skillEntries = POWER_LIST
    .filter(p => SUPPORTED_SKILL_IDS.includes(p.id))
    .map(p => [p.id, { name: p.name, tip: p.tip || '' }]);
  buildChips(els.skills, skillEntries, s.skills);
}

export function readLoadout() {
  if (!els || !els.power) return {};
  return {
    power: clampStat(els.power.value),
    intelligence: clampStat(els.int.value),
    traits: chipValues(els.traits),
    passives: chipValues(els.passives),
    skills: chipValues(els.skills),
  };
}

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(readLoadout())); } catch { /* ignore */ }
}
