import * as THREE from 'three';
import { waveHeight } from '../waves.js';
import { loadProp } from './props.js';
import { createSpray } from './effects.js';
import { mulberry32 } from './world.js';

// Background life (docs/world-ideas.md §2): a seagull flock, distant kiters, a dolphin pod, a speedboat
// towing a parasailer and a slaloming jet-ski. All procedural, no rigs, and a pure function of sim time
// and the rider's position, so every run plays the same. Everything stays downwind (-Z) of the rider:
// in view of the upwind camera, out of the rider's line. Models load in the background; a missing
// file just leaves that creature out.

const TAU = 2 * Math.PI;

// Model yaw that turns each model's nose to +X, the travel direction (Assets orientation notes).
const YAW = { seagull: Math.PI / 2, dolphin: Math.PI / 2, parasail: Math.PI / 2, speedboat: Math.PI, jetski: Math.PI, distant_kiter: 0 };

// Things on a lane move at `speed` m/s (negative: toward -X) and are kept in a `span` m window around
// the rider, wrapping at its ends. Make `span` wider than the view at that depth so the wrap is unseen.
const lane = (x0, speed, t, riderX, span) => riderX + THREE.MathUtils.euclideanModulo(x0 + speed * t - riderX + span / 2, span) - span / 2;

// A group in the travel frame (+X forward; rotation order YZX = yaw, pitch, roll); parts arrive on load.
function prop(name, height) {
  const group = new THREE.Group();
  group.rotation.order = 'YZX';
  loadProp(name, height)
    .then((parts) => {
      for (const { geometry, material } of parts) group.add(new THREE.Mesh(geometry.rotateY(YAW[name]), material));
    })
    .catch(() => {});
  return group;
}

// Seagulls: two flocks on sine paths, one instanced draw call per part.
const FLOCKS = [
  { x0: 30, speed: 4, z: -30, y: 14 },
  { x0: -40, speed: -5, z: -55, y: 20 },
];
const GULLS = 16;

// Distant kiters: [lane start x, speed m/s, z offset from the rider].
const KITERS = [
  [60, 6, -70],
  [-80, -7, -100],
  [150, 4, -135],
  [-20, -5, -60],
];

// Dolphin pod: surfaces beside the rider for a stretch of every DOLPHIN_EVERY m of rider x.
const DOLPHIN_EVERY = 220;
const DOLPHIN_FROM = 20; // m into the stretch the pod shows up...
const DOLPHIN_TO = 140; // ...and dives for good
const LEAP = { period: 2.4, time: 1.1, height: 2.2, ahead: 4 }; // s, s, m, m gained on the rider per leap

const BOAT = { x0: 40, speed: 5, z: -55, span: 320 };
const SKI = { x0: -60, speed: 13, z: -32, span: 170, swing: 5, rate: 0.8 }; // slalom: m either side, rad/s
const WAKE = 12; // speedboat wake cross-sections, 2.5 m apart

export function createLife(renderer) {
  const group = new THREE.Group();
  const rnd = mulberry32(11);

  // ---------- seagulls ----------
  const gulls = Array.from({ length: GULLS }, (_, i) => ({
    flock: FLOCKS[i % FLOCKS.length],
    dx: (rnd() - 0.5) * 14,
    dy: (rnd() - 0.5) * 4,
    dz: (rnd() - 0.5) * 10,
    ph: rnd() * TAU,
  }));
  const gullMeshes = [];
  const flapTime = { value: 0 };
  loadProp('seagull', 1.4)
    .then((parts) => {
      for (const { geometry, material } of parts) {
        // Flap without a rig: the wings (along Z once turned to face +X) bend up and down, more toward
        // the tips, each bird on its own beat and gliding between bursts.
        const mat = material.clone();
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = flapTime;
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
            '#include <begin_vertex>',
            /* glsl */ `#include <begin_vertex>
            float id = float(gl_InstanceID);
            float wing = max(abs(position.z) - 0.15, 0.0);
            float beat = smoothstep(-0.3, 0.3, sin(uTime * 0.7 + id * 1.9));
            transformed.y += wing * wing * 1.1 * beat * sin(uTime * 9.0 + id * 2.3);`
          );
        };
        const mesh = new THREE.InstancedMesh(geometry.rotateY(YAW.seagull), mat, GULLS);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false; // instances roam far from the geometry's bounds
        group.add(mesh);
        gullMeshes.push(mesh);
      }
    })
    .catch(() => {});
  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YZX';

  // ---------- props ----------
  const kiters = KITERS.map(([x0, speed, z]) => ({ x0, speed, z, obj: prop('distant_kiter', 10) }));
  const dolphins = [0, 1, 2].map(() => prop('dolphin', 1.5));
  const boat = prop('speedboat', 3);
  const parasail = prop('parasail', 6);
  const ski = prop('jetski', 1.5);
  group.add(...kiters.map((k) => k.obj), ...dolphins, boat, parasail, ski);

  // Tow line, stern to the parasailer's harness.
  const tow = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x1d1d28 }));
  tow.frustumCulled = false;
  group.add(tow);

  // Foam wake: a strip widening and fading behind the boat, laid on the swell every frame.
  const wakePos = new Float32Array(WAKE * 2 * 3);
  const wakeCol = new Float32Array(WAKE * 2 * 4).fill(1);
  const wakeIndex = [];
  for (let k = 0; k < WAKE; k++) {
    wakeCol[k * 8 + 3] = wakeCol[k * 8 + 7] = 0.75 * (1 - k / (WAKE - 1));
    if (k < WAKE - 1) wakeIndex.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
  }
  const wakeGeo = new THREE.BufferGeometry();
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(wakePos, 3).setUsage(THREE.DynamicDrawUsage));
  wakeGeo.setAttribute('color', new THREE.BufferAttribute(wakeCol, 4));
  wakeGeo.setIndex(wakeIndex);
  const wake = new THREE.Mesh(wakeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  wake.frustumCulled = false;
  group.add(wake);

  // Jet-ski spray: the board effects' droplets, a rooster tail plus a burst at each slalom turn.
  const spray = createSpray(600);
  group.add(spray.points);
  const origin = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  let sprayBudget = 0;
  let lastTurn = null;

  // Floats `obj` at (x, z) with a bob; heading from its velocity (vx, vz).
  function float(obj, x, z, t, lift, vx, vz) {
    obj.position.set(x, waveHeight(x, z, t) + lift, z);
    obj.rotation.y = Math.atan2(-vz, vx);
  }

  return {
    group,
    update(t, dt, rider) {
      const { x: rx, z: rz } = rider;

      // Seagulls
      flapTime.value = t;
      if (gullMeshes.length) {
        gulls.forEach((g, i) => {
          const f = g.flock;
          const cx = lane(f.x0, f.speed, t, rx, 220);
          dummy.position.set(cx + g.dx + 2.5 * Math.sin(0.4 * t + g.ph), f.y + g.dy + 1.2 * Math.sin(0.7 * t + g.ph), rz + f.z + g.dz + 2 * Math.cos(0.3 * t + g.ph));
          dummy.rotation.y = Math.atan2(0.6 * Math.sin(0.3 * t + g.ph), f.speed + Math.cos(0.4 * t + g.ph));
          dummy.rotation.x = 0.25 * Math.sin(0.3 * t + g.ph); // bank with the weave
          dummy.updateMatrix();
          for (const mesh of gullMeshes) mesh.setMatrixAt(i, dummy.matrix);
        });
        for (const mesh of gullMeshes) mesh.instanceMatrix.needsUpdate = true;
      }

      // Distant kiters: chest to the camera whichever way they go, swaying under the kite.
      kiters.forEach((k, i) => {
        const x = lane(k.x0, k.speed, t, rx, 2 * (-k.z + 60));
        const z = rz + k.z;
        k.obj.position.set(x, waveHeight(x, z, t) + 0.1 * Math.sin(2.1 * t + i), z);
        k.obj.rotation.x = 0.08 * Math.sin(0.9 * t + i * 1.7);
        k.obj.rotation.y = 0.15 * Math.sin(0.45 * t + i);
      });

      // Dolphins: leap arcs beside the rider, nose along the velocity; hidden (diving) between leaps.
      const stretch = THREE.MathUtils.euclideanModulo(rx, DOLPHIN_EVERY);
      const podOn = stretch > DOLPHIN_FROM && stretch < DOLPHIN_TO;
      dolphins.forEach((d, i) => {
        const u = THREE.MathUtils.euclideanModulo(t - i * 0.35, LEAP.period) / LEAP.time; // 0..1 in the air
        d.visible = podOn && u < 1;
        if (!d.visible) return;
        const x = rx + 14 + 3 * i + LEAP.ahead * (u - 0.5);
        const z = rz - 16 - 2.5 * i;
        d.position.set(x, waveHeight(x, z, t) + LEAP.height * 4 * u * (1 - u) - 0.6, z);
        // ~10 m/s keeping pace with the rider, plus the leap's own motion
        d.rotation.z = Math.atan2((LEAP.height * 4 * (1 - 2 * u)) / LEAP.time, 10 + LEAP.ahead / LEAP.time);
      });

      // Speedboat with the parasailer swinging on its tow line.
      const bx = lane(BOAT.x0, BOAT.speed, t, rx, BOAT.span);
      const bz = rz + BOAT.z;
      float(boat, bx, bz, t, -0.3 + 0.08 * Math.sin(2.3 * t), 1, 0);
      boat.rotation.z = 0.06 + 0.04 * Math.sin(1.3 * t); // bow up on the plane
      boat.rotation.x = 0.04 * Math.sin(1.7 * t);
      parasail.position.set(bx - 28, 15 + 0.8 * Math.sin(0.5 * t), bz + 3 * Math.sin(0.6 * t));
      parasail.rotation.x = 0.2 * Math.sin(1.2 * t); // pendulum under the canopy
      tow.geometry.attributes.position.setXYZ(0, bx - 3, boat.position.y + 1, bz);
      tow.geometry.attributes.position.setXYZ(1, parasail.position.x, parasail.position.y + 2.5, parasail.position.z);
      tow.geometry.attributes.position.needsUpdate = true;
      for (let k = 0; k < WAKE; k++) {
        const x = bx - 3 - k * 2.5;
        const half = 0.9 + k * 0.45;
        for (const s of [0, 1]) {
          const z = bz + (s ? half : -half);
          wakePos.set([x, waveHeight(x, z, t) + 0.08, z], (k * 2 + s) * 3);
        }
      }
      wakeGeo.attributes.position.needsUpdate = true;

      // Jet-ski slalom: leans into each turn, throws a burst of spray at the apex.
      const ph = SKI.rate * t;
      const sx = lane(SKI.x0, SKI.speed, t, rx, SKI.span);
      const sz = rz + SKI.z + SKI.swing * Math.sin(ph);
      const vz = SKI.swing * SKI.rate * Math.cos(ph);
      float(ski, sx, sz, t, -0.15, SKI.speed, vz);
      ski.rotation.x = -0.4 * Math.sin(ph);
      ski.rotation.z = 0.05;
      const fx = Math.cos(ski.rotation.y);
      const fz = -Math.sin(ski.rotation.y);
      sprayBudget += dt * 50;
      const count = Math.floor(sprayBudget);
      sprayBudget -= count;
      origin.set(sx - fx * 1.4, ski.position.y + 0.3, sz - fz * 1.4);
      if (count) spray.emit(origin, velocity.set(-fx * 3, 3, -fz * 3), 1.2, count, 0.8, 0.35);
      const turn = Math.floor(ph / Math.PI + 0.5); // apexes at sin(ph) = ±1
      if (lastTurn !== null && turn !== lastTurn) spray.emit(origin, velocity.set(SKI.speed * 0.3, 3.5, 4 * Math.sign(Math.sin(ph))), 2, 50, 1, 0.4);
      lastTurn = turn;
      spray.setPixelScale(innerHeight * renderer.getPixelRatio());
      spray.update(dt);
    },
  };
}
