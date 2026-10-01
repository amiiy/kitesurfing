import * as THREE from 'three';
import { WAVES, waveHeight } from '../waves.js';

// Ocean surface. Waves are displaced in the vertex shader from the shared WAVES set; the fragment
// shader is cartoon: analytic normals and ripples drive flat colour bands, with hard-edged crest
// foam, wake lines, sun sparkles and a contact shadow under the rider (no shadow maps here).

// Format a number as a GLSL float literal; wave constants are baked into the shader source.
const f = (n) => n.toFixed(6);
const phase = (w) => `${f(w.k)} * (dot(vec2(${f(w.dx)}, ${f(w.dz)}), xz) - ${f(w.c)} * uTime)`;

const vertexShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vBase;
varying float vCrest;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 xz = wp.xz;
  vec3 p = wp.xyz;
  float crest = 0.0;
  ${WAVES.map(
    (w) => `{ float ph = ${phase(w)};
    p.x += ${f(w.dx * w.a)} * cos(ph); p.z += ${f(w.dz * w.a)} * cos(ph);
    p.y += ${f(w.a)} * sin(ph); crest += ${f(w.s)} * sin(ph); }`
  ).join('\n  ')}
  vWorld = p;
  vBase = xz;
  vCrest = crest;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
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
varying vec3 vWorld;
varying vec2 vBase;
varying float vCrest;
#include <fog_pars_fragment>

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
    n.x -= ${f(w.dx * w.s)} * cos(ph); n.z -= ${f(w.dz * w.s)} * cos(ph); n.y -= ${f(w.s)} * sin(ph); }`
  ).join('\n  ')}
  vec3 Ng = normalize(n); // swell only, before ripples: a smooth field to size the sparkles by

  // Small wind ripples, faded out with distance to avoid shimmering
  float dist = length(cameraPosition - vWorld);
  float detail = 1.0 - smoothstep(15.0, 140.0, dist);
  vec2 r = vec2(0.0);
  r += vec2(0.8, -0.6) * cos(dot(xz, vec2(0.8, -0.6)) * 2.3 - uTime * 3.4);
  r += vec2(-0.5, -0.86) * cos(dot(xz, vec2(-0.5, -0.86)) * 3.1 - uTime * 4.1);
  r += vec2(0.2, -0.98) * cos(dot(xz, vec2(0.2, -0.98)) * 5.3 - uTime * 5.2);
  r += vec2(noise(xz * 1.7 + uTime * 0.6), noise(xz * 1.7 - uTime * 0.5)) - 0.5;
  n.xz -= r * 0.07 * detail;
  vec3 N = normalize(n);

  // One tone value picks between four flat colour bands: crests, sun-facing slopes, the sun's
  // reflection path and grazing angles (the distance) go light, troughs go deep.
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  float path = pow(max(dot(R, uSunDir), 0.0), 12.0);
  float tone = 0.3 + vCrest * 1.6 + dot(N, uSunDir) * 0.2 + fres * 0.6 + path * 0.35;
  vec3 col = mix(uDeep, uMid, band(tone, 0.24));
  col = mix(col, uShallow, band(tone, 0.55));
  col = mix(col, uLight, band(tone, 0.8));

  // Sun glint: hard-edged four-point sparkles in a jittered grid, sized by how well the swell
  // reflects the sun and twinkling on their own clocks; faded out before they shrink below a pixel.
  vec2 g = xz * 0.8;
  vec2 id = floor(g);
  vec2 q = abs(fract(g) - 0.3 - 0.4 * vec2(hash(id), hash(id + 7.3)));
  float star = sqrt(q.x) + sqrt(q.y); // astroid: a cartoon twinkle shape
  float size = 0.6 * pow(max(dot(reflect(-V, Ng), uSunDir), 0.0), 8.0) * max(sin(6.2832 * (hash(id + 3.7) + uTime * 0.7)), 0.0);
  size *= 1.0 - smoothstep(50.0, 120.0, dist);
  float spark = clamp((size - star) / max(fwidth(star), 1e-4), 0.0, 1.0);

  // Foam caps on steep crests, ringed by a thin foam line just below them.
  float foamN = noise(xz * 2.5 + uTime * 0.3) * 0.6 + mix(0.5, noise(xz * 7.0), detail) * 0.4;
  float c = vCrest + (foamN - 0.5) * 0.12;
  float foam = max(band(c, 0.27), (band(c, 0.19) - band(c, 0.21)) * detail);

  // Wake: V-shaped foam trail behind the rider, only while the board is on the water.
  vec2 rel = vWorld.xz - uRider.xz;
  float behind = -dot(rel, uVel.xy);
  float lateral = abs(rel.x * uVel.y - rel.y * uVel.x);
  float halfW = 0.35 + behind * 0.22;
  float wakeEdge = 1.0 - smoothstep(0.0, 0.35 + behind * 0.05, abs(lateral - halfW * 0.8));
  float wakeCore = 1.0 - smoothstep(0.0, halfW * 0.5, lateral);
  float wake = max(wakeEdge, wakeCore * 0.6) * step(0.0, behind) * (1.0 - smoothstep(2.0, 14.0, behind));
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
    vertexShader,
    fragmentShader,
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
      },
    ]),
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  const cell = size / segments;

  return {
    mesh,
    update(t, state) {
      // Snap to the grid so vertices sample the same world points as the mesh follows the rider.
      const { x, y, z } = state.pos;
      mesh.position.set(Math.round(x / cell) * cell, 0, Math.round(z / cell) * cell);
      material.uniforms.uTime.value = t;
      material.uniforms.uRider.value.set(x, y, z, Math.max(0, y - waveHeight(x, z, t)));
      const speed = Math.hypot(state.vel.x, state.vel.z);
      if (speed > 0.01) material.uniforms.uVel.value.set(state.vel.x / speed, state.vel.z / speed, speed);
      else material.uniforms.uVel.value.z = 0;
    },
  };
}
