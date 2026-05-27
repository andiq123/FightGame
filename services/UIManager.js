export class UIManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.elements = this._cacheElements();
        this._initListeners();
    }

    _cacheElements() {
        return {
            heroScreen: document.getElementById('heroScreen'),
            confirmHeroBtn: document.getElementById('confirmHeroBtn'),
            stopGameBtn: document.getElementById('stopGameBtn'),
            speedBtns: document.querySelectorAll('.speed-control button, .quick-speed-btn'),
            hp1: document.getElementById('hpSet1'),
            intel1: document.getElementById('intelligence1'),
            level1: document.getElementById('level1'),
            levelVal1: document.getElementById('levelVal1')
        };
    }

    _initListeners() {
        const { elements, callbacks } = this;

        elements.confirmHeroBtn?.addEventListener('click', () => {
            elements.heroScreen?.classList.add('hidden');
            callbacks.onHeroConfirmed?.();
            callbacks.onStart?.();
        });

        elements.stopGameBtn?.addEventListener('click', () => callbacks.onReset?.());

        elements.hp1?.addEventListener('input', () => callbacks.onSettingsChange?.());
        elements.intel1?.addEventListener('change', () => callbacks.onStatsSync?.(0));
        elements.level1?.addEventListener('input', () => {
            callbacks.onLevelChange?.(0, parseInt(elements.level1.value, 10));
        });


        elements.speedBtns.forEach(btn => {
            btn.addEventListener('click', () => callbacks.onSpeedChange?.(parseFloat(btn.dataset.speed)));
        });

        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
            if (e.code === 'Escape') { e.preventDefault(); callbacks.onReset?.(); }
        });
    }

    showInitialFlow() {
        this.elements.heroScreen?.classList.remove('hidden');
    }

    updateSpeedUI(speed) {
        this.elements.speedBtns.forEach(b =>
            b.classList.toggle('active', parseFloat(b.dataset.speed) === speed)
        );
    }

    buildPowerButtons(containerId, powersRegistry, savedPowers = [], onPowerClick) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        Object.entries(powersRegistry).forEach(([id, p]) => {
            const btn = document.createElement('button');
            btn.className = 'power-btn';
            btn.dataset.power = id;
            btn.title = p.tip || p.name;
            btn.textContent = p.name;
            if (savedPowers.includes(id)) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                btn.classList.toggle('selected');
                onPowerClick?.(btn.closest('.powers'));
            });
            container.appendChild(btn);
        });
        this.updatePowerCount(container.closest('.powers'));
    }

    buildEquipButtons(containerId, registry, selectedId, onEquipClick) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        Object.entries(registry).forEach(([id, item]) => {
            const btn = document.createElement('button');
            btn.className = 'equip-btn';
            btn.dataset.id = id;

            const itemColor = item.color || item.trim;
            if (itemColor && id !== 'none' && id !== 'fists') {
                const dot = document.createElement('span');
                dot.className = 'item-dot';
                dot.style.background = itemColor;
                btn.appendChild(dot);
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'item-name';
            nameSpan.textContent = item.name;
            btn.appendChild(nameSpan);

            let lines = [];
            if (item.damage && item.damage !== 1) lines.push(`Attack: ${Math.round(item.damage * 100)}%`);
            if (item.range && item.range !== 1) lines.push(`Range: ${item.range}x`);
            if (item.knockback && item.knockback !== 1) lines.push(`Knockback: ${Math.round(item.knockback * 100)}%`);
            if (item.critChance) lines.push(`Crit Chance: ${Math.round(item.critChance * 100)}%`);
            if (item.stunMult) lines.push(`Stun: +${Math.round((item.stunMult - 1) * 100)}%`);
            if (item.lifesteal) lines.push(`Lifesteal: ${Math.round(item.lifesteal * 100)}%`);
            if (item.guardBreak) lines.push('Guard Break');

            if (lines.length > 0) {
                const tooltip = document.createElement('div');
                tooltip.className = 'equip-tooltip';
                tooltip.innerHTML = lines.join('<br>');
                btn.appendChild(tooltip);
                btn.classList.add('has-tooltip');
            }

            if (id === selectedId) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                container.querySelectorAll('.equip-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                onEquipClick?.();
            });
            container.appendChild(btn);
        });
    }

    updatePowerCount(wrap) {
        if (!wrap) return;
        const sel = wrap.querySelectorAll('.power-btn.selected');
        const countEl = wrap.querySelector('.power-count');
        if (countEl) countEl.textContent = `(${sel.length})`;
    }
}
