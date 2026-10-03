import * as THREE from 'three';

// Time of day and weather (docs/world-ideas.md §3): a run goes sunrise → noon → sunset by progress,
// a storm level holds the storm preset and adds rain and lightning. Render only: the sea's waves
// and the wind are the level's, untouched here.
const PRESETS = {
  sunrise: {
    zenith: 0x5b6fb8, horizon: 0xffc7a8, sun: 0xffe2b0,
    hemiSky: 0xc9b8ff, hemiGround: 0x2a8fa0, hemi: 1.6, dirColor: 0xffc89a, dir: 2.0,
    uSunColor: 0xffd9a8, uDeep: 0x1d2a5a, uMid: 0x2e6f9e, uShallow: 0x4fa9c4, uLight: 0xffc7b0, uFoam: 0xfff4ec,
    fog: 0xffd2b8,
  },
  noon: {
    zenith: 0x1e8cf0, horizon: 0xbfe9ff, sun: 0xfff3c4,
    hemiSky: 0xa8d8ff, hemiGround: 0x22a5b0, hemi: 1.9, dirColor: 0xffe4bd, dir: 2.6,
    uSunColor: 0xfffbe6, uDeep: 0x0b4a6e, uMid: 0x0f86a8, uShallow: 0x1fb9c8, uLight: 0x6fe3e6, uFoam: 0xf4fcff,
    fog: 0xbfe9ff,
  },
  sunset: {
    zenith: 0x2a2350, horizon: 0xff7a6e, sun: 0xffb15c,
    hemiSky: 0xff9aa8, hemiGround: 0x1d1d28, hemi: 1.4, dirColor: 0xff8c5a, dir: 2.2,
    uSunColor: 0xff9e6b, uDeep: 0x1d1d28, uMid: 0x3a2e5e, uShallow: 0xb3456e, uLight: 0xff3d6e, uFoam: 0xffe6ee,
    fog: 0xc25a70,
  },
  storm: {
    zenith: 0x3a4452, horizon: 0x8a97a3, sun: 0xd8dee4,
    hemiSky: 0x9aa8b5, hemiGround: 0x1e3a44, hemi: 1.3, dirColor: 0xcfd8e0, dir: 0.8,
    uSunColor: 0xc8d2da, uDeep: 0x18303a, uMid: 0x2a5560, uShallow: 0x3e7478, uLight: 0x7fa3a6, uFoam: 0xe6ecef,
    fog: 0x6e7c88,
  },
};
const COLOURS = ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'dirColor', 'uSunColor', 'uDeep', 'uMid', 'uShallow', 'uLight', 'uFoam', 'fog'];
for (const p of Object.values(PRESETS)) for (const k of COLOURS) p[k] = new THREE.Color(p[k]);

const STORM_FOAM = 0.8; // storm foam is greyer: wind-torn spray, not clean whitecaps
const FLASH_EVERY = 6; // s: one lightning flash somewhere in each window
const FLASH_TIME = 0.08; // s
const FLASH = 4; // hemisphere intensity added during a flash
const FLASH_SKY = 0.5; // how far a flash whitens the sky and fog
const WHITE = new THREE.Color(1, 1, 1);

const now = Object.fromEntries(COLOURS.map((k) => [k, new THREE.Color()]));
const mix = (key, a, b, k) => (now[key]?.isColor ? now[key].lerpColors(a[key], b[key], k) : (now[key] = THREE.MathUtils.lerp(a[key], b[key], k)));

// progress: 0 at the start of the run, 1 at the buzzer. t: sim time (s), for the lightning schedule.
export function applyTimeOfDay(world, water, progress, storm, t) {
  let a, b, k;
  if (storm) [a, b, k] = [PRESETS.storm, PRESETS.storm, 0];
  else if (progress < 0.5) [a, b, k] = [PRESETS.sunrise, PRESETS.noon, progress * 2];
  else [a, b, k] = [PRESETS.noon, PRESETS.sunset, Math.min(1, progress * 2 - 1)];
  for (const key in a) mix(key, a, b, k);
  // A flash lights the models (hemisphere) and whitens the sky and the fog, so the far sea flashes too.
  const flash = storm && flashing(t);
  if (flash) for (const key of ['zenith', 'horizon', 'fog']) now[key].lerp(WHITE, FLASH_SKY);

  world.sky.uZenith.value.copy(now.zenith);
  world.sky.uHorizon.value.copy(now.horizon);
  world.sky.uSunColor.value.copy(now.sun);
  world.hemi.color.copy(now.hemiSky);
  world.hemi.groundColor.copy(now.hemiGround);
  world.hemi.intensity = now.hemi + (flash ? FLASH : 0);
  world.sunLight.color.copy(now.dirColor);
  world.sunLight.intensity = now.dir;
  world.scene.fog.color.copy(now.fog);
  const u = water.mesh.material.uniforms;
  for (const key of ['uSunColor', 'uDeep', 'uMid', 'uShallow', 'uLight', 'uFoam']) u[key].value.copy(now[key]);
  if (storm) u.uFoam.value.multiplyScalar(STORM_FOAM);

  rain ??= createRain(world.scene);
  rain.visible = storm;
  if (storm) {
    rain.material.uniforms.uTime.value = t;
    rain.material.uniforms.uCenter.value.copy(world.camera.position);
  }
}

// Deterministic lightning: each FLASH_EVERY window flashes once, at a time hashed from its index.
function flashing(t) {
  const i = Math.floor(t / FLASH_EVERY);
  const h = Math.abs(Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1;
  const dt = t - (i + h * 0.9) * FLASH_EVERY;
  return dt >= 0 && dt < FLASH_TIME;
}

// Rain: streaks fixed in a world-space box that wraps around the camera, so they fall past it
// rather than travelling with it. One LineSegments draw; the fall and wrap are in the vertex shader.
let rain = null;
const RAIN_DROPS = 1500;
const RAIN_BOX = 60; // m, each side
function createRain(scene) {
  const pos = new Float32Array(RAIN_DROPS * 6);
  const end = new Float32Array(RAIN_DROPS * 2);
  let seed = 9;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * RAIN_BOX; // deterministic, like everything else
  for (let i = 0; i < RAIN_DROPS; i++) {
    const p = [rand(), rand(), rand()];
    pos.set(p, i * 6);
    pos.set(p, i * 6 + 3);
    end[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      attribute float aEnd;
      uniform float uTime;
      uniform vec3 uCenter;
      const float BOX = ${RAIN_BOX.toFixed(1)};
      const vec3 FALL = vec3(0.0, -22.0, -7.0); // m/s: blown downwind (-Z)
      void main() {
        vec3 p = mod(position + FALL * uTime - uCenter, BOX) + uCenter - BOX * 0.5;
        p += FALL * 0.04 * aEnd; // streak length: 40 ms of fall
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      void main() { gl_FragColor = vec4(0.82, 0.87, 0.92, 0.35); }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  scene.add(lines);
  return lines;
}
