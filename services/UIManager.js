export class UIManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.elements = this._cacheElements();
        this._initListeners();
    }

    _cacheElements() {
        return {
            heroScreen: document.getElementById('heroScreen'),
            monsterScreen: document.getElementById('monsterScreen'),
            confirmHeroBtn: document.getElementById('confirmHeroBtn'),
            startGameBtn: document.getElementById('startGameBtn'),
            stopGameBtn: document.getElementById('stopGameBtn'),
            speedBtns: document.querySelectorAll('.speed-control button, .quick-speed-btn'),
            hp1: document.getElementById('hpSet1'),
            intel1: document.getElementById('intelligence1'),
            intelRange1: document.getElementById('intelligenceRange1'),
            level1: document.getElementById('level1'),
            levelVal1: document.getElementById('levelVal1')
        };
    }

    _initListeners() {
        const { elements, callbacks } = this;

        elements.confirmHeroBtn?.addEventListener('click', () => {
            elements.heroScreen?.classList.add('hidden');
            callbacks.onHeroConfirmed?.();
            this.showMonsterFlow();
        });

        elements.startGameBtn?.addEventListener('click', () => {
            elements.monsterScreen?.classList.add('hidden');
            callbacks.onStart?.();
        });

        elements.stopGameBtn?.addEventListener('click', () => callbacks.onReset?.());

        elements.hp1?.addEventListener('input', () => callbacks.onSettingsChange?.());
        elements.intel1?.addEventListener('input', () => callbacks.onStatsSync?.(0, elements.intel1.value));
        elements.intel1?.addEventListener('change', () => callbacks.onStatsSync?.(0, elements.intel1.value));
        elements.intelRange1?.addEventListener('input', () => callbacks.onStatsSync?.(0, elements.intelRange1.value));
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
        this.elements.monsterScreen?.classList.add('hidden');
    }

    showMonsterFlow() {
        this.elements.monsterScreen?.classList.remove('hidden');
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

    updatePowerCount(wrap) {
        if (!wrap) return;
        const sel = wrap.querySelectorAll('.power-btn.selected');
        const countEl = wrap.querySelector('.power-count');
        if (countEl) countEl.textContent = `(${sel.length})`;
    }
}
