export const ATTACK = { jab: 0, cross: 1, hook: 2, lowKick: 3, highKick: 4, uppercut: 6, spinningKick: 8, axeKick: 9, frontKick: 10 };
export const ATTACK_POWER_PUNCH = 5;
export const GRAB = 7;

// `light: true`  → a combo builder: small stun, never knocks down (chain these).
// `knockdown: true` → a finisher: knocks the opponent down (ragdoll) + hard push.
export const ATTACK_DATA = {
  [ATTACK.jab]: { damage: 5, stun: 55, range: 78, duration: 190, combo: true, stamina: 3, knockback: 16, high: true, light: true },
  [ATTACK.cross]: { damage: 9, stun: 80, range: 88, duration: 310, combo: true, stamina: 6, knockback: 28, high: true, light: true },
  [ATTACK.hook]: { damage: 11, stun: 110, range: 82, duration: 410, combo: true, stamina: 10, knockback: 40, high: true, light: true },
  [ATTACK.lowKick]: { damage: 6, stun: 65, range: 92, duration: 340, combo: true, stamina: 5, knockback: 20, high: false, light: true },
  [ATTACK.highKick]: { damage: 13, stun: 165, range: 96, duration: 520, combo: false, stamina: 12, knockback: 90, high: true, kickLaunch: true, knockdown: true },
  [ATTACK.uppercut]: { damage: 10, stun: 150, range: 72, duration: 450, combo: true, stamina: 10, knockback: 58, high: true, light: true },
  [ATTACK_POWER_PUNCH]: { damage: 20, stun: 300, range: 92, duration: 650, combo: false, stamina: 20, knockback: 110, high: true, knockdown: true },
  [GRAB]: { damage: 9, stun: 200, range: 56, duration: 400, combo: false, stamina: 9, knockback: 55, high: true },
  [ATTACK.spinningKick]: { damage: 16, stun: 220, range: 100, duration: 560, combo: false, stamina: 16, knockback: 130, high: false, kickLaunch: true, knockdown: true },
  [ATTACK.axeKick]: { damage: 14, stun: 190, range: 88, duration: 510, combo: false, stamina: 14, knockback: 85, high: true, knockdown: true },
  [ATTACK.frontKick]: { damage: 8, stun: 75, range: 90, duration: 280, combo: true, stamina: 6, knockback: 34, high: true, light: true }
};

export const COMBO_CHAINS = [
  [ATTACK.jab, ATTACK.cross, ATTACK.hook],
  [ATTACK.jab, ATTACK.cross, ATTACK.uppercut],
  [ATTACK.jab, ATTACK.lowKick, ATTACK.highKick],
  [ATTACK.jab, ATTACK.frontKick, ATTACK.spinningKick],
  [ATTACK.cross, ATTACK.hook, ATTACK.highKick],
  [ATTACK.cross, ATTACK.frontKick, ATTACK.axeKick],
  [ATTACK.lowKick, ATTACK.frontKick, ATTACK.axeKick],
  [ATTACK.lowKick, ATTACK.cross, ATTACK.uppercut],
  [ATTACK.frontKick, ATTACK.jab, ATTACK.cross, ATTACK.hook],
  [ATTACK.jab, ATTACK.jab, ATTACK.cross],
  [ATTACK.cross, ATTACK.uppercut],
  [ATTACK.hook, ATTACK.spinningKick],
  [ATTACK.frontKick, ATTACK.highKick],
  [ATTACK.lowKick, ATTACK.highKick],
  [ATTACK.jab, ATTACK.uppercut]
];
