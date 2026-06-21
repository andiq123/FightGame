import {
  drawStickman, drawBackground, drawHitEffect, drawDamageNumber,
  drawParticles, drawHitVignette,
} from '../engine/renderer.js';
import { TD } from './config.js';

export const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const GROUND_Y = TD.GROUND_Y;

export class TDViewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }

  render(world, now) {
    const { ctx, canvas } = this;
    if (!ctx) return;
    this.resize();

    const camX = world.camX;
    const sx = canvas.width / LOGICAL_WIDTH;
    const sy = canvas.height / LOGICAL_HEIGHT;
    const centerX = LOGICAL_WIDTH / 2;
    const zoom = world.zoom || 1;
    const shakeX = (world.rng() - 0.5) * world.screenShake;
    const shakeY = (world.rng() - 0.5) * world.screenShake;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    ctx.scale(sx, sy);
    ctx.translate(centerX - camX + shakeX / sx, shakeY / sy);

    drawBackground(ctx, LOGICAL_WIDTH, LOGICAL_HEIGHT, camX, now, world, GROUND_Y);
    drawLane(ctx, camX);
    drawBaseZone(ctx, world, now);

    drawTower(ctx, world.playerTower, now);
    drawTower(ctx, world.enemyTower, now);
    drawAegisBarrier(ctx, world, now);

    // Monsters (sorted by scale so brutes read behind small grunts a touch).
    const units = [...world.monsters].filter(m => m.hp > 0);
    units.sort((a, b) => (b.scale || 1) - (a.scale || 1));
    for (const m of units) {
      drawStickman(ctx, m, GROUND_Y, now);
      drawStatPlate(ctx, m, '#e0533a');
    }

    // Allied reinforcements (friendly cyan), with their STR / INT shown like everyone else.
    for (const a of world.allies || []) {
      if (a.hp <= 0) continue;
      drawStickman(ctx, a, GROUND_Y, now);
      drawStatPlate(ctx, a, '#5bd6ff');
    }

    if (world.hero.hp > 0) {
      drawStickman(ctx, world.hero, GROUND_Y, now);
      drawStatPlate(ctx, world.hero, '#28d6c8'); // show the hero's STR / INT too
    }

    drawTDProjectiles(ctx, world.projectiles, now);
    drawParticles(ctx, world.particles);
    world.hitEffects.forEach(h => {
      drawHitEffect(ctx, h);
      if (h.dmg > 0) drawDamageNumber(ctx, h.x, h.y - 25, h.dmg, Math.max(0, 1 - h.t * 2.2), h.counter, h.crit);
    });

    ctx.restore();

    if (world.screenShake > 8) drawHitVignette(ctx, canvas.width, canvas.height, Math.min(1, world.screenShake / 26));
  }
}

// Per-skill projectile visuals: a glowing fire orb, a spinning steel shuriken,
// or a faceted ice shard — each reads distinctly in flight.
function drawTDProjectiles(ctx, projectiles, now) {
  const baseY = GROUND_Y - 55 - 15;
  for (const p of projectiles) {
    const y = baseY + (p.y + 70 || 0);
    const dir = p.vx > 0 ? 1 : -1;
    ctx.save();
    ctx.translate(p.x, y);
    if (p.type === 'fireball') {
      ctx.globalCompositeOperation = 'lighter';
      const flick = 18 + Math.sin(now * 0.03) * 3;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, flick + 8);
      g.addColorStop(0, 'rgba(255,250,210,0.95)');
      g.addColorStop(0.35, 'rgba(255,170,70,0.9)');
      g.addColorStop(0.7, 'rgba(220,80,30,0.5)');
      g.addColorStop(1, 'rgba(180,40,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, flick + 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe9b0';
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    } else if (p.type === 'ice') {
      ctx.rotate(p.spin || 0);
      ctx.shadowColor = '#9fe8ff'; ctx.shadowBlur = 14;
      const grad = ctx.createLinearGradient(-12, -12, 12, 12);
      grad.addColorStop(0, '#eaffff'); grad.addColorStop(1, '#5cc7ff');
      ctx.fillStyle = grad; ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const r = i % 2 ? 6 : 14; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.type === 'arrow') { // tower arrow — angled along its flight path
      const ang = Math.atan2(p.vy || 0, p.vx || 1);
      ctx.rotate(ang);
      ctx.strokeStyle = '#caa86a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.fillStyle = '#e8e2d0'; // arrowhead
      ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(10, -4); ctx.lineTo(10, 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9a7b3a'; ctx.lineWidth = 2; // fletching
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-20, -4); ctx.moveTo(-16, 0); ctx.lineTo(-20, 4); ctx.stroke();
    } else { // shuriken — spinning four-point steel star
      ctx.scale(dir, 1); ctx.rotate(p.spin || 0);
      ctx.shadowColor = 'rgba(180,200,220,0.6)'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#c2ccd8'; ctx.strokeStyle = '#6b7785'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const r = i % 2 ? 5 : 14; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#39424d'; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

// A worn dirt path the monsters march along.
function drawLane(ctx, camX) {
  ctx.save();
  const grad = ctx.createLinearGradient(0, GROUND_Y - 10, 0, GROUND_Y + 90);
  grad.addColorStop(0, '#2a2620');
  grad.addColorStop(1, '#17140f');
  ctx.fillStyle = grad;
  ctx.fillRect(camX - LOGICAL_WIDTH, GROUND_Y, LOGICAL_WIDTH * 2, 120);
  ctx.strokeStyle = 'rgba(120,100,70,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(camX - LOGICAL_WIDTH, GROUND_Y + 2);
  ctx.lineTo(camX + LOGICAL_WIDTH, GROUND_Y + 2);
  ctx.stroke();
  ctx.restore();
}

// A soft green "safe haven" glow on the ground around the base, where the hero
// heals. Pulses brighter while the hero is actually sheltering there.
function drawBaseZone(ctx, world, now) {
  const zone = TD.HERO.baseHealZone;
  const cx = world.playerTower.x;
  const hero = world.hero;
  const sheltering = hero.hp > 0 && Math.abs(hero.x - cx) < zone;
  const pulse = sheltering ? 0.16 + 0.07 * Math.sin(now * 0.006) : 0.07;
  ctx.save();
  const g = ctx.createLinearGradient(0, GROUND_Y - 70, 0, GROUND_Y + 60);
  g.addColorStop(0, `rgba(60,220,170,0)`);
  g.addColorStop(1, `rgba(60,220,170,${pulse})`);
  ctx.fillStyle = g;
  ctx.fillRect(cx - zone, GROUND_Y - 70, zone * 2, 130);
  // Edge markers.
  ctx.strokeStyle = `rgba(80,230,180,${pulse + 0.12})`;
  ctx.lineWidth = 2; ctx.setLineDash([6, 10]);
  ctx.beginPath();
  ctx.moveTo(cx + zone, GROUND_Y - 50); ctx.lineTo(cx + zone, GROUND_Y + 40);
  ctx.stroke();
  ctx.restore();
}

// The rising Aegis Barrier: an expanding kinetic shock-ring sweeping out from the
// base when it unleashes its last-resort pulse.
function drawAegisBarrier(ctx, world, now) {
  const fx = world.baseAegisFx;
  if (!fx) return;
  const k = (now - fx.startedAt) / fx.dur;
  if (k < 0 || k > 1) { if (k > 1) world.baseAegisFx = null; return; }
  const ease = 1 - Math.pow(1 - k, 3);
  const radius = 120 + ease * 1500;
  const alpha = (1 - k) * 0.85;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // A vertical kinetic wall rising from the base, expanding outward.
  ctx.strokeStyle = `rgba(120,225,255,${alpha})`;
  ctx.lineWidth = 6 + (1 - k) * 10;
  ctx.beginPath();
  ctx.ellipse(fx.x, GROUND_Y - 120, radius, 320 + ease * 120, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.strokeStyle = `rgba(190,245,255,${alpha * 0.6})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(fx.x, GROUND_Y - 120, radius * 0.78, 260 + ease * 90, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.restore();
}

function drawTower(ctx, t, now) {
  const baseY = GROUND_Y;
  const topY = baseY - t.h;
  const x = t.x;
  const w = t.w;
  const alive = t.hp > 0;

  ctx.save();
  // Crumble + sink when destroyed.
  if (!alive) { ctx.globalAlpha = 0.5; ctx.translate(0, 40); }

  // Body
  const g = ctx.createLinearGradient(x - w / 2, topY, x + w / 2, baseY);
  g.addColorStop(0, t.color);
  g.addColorStop(1, '#11151c');
  ctx.fillStyle = g;
  ctx.fillRect(x - w / 2, topY, w, t.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(x - w / 2, topY, w, t.h);

  // Battlements
  ctx.fillStyle = t.color;
  for (let i = 0; i < 4; i++) {
    const bx = x - w / 2 + i * (w / 4);
    ctx.fillRect(bx + 4, topY - 26, w / 4 - 10, 26);
  }
  // Door / banner
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 26, baseY - 90, 52, 90);
  // Brick lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let yy = topY + 40; yy < baseY; yy += 46) {
    ctx.beginPath(); ctx.moveTo(x - w / 2, yy); ctx.lineTo(x + w / 2, yy); ctx.stroke();
  }
  ctx.restore();

  // HP bar floating above.
  drawHpBar(ctx, x, topY - 56, Math.max(0, t.hp / t.maxHp), w, t.side === 'player' ? '#3fa7ff' : '#ff4d6d', true);
  // Label
  ctx.save();
  ctx.fillStyle = '#cdd6e2';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(t.side === 'player' ? 'YOUR BASE' : 'ENEMY KEEP', x, topY - 70);
  ctx.restore();
}

// Floating nameplate over a monster: HP bar + its STRENGTH and INTELLIGENCE
// levels (both rise each wave), so the threat is readable at a glance.
// STR / INT badges + HP bar above a unit's head. Shared by enemies, the hero, and
// allies — only the HP-bar colour differs (red foes, teal hero, cyan allies).
function drawStatPlate(ctx, m, hpColor = '#e0533a') {
  const scale = m.scale || 1;
  const cx = m.x;
  const w = Math.max(48, 46 * scale);
  // Sit just above the head (head top ≈ -120·scale in body space).
  const top = GROUND_Y + m.y - 120 * scale - 30;

  // STR / INT badges row.
  const str = m.power ?? 1;
  const intel = m.intelligence ?? 1;
  ctx.save();
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const label = `STR ${str}`;
  const label2 = `INT ${intel}`;
  const padX = 6, gap = 9;
  const wA = ctx.measureText(label).width;
  const wB = ctx.measureText(label2).width;
  const totalW = wA + wB + gap + padX * 2;
  const bx = cx - totalW / 2;
  const by = top - 20;
  // Plate background.
  ctx.fillStyle = 'rgba(8,11,16,0.78)';
  roundRect(ctx, bx, by, totalW, 18, 5);
  ctx.fill();
  // STR (amber) · INT (cyan)
  ctx.fillStyle = '#ffb84d';
  ctx.fillText(label, bx + padX, by + 9.5);
  ctx.fillStyle = '#5cd8ff';
  ctx.fillText(label2, bx + padX + wA + gap, by + 9.5);
  ctx.restore();

  // HP bar directly under the badges.
  drawHpBar(ctx, cx, top, Math.max(0, m.hp) / m.maxHp, w, hpColor);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHpBar(ctx, cx, y, ratio, w, color, big = false) {
  const h = big ? 12 : 6;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(cx - w / 2 - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#1a1d24';
  ctx.fillRect(cx - w / 2, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(cx - w / 2, y, w * Math.max(0, Math.min(1, ratio)), h);
  ctx.restore();
}
