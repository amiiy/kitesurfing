import { GAME } from './config.js';

// Gerstner wave set shared by the GPU water surface and CPU height queries (physics, buoys,
// wake), so everything floats on the visible water. Waves travel mostly downwind (-Z).
const G = 9.8;

export const WAVES = [
  // [direction angle from -Z (rad), wavelength (m), steepness]
  [0.0, 34, 0.1],
  [0.45, 21, 0.09],
  [-0.55, 13, 0.08],
  [0.2, 7.5, 0.06],
  [-0.9, 4.5, 0.04],
].map(([angle, wavelength, steepness]) => {
  const k = (2 * Math.PI) / wavelength;
  return {
    dx: Math.sin(angle),
    dz: -Math.cos(angle),
    k, // wavenumber
    c: Math.sqrt(G / k), // deep-water phase speed
    s: steepness,
    a: steepness / k, // amplitude
  };
});

// Height at an undisplaced grid point. Ignores the small horizontal Gerstner shift, which is
// within a few centimetres at these steepness values.
export function waveHeight(x, z, t) {
  let h = rampAt(x, z).h;
  for (const w of WAVES) h += w.a * Math.sin(w.k * (w.dx * x + w.dz * z - w.c * t));
  return h;
}

// Surface gradient (dh/dx, dh/dz) at a point; writes into `out` ({ x, z }).
export function waveSlope(x, z, t, out) {
  const r = rampAt(x, z);
  out.x = r.x;
  out.z = r.z;
  for (const w of WAVES) {
    const d = w.a * w.k * Math.cos(w.k * (w.dx * x + w.dz * z - w.c * t));
    out.x += d * w.dx;
    out.z += d * w.dz;
  }
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
