// ─────────────────────────────────────────────────────────────────────────────
// Audio system — asset-free. Every sound is synthesized with the Web Audio API
// (oscillators + filtered noise), so there are no audio files to ship. One small
// reusable API:
//
//   resumeAudio()            — call once on a user gesture (browsers require it)
//   playSfx(name, opts)      — fire a named sound effect
//   startMusic() / stopMusic() — gentle generative background loop
//   toggleMute() / setVolume() — global controls (persisted)
//
// To add a sound: add one entry to RECIPES below and call playSfx('name').
// ─────────────────────────────────────────────────────────────────────────────

let ctx = null;
let master = null, sfxBus = null, musicBus = null;
let started = false;
let muted = false;
const lastPlayAt = {}; // per-sound throttle (ms)

const MASTER_VOL = 0.55;

try { muted = localStorage.getItem('fg_muted') === '1'; } catch { }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER_VOL; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.3; musicBus.connect(master);
  return ctx;
}

export function resumeAudio() {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  started = true;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : MASTER_VOL;
  try { localStorage.setItem('fg_muted', m ? '1' : '0'); } catch { }
}
export function isMuted() { return muted; }
export function toggleMute() { setMuted(!muted); return muted; }

// ── synth helpers ────────────────────────────────────────────────────────────
function noiseBuffer(dur) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function envGain(t0, attack, hold, release, peak) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  return g;
}

function tone(t0, { freq, type = 'sine', dur = 0.15, peak = 0.4, glideTo, dest }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
  const g = envGain(t0, 0.005, dur * 0.25, dur * 0.75, peak);
  o.connect(g).connect(dest || sfxBus);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise(t0, { dur = 0.15, peak = 0.3, type = 'highpass', freq = 900, dest }) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = envGain(t0, 0.002, dur * 0.1, dur * 0.9, peak);
  src.connect(f).connect(g).connect(dest || sfxBus);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

// ── sound recipes ─────────────────────────────────────────────────────────────
const RECIPES = {
  swing: t => noise(t, { dur: 0.12, peak: 0.16, type: 'bandpass', freq: 1300 }),
  hit: t => { tone(t, { freq: 165, dur: 0.12, peak: 0.5, glideTo: 80 }); noise(t, { dur: 0.08, peak: 0.28, type: 'lowpass', freq: 2200 }); },
  hitHeavy: t => { tone(t, { freq: 110, dur: 0.22, peak: 0.7, glideTo: 52 }); noise(t, { dur: 0.16, peak: 0.42, type: 'lowpass', freq: 1500 }); },
  crit: t => { tone(t, { freq: 210, type: 'square', dur: 0.2, peak: 0.4, glideTo: 90 }); noise(t, { dur: 0.18, peak: 0.5, type: 'lowpass', freq: 2600 }); tone(t + 0.01, { freq: 900, dur: 0.14, peak: 0.22, glideTo: 1700 }); },
  block: t => { tone(t, { freq: 520, type: 'square', dur: 0.07, peak: 0.22, glideTo: 380 }); tone(t + 0.006, { freq: 700, type: 'square', dur: 0.06, peak: 0.16 }); },
  jump: t => tone(t, { freq: 300, dur: 0.16, peak: 0.2, glideTo: 700 }),
  land: t => { tone(t, { freq: 120, dur: 0.12, peak: 0.32, glideTo: 58 }); noise(t, { dur: 0.06, peak: 0.18, type: 'lowpass', freq: 800 }); },
  dash: t => noise(t, { dur: 0.2, peak: 0.18, type: 'bandpass', freq: 950 }),
  projectile: t => { tone(t, { freq: 620, type: 'sawtooth', dur: 0.25, peak: 0.18, glideTo: 200 }); noise(t, { dur: 0.2, peak: 0.13, type: 'bandpass', freq: 1600 }); },
  fire: t => noise(t, { dur: 0.4, peak: 0.28, type: 'lowpass', freq: 1200 }),
  ice: t => { tone(t, { freq: 1400, dur: 0.3, peak: 0.16, glideTo: 2200 }); tone(t + 0.02, { freq: 1860, dur: 0.25, peak: 0.1 }); },
  heal: t => [523, 659, 784].forEach((f, i) => tone(t + i * 0.06, { freq: f, dur: 0.18, peak: 0.16 })),
  warp: t => { tone(t, { freq: 200, dur: 0.34, peak: 0.3, glideTo: 1500 }); noise(t, { dur: 0.3, peak: 0.16, type: 'bandpass', freq: 2000 }); tone(t + 0.12, { freq: 1300, dur: 0.2, peak: 0.18, glideTo: 300 }); },
  clone: t => { tone(t, { freq: 420, type: 'triangle', dur: 0.18, peak: 0.2, glideTo: 250 }); noise(t, { dur: 0.12, peak: 0.1, type: 'bandpass', freq: 1800 }); },
  skill: t => tone(t, { freq: 300, type: 'triangle', dur: 0.3, peak: 0.24, glideTo: 600 }),
  ko: t => { tone(t, { freq: 92, dur: 0.6, peak: 0.7, glideTo: 40 }); noise(t, { dur: 0.5, peak: 0.45, type: 'lowpass', freq: 900 }); },
  // Bone crack/snap when a body goes limp (ragdoll activates).
  crack: t => {
    noise(t, { dur: 0.045, peak: 0.5, type: 'highpass', freq: 2700 });        // sharp snap transient
    tone(t, { freq: 380, type: 'square', dur: 0.05, peak: 0.32, glideTo: 150 }); // woody body
    noise(t + 0.012, { dur: 0.07, peak: 0.22, type: 'bandpass', freq: 1700 });   // crackle tail
  },
  // Sharingan awakening — a dark horror sting: a menacing detuned drone, a
  // dissonant tritone of dread, a descending whine, and a deep heartbeat thump.
  sharinganActivate: t => {
    tone(t, { freq: 55.0, type: 'sawtooth', dur: 1.5, peak: 0.22, glideTo: 47 });    // ominous low drone…
    tone(t, { freq: 58.6, type: 'sawtooth', dur: 1.5, peak: 0.17 });                  // …detuned → uneasy beating
    tone(t + 0.04, { freq: 92.5, type: 'triangle', dur: 1.3, peak: 0.14, glideTo: 87 }); // tritone of dread
    tone(t + 0.08, { freq: 2000, type: 'sine', dur: 1.0, peak: 0.15, glideTo: 210 });    // descending horror whine
    noise(t, { dur: 1.3, peak: 0.11, type: 'bandpass', freq: 520 });                     // eerie airy wash
    tone(t, { freq: 130, type: 'sine', dur: 0.5, peak: 0.42, glideTo: 40 });             // deep impact thump
    tone(t + 0.42, { freq: 120, type: 'sine', dur: 0.4, peak: 0.3, glideTo: 42 });       // heartbeat second beat
  },
};

export function playSfx(name, { throttleMs = 45 } = {}) {
  if (muted || !started) return;
  const c = ensure(); if (!c) return;
  const tMs = c.currentTime * 1000;
  if (tMs - (lastPlayAt[name] || 0) < throttleMs) return; // dedupe rapid bursts
  lastPlayAt[name] = tMs;
  const recipe = RECIPES[name]; if (!recipe) return;
  try { recipe(c.currentTime + 0.001); } catch { }
}

// ── generative background music ────────────────────────────────────────────────
// A slow, calm chord pad + soft bass — loops forever, lookahead-scheduled.
let musicTimer = null;
let musicStep = 0;
const STEP_SEC = 2.2;
const PROGRESSION = [
  [220.0, 277.2, 329.6], // A minor
  [196.0, 246.9, 293.7], // G
  [174.6, 220.0, 261.6], // F
  [207.7, 261.6, 311.1], // G#/Ab-ish lift
];

function scheduleBar() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.06;
  const chord = PROGRESSION[musicStep % PROGRESSION.length];
  chord.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.5);
    g.gain.setValueAtTime(0.07, t + STEP_SEC - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP_SEC);
    o.connect(g).connect(musicBus);
    o.start(t); o.stop(t + STEP_SEC + 0.1);
  });
  const bo = ctx.createOscillator(); bo.type = 'triangle'; bo.frequency.value = chord[0] / 2;
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.linearRampToValueAtTime(0.09, t + 0.15);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + STEP_SEC);
  bo.connect(bg).connect(musicBus);
  bo.start(t); bo.stop(t + STEP_SEC + 0.1);
  musicStep++;
}

export function startMusic() {
  const c = ensure(); if (!c || musicTimer) return;
  musicStep = 0;
  scheduleBar();
  musicTimer = setInterval(scheduleBar, STEP_SEC * 1000);
}

export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}
