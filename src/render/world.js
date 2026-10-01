import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CAMERA } from '../config.js';
import { createPostFxPass } from './postFx.js';
import { instanceProp } from './props.js';

// Renderer, scene, sky, lighting and post-processing.
const MOBILE = matchMedia('(pointer: coarse)').matches; // phones are fill-rate bound
const SKY = { zenith: 0x1e8cf0, horizon: 0xbfe9ff, sun: 0xfff3c4 };

export function createWorld(container) {
  // Default-framebuffer AA is wasted: the composer renders offscreen and only blits a quad here.
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  // Neutral keeps the cartoon palette close to its authored hex values (ACES desaturates and darkens).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY.horizon, 80, 320); // same colour as the sky's horizon: no seam
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, 0.1, 2000);

  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(200));
  scene.add(createSky(sun));
  const shore = createShoreline();
  scene.add(shore.group);

  // Cool sky fill with a turquoise bounce from the sea, so the shadow side of a backlit rider still has colour.
  scene.add(new THREE.HemisphereLight(0xa8d8ff, 0x22a5b0, 1.9));
  // Warm key. Tight shadow frustum that follows the rider.
  const sunLight = new THREE.DirectionalLight(0xffe4bd, 2.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunLight.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
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
    onResize: (fn) => resizeListeners.push(fn),
    followSun(target) {
      sunLight.target.position.copy(target);
      sunLight.position.copy(target).addScaledVector(sun, 50);
      shore.follow(target);
    },
    render: () => composer.render(),
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

const SHORE_TILE = 400; // island layout repeats along X so riding along the shore never runs out
const SHORE_DIST = 230; // downwind (-Z) distance from the rider; kept inside the fog far plane

// Distant cartoon beach: sand strip, sand-and-rock mounds behind it, three palm variants, kite-school
// huts, a lifeguard tower and sailboats offshore. Stays a fixed distance downwind but scrolls in X,
// so it reads as a motion reference. One instanced draw call per model (loaded async), no shadows, fogged.
function createShoreline() {
  const group = new THREE.Group();
  const rnd = mulberry32(7);
  const tiles = 3;

  const sand = new THREE.Mesh(new THREE.PlaneGeometry(SHORE_TILE * tiles, 40), new THREE.MeshLambertMaterial({ color: 0xe8d3a2 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 1, -14);
  group.add(sand);

  // `perTile` copies of a model at random x, z in [z0 - zRange, z0], height × (1 ± jitter/2),
  // yaw within ±yawRange; the same layout repeats in every tile. Bases sit at y, the sand top is 1.
  const up = new THREE.Vector3(0, 1, 0);
  const place = (name, height, perTile, { z0, zRange, y = 0.5, jitter = 0.4, yawRange = Math.PI }) => {
    const layout = Array.from({ length: perTile }, () => [
      rnd() * SHORE_TILE, z0 - rnd() * zRange, 1 + (rnd() - 0.5) * jitter, (rnd() * 2 - 1) * yawRange,
    ]);
    const matrices = [];
    for (let t = 0; t < tiles; t++) {
      const ox = (t - 1) * SHORE_TILE - SHORE_TILE / 2;
      for (const [x, z, k, yaw] of layout) {
        const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
        matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(ox + x, y, z), q, new THREE.Vector3(k, k, k)));
      }
    }
    instanceProp(group, name, height, matrices);
  };
  place('island', 12, 9, { z0: -32, zRange: 25, y: 0, jitter: 0.5 });
  place('palm_a', 13, 12, { z0: -6, zRange: 22 });
  place('palm_b', 12, 11, { z0: -6, zRange: 22 });
  place('palm_c', 9, 11, { z0: -6, zRange: 22 });
  place('hut', 8, 2, { z0: -6, zRange: 8, jitter: 0.1, yawRange: 0.5 }); // fronts face the sea (+Z)
  place('lifeguard', 9, 1, { z0: -2, zRange: 4, jitter: 0, yawRange: 0.4 });
  place('sailboat', 8, 2, { z0: 60, zRange: 30, y: -0.6, jitter: 0.3 });

  return {
    group,
    follow(target) {
      // Snap X to the tile grid so the layout is world-fixed; Z tracks the rider.
      group.position.set(Math.round(target.x / SHORE_TILE) * SHORE_TILE, 0, target.z - SHORE_DIST);
    },
  };
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
