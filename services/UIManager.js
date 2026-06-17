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
            // Power/Intelligence sliders for both fighters: suffix 1 = hero, 2 = monster.
            statSliders: [1, 2].flatMap(suffix => ['power', 'intelligence'].map(key => ({
                suffix,
                slider: document.getElementById(`${key}${suffix}`),
                val: document.getElementById(`${key}Val${suffix}`)
            }))).filter(s => s.slider)
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

        elements.statSliders.forEach(({ slider, val, suffix }) => {
            slider.addEventListener('input', () => {
                if (val) val.textContent = slider.value;
                callbacks.onStatChange?.(suffix);
            });
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
            btn.title = p.tip || p.name;           // accessibility / fallback
            if (p.tip) btn.dataset.tip = p.tip;    // instant styled hover tooltip
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
