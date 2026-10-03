import * as THREE from 'three';
import { GAME } from '../config.js';
import { WAVES, ramps, waveHeight } from '../waves.js';
import { FADE, RISE, gustShape, upcomingGusts, windAt } from '../sim/wind.js';

// Gusts show as dark, ruffled water rolling downwind (-Z) at GUST_SPEED, reaching the rider as they hit.
const GUSTS = 4;
const GUST_SPEED = 12; // m/s

// Ocean surface. Waves are displaced in the vertex shader from the shared WAVES set; the fragment
// shader is cartoon: analytic normals and ripples drive flat colour bands, with hard-edged crest
// foam, wake lines, sun sparkles and a contact shadow under the rider (no shadow maps here).

// Format a number as a GLSL float literal; wave constants are baked into the shader source.
const f = (n) => n.toFixed(6);
const phase = (w) => `${f(w.k)} * (dot(vec2(${f(w.dx)}, ${f(w.dz)}), xz) - ${f(w.c)} * uTime) + ${f(w.p)}`;

// Wind ripples [direction x, z; wavenumber rad/m], at the capillary-gravity dispersion speed
// ω = √(g k + σ/ρ k³) (sea water σ/ρ = 7.2e-5 m³/s²; the capillary term only counts at cm scale).
const RIPPLES = [
  [0.8, -0.6, 2.3],
  [-0.5, -0.86, 3.1],
  [0.2, -0.98, 5.3],
];
const ripple = ([dx, dz, k]) =>
  `r += vec2(${f(dx)}, ${f(dz)}) * cos(dot(xz, vec2(${f(dx)}, ${f(dz)})) * ${f(k)} - uTime * ${f(Math.sqrt(9.8 * k + 7.2e-5 * k ** 3))});`;

// Kicker swells, same shape as waves.js rampAt: (height, dh/dx, dh/dz) from the nearest RAMPS centres.
const RAMPS = 4;
const { height: RH, halfLength: RL, halfWidth: RW } = GAME.ramp;
const rampGlsl = /* glsl */ `
uniform vec2 uRamps[${RAMPS}];
vec3 ramps(vec2 xz) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < ${RAMPS}; i++) {
    vec2 u = (xz - uRamps[i]) / vec2(${f(RL)}, ${f(RW)});
    if (abs(u.x) >= 1.0 || abs(u.y) >= 1.0) continue;
    vec2 c = cos(1.5707963 * u);
    c *= c;
    vec2 s = sin(3.1415927 * u);
    r += ${f(RH)} * vec3(c.x * c.y, -${f(Math.PI / (2 * RL))} * s.x * c.y, -${f(Math.PI / (2 * RW))} * s.y * c.x);
  }
  return r;
}`;

const vertexShader = () => /* glsl */ `
uniform float uTime;
uniform float uCalm; // 0..1: the lagoon's swell flattens towards the shore (render only: the sim keeps its waves)
uniform vec4 uRider;
varying vec3 vWorld;
varying vec2 vBase;
varying float vFold;
varying float vSwell;
${rampGlsl}
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 xz = wp.xz;
  vec3 p = wp.xyz;
  // Jacobian J of the sideways motion: where the waves squeeze the surface together (J well below 1)
  // crests sharpen and break.
  float jxx = 1.0, jxz = 0.0, jzz = 1.0;
  // Full swell within 40 m downwind of the rider (it rides the sim's waves), calm from 150 m on.
  float k = 1.0 - uCalm * smoothstep(40.0, 150.0, uRider.z - xz.y);
  ${WAVES.map(
    (w) => `{ float ph = ${phase(w)}; float c = k * cos(ph), s = k * sin(ph);
    p.x += ${f(w.dx * w.a)} * c; p.z += ${f(w.dz * w.a)} * c; p.y += ${f(w.a)} * s;
    jxx -= ${f(w.s * w.dx * w.dx)} * s; jxz -= ${f(w.s * w.dx * w.dz)} * s; jzz -= ${f(w.s * w.dz * w.dz)} * s; }`
  ).join('\n  ')}
  // Ramps lift the surface where it now is (as waves.js) and whiten towards their tops so they
  // read as breaking swells.
  vec3 ramp = ramps(p.xz);
  p.y += ramp.x;
  vWorld = p;
  vBase = xz;
  vSwell = k;
  vFold = 1.0 - (jxx * jzz - jxz * jxz) + 0.25 * ramp.x / ${f(RH)};
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = () => /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uLight;
uniform vec3 uFoam;
uniform vec4 uRider; // xyz = rider position, w = height above water
uniform vec3 uVel; // xy = horizontal travel direction, z = speed (m/s)
uniform vec4 uGusts[${GUSTS}]; // at, amp, hold (wind.js), unused
uniform float uWind; // the level's wind now, without gusts, as a share of WIND.knots · WIND.strength
varying vec3 vWorld;
varying vec2 vBase;
varying float vFold;
varying float vSwell;
#include <fog_pars_fragment>
${rampGlsl}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Hard step at \`edge\`, anti-aliased over about one pixel at any distance.
float band(float x, float edge) {
  float w = fwidth(x) * 0.75;
  return smoothstep(edge - w, edge + w, x);
}

void main() {
  vec2 xz = vBase;
  // Analytic Gerstner normal
  vec3 n = vec3(0.0, 1.0, 0.0);
  ${WAVES.map(
    (w) => `{ float ph = ${phase(w)};
    n.x -= ${f(w.dx * w.s)} * vSwell * cos(ph); n.z -= ${f(w.dz * w.s)} * vSwell * cos(ph); n.y -= ${f(w.s)} * vSwell * sin(ph); }`
  ).join('\n  ')}
  vec3 ramp = ramps(vWorld.xz);
  n.xz -= ramp.yz;
  vec3 Ng = normalize(n); // swell only, before ripples: a smooth field to size the sparkles by

  // Small wind ripples, faded out with distance to avoid shimmering
  float dist = length(cameraPosition - vWorld);
  float detail = 1.0 - smoothstep(15.0, 140.0, dist);
  vec2 r = vec2(0.0);
  ${RIPPLES.map(ripple).join('\n  ')}
  r += vec2(noise(xz * 1.7 + uTime * 0.6), noise(xz * 1.7 - uTime * 0.5)) - 0.5;
  // Gust patches: the gust's envelope (wind.js gustShape) as felt here, earlier upwind (+Z).
  float tl = uTime + (vWorld.z - uRider.z) / ${f(GUST_SPEED)};
  float gust = 0.0;
  for (int i = 0; i < ${GUSTS}; i++) {
    vec4 g = uGusts[i];
    if (g.y == 0.0) continue; // empty slot: calm levels skip the gust maths
    float u = tl - g.x;
    float x = u < ${f(RISE)} ? u / ${f(RISE)} : u < ${f(RISE)} + g.z ? 1.0 : 1.0 - (u - ${f(RISE)} - g.z) / ${f(FADE)};
    x = clamp(x, 0.0, 1.0) * step(0.0, u);
    gust += g.y * x * x * (3.0 - 2.0 * x);
  }
  if (gust != 0.0) gust *= 0.6 + 0.8 * noise(xz * 0.08 + vec2(0.0, uTime * 0.4)); // patchy, not a straight band
  // Ripples grow with the wind stress (∝ U²) of the wind here: ruffled in a gust, glassy in a lull.
  float wind = uWind * (1.0 + gust);
  n.xz -= r * 0.07 * detail * wind * wind;
  vec3 N = normalize(n);

  // One tone value picks between four flat colour bands: crests, sun-facing slopes, the sun's
  // reflection path and grazing angles (the distance) go light, troughs go deep.
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  float path = pow(max(dot(R, uSunDir), 0.0), 12.0);
  float tone = 0.3 + vFold * 1.6 + dot(N, uSunDir) * 0.2 + fres * 0.6 + path * 0.35;
  vec3 col = mix(uDeep, uMid, band(tone, 0.24));
  col = mix(col, uShallow, band(tone, 0.55));
  col = mix(col, uLight, band(tone, 0.8));
  col = mix(col, uDeep * 0.7, clamp(gust, 0.0, 1.0)); // gusts darken the water

  // Sun glint: hard-edged four-point sparkles in a jittered grid, sized by how well the swell
  // reflects the sun and twinkling on their own clocks; faded out before they shrink below a pixel.
  vec2 g = xz * 0.8;
  vec2 id = floor(g);
  vec2 q = abs(fract(g) - 0.3 - 0.4 * vec2(hash(id), hash(id + 7.3)));
  float star = sqrt(q.x) + sqrt(q.y); // astroid: a cartoon twinkle shape
  float size = 0.6 * pow(max(dot(reflect(-V, Ng), uSunDir), 0.0), 8.0) * max(sin(6.2832 * (hash(id + 3.7) + uTime * 0.7)), 0.0);
  size *= 1.0 - smoothstep(50.0, 120.0, dist);
  float spark = clamp((size - star) / max(fwidth(star), 1e-4), 0.0, 1.0);

  // Foam caps where the waves squeeze the surface (J under ~0.78: breaking crests, ~3% of the sea
  // in 27 kn as whitecap surveys find), ringed by a thin foam line just below them.
  float foamN = noise(xz * 2.5 + uTime * 0.3) * 0.6 + mix(0.5, noise(xz * 7.0), detail) * 0.4;
  float c = vFold + (foamN - 0.5) * 0.12;
  float foam = max(band(c, 0.22), (band(c, 0.15) - band(c, 0.17)) * detail);

  // Wake, only while the board is on the water: a foam line down its track and the Kelvin arms,
  // asin(1/3) = 19.5° off it at any speed (deep water). The foam lasts ~1.2 s, so the wake
  // stretches with speed, and it fades out as the board slows off the plane.
  vec2 rel = vWorld.xz - uRider.xz;
  float behind = -dot(rel, uVel.xy);
  float lateral = abs(rel.x * uVel.y - rel.y * uVel.x);
  float arms = 1.0 - smoothstep(0.0, 0.35 + behind * 0.05, abs(lateral - 0.28 - behind * 0.3536));
  float core = 1.0 - smoothstep(0.0, 0.18 + behind * 0.11, lateral);
  float wake = max(arms, core * 0.6) * step(0.0, behind) * (1.0 - smoothstep(0.2, 1.2, behind / max(uVel.z, 0.1)));
  wake *= smoothstep(2.0, 8.0, uVel.z) * (1.0 - smoothstep(0.1, 0.6, uRider.w));
  wake *= smoothstep(0.35, 0.65, noise(xz * 4.0 - uVel.xy * uTime * 2.0) + 0.25);
  foam = max(foam, band(wake, 0.4));
  col = mix(col, uFoam, foam);
  col = mix(col, uSunColor * 2.0, spark); // over-bright: tone mapping turns it pure white

  // Hard-edged contact shadow under the rider, shrinking and fading with height.
  float d = length(vWorld.xz - uRider.xz);
  float h = uRider.w;
  col *= 1.0 - (1.0 - band(d, 0.55 + h * 0.15)) * 0.4 / (1.0 + h * 0.6);

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function createWater({ size = 400, segments = 220, sunDir }) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: vertexShader(),
    fragmentShader: fragmentShader(),
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunColor: { value: new THREE.Color(0xfffbe6) },
        uDeep: { value: new THREE.Color(0x0b4a6e) }, // navy turquoise
        uMid: { value: new THREE.Color(0x0f86a8) },
        uShallow: { value: new THREE.Color(0x1fb9c8) },
        uLight: { value: new THREE.Color(0x6fe3e6) }, // bright turquoise
        uFoam: { value: new THREE.Color(0xf4fcff) },
        uRider: { value: new THREE.Vector4() },
        uVel: { value: new THREE.Vector3() },
        uGusts: { value: Array.from({ length: GUSTS }, () => new THREE.Vector4()) },
        uWind: { value: 1 },
        uRamps: { value: Array.from({ length: RAMPS }, () => new THREE.Vector2()) },
        uCalm: { value: 0 },
      },
    ]),
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  const cell = size / segments;

  return {
    mesh,
    // WAVES are baked into the shaders: recompile after setWind.
    rebuild() {
      material.vertexShader = vertexShader();
      material.fragmentShader = fragmentShader();
      material.needsUpdate = true;
    },
    // 0..1 lagoon calm (world.js updateShore): flattens the swell towards the shore.
    setCalm(amount) {
      material.uniforms.uCalm.value = amount;
    },
    update(t, state) {
      // Snap to the grid so vertices sample the same world points as the mesh follows the rider.
      const { x, y, z } = state.pos;
      mesh.position.set(Math.round(x / cell) * cell, 0, Math.round(z / cell) * cell);
      material.uniforms.uTime.value = t;
      for (let i = 0; i < RAMPS; i++) {
        const r = ramps[ramps.length - 1 - i]; // the latest are the nearest: they're fixed in course order
        material.uniforms.uRamps.value[i].set(r ? r.x : 1e6, r ? r.z : 1e6);
      }
      const gusts = upcomingGusts(t, GUSTS);
      for (let i = 0; i < GUSTS; i++) {
        const g = gusts[i];
        material.uniforms.uGusts.value[i].set(g ? g.at : 0, g ? g.amp : 0, g ? g.hold : 0, 0);
      }
      // windAt(t) is the level's wind times the gusts felt now (1 + Σ amp · shape): divide those out.
      material.uniforms.uWind.value = windAt(t) / gusts.reduce((g, gust) => g + gust.amp * gustShape(gust, t), 1);
      material.uniforms.uRider.value.set(x, y, z, Math.max(0, y - waveHeight(x, z, t)));
      const speed = Math.hypot(state.vel.x, state.vel.z);
      if (speed > 0.01) material.uniforms.uVel.value.set(state.vel.x / speed, state.vel.z / speed, speed);
      else material.uniforms.uVel.value.z = 0;
    },
  };
}
