import { GAME, SEA, WIND } from './config.js';
import { rng } from './sim/wind.js';

// Gerstner wave set shared by the GPU water surface and CPU height queries (physics, buoys,
// wake), so everything floats on the visible water. The wind always blows toward -Z; the sea is a
// wind sea sampled from its spectrum, travelling SEA.wind[mode] rad off the wind, `size` times as
// high (setWind rebuilds the set in place, before a run).
const G = 9.8;
const KNOT = 0.5144; // m/s
const COUNT = 12; // wave components
const SEED = 11; // fixed: the same sea every run (fair scores, deterministic sim-check)
const MAX_STEEPNESS = 0.8; // Σ k·a of the set; at 1 Gerstner crests fold over into loops

export const WAVES = [];

export function setWind(mode, size = 1) {
  WAVES.length = 0;
  // JONSWAP spectrum S(ω) of a sea raised by wind U (m/s) over fetch F (m): peak ωp = 22 (g²/(U F))^⅓
  // rad/s, Phillips α = 0.076 (U²/(F g))^0.22, peak enhancement γ = 3.3 (width 0.07 below ωp, 0.09 above).
  const U = WIND.knots * WIND.strength * KNOT;
  const F = SEA.fetch;
  const wp = 22 * Math.cbrt((G * G) / (U * F));
  const alpha = 0.076 * ((U * U) / (F * G)) ** 0.22;
  const spectrum = (w) =>
    alpha * G * G * w ** -5 * Math.exp(-1.25 * (wp / w) ** 4) * 3.3 ** Math.exp(-((w - wp) ** 2) / (2 * (w < wp ? 0.07 : 0.09) ** 2 * wp * wp));
  // One wave per log-spaced band of 0.8–3 ωp (1.5 to 1/9 of the peak wavelength), at a random
  // frequency in its band carrying the band's energy (a = √(2 S Δω)), heading off the swell
  // direction by a draw from a cos² spread, at a random phase.
  const rand = rng(SEED);
  const lo = 0.8 * wp;
  const span = 3 / 0.8;
  let steepness = 0;
  for (let i = 0; i < COUNT; i++) {
    const w0 = lo * span ** (i / COUNT);
    const w1 = lo * span ** ((i + 1) / COUNT);
    const w = w0 + (w1 - w0) * rand();
    let angle;
    do angle = (rand() - 0.5) * Math.PI;
    while (rand() > Math.cos(angle) ** 2);
    angle += SEA.wind[mode];
    const k = (w * w) / G; // deep water: ω² = g k
    const a = size * Math.sqrt(2 * spectrum(w) * (w1 - w0));
    steepness += k * a;
    WAVES.push({
      dx: Math.sin(angle),
      dz: -Math.cos(angle),
      k, // wavenumber
      c: w / k, // deep-water phase speed
      s: k * a, // steepness
      a, // amplitude
      p: 2 * Math.PI * rand(), // phase offset
    });
  }
  // A set too steep (big `size`, strong wind) is scaled down rather than let its crests loop.
  const fit = Math.min(1, MAX_STEEPNESS / steepness);
  for (const w of WAVES) {
    w.a *= fit;
    w.s *= fit;
  }
}
setWind('onshore');

// The swell under world point (x, z), into `sea`. Gerstner waves carry the water sideways as well
// as up (by up to ~2 m here), so first find the rest point p whose water is now over (x, z):
// invert x = p + Σ d·a cos θ(p) by fixed-point iteration, which converges as Σ k·a < 1 (3 rounds:
// height within ~1 cm). Then h, the world gradient ∇h = J⁻ᵀ ∇ₚh (J: Jacobian of the sideways
// motion), and the water's motion at p: vertical speed ht = ∂h/∂t, horizontal velocity (ux, uz).
const sea = { h: 0, x: 0, z: 0, ht: 0, ux: 0, uz: 0 };
function swell(x, z, t) {
  let px = x;
  let pz = z;
  for (let i = 0; i < 3; i++) {
    let ox = 0;
    let oz = 0;
    for (const w of WAVES) {
      const d = w.a * Math.cos(w.k * (w.dx * px + w.dz * pz - w.c * t) + w.p);
      ox += w.dx * d;
      oz += w.dz * d;
    }
    px = x - ox;
    pz = z - oz;
  }
  let h = 0, gx = 0, gz = 0, ht = 0, ux = 0, uz = 0, jxx = 1, jxz = 0, jzz = 1;
  for (const w of WAVES) {
    const th = w.k * (w.dx * px + w.dz * pz - w.c * t) + w.p;
    const sin = Math.sin(th);
    const cos = Math.cos(th);
    const v = w.a * w.k * w.c; // orbital speed, m/s
    h += w.a * sin;
    gx += w.s * w.dx * cos;
    gz += w.s * w.dz * cos;
    ht -= v * cos;
    ux += v * w.dx * sin;
    uz += v * w.dz * sin;
    jxx -= w.s * w.dx * w.dx * sin;
    jxz -= w.s * w.dx * w.dz * sin;
    jzz -= w.s * w.dz * w.dz * sin;
  }
  const det = jxx * jzz - jxz * jxz;
  sea.h = h;
  sea.x = (jzz * gx - jxz * gz) / det;
  sea.z = (jxx * gz - jxz * gx) / det;
  sea.ht = ht;
  sea.ux = ux;
  sea.uz = uz;
  return sea;
}

// Rate the swell (not ramps) lifts a board moving at (vx, vz) over the surface: the water's own
// rise plus the slope times the board's speed through the water, dh/dt = ∂h/∂t + ∇h·(v - u).
// Positive riding up a face, negative over the back.
export function waveRise(x, z, t, vx, vz) {
  const s = swell(x, z, t);
  return s.ht + s.x * (vx - s.ux) + s.z * (vz - s.uz);
}

// Surface height at a world point.
export function waveHeight(x, z, t) {
  return rampAt(x, z).h + swell(x, z, t).h;
}

// Surface gradient (dh/dx, dh/dz) at a world point; writes into `out` ({ x, z }).
export function waveSlope(x, z, t, out) {
  const r = rampAt(x, z);
  const s = swell(x, z, t);
  out.x = r.x + s.x;
  out.z = r.z + s.z;
  return out;
}

// Kicker swells the course raises along the rider's line (src/game/run.js pushes { x, z } centres,
// a new run clears them): static raised-cosine mounds, long across the course so the board meets
// the face head-on. The water shader mirrors this shape (src/render/water.js).
export const ramps = [];
const { height: RH, halfLength: RL, halfWidth: RW } = GAME.ramp;
const ramp = { h: 0, x: 0, z: 0 };

// Height of the ramps at (x, z) and their gradient (dh/dx, dh/dz), as { h, x, z } (reused object).
export function rampAt(x, z) {
  ramp.h = ramp.x = ramp.z = 0;
  for (const r of ramps) {
    const u = (x - r.x) / RL;
    const w = (z - r.z) / RW;
    if (Math.abs(u) >= 1 || Math.abs(w) >= 1) continue;
    const cu = Math.cos((Math.PI / 2) * u) ** 2;
    const cw = Math.cos((Math.PI / 2) * w) ** 2;
    ramp.h += RH * cu * cw;
    ramp.x -= ((RH * Math.PI) / (2 * RL)) * Math.sin(Math.PI * u) * cw;
    ramp.z -= ((RH * Math.PI) / (2 * RW)) * Math.sin(Math.PI * w) * cu;
  }
  return ramp;
}
