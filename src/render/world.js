import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CAMERA, GAME } from '../config.js';
import { createPostFxPass } from './postFx.js';
import { instanceProp } from './props.js';

// Renderer, scene, sky, lighting and post-processing.
const MOBILE = matchMedia('(pointer: coarse)').matches; // phones are fill-rate bound
const SKY = { zenith: 0x1e8cf0, horizon: 0xbfe9ff, sun: 0xfff3c4 };

export function createWorld(container) {
  // Default-framebuffer AA is wasted: the composer renders offscreen and only blits a quad here.
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const maxRatio = Math.min(devicePixelRatio, MOBILE ? 1.5 : 2);
  renderer.setPixelRatio(maxRatio);
  renderer.setSize(innerWidth, innerHeight);
  // Neutral keeps the cartoon palette close to its authored hex values (ACES desaturates and darkens).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  // No shadow pass: the toon water doesn't receive shadows, so a shadow map would be drawn for nothing.
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY.horizon, 80, 320); // same colour as the sky's horizon: no seam
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, 0.1, 2000);

  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(200));
  const sky = createSky(sun);
  scene.add(sky);
  const shore = createShoreline();
  scene.add(shore.group);

  // Cool sky fill with a turquoise bounce from the sea.
  const hemi = new THREE.HemisphereLight(0xa8d8ff, 0x22a5b0, 1.9);
  scene.add(hemi);
  // Warm key from behind and above the camera (which sits upwind, +Z), so the rider is always front-lit.
  // The sky's sun disc and the water's glints stay on `sun`; only the light moves.
  const key = new THREE.Vector3(0.35, 0.8, 1).normalize();
  const sunLight = new THREE.DirectionalLight(0xffe4bd, 2.6);
  scene.add(sunLight, sunLight.target);

  // No bloom: the toon look wants crisp edges, and the sun disc and water sparkles are hard-edged anyway.
  // ponytail: no MSAA (samples:4 measured 61 → 46 fps); add FXAA/SMAA pass if edges bother anyone.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.setSize(innerWidth, innerHeight); // a supplied target starts at 1×1
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(createPostFxPass(MOBILE ? 0 : 6)); // vignette + speed blur; vignette only on phones
  composer.addPass(new OutputPass());

  const resizeListeners = [];

  // Dynamic resolution: the frame is fill-rate bound (water shader + half-float target at Retina
  // resolution measured ~10 ms/frame on an M2, 16 ms at p90: dropped frames). Every WINDOW frames:
  // if frames run slow against the display's refresh, drop the pixel ratio a step; after several clean
  // windows, step back up, but not back to a ratio that failed until ~30 s clean (a passing load, like
  // another app, doesn't pin it low). A few hitches (shader compiles, GC) aren't enough to trip it.
  const STEP = 0.25;
  const WINDOW = 60; // frames
  const MIN_RATIO = Math.min(1, maxRatio);
  let ratio = maxRatio;
  let ceiling = Infinity; // lowest ratio that has run late
  let clean = 0; // windows in a row without a late frame
  let vsync = 1 / 59; // s; display refresh interval: the fastest steady frame time seen, at most 60 Hz's
  const frames = [];
  function setRatio(r) {
    ratio = r;
    renderer.setPixelRatio(r);
    composer.setPixelRatio(r);
    for (const fn of resizeListeners) fn();
  }
  function adaptResolution(dt) {
    if (!(dt > 0) || frames.push(dt) < WINDOW) return;
    frames.sort((a, b) => a - b);
    vsync = Math.min(vsync, frames[WINDOW >> 3]); // ~p12 of a window: robust to catch-up frames
    // Mean frame time without the worst few (shader compiles, GC); late frames are those clearly over vsync.
    const kept = frames.slice(0, WINDOW - 5);
    const slow = kept.reduce((a, f) => a + f, 0) / kept.length > 1.2 * vsync;
    const late = frames.filter((f) => f > 1.3 * vsync).length;
    frames.length = 0;
    if (slow && ratio > MIN_RATIO) {
      ceiling = ratio;
      clean = 0;
      setRatio(Math.max(MIN_RATIO, ratio - STEP));
    } else if (late > 0) clean = 0;
    else if (++clean >= 30) {
      ceiling = Infinity; // retry the ratios that failed
      clean = 0;
    } else if (clean % 4 === 0 && ratio + STEP < ceiling && ratio < maxRatio) {
      setRatio(Math.min(maxRatio, ratio + STEP));
    }
  }
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    for (const fn of resizeListeners) fn();
  });

  return {
    renderer,
    scene,
    camera,
    sun,
    sky: sky.material.uniforms, // timeOfDay.js recolours these, the lights and the fog
    hemi,
    sunLight,
    onResize: (fn) => resizeListeners.push(fn),
    followSun(target) {
      sunLight.target.position.copy(target);
      sunLight.position.copy(target).addScaledVector(key, 50);
    },
    updateShore: shore.follow, // (rider pos, run progress 0..1) → lagoon calm for water.setCalm
    render(realDt) {
      adaptResolution(realDt);
      composer.render();
    },
  };
}

// Flat cartoon sky: saturated zenith fading to a pale horizon, plus a hard-edged sun disc and halo.
// Drawn at infinity (rotates with the camera, never translates), so it needs no follow or culling.
function createSky(sun) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sun },
      uZenith: { value: new THREE.Color(SKY.zenith) },
      uHorizon: { value: new THREE.Color(SKY.horizon) },
      uSunColor: { value: new THREE.Color(SKY.sun) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww; // z = w: far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uZenith, uHorizon, uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.45, d.y));
        float s = dot(d, uSun);
        float aa = fwidth(s);
        col += uSunColor * 0.25 * smoothstep(0.9955 - aa, 0.9955 + aa, s); // halo ring
        col = mix(col, uSunColor * 1.6, smoothstep(0.9988 - aa, 0.9988 + aa, s)); // disc
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.frustumCulled = false;
  return mesh;
}

const SHORE_TILE = 150; // m of shore per tile; each tile shows one biome
const SHORE_DIST = 230; // downwind (-Z) distance from the rider; kept inside the fog far plane
const SHORE_SPEED = 10; // m/s: typical board speed (sim:check ~35 km/h), to guess when the rider reaches a tile
const SLOTS = 5; // tiles drawn: the rider's and two either side, past the fogged view along X
const HALF = SHORE_TILE / 2;

// Distant shore as a run of biome tiles along X, tile `ti` centred at x = ti · SHORE_TILE. A tile picks
// its biome as it comes into view, from the run's progress (time, so every run ends at the lagoon) by
// when the rider should reach it, at most one biome on from the tile before. It stays a fixed distance
// downwind but is world-fixed in X, so it reads as a motion reference. One instanced draw call per
// model per biome (loaded async, seeded layout), no shadows, fogged.
// calm: how flat the water lies towards the shore (water.js setCalm). Render only.
const BIOMES = [
  { seed: 7, ground: 0xe8d3a2, calm: 0, build: beach },
  { seed: 11, ground: 0xe3cf98, calm: 0, build: reef },
  { seed: 13, ground: 0xead6a6, calm: 0, build: pier },
  { seed: 17, ground: 0x9aa3ab, calm: 0, build: harbour }, // concrete quay
  { seed: 19, ground: 0xf0e0b8, calm: 1, build: lagoon },
];

function createShoreline() {
  const group = new THREE.Group();
  const tileBiome = new Map(); // tile index → BIOMES index, fixed while in view
  const shown = new Array(SLOTS).fill(-1); // BIOMES index per slot, slot 2 the rider's tile
  const sands = Array.from({ length: SLOTS }, (_, s) => {
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(SHORE_TILE, 40), new THREE.MeshLambertMaterial());
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((s - 2) * SHORE_TILE, 1, -14); // top at y 1; the waterline is at z ≈ 6
    group.add(sand);
    return sand;
  });

  // Each model holds SLOTS copies of its biome's layout, slot after slot; the copies in slots showing
  // another biome are scaled to nothing, and a model no slot shows isn't drawn.
  const loaded = BIOMES.map(() => []); // { mesh, base: all-slots matrices } per biome
  const show = ({ mesh, base }, b) => {
    const n = base.length / SLOTS;
    const m = mesh.instanceMatrix.array;
    for (let s = 0; s < SLOTS; s++) {
      if (shown[s] === b) m.set(base.subarray(s * n, (s + 1) * n), s * n);
      else m.fill(0, s * n, (s + 1) * n);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = shown.includes(b);
  };
  BIOMES.forEach(({ seed, build }, b) => {
    // A model `height` m tall at rows of [x, y (base), z, scale, yaw, tilt about the model's X] in a
    // tile. Models face +Z (the sea) unless noted. A missing model just leaves the shore without it.
    const put = (name, height, rows) => {
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      const q = new THREE.Quaternion();
      const matrices = [];
      for (let s = 0; s < SLOTS; s++) {
        for (const [x, y, z, k = 1, yaw = 0, tilt = 0] of rows) {
          const p = new THREE.Vector3(x + (s - 2) * SHORE_TILE, y, z);
          matrices.push(new THREE.Matrix4().compose(p, q.setFromEuler(euler.set(tilt, yaw, 0)), new THREE.Vector3(k, k, k)));
        }
      }
      instanceProp(group, name, height, matrices)
        .then((meshes) => {
          for (const mesh of meshes) {
            mesh.computeBoundingSphere(); // over every slot, before any are hidden, for frustum culling
            const entry = { mesh, base: mesh.instanceMatrix.array.slice() };
            loaded[b].push(entry);
            show(entry, b);
          }
        })
        .catch(console.warn);
    };
    build(put, mulberry32(seed));
  });

  return {
    group,
    // pos: the rider; progress: 0..1 through the run's time. Returns the lagoon calm at the rider,
    // eased over ±22 m around tile boundaries.
    follow(pos, progress) {
      const ti = Math.round(pos.x / SHORE_TILE);
      for (const k of tileBiome.keys()) if (Math.abs(k - ti) > 2) tileBiome.delete(k); // also resets on a restart
      for (let k = ti - 2; k <= ti + 2; k++) {
        if (tileBiome.has(k)) continue;
        const arrive = progress + Math.max(0, k * SHORE_TILE - pos.x) / (SHORE_SPEED * GAME.runTime);
        const want = Math.min(BIOMES.length - 1, Math.floor(arrive * BIOMES.length));
        const prev = tileBiome.get(k - 1) ?? want;
        tileBiome.set(k, Math.min(Math.max(want, prev), prev + 1));
      }
      group.position.set(ti * SHORE_TILE, 0, pos.z - SHORE_DIST);
      let changed = false;
      for (let s = 0; s < SLOTS; s++) {
        const b = tileBiome.get(ti - 2 + s);
        if (b === shown[s]) continue;
        shown[s] = b;
        sands[s].material.color.setHex(BIOMES[b].ground);
        changed = true;
      }
      if (changed) loaded.forEach((entries, b) => entries.forEach((e) => show(e, b)));
      const u = pos.x / SHORE_TILE;
      const i = Math.floor(u);
      const calm = (k) => BIOMES[tileBiome.get(k)].calm;
      return THREE.MathUtils.lerp(calm(i), calm(i + 1), THREE.MathUtils.smoothstep(u - i, 0.35, 0.65));
    },
  };
}

// `n` copies at random x across a tile, z in [z0 - zRange, z0], base at y, scale 1 ± jitter/2,
// yaw within ±yawRange: rows for `put`.
function scatter(rnd, n, { z0, zRange, y = 0.5, jitter = 0.4, yawRange = Math.PI }) {
  return Array.from({ length: n }, () => [(rnd() - 0.5) * SHORE_TILE, y, z0 - rnd() * zRange, 1 + (rnd() - 0.5) * jitter, (rnd() * 2 - 1) * yawRange]);
}

// Start beach: sand-and-rock mounds, three palm variants, a kite-school hut, a lifeguard tower and a
// sailboat offshore.
function beach(put, rnd) {
  put('island', 12, scatter(rnd, 4, { z0: -32, zRange: 25, y: 0, jitter: 0.5 }));
  put('palm_a', 13, scatter(rnd, 5, { z0: -6, zRange: 22 }));
  put('palm_b', 12, scatter(rnd, 4, { z0: -6, zRange: 22 }));
  put('palm_c', 9, scatter(rnd, 4, { z0: -6, zRange: 22 }));
  put('hut', 8, scatter(rnd, 1, { z0: -6, zRange: 8, jitter: 0.1, yawRange: 0.5 }));
  put('lifeguard', 9, scatter(rnd, 1, { z0: -2, zRange: 4, jitter: 0, yawRange: 0.4 }));
  put('sailboat', 8, scatter(rnd, 1, { z0: 60, zRange: 30, y: -0.6, jitter: 0.3 }));
}

// Reef: rocky islets, rocks and coral heads breaking the surface offshore, buoys, and a wreck listing
// in the shallows (bow +X).
function reef(put, rnd) {
  put('island', 10, scatter(rnd, 3, { z0: -30, zRange: 25, y: 0, jitter: 0.5 }));
  put('palm_b', 11, scatter(rnd, 3, { z0: -6, zRange: 20 }));
  put('rock', 4, [...scatter(rnd, 5, { z0: 8, zRange: 10, y: -0.5, jitter: 1 }), ...scatter(rnd, 6, { z0: 110, zRange: 75, y: -1.5, jitter: 1 })]);
  put('coral', 3, scatter(rnd, 8, { z0: 100, zRange: 65, y: -1.6, jitter: 0.8 }));
  put('buoy', 2, scatter(rnd, 3, { z0: 120, zRange: 50, y: -0.3, jitter: 0 }));
  put('shipwreck', 14, [[20, -4, 70, 1, -0.4, 0.3]]);
}

// Pier: a beach bar on the sand and a long pier running out to sea; the rider passes its end.
function pier(put, rnd) {
  put('palm_a', 13, scatter(rnd, 4, { z0: -6, zRange: 22 }));
  put('palm_c', 9, scatter(rnd, 4, { z0: -6, zRange: 22 }));
  put('hut', 8, scatter(rnd, 1, { z0: -8, zRange: 8, jitter: 0.1, yawRange: 0.5 }));
  put('beach_bar', 7, [[-30, 0.5, -2, 1, 0.15]]);
  // pier_segment: a 1 × 1 deck section 0.34 tall, deck along Z; 2 m tall is ~5.9 m square.
  put('pier_segment', 2, Array.from({ length: 20 }, (_, i) => [15, 0, i * 5.8]));
  put('sailboat', 8, scatter(rnd, 1, { z0: 70, zRange: 30, y: -0.6, jitter: 0.3 }));
}

// Harbour: a sea wall in front of the quay, cranes over stacked containers, moored sailboats, and a
// lighthouse at the harbour mouth on a breakwater (the end the rider arrives from).
function harbour(put, rnd) {
  // harbour_wall runs along X, 1 × 0.32: 3.5 m tall is ~10.9 m long.
  const wall = Array.from({ length: 14 }, (_, i) => [i * 10.5 - HALF + 5, 0, 7]);
  for (let i = 0; i < 4; i++) wall.push([-HALF + 12, 0, 12 + i * 10.5, 1, Math.PI / 2]); // breakwater
  put('harbour_wall', 3.5, wall);
  put('lighthouse', 26, [[-HALF + 12, 0, 52]]);
  put('rock', 4, scatter(rnd, 6, { z0: 56, zRange: 8, y: -1, jitter: 0.6 }).map((r) => [-HALF + 12 + r[0] / 10, ...r.slice(1)]));
  put('crane', 32, [[-35, 1, -4], [30, 1, -4]]); // booms out over the water (Z)
  const boxes = []; // container: long along X, 1 × 0.64: 3 m tall is ~4.7 m long
  for (let x = -60; x < 66; x += 6) for (const z of [-12, -20]) for (let h = Math.floor(rnd() * 4); h > 0; h--) boxes.push([x, 1 + (h - 1) * 3, z, 1, rnd() < 0.5 ? 0 : Math.PI]);
  put('container', 3, boxes);
  put('sailboat', 8, scatter(rnd, 4, { z0: 50, zRange: 25, y: -0.6, jitter: 0.3, yawRange: 0.3 }));
}

// Lagoon (finish): mangroves along the waterline, overwater bungalows (deck at +Z) and flamingo floats
// on water that lies flat towards the shore (calm).
function lagoon(put, rnd) {
  put('palm_a', 13, scatter(rnd, 3, { z0: -10, zRange: 18 }));
  put('mangrove', 9, scatter(rnd, 8, { z0: 8, zRange: 16, y: 0, jitter: 0.5 }));
  put('bungalow', 7, Array.from({ length: 3 }, (_, i) => [i * 45 - 45, -0.5, 36 + (i % 2) * 12, 1, (rnd() - 0.5) * 0.2]));
  put('flamingo_float', 3, scatter(rnd, 5, { z0: 110, zRange: 55, y: -0.3, jitter: 0.3 }));
}

export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
