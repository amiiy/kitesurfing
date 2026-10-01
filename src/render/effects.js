import * as THREE from 'three';
import { waveHeight } from '../waves.js';
import { inSweetSpot } from '../feel.js';

// Board effects: heel-edge spray, landing splash, a foam wake trail, the sweet-spot ring and
// the release cues (screen flash and spray bursts).

// ---------- spray: pooled point particles ----------
function createSpray(max = 2000) {
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max); // remaining life (s)
  const maxLife = new Float32Array(max);
  const lifeN = new Float32Array(max); // normalised remaining life, 0 = dead
  const size = new Float32Array(max);
  let next = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aLife', new THREE.BufferAttribute(lifeN, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  // Cartoon droplets: solid white discs with a pale cyan rim that shrink away as they die.
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      uniform float uScale;
      attribute float aLife;
      attribute float aSize;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // grow as the droplet cloud disperses; clamp so near-camera puffs never become screen-size quads
        float s = aSize * uScale / max(-mv.z, 0.1) * (0.5 + 1.2 * (1.0 - aLife));
        gl_PointSize = aLife > 0.0 ? min(s, 96.0) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        // quick grow-in, long shrink-out: the disc radius is the fade
        float radius = 0.8 * smoothstep(0.0, 0.6, vLife) * (1.0 - smoothstep(0.92, 1.0, vLife));
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float aa = fwidth(r);
        float a = 1.0 - smoothstep(radius - aa, radius, r);
        if (a < 0.01) discard;
        vec3 col = mix(vec3(0.97, 0.99, 1.0), vec3(0.62, 0.9, 0.97), step(radius * 0.7, r));
        gl_FragColor = vec4(col, a * 0.95);
      }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  return {
    points,
    emit(origin, velocity, jitter, count, lifetime = 0.9, sz = 0.25) {
      for (let n = 0; n < count; n++) {
        const i = next;
        next = (next + 1) % max;
        pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.3;
        pos[i * 3 + 1] = origin.y;
        pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.3;
        vel[i * 3] = velocity.x + (Math.random() - 0.5) * jitter;
        vel[i * 3 + 1] = velocity.y + Math.random() * jitter;
        vel[i * 3 + 2] = velocity.z + (Math.random() - 0.5) * jitter;
        maxLife[i] = life[i] = lifetime * (0.6 + Math.random() * 0.6);
        size[i] = sz * (0.5 + Math.random());
      }
      geo.attributes.aSize.needsUpdate = true;
    },
    update(dt) {
      const drag = Math.exp(-1.2 * dt);
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) { lifeN[i] = 0; continue; }
        life[i] -= dt;
        vel[i * 3 + 1] -= 9.8 * dt;
        vel[i * 3] *= drag; vel[i * 3 + 1] *= drag; vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        lifeN[i] = Math.max(0, life[i] / maxLife[i]);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
    },
    setPixelScale(heightPx) {
      material.uniforms.uScale.value = heightPx * 0.5;
    },
  };
}

// ---------- wake: foam ribbon laid behind the board ----------
function createWake(maxPoints = 200, lifetime = 7) {
  const pts = []; // { x, z, age, strength }
  const positions = new Float32Array(maxPoints * 2 * 3);
  const alpha = new Float32Array(maxPoints * 2);
  const side = new Float32Array(maxPoints * 2);
  const index = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (let i = 0; i < maxPoints; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(index);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSide;
      varying float vAlpha;
      varying float vSide;
      varying vec2 vXZ;
      void main() {
        vAlpha = aAlpha; vSide = aSide; vXZ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vAlpha;
      varying float vSide;
      varying vec2 vXZ;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), u = fract(p);
        u = u * u * (3.0 - 2.0 * u);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float n = noise(vXZ * 3.0) * 0.6 + noise(vXZ * 9.0 + uTime) * 0.4;
        // two crisp foam lines at the ribbon edges, broken-up foam between; as the trail ages
        // the shapes erode (hard threshold) instead of fading
        float s = abs(vSide);
        float edge = smoothstep(0.35, 0.8, s) * (1.0 - smoothstep(0.8, 1.0, s));
        float lace = smoothstep(0.5, 0.85, n) * (1.0 - s * 0.6);
        float shape = vAlpha * max(edge * (0.55 + 0.45 * n), lace * 0.7);
        float w = fwidth(shape) * 0.75;
        gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), smoothstep(0.22 - w, 0.22 + w, shape) * 0.9);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;

  const dir = new THREE.Vector2();
  return {
    mesh,
    // strength 0 inserts an invisible point, used to break the ribbon around jumps
    add(x, z, strength) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(x - last.x, z - last.z) < 0.4 && strength > 0) return;
      pts.push({ x, z, age: 0, strength });
      if (pts.length > maxPoints) pts.shift();
    },
    update(dt, t) {
      material.uniforms.uTime.value = t;
      for (const p of pts) p.age += dt;
      while (pts.length && pts[0].age > lifetime) pts.shift();
      for (let i = 0; i < maxPoints; i++) {
        const p = pts[i];
        if (!p) { alpha[i * 2] = alpha[i * 2 + 1] = 0; continue; }
        const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
        dir.set(b.x - a.x, b.z - a.z);
        if (dir.lengthSq() < 1e-6) dir.set(0, 1);
        dir.normalize();
        const age = p.age / lifetime;
        const w = 0.25 + Math.sqrt(p.age) * 0.55; // spreads fast, then slows
        const y = waveHeight(p.x, p.z, t) + 0.04;
        positions.set([p.x - dir.y * w, y, p.z + dir.x * w, p.x + dir.y * w, y, p.z - dir.x * w], i * 6);
        // fade in over the first ~0.3s so the ribbon doesn't start as a hard edge at the board
        alpha[i * 2] = alpha[i * 2 + 1] = p.strength * Math.pow(1 - age, 1.5) * Math.min(1, p.age * 3);
      }
      // collapse unused tail onto the last point so no stray triangles render
      if (pts.length) {
        const last = (pts.length - 1) * 6;
        for (let i = pts.length; i < maxPoints; i++) positions.copyWithin(i * 6, last, last + 6);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    },
    clear() { pts.length = 0; },
  };
}

// ---------- sweet-spot ring: a flat cyan ring that pulses out from the board ----------
const RING_PERIOD = 0.35; // s between pulses while the charge stays in the sweet spot
function createRing() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2ef2ff, transparent: true, depthWrite: false, fog: false })
  );
  mesh.visible = false;
  let age = RING_PERIOD;
  return {
    mesh,
    update(state, dt) {
      const ready = inSweetSpot(state.charge);
      if (ready && age >= RING_PERIOD) age = 0; // first pulse on entry, then one per period
      age += dt;
      const p = age / RING_PERIOD;
      mesh.visible = p < 1;
      if (!mesh.visible) return;
      mesh.position.set(state.pos.x, state.pos.y + 0.08, state.pos.z);
      mesh.scale.setScalar(0.6 + 1.6 * p);
      mesh.material.opacity = 0.8 * (1 - p);
    },
  };
}

// ---------- screen flash: a DOM overlay over the canvas, timed in real time so it fades through the hit-stop ----------
function createFlash() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:5';
  document.body.appendChild(el);
  let start = 0;
  let peak = 0;
  let length = 1;
  return {
    fire(color, opacity, ms) {
      el.style.background = color;
      [start, peak, length] = [performance.now(), opacity, ms];
    },
    update() {
      const p = (performance.now() - start) / length;
      el.style.opacity = p < 1 ? (peak * (1 - p) ** 2).toFixed(3) : '0';
    },
  };
}

// Release cues, smaller than Perfect's on purpose: [flash colour, opacity, ms] and a spray burst
// (particles, upward speed, outward speed).
const RELEASE = {
  perfect: { flash: ['#fff', 0.75, 260], burst: [160, 5, 4] },
  early: { burst: [30, 2.5, 1.5] },
  overload: { flash: ['#ff6a4d', 0.25, 220], burst: [50, 1.5, 3] },
  slow: { burst: [12, 1, 1] },
};

// ---------- emitter: drives spray and wake from the simulation state ----------
export function createBoardEffects(renderer) {
  const spray = createSpray();
  const wake = createWake();
  const ring = createRing();
  const flash = createFlash();
  const heel = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  let sprayBudget = 0; // fractional particles carried between frames
  let wasAirborne = false;
  let wasWipeout = false;

  // `count` drops thrown up and out in a crown around the board.
  function burst(pos, vel, count, up, out) {
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      velocity.set(vel.x * 0.3 + Math.cos(ang) * out, up, vel.z * 0.3 + Math.sin(ang) * out);
      spray.emit(pos, velocity, 1.5, Math.ceil(count / 12), 1.1, 0.4);
    }
  }

  const updatePixelScale = () => spray.setPixelScale(innerHeight * renderer.getPixelRatio());
  updatePixelScale();

  return {
    objects: [spray.points, wake.mesh, ring.mesh],
    updatePixelScale,
    reset() {
      wake.clear();
      wasAirborne = false;
    },
    update(state, dt, t) {
      const { pos, vel, forward, side, pullDir } = state;
      const speed = Math.hypot(vel.x, vel.z);

      // Break the wake ribbon across jumps.
      if (state.airborne !== wasAirborne) wake.add(pos.x, pos.z, 0);
      wasAirborne = state.airborne;

      if (state.landImpact > 0) {
        // crown splash: an outward ring plus a vertical plume
        const n = Math.round(60 + state.landImpact * 25);
        const up = 1.5 + state.landImpact * 0.35;
        burst(pos, vel, n * 0.6, up * 0.7, 3);
        velocity.set(vel.x * 0.3, up, vel.z * 0.3);
        spray.emit(pos, velocity, 2, Math.round(n * 0.4), 1.1, 0.45);
      }

      const cue = RELEASE[state.jumpResult];
      if (cue) {
        if (cue.flash) flash.fire(...cue.flash);
        burst(pos, vel, ...cue.burst);
      }
      // Wipeout: a big messy splash as the rider goes down.
      const wipeout = state.wipeout > 0;
      if (wipeout && !wasWipeout) burst(pos, vel, 200, 4, 5);
      wasWipeout = wipeout;

      if (!state.airborne && speed > 1) {
        wake.add(pos.x - forward.x * 0.6, pos.z - forward.z * 0.6, Math.min(1, speed / 8));

        // Spray comes off the heel edge (the side away from the kite); edging throws much more.
        heel.copy(side).multiplyScalar(pullDir.dot(side) > 0 ? -1 : 1);
        sprayBudget += dt * speed * (3 + 30 * state.edge);
        const count = Math.floor(sprayBudget);
        sprayBudget -= count;
        if (count > 0) {
          origin.copy(pos).addScaledVector(heel, 0.25).addScaledVector(forward, -0.4);
          origin.y += 0.05;
          velocity.copy(heel).multiplyScalar(1 + speed * 0.25 * state.edge).addScaledVector(forward, speed * 0.4);
          velocity.y = 1 + speed * 0.15 * (0.4 + state.edge);
          spray.emit(origin, velocity, 1.5, count, 0.9, 0.35);
        }
      }

      spray.update(dt);
      wake.update(dt, t);
      ring.update(state, dt);
      flash.update();
    },
  };
}
