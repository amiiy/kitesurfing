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
  let h = 0;
  for (const w of WAVES) h += w.a * Math.sin(w.k * (w.dx * x + w.dz * z - w.c * t));
  return h;
}

// Surface gradient (dh/dx, dh/dz) at a point; writes into `out` ({ x, z }).
export function waveSlope(x, z, t, out) {
  out.x = 0;
  out.z = 0;
  for (const w of WAVES) {
    const d = w.a * w.k * Math.cos(w.k * (w.dx * x + w.dz * z - w.c * t));
    out.x += d * w.dx;
    out.z += d * w.dz;
  }
  return out;
}
