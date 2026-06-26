import {
  drawStickman, drawBackground, drawHitEffect, drawDamageNumber,
  drawParticles, drawHitVignette,
} from '../engine/renderer.js';
import { drawRagdoll } from '../engine/ragdoll.js';
import { TD, TEAM_COLOR } from './config.js';

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

    drawBase(ctx, world.bases.L);
    drawBase(ctx, world.bases.R);

    const drawUnit = (u) => {
      if (u.staggerRagdoll) { drawRagdoll(ctx, u.staggerRagdoll, u.color); return; }
      if (u.role === 'miner') drawMinerGlow(ctx, u, now);
      drawStickman(ctx, u, GROUND_Y, now);
      drawStatPlate(ctx, u, TEAM_COLOR[u.team]);
    };

    // Bigger units drawn first so small ones read in front.
    const units = world.creeps.filter(c => c.hp > 0).sort((a, b) => (b.scale || 1) - (a.scale || 1));
    for (const c of units) drawUnit(c);

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

function drawTDProjectiles(ctx, projectiles, now) {
  const baseY = GROUND_Y - 55 - 15;
  for (const p of projectiles) {
    const y = baseY + (p.y + 70 || 0);
    const dir = p.vx > 0 ? 1 : -1;
    ctx.save();
    ctx.translate(p.x, y);
    if (p.type === 'ice') {
      ctx.rotate(p.spin || 0);
      ctx.shadowColor = '#9fe8ff'; ctx.shadowBlur = 14;
      const grad = ctx.createLinearGradient(-12, -12, 12, 12);
      grad.addColorStop(0, '#eaffff'); grad.addColorStop(1, '#5cc7ff');
      ctx.fillStyle = grad; ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const r = i % 2 ? 6 : 14; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.type === 'arrow') {
      const ang = Math.atan2(p.vy || 0, p.vx || 1);
      ctx.rotate(ang);
      ctx.strokeStyle = '#caa86a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(10, -4); ctx.lineTo(10, 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9a7b3a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-20, -4); ctx.moveTo(-16, 0); ctx.lineTo(-20, 4); ctx.stroke();
    } else { // shuriken
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

// A warm gold aura under a miner so its economic role reads at a glance.
function drawMinerGlow(ctx, m, now) {
  const y = GROUND_Y + m.y;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.25 + 0.1 * Math.sin(now * 0.006 + m.id);
  const g = ctx.createRadialGradient(m.x, y - 30, 0, m.x, y - 30, 60);
  g.addColorStop(0, `rgba(255,210,90,${pulse})`);
  g.addColorStop(1, 'rgba(255,210,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(m.x, y - 30, 60, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBase(ctx, t) {
  const baseY = GROUND_Y;
  const topY = baseY - t.h;
  const x = t.x, w = t.w;
  const alive = t.hp > 0;

  ctx.save();
  if (!alive) { ctx.globalAlpha = 0.5; ctx.translate(0, 40); }

  const g = ctx.createLinearGradient(x - w / 2, topY, x + w / 2, baseY);
  g.addColorStop(0, t.color);
  g.addColorStop(1, '#11151c');
  ctx.fillStyle = g;
  ctx.fillRect(x - w / 2, topY, w, t.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(x - w / 2, topY, w, t.h);

  ctx.fillStyle = t.color;
  for (let i = 0; i < 4; i++) {
    const bx = x - w / 2 + i * (w / 4);
    ctx.fillRect(bx + 4, topY - 26, w / 4 - 10, 26);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 26, baseY - 90, 52, 90);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let yy = topY + 40; yy < baseY; yy += 46) {
    ctx.beginPath(); ctx.moveTo(x - w / 2, yy); ctx.lineTo(x + w / 2, yy); ctx.stroke();
  }
  ctx.restore();

  drawHpBar(ctx, x, topY - 56, Math.max(0, t.hp / t.maxHp), w, TEAM_COLOR[t.team], true);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd66b';
  ctx.font = '800 22px system-ui, sans-serif';
  ctx.fillText('⛏ ' + Math.floor(t.gold), x, topY - 70);
  ctx.fillStyle = '#9fb0c4';
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText((t.team === 'L' ? 'BLUE' : 'RED') + ' BASE', x, topY - 92);
  ctx.restore();
}

function drawStatPlate(ctx, m, hpColor) {
  const scale = m.scale || 1;
  const cx = m.x;
  const w = Math.max(48, 46 * scale);
  const top = GROUND_Y + m.y - 120 * scale - 30;

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
  ctx.fillStyle = 'rgba(8,11,16,0.78)';
  roundRect(ctx, bx, by, totalW, 18, 5);
  ctx.fill();
  ctx.fillStyle = '#ffb84d';
  ctx.fillText(label, bx + padX, by + 9.5);
  ctx.fillStyle = '#5cd8ff';
  ctx.fillText(label2, bx + padX + wA + gap, by + 9.5);
  ctx.restore();

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
