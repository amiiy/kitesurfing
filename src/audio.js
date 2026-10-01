// Procedural sound: wind, water hiss, kite whoosh/flap, landing thump. No assets.
// Browsers block audio until a user gesture, so the graph is built on the first key/click.
// M toggles mute.

const VOLUME = 0.8;
const SMOOTH = 0.08; // seconds; time constant for parameter changes, hides per-frame steps

export function createAudio() {
  let ctx = null;
  let nodes = null;
  let muted = true; // off by default; M turns it on
  let prevAz = null;
  let prevEl = 0;

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

      // Wind: rises with gusts and with the apparent wind of riding fast.
      const w = state.gust * (0.6 + 0.6 * s);
      set(nodes.windFilter.frequency, 250 + 700 * w);
      set(nodes.windGain.gain, 0.05 + 0.08 * w);

      // Water hiss: only while the board is on the water.
      set(nodes.waterFilter.frequency, 900 + 2500 * s);
      set(nodes.waterGain.gain, state.airborne ? 0 : 0.18 * s * s + 0.01);

      // Kite: whoosh with speed, canopy flutter strongest when moving but unloaded.
      set(nodes.kiteFilter.frequency, 300 + 1500 * k);
      set(nodes.kiteGain.gain, 0.25 * k * k * (0.4 + power));
      set(nodes.flapDepth.gain, 0.04 * (k + 0.3) * (1 - power) * (kite.crashed ? 0 : 1));
      set(nodes.flapLfo.frequency, 7 + 10 * k);

      if (state.landImpact > 0) thump(ctx, nodes.master, Math.min(state.landImpact / 8, 1));
    },
  };
}

function build(ctx) {
  const master = ctx.createGain();
  master.connect(ctx.destination);

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

  return { master, windFilter, windGain, waterFilter, waterGain, kiteFilter, kiteGain, flapLfo, flapDepth };
}

// Landing: a falling sine for the body plus a short noise splash; `amount` 0..1.
function thump(ctx, out, amount) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(110, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.6 * amount, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.4);

  const len = ctx.sampleRate * 0.4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1200;
  const sg = ctx.createGain();
  sg.gain.value = 0.5 * amount;
  src.connect(f).connect(sg).connect(out);
  src.start(t);
}
