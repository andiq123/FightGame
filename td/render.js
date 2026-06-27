import {
  drawStickman, drawBackground, drawHitEffect, drawDamageNumber,
  drawParticles, drawHitVignette,
} from '../engine/renderer.js';
import { drawRagdoll } from '../engine/ragdoll.js';
import { TD, TEAM_COLOR } from './config.js';

export const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const GROUND_Y = TD.GROUND_Y;
// ponytail: head top ≈ groundY + y - 126×scale — bar sits above, not on the face
const unitHpBarY = (u) => GROUND_Y + u.y - (138 * (u.scale || 1) + 10);

export class TDViewport {
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

    const camX = world.camX;
    const zoom = world.zoom || 1;
    const viewW = LOGICAL_WIDTH / zoom;
    const viewH = LOGICAL_HEIGHT / zoom;
    const sx = canvas.width / LOGICAL_WIDTH;
    const sy = canvas.height / LOGICAL_HEIGHT;
    const centerX = LOGICAL_WIDTH / 2;
    const pivotY = GROUND_Y - 95;
    const shakeX = (world.rng() - 0.5) * world.screenShake;
    const shakeY = (world.rng() - 0.5) * world.screenShake;

    // Sync game-time sky tints → renderer's ms-based skyFocus (reuse versus FX).
    if (world.skyFocus?.until > world.time) {
      world.skyFocus.expiry = now + (world.skyFocus.until - world.time) * 1000;
    } else if (world.skyFocus) world.skyFocus = null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(centerX + shakeX / sx, pivotY + shakeY / sy);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX, -pivotY);
    ctx.translate(centerX - camX, 0);

    drawBackground(ctx, viewW, viewH, camX, now, world, GROUND_Y);
    drawLane(ctx, camX, world, now, viewW);
    drawGoldNodes(ctx, world, now);

    drawBase(ctx, world.bases.L, now);
    drawBase(ctx, world.bases.R, now);

    const drawUnit = (u) => {
      if (u.staggerRagdoll) { drawRagdoll(ctx, u.staggerRagdoll, u.color, now); return; }
      if (u.role === 'miner') drawMinerGlow(ctx, u, now);
      if (u.role === 'boss') drawBossGlow(ctx, u, now);
      if (u.flying && !u._hoverOff) drawFlyGlow(ctx, u, now);
      drawStickman(ctx, u, GROUND_Y, now);
      if (u.role === 'boss' || (u.scale || 1) >= 1.85) drawStatPlate(ctx, u, TEAM_COLOR[u.team]);
      else drawHpBar(ctx, u.x, unitHpBarY(u), Math.max(0, u.hp) / u.maxHp, Math.max(48, 46 * (u.scale || 1)), TEAM_COLOR[u.team]);
    };

    const cull = viewW * 0.55 + 60;
    const units = this._drawBuf;
    units.length = 0;
    for (const c of world.creeps) {
      if (c.hp <= 0 || Math.abs(c.x - camX) > cull) continue;
      units.push(c);
    }
    units.sort((a, b) => (b.scale || 1) - (a.scale || 1));
    for (const c of units) drawUnit(c);

    drawBaseLasers(ctx, world, now);
    drawTDProjectiles(ctx, world.projectiles, now);
    drawParticles(ctx, world.particles);
    world.hitEffects.forEach(h => {
      if (h.death) { drawDeathRing(ctx, h); return; }
      drawHitEffect(ctx, h);
      if (h.dmg > 0) drawDamageNumber(ctx, h.x, h.y - 25, h.dmg, Math.max(0, 1 - h.t * 2.2), h.counter, h.crit);
    });

    if (world.fogUntil && world.time < world.fogUntil) {
      ctx.save();
      ctx.fillStyle = 'rgba(160,175,200,0.14)';
      ctx.fillRect(camX - viewW, 0, viewW * 2, LOGICAL_HEIGHT);
      ctx.restore();
    }

    ctx.restore();

    if (world.screenShake > 8) drawHitVignette(ctx, canvas.width, canvas.height, Math.min(1, world.screenShake / 26));
  }
}

function drawTDProjectiles(ctx, projectiles, now) {
  const baseY = GROUND_Y - 55 - 15;
  for (const p of projectiles) {
    const y = baseY + (p.y + 70 || 0);
    const dir = p.vx >= 0 ? 1 : -1;
    const ang = p.arc ? Math.atan2(p.vy || 0, p.vx || dir) : 0;
    ctx.save();
    ctx.translate(p.x, y);
    if (p.arc && (p.type !== 'shuriken' || Math.abs(p.vy || 0) > 30)) ctx.rotate(ang);
    if (p.type === 'ice') {
      ctx.rotate(p.spin || 0);
      ctx.shadowColor = '#9fe8ff'; ctx.shadowBlur = 14;
      const grad = ctx.createLinearGradient(-12, -12, 12, 12);
      grad.addColorStop(0, '#eaffff'); grad.addColorStop(1, '#5cc7ff');
      ctx.fillStyle = grad; ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const r = i % 2 ? 6 : 14; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.type === 'fireball') {
      ctx.shadowColor = '#ff6622'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#ff4400'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffcc55'; ctx.beginPath(); ctx.arc(-5 * dir, -2, 5, 0, Math.PI * 2); ctx.fill();
    } else if (p.type === 'bolt') {
      ctx.strokeStyle = '#ffe566'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.shadowColor = '#aaeeff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(-14, 4); ctx.lineTo(-2, -2); ctx.lineTo(-6, 6); ctx.lineTo(8, -6); ctx.lineTo(2, 8); ctx.lineTo(14, 0); ctx.stroke();
    } else if (p.type === 'kunai') {
      ctx.rotate(p.spin || 0);
      ctx.fillStyle = '#6a7585'; ctx.strokeStyle = '#2a3140'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -4); ctx.lineTo(-6, 0); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-14, -2, 5, 4);
    } else if (p.type === 'arrow') {
      ctx.strokeStyle = '#caa86a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(10, -4); ctx.lineTo(10, 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9a7b3a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-20, -4); ctx.moveTo(-16, 0); ctx.lineTo(-20, 4); ctx.stroke();
    } else { // shuriken
      if (!p.arc) ctx.scale(dir, 1);
      ctx.rotate(p.spin || 0);
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

function drawLane(ctx, camX, world, now, viewW = LOGICAL_WIDTH) {
  const left = camX - viewW;
  const w = viewW * 2;
  ctx.save();

  // ponytail: never paint a solid slab over drawBackground — overlay wear + camp light only.
  const pathG = ctx.createLinearGradient(camX - 520, GROUND_Y, camX + 520, GROUND_Y);
  pathG.addColorStop(0, 'rgba(0,0,0,0)');
  pathG.addColorStop(0.45, 'rgba(74,58,36,0.1)');
  pathG.addColorStop(0.55, 'rgba(74,58,36,0.1)');
  pathG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pathG;
  ctx.fillRect(left, GROUND_Y - 2, w, 16);

  // March lane center line — subtle guide toward the fight.
  ctx.setLineDash([18, 22]);
  ctx.strokeStyle = 'rgba(180,160,110,0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, GROUND_Y + 8);
  ctx.lineTo(left + w, GROUND_Y + 8);
  ctx.stroke();
  ctx.setLineDash([]);

  // Footfall scuffs under active ground units (viewport only).
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  const cull = camX + viewW * 0.55;
  const culL = camX - viewW * 0.55;
  for (const c of world?.creeps || []) {
    if (c.hp <= 0 || c.flying || c.x < culL || c.x > cull) continue;
    ctx.beginPath();
    ctx.ellipse(c.x, GROUND_Y + 5, 14 * (c.scale || 1), 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Base campfires / braziers at each home.
  for (const [team, rgb] of [['L', '79,155,232'], ['R', '224,102,74']]) {
    const b = world?.bases?.[team];
    if (!b || b.hp <= 0) continue;
    const pulse = 0.12 + 0.06 * Math.sin(now * 0.005 + b.x * 0.001);
    const g = ctx.createRadialGradient(b.x, GROUND_Y - 18, 0, b.x, GROUND_Y - 18, 130);
    g.addColorStop(0, `rgba(${rgb},${pulse})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(b.x - 150, GROUND_Y - 40, 300, 70);
    ctx.fillStyle = `rgba(255,180,80,${0.35 + 0.2 * Math.sin(now * 0.012 + b.x)})`;
    ctx.beginPath();
    ctx.arc(b.x + (team === 'L' ? 55 : -55), GROUND_Y - 8, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Heat shimmer on the horizon line.
  ctx.strokeStyle = `rgba(255,210,140,${0.05 + 0.025 * Math.sin(now * 0.004)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, GROUND_Y + 1);
  ctx.lineTo(left + w, GROUND_Y + 1);
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

function drawBossGlow(ctx, b, now) {
  const y = GROUND_Y + b.y;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.35 + 0.15 * Math.sin(now * 0.004 + b.id);
  const g = ctx.createRadialGradient(b.x, y - 50, 0, b.x, y - 50, 90 * (b.scale || 1));
  g.addColorStop(0, `rgba(255,80,120,${pulse})`);
  g.addColorStop(1, 'rgba(255,80,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(b.x, y - 50, 90 * (b.scale || 1), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawFlyGlow(ctx, u, now) {
  const cy = GROUND_Y + u.y - 50;
  const face = u.facing || 1;
  const flap = Math.sin(now * 0.012 + u.id) * 0.35;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(u.x, GROUND_Y + 8, 36 * (u.scale || 1), 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(200,235,255,${0.55 + 0.2 * Math.sin(now * 0.01 + u.id)})`;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(u.x + face * 8, cy);
    ctx.quadraticCurveTo(u.x + face * 28, cy - 32 - flap * 20, u.x + face * 52, cy - 8 + flap * 12);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(u.x, cy, 0, u.x, cy, 55);
  g.addColorStop(0, 'rgba(160,220,255,0.35)');
  g.addColorStop(1, 'rgba(160,220,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(u.x, cy, 55, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawGoldNodes(ctx, world, now) {
  for (const n of world.goldNodes || []) {
    const pulse = 0.55 + 0.35 * Math.sin(now * 0.004 + n.x * 0.01);
    const ratio = n.gold / (n.max || 90);
    if (ratio < 0.08) continue;
    const y = GROUND_Y - 4;
    ctx.save();
    ctx.fillStyle = `rgba(255,200,60,${0.12 + ratio * 0.18})`;
    ctx.beginPath();
    ctx.ellipse(n.x, y, 22 + ratio * 10, 8 + ratio * 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,220,90,${pulse * ratio})`;
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * 9;
      ctx.beginPath();
      ctx.arc(n.x + ox, y - 3 - (i % 2) * 2, 4 + ratio * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  for (const c of world.creeps || []) {
    if (c.role !== 'miner' || c.hp <= 0 || !(c.carry > 0)) continue;
    ctx.save();
    ctx.fillStyle = '#ffd566';
    ctx.font = '700 11px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`+${Math.floor(c.carry)}`, c.x, GROUND_Y - 95);
    ctx.restore();
  }
}

function drawBaseFace(ctx, cx, cy, emotion, now) {
  const blink = Math.sin(now * 0.004) > 0.985;
  const wobble = Math.sin(now * 0.02) * 1.5;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1a1210';
  ctx.fillStyle = '#e8dcc8';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 20, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();

  const eyeY = cy - 7;
  const ex = 8;
  const drawEye = (ox, wide = 1, slit = false) => {
    if (emotion === 'dead') {
      ctx.strokeStyle = '#1a1210';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + ox - 4, eyeY - 4); ctx.lineTo(cx + ox + 4, eyeY + 4);
      ctx.moveTo(cx + ox + 4, eyeY - 4); ctx.lineTo(cx + ox - 4, eyeY + 4);
      ctx.stroke();
      return;
    }
    if (emotion === 'infuriated') {
      ctx.fillStyle = '#ff5533';
      ctx.shadowColor = '#ff2200';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.ellipse(cx + ox, eyeY, 5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx + ox, eyeY, 1.8, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const r = (emotion === 'scared' ? 5.5 : 4) * wide;
    const h = blink ? 1 : (slit ? 2.5 : r);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx + ox, eyeY, r, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1210';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (!blink) {
      ctx.fillStyle = '#1a1210';
      ctx.beginPath();
      ctx.arc(cx + ox + (emotion === 'scared' ? wobble * 0.3 : 0), eyeY, emotion === 'scared' ? 2.2 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  ctx.strokeStyle = '#1a1210';
  ctx.lineWidth = 2.5;
  if (emotion === 'infuriated') {
    ctx.fillStyle = '#f0b0a0';
    ctx.beginPath(); ctx.ellipse(cx, cy, 20, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a2020';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#5a1010';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - ex - 7, eyeY - 8); ctx.lineTo(cx - ex + 6, eyeY - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + ex + 7, eyeY - 8); ctx.lineTo(cx + ex - 6, eyeY - 2); ctx.stroke();
    for (let i = -1; i <= 1; i += 2) {
      ctx.strokeStyle = 'rgba(255,120,80,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + i * 22, cy - 22); ctx.lineTo(cx + i * 26, cy - 30); ctx.stroke();
    }
  } else if (emotion === 'happy') {
    ctx.beginPath(); ctx.moveTo(cx - ex - 5, eyeY - 9); ctx.quadraticCurveTo(cx - ex, eyeY - 12, cx - ex + 5, eyeY - 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + ex - 5, eyeY - 9); ctx.quadraticCurveTo(cx + ex, eyeY - 12, cx + ex + 5, eyeY - 9); ctx.stroke();
  } else if (emotion === 'angry') {
    ctx.beginPath(); ctx.moveTo(cx - ex - 6, eyeY - 10); ctx.lineTo(cx - ex + 5, eyeY - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + ex + 6, eyeY - 10); ctx.lineTo(cx + ex - 5, eyeY - 5); ctx.stroke();
  } else if (emotion === 'scared') {
    ctx.beginPath(); ctx.moveTo(cx - ex - 5, eyeY - 12); ctx.quadraticCurveTo(cx - ex, eyeY - 16, cx - ex + 5, eyeY - 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + ex - 5, eyeY - 12); ctx.quadraticCurveTo(cx + ex, eyeY - 16, cx + ex + 5, eyeY - 12); ctx.stroke();
  } else if (emotion === 'frustrated') {
    ctx.beginPath(); ctx.moveTo(cx - ex - 5, eyeY - 11); ctx.lineTo(cx - ex + 5, eyeY - 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + ex - 5, eyeY - 8); ctx.lineTo(cx + ex + 5, eyeY - 11); ctx.stroke();
    ctx.fillStyle = 'rgba(100,160,220,0.85)';
    ctx.beginPath(); ctx.ellipse(cx + 16, cy - 18, 3, 5, 0.3, 0, Math.PI * 2); ctx.fill();
  }

  drawEye(-ex, 1, emotion === 'angry' || emotion === 'frustrated' || emotion === 'infuriated');
  drawEye(ex, 1, emotion === 'angry' || emotion === 'infuriated');

  ctx.strokeStyle = '#c4a882';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 1);
  ctx.lineTo(cx - 2.5, cy + 5);
  ctx.lineTo(cx + 2.5, cy + 5);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = '#1a1210';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#1a1210';
  const my = cy + 14;
  if (emotion === 'happy') {
    ctx.beginPath(); ctx.arc(cx, my - 3, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  } else if (emotion === 'infuriated') {
    ctx.fillStyle = '#3a1010';
    ctx.beginPath(); ctx.ellipse(cx, my + 2, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a1010';
    ctx.stroke();
  } else if (emotion === 'angry') {
    ctx.beginPath(); ctx.moveTo(cx - 8, my); ctx.lineTo(cx - 2, my + 2); ctx.lineTo(cx + 2, my + 2); ctx.lineTo(cx + 8, my); ctx.stroke();
  } else if (emotion === 'scared') {
    ctx.beginPath(); ctx.ellipse(cx, my + wobble, 5, 6 + Math.abs(wobble), 0, 0, Math.PI * 2); ctx.stroke();
  } else if (emotion === 'frustrated') {
    ctx.beginPath(); ctx.moveTo(cx - 7, my + 1); ctx.quadraticCurveTo(cx - 2, my - 1, cx + 3, my + 2); ctx.lineTo(cx + 7, my); ctx.stroke();
  } else if (emotion === 'dead') {
    ctx.beginPath(); ctx.moveTo(cx - 6, my + 2); ctx.lineTo(cx + 6, my + 2); ctx.stroke();
    ctx.fillStyle = '#c45';
    ctx.beginPath(); ctx.ellipse(cx + 4, my + 8, 4, 3, 0.4, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(cx - 6, my); ctx.lineTo(cx + 6, my); ctx.stroke();
  }
  ctx.restore();
}

function drawBaseLasers(ctx, world, now) {
  const faceY = GROUND_Y - 45;
  const eyeY = faceY - 7;
  const eyeOff = 8;
  for (const team of ['L', 'R']) {
    const b = world.bases?.[team];
    const L = b?._laser;
    if (!L || L.until <= now || b.hp <= 0) continue;
    const fade = Math.min(1, (L.until - now) / 140);
    const wob = Math.sin(now * 0.035) * 5;
    const eyes = [{ x: b.x - eyeOff, y: eyeY }, { x: b.x + eyeOff, y: eyeY }];
    for (const e of eyes) {
      const endY = e.y + wob;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(e.x, e.y, L.endX, endY);
      g.addColorStop(0, `rgba(255,60,20,${0.95 * fade})`);
      g.addColorStop(0.45, `rgba(255,240,120,${0.9 * fade})`);
      g.addColorStop(1, `rgba(255,80,30,${0.25 * fade})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#ff3300';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(L.endX, endY);
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(255,255,240,${0.95 * fade})`;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.fillStyle = `rgba(255,120,60,${0.85 * fade})`;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawBase(ctx, t, now = 0) {
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
  drawBaseFace(ctx, x, baseY - 45, (t._laserUntil > now) ? 'infuriated' : (t.emotion || (alive ? 'neutral' : 'dead')), now);
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
  const top = unitHpBarY(m);

  const str = m.power ?? 1;
  const intel = m.intelligence ?? 1;
  ctx.save();
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const tag = m.displayName && !['grunt', 'runner'].includes(m.typeKey)
    ? m.displayName.toUpperCase().slice(0, 9)
    : `STR ${str}`;
  const label2 = m.role === 'boss' ? `INT ${intel}` : `INT ${intel}`;
  const padX = 6, gap = 9;
  const wA = ctx.measureText(tag).width;
  const wB = ctx.measureText(label2).width;
  const totalW = wA + wB + gap + padX * 2;
  const bx = cx - totalW / 2;
  const by = top - 20;
  ctx.fillStyle = 'rgba(8,11,16,0.78)';
  roundRect(ctx, bx, by, totalW, 18, 5);
  ctx.fill();
  ctx.fillStyle = m.role === 'boss' ? '#ff6b8a' : '#ffb84d';
  ctx.fillText(tag, bx + padX, by + 9.5);
  ctx.fillStyle = '#5cd8ff';
  ctx.fillText(label2, bx + padX + wA + gap, by + 9.5);
  ctx.restore();

  drawHpBar(ctx, cx, top, Math.max(0, m.hp) / m.maxHp, w, hpColor);
  drawTraitDots(ctx, m, bx, by + 22);
}

// Tiny trait pips — shows which special rules this creep rolled.
function drawTraitDots(ctx, m, bx, by) {
  const ids = Object.keys(m.traits || {}).filter(k => m.traits[k]);
  if (!ids.length) return;
  const colors = {
    untouchable: '#a8f0ff', unbreakable: '#888', perfectStrike: '#ffd566',
    seriousPunch: '#ff6644', tireless: '#66ff99', athletic: '#88ccff',
    blink: '#cc88ff', chill: '#aaaacc',
  };
  ctx.save();
  ids.slice(0, 4).forEach((id, i) => {
    ctx.fillStyle = colors[id] || '#888';
    ctx.beginPath();
    ctx.arc(bx + 4 + i * 7, by, 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
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

function drawDeathRing(ctx, h) {
  const a = 1 - h.t * 2.2;
  if (a <= 0) return;
  const r = 6 + h.t * 32;
  ctx.save();
  ctx.globalAlpha = a * 0.7;
  ctx.strokeStyle = h.color || '#b8c0cc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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
