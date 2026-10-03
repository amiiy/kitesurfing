import { WIND } from '../config.js';

// The level's wind over run time: base knots eased between [t, knots] keys, plus gusts and lulls
// scheduled from a seed, so a level blows the same every run (fair scores, deterministic sim-check).
// windAt(t) is the multiplier on WIND.strength the sim and HUD use (1 = WIND.knots · WIND.strength).

export const RISE = 1; // s a gust takes to build...
export const FADE = 2; // ...and to die away
const SPAN = 300; // s of gusts scheduled; well past any run

let keys = [[0, WIND.knots * WIND.strength]];
export const gusts = []; // { at, amp, hold }: starts building at `at`, in time order

// Small seeded PRNG (mulberry32).
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// plan: { knots: [[t, kn], ...], gusts?: { seed, every (mean s between), strength (fraction) } }
export function setWindPlan(plan) {
  keys = plan.knots;
  gusts.length = 0;
  if (!plan.gusts) return;
  const { seed, every, strength } = plan.gusts;
  const rand = rng(seed);
  for (let at = every * (0.5 + rand()); at < SPAN; at += every * (0.5 + rand())) {
    const lull = rand() < 0.25; // a quarter are lulls: the wind drops instead
    gusts.push({ at, amp: strength * (0.5 + 0.5 * rand()) * (lull ? -0.6 : 1), hold: 2 + 2 * rand() });
  }
}

// 0..1 envelope of a gust at time t.
export function gustShape(g, t) {
  const u = t - g.at;
  if (u <= 0 || u >= RISE + g.hold + FADE) return 0;
  const x = u < RISE ? u / RISE : u < RISE + g.hold ? 1 : 1 - (u - RISE - g.hold) / FADE;
  return x * x * (3 - 2 * x);
}

function knotsAt(t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, k1] = keys[i];
    if (t < t1) {
      const [t0, k0] = keys[i - 1];
      return k0 + ((k1 - k0) * (t - t0)) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

export function windAt(t) {
  let g = 1;
  for (const gust of gusts) {
    if (gust.at > t) break;
    g += gust.amp * gustShape(gust, t);
  }
  return (knotsAt(t) / (WIND.knots * WIND.strength)) * g;
}

// The next `n` gusts not yet over at t (for the water's dark gust patches and the HUD warning).
export function upcomingGusts(t, n) {
  const out = [];
  for (const g of gusts) {
    if (g.at + RISE + g.hold + FADE <= t) continue;
    out.push(g);
    if (out.length === n) break;
  }
  return out;
}
