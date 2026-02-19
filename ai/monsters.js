export const MONSTERS = {
    golem: {
        id: 'golem',
        name: 'Garnet Golem',
        description: 'A massive volcanic entity. Unrivaled defense and powerful magma shockwaves.',
        hp: 3500,
        intelligence: 110, // Ascended
        level: 25,
        armor: 'heavy',
        weapon: 'claymore',
        powers: ['flameShower', 'earthWall', 'dragonRoar'],
        passives: ['stonePlating', 'sturdy'],
        scale: 1.25,
        color: '#8b0000',
        visuals: { eyes: '#ff0000', glow: '#ff4500' },
        logoHtml: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 80 L35 30 L65 30 L80 80 Z" /><path d="M35 30 L40 10 L60 10 L65 30" /><circle cx="40" cy="45" r="3" fill="#ff0000" /><circle cx="60" cy="45" r="3" fill="#ff0000" /></svg>`
    },
    assassin: {
        id: 'assassin',
        name: 'Azure Assassin',
        description: 'A lethal ethereal specter. Absolute speed and terrifyingly smart tactical daggers.',
        hp: 1800,
        intelligence: 125, // God-tier
        level: 30,
        armor: 'ninja',
        weapon: 'daggers',
        powers: ['spectralDash', 'cloneJutsu', 'lightningCutter'],
        passives: ['vampirism', 'blur'],
        scale: 1.15,
        color: '#00008b',
        visuals: { eyes: '#00ced1', glow: '#00ffff' },
        logoHtml: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"><path d="M30 20 Q50 10 70 20 L80 80 Q50 90 20 80 Z" /><path d="M40 40 L60 40" stroke-width="4" stroke="#00ced1" /><path d="M35 15 L65 15" stroke-dasharray="4 2" /></svg>`
    },
    vanguard: {
        id: 'vanguard',
        name: 'Veridian Vanguard',
        description: 'Ancient jade knight. An impenetrable wall that manipulates the very ground beneath you.',
        hp: 2500,
        intelligence: 115, // Ascended+
        level: 28,
        armor: 'samurai',
        weapon: 'katana',
        powers: ['earthWall', 'iceSpikes', 'shinraTensei'],
        passives: ['thorns', 'battleFocus'],
        scale: 1.2,
        color: '#006400',
        visuals: { eyes: '#32cd32', glow: '#00ff00' },
        logoHtml: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"><path d="M25 30 L50 15 L75 30 L75 75 L50 90 L25 75 Z" /><path d="M50 15 L50 90 M25 30 L75 30 M25 75 L75 75" opacity="0.3" /><path d="M40 45 L60 45" stroke="#32cd32" stroke-width="3" /></svg>`
    },
    oracle: {
        id: 'oracle',
        name: 'Onyx Oracle',
        description: 'Floating shadow mage. Warps reality and gravity to pick opponents apart.',
        hp: 2100,
        intelligence: 112,
        level: 26,
        armor: 'cyber',
        weapon: 'staff',
        powers: ['vacuumPull', 'flameShower', 'heal'],
        passives: ['blur', 'battleFocus'],
        scale: 1.18,
        color: '#1a1a1a',
        visuals: { eyes: '#ffd700', glow: '#ffd700' },
        logoHtml: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"><circle cx="50" cy="50" r="35" /><path d="M50 15 L50 85 M15 50 L85 50" opacity="0.5" /><circle cx="50" cy="50" r="10" fill="#ffd700" /><path d="M30 30 L70 70 M30 70 L70 30" stroke-width="0.5" /></svg>`
    }
};
