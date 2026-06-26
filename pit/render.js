import { drawStickman, drawHitEffect, drawDamageNumber, drawParticles, drawHitVignette } from '../engine/renderer.js';
import { drawRagdoll } from '../engine/ragdoll.js';
import { PIT, TEAM_COLOR, TEAM_LABEL } from './config.js';

const { GROUND_Y, LOGICAL_WIDTH, LOGICAL_HEIGHT } = PIT;

function drawPitScene(ctx, now) {
  const w = LOGICAL_WIDTH;
  const h = LOGICAL_HEIGHT;
  const cx = 0;
  const gy = GROUND_Y;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0a0618');
  sky.addColorStop(0.45, '#1a1030');
  sky.addColorStop(1, '#120c10');
  ctx.fillStyle = sky;
  ctx.fillRect(-w, 0, w * 2, h);

  // Stone bowl — layered arches, no parallax lane art.
  ctx.save();
  ctx.strokeStyle = 'rgba(80,70,62,0.35)';
  ctx.lineWidth = 3;
  for (let ring = 0; ring < 4; ring++) {
    const rx = 680 - ring * 55;
    const ry = 120 - ring * 8;
    ctx.beginPath();
    ctx.ellipse(cx, gy - 40, rx, ry, 0, Math.PI, 0);
    ctx.stroke();
  }
  ctx.fillStyle = '#2a2520';
  ctx.fillRect(-760, gy - 180, 1520, 200);
  ctx.fillStyle = '#3d342c';
  ctx.fillRect(-720, gy - 160, 1440, 24);
  ctx.restore();

  // Sand floor
  const sand = ctx.createRadialGradient(cx, gy, 40, cx, gy, 560);
  sand.addColorStop(0, '#c4a574');
  sand.addColorStop(0.55, '#9a7848');
  sand.addColorStop(1, '#5c4528');
  ctx.fillStyle = sand;
  ctx.beginPath();
  ctx.ellipse(cx, gy + 8, 540, 72, 0, 0, Math.PI * 2);
  ctx.fill();

  // Torches
  for (const tx of [-620, 620]) {
    const flicker = 0.7 + 0.3 * Math.sin(now * 0.009 + tx);
    const g = ctx.createRadialGradient(tx, gy - 120, 0, tx, gy - 120, 180);
    g.addColorStop(0, `rgba(255,180,80,${0.22 * flicker})`);
    g.addColorStop(1, 'rgba(255,100,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(tx - 200, gy - 260, 400, 260);
    ctx.fillStyle = `rgba(255,220,120,${0.5 + flicker * 0.3})`;
    ctx.beginPath();
    ctx.arc(tx, gy - 118, 7 + flicker * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4038';
    ctx.fillRect(tx - 6, gy - 110, 12, 90);
  }

  ctx.strokeStyle = 'rgba(255,210,140,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, gy + 6, 500, 64, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export class PitViewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._lastW = 0;
    this._lastH = 0;
    this._lastDpr = 0;
    this._drawBuf = [];
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this._lastW && h === this._lastH && dpr === this._lastDpr) return;
    this._lastW = w; this._lastH = h; this._lastDpr = dpr;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  render(world, now) {
    const { ctx, canvas } = this;
    if (!ctx) return;
    this.resize();

    const sx = canvas.width / LOGICAL_WIDTH;
    const sy = canvas.height / LOGICAL_HEIGHT;
    const shakeX = (world.rng() - 0.5) * world.screenShake;
    const shakeY = (world.rng() - 0.5) * world.screenShake;

    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(LOGICAL_WIDTH / 2 + shakeX / sx, shakeY / sy);

    drawPitScene(ctx, now);

    const units = this._drawBuf;
    units.length = 0;
    for (const c of world.creeps) if (c.hp > 0) units.push(c);
    units.sort((a, b) => (b.scale || 1) - (a.scale || 1));
    for (const u of units) {
      if (u.staggerRagdoll) drawRagdoll(ctx, u.staggerRagdoll, u.color, now);
      else drawStickman(ctx, u, GROUND_Y, now);
    }

    drawParticles(ctx, world.particles);
    for (const h of world.hitEffects) {
      drawHitEffect(ctx, h);
      if (h.dmg > 0) drawDamageNumber(ctx, h.x, h.y - 25, h.dmg, Math.max(0, 1 - h.t * 2.2), h.counter, h.crit);
    }

    ctx.restore();

    this.drawHud(ctx, canvas, world);
    if (world.screenShake > 8) drawHitVignette(ctx, canvas.width, canvas.height, Math.min(1, world.screenShake / 26));
  }

  drawHud(ctx, canvas, world) {
    const alive = (t) => world.creeps.filter(c => c.team === t && c.hp > 0).length;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '800 15px system-ui,sans-serif';
    ctx.fillStyle = 'rgba(10,12,18,0.72)';
    ctx.fillRect(16, 16, canvas.width - 32, 42);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEAM_COLOR.L;
    ctx.fillText(`${TEAM_LABEL.L}  ${alive('L')}`, 28, 37);
    ctx.textAlign = 'right';
    ctx.fillStyle = TEAM_COLOR.R;
    ctx.fillText(`${alive('R')}  ${TEAM_LABEL.R}`, canvas.width - 28, 37);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aab7c8';
    ctx.font = '700 12px system-ui,sans-serif';
    const title = world.over ? `${TEAM_LABEL[world.over] || 'Draw'} wins` : 'THE PIT';
    ctx.fillText(title, canvas.width / 2, 37);
    ctx.restore();
  }
}
