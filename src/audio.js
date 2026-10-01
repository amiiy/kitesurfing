import { JUMP } from './config.js';
import { inSweetSpot } from './feel.js';

// Procedural cartoon sound: wind, water hiss, kite whoosh/flap, a charge tone with a sweet-spot
// chime, release whoomps and a landing thump. No assets.
// Browsers block audio until a user gesture, so the graph is built on the first key/click/tap
// and plays from then on; M toggles mute.

const VOLUME = 0.9;
const SMOOTH = 0.08; // seconds; time constant for parameter changes, hides per-frame steps

export function createAudio() {
  let ctx = null;
  let nodes = null;
  let muted = false;
  let prevAz = null;
  let prevEl = 0;
  let wasReady = false;
  let wasWipeout = false;

  function start() {
    if (ctx) return void ctx.resume();
    ctx = new AudioContext();
    nodes = build(ctx);
    nodes.master.gain.value = muted ? 0 : VOLUME;
  }
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') {
      muted = !muted;
      if (nodes) nodes.master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.05);
    }
    start();
  });
  addEventListener('pointerdown', start);

  return {
    update(state, dt) {
      if (!nodes || ctx.state !== 'running' || dt <= 0) return;
      const now = ctx.currentTime;
      const set = (param, v) => param.setTargetAtTime(v, now, SMOOTH);
      const speed = Math.hypot(state.vel.x, state.vel.z);
      const s = Math.min(speed / 15, 1); // ~top board speed in m/s
      const { kite } = state;

      // Kite angular speed across the window, rad/s; ~2 is a hard loop.
      if (prevAz === null) prevAz = kite.az, prevEl = kite.el;
      const ang = Math.hypot((kite.az - prevAz) * Math.cos(kite.el), kite.el - prevEl) / dt;
      prevAz = kite.az;
      prevEl = kite.el;
      const k = kite.crashed ? 0 : Math.min(ang / 2, 1);
      const power = kite.crashed ? 0 : kite.power;

      // Wind: soft, rising with gusts and with the apparent wind of riding fast.
      const w = state.gust * (0.6 + 0.6 * s);
      set(nodes.windFilter.frequency, 250 + 600 * w);
      set(nodes.windGain.gain, 0.02 + 0.035 * w);

      // Water hiss: only while the board is on the water.
      set(nodes.waterFilter.frequency, 900 + 2500 * s);
      set(nodes.waterGain.gain, state.airborne ? 0 : 0.18 * s * s + 0.01);

      // Kite: whoosh with speed, canopy flutter strongest when moving but unloaded.
      set(nodes.kiteFilter.frequency, 300 + 1500 * k);
      set(nodes.kiteGain.gain, 0.25 * k * k * (0.4 + power));
      set(nodes.flapDepth.gain, 0.04 * (k + 0.3) * (1 - power) * (kite.crashed ? 0 : 1));
      set(nodes.flapLfo.frequency, 7 + 10 * k);

      // Charge: a tone rising with the load; a chime on entering the sweet spot, sour (sawtooth) past it.
      const ready = inSweetSpot(state.charge);
      set(nodes.chargeOsc.frequency, 220 + 520 * state.charge);
      set(nodes.chargeGain.gain, state.charge > 0 ? 0.05 + 0.05 * state.charge : 0);
      nodes.chargeOsc.type = state.charge > JUMP.sweetMax ? 'sawtooth' : 'triangle';
      if (ready && !wasReady) chime(ctx, nodes.master);
      wasReady = ready;

      if (state.jumpResult) RELEASE[state.jumpResult](ctx, nodes.master);
      if (state.landImpact > 0) thump(ctx, nodes.master, Math.min(state.landImpact / 8, 1));
      const wipeout = state.wipeout > 0;
      if (wipeout && !wasWipeout) thump(ctx, nodes.master, 1.3);
      wasWipeout = wipeout;
    },
  };
}

function build(ctx) {
  const master = ctx.createGain();
  // Glue and safety: the punchy one-shots stack on the loops without clipping.
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);

  // One looped white-noise buffer feeds every noise voice.
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noiseVoice = (type, q) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random(); // decorrelate the voices
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start(0, Math.random() * 2);
    return [filter, gain];
  };

  const [windFilter, windGain] = noiseVoice('lowpass', 0.7);
  const [waterFilter, waterGain] = noiseVoice('bandpass', 0.6);
  const [kiteFilter, kiteGain] = noiseVoice('bandpass', 2);

  // Flap: an LFO added onto a quiet noise voice's gain gives a fluttering canopy.
  const [, flapGain] = noiseVoice('highpass', 0.5);
  const flapLfo = ctx.createOscillator();
  flapLfo.type = 'square';
  const flapDepth = ctx.createGain();
  flapDepth.gain.value = 0;
  flapLfo.connect(flapDepth).connect(flapGain.gain);
  flapLfo.start();

  const chargeOsc = ctx.createOscillator();
  const chargeGain = ctx.createGain();
  chargeGain.gain.value = 0;
  chargeOsc.connect(chargeGain).connect(master);
  chargeOsc.start();

  return { master, windFilter, windGain, waterFilter, waterGain, kiteFilter, kiteGain, flapLfo, flapDepth, chargeOsc, chargeGain };
}

// One enveloped oscillator: `freq` [from, to] Hz over `len` s, peak `gain`, starting `at` s from now.
function tone(ctx, out, type, [from, to], gain, len, at = 0) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

// A burst of filtered noise; the filter sweeps `freq` [from, to] Hz over `len` s.
function noise(ctx, out, type, [from, to], gain, len) {
  const t = ctx.currentTime;
  const n = Math.ceil(ctx.sampleRate * len);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + len);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

// Sweet spot reached: a bright two-note ding.
function chime(ctx, out) {
  tone(ctx, out, 'sine', [1320, 1320], 0.18, 0.35);
  tone(ctx, out, 'sine', [1980, 1980], 0.12, 0.45, 0.06);
}

// Release: a 'whoomp' (rising sine body + swept air) scaled per result; Perfect adds a sparkle,
// Overload is a dull bonk, Slow a sad falling 'womp womp'.
const RELEASE = {
  perfect(ctx, out) {
    tone(ctx, out, 'sine', [90, 320], 0.7, 0.28);
    noise(ctx, out, 'lowpass', [300, 3000], 0.5, 0.35);
    tone(ctx, out, 'triangle', [880, 1760], 0.15, 0.3, 0.05);
  },
  early(ctx, out) {
    tone(ctx, out, 'sine', [90, 220], 0.4, 0.2);
    noise(ctx, out, 'lowpass', [300, 1500], 0.25, 0.22);
  },
  overload(ctx, out) {
    tone(ctx, out, 'square', [140, 60], 0.18, 0.25);
    noise(ctx, out, 'lowpass', [600, 200], 0.3, 0.25);
  },
  slow(ctx, out) {
    tone(ctx, out, 'triangle', [330, 300], 0.15, 0.22);
    tone(ctx, out, 'triangle', [280, 200], 0.15, 0.35, 0.22);
  },
};

// Landing: a punchy pitch-dropping kick for the body, a click on top and a water splash; `amount` 0..1+.
function thump(ctx, out, amount) {
  tone(ctx, out, 'sine', [160, 42], 1.0 * amount, 0.32);
  tone(ctx, out, 'triangle', [900, 120], 0.25 * amount, 0.04);
  noise(ctx, out, 'bandpass', [1800, 600], 0.7 * amount, 0.45);
}
