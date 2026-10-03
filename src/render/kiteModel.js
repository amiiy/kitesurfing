import * as THREE from 'three';
import { KITE } from '../config.js';
import { getAsset } from './assets.js';

const RADIUS = 3.15; // arc radius of the canopy: ~5.8 m span, in scale with KITE.lineLength
const ARC = 1.15; // half-angle of the arc (rad)
const CHORD = 1.3; // leading edge to trailing edge
const ANCHOR_HEIGHT = 1.25; // lines meet the rider at harness height
const BANK = 0.06; // rad of bank per rad/s of turn...
const MAX_BANK = 0.3; // ...up to this
const AOA = 0.12; // rad the leading edge tilts away from the rider (angle of attack)...
const AOA_POWER = 0.12; // ...plus this much more at full power
const BOB = 0.1; // m the kite breathes up and down while it holds still

// Local frame: +Y = direction of flight (leading edge), +Z = away from the rider (convex side),
// span along X; the tips curve back toward the rider (-Z). Apex of the arc at z = 0.
function buildProceduralKite() {
  const group = new THREE.Group();

  const canopyGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, CHORD, 32, 1, true, -ARC, ARC * 2);
  canopyGeo.translate(0, 0, -RADIUS);
  const canopy = new THREE.Mesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ color: 0xff3d6e, side: THREE.DoubleSide, roughness: 0.6 })
  );
  canopy.castShadow = true;

  const leadingEdgeGeo = new THREE.TorusGeometry(RADIUS, 0.1, 8, 40, ARC * 2);
  leadingEdgeGeo.rotateX(Math.PI / 2); // into the XZ plane
  leadingEdgeGeo.rotateY(ARC - Math.PI / 2); // centre the arc on +Z
  leadingEdgeGeo.translate(0, CHORD / 2, -RADIUS);
  const leadingEdge = new THREE.Mesh(leadingEdgeGeo, new THREE.MeshStandardMaterial({ color: 0x1d1d28 }));

  group.add(canopy, leadingEdge);
  const tipsLocal = [-1, 1].map(
    (side) => new THREE.Vector3(side * RADIUS * Math.sin(ARC), 0, RADIUS * Math.cos(ARC) - RADIUS)
  );
  return { group, tipsLocal };
}

// Fits public/models/kite.glb into the local frame above. Its authored axes are: span X, convex
// side +Y, leading edge +Z (the thick tube). Turning 180° about Y, then +90° about X, maps those to
// span X (mirrored), convex +Z, leading edge +Y.
// If a new export flies backwards or upside down, fix the rotation here.
function buildGltfKite(scene) {
  const group = new THREE.Group();
  scene.rotation.set(Math.PI / 2, Math.PI, 0);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const s = (2 * RADIUS * Math.sin(ARC)) / (box.max.x - box.min.x); // same span as the placeholder
  box.min.multiplyScalar(s);
  box.max.multiplyScalar(s);
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  scene.scale.setScalar(s);
  scene.position.set(-cx, -cy, -box.max.z); // centred on span and chord, apex at z = 0
  box.translate(scene.position);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.material.metalness = 0; // exported metallicFactor 1 renders black without an env map
  });
  group.add(scene);
  // Lines attach at the span ends, where the wingtips curve furthest back toward the rider.
  const tipsLocal = [box.min.x, box.max.x].map((x) => new THREE.Vector3(x, 0, box.min.z));
  return { group, tipsLocal };
}

export function createKiteModel() {
  const gltf = getAsset('kite');
  const { group, tipsLocal } = gltf ? buildGltfKite(gltf.scene) : buildProceduralKite();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let bank = 0;
  let pitch = AOA;
  let time = 0;

  return {
    group,
    update(state, dt) {
      const { az, el, heading, turn, power } = state.kite;
      time += dt;
      group.position.copy(state.pos).addScaledVector(state.kiteDir, KITE.lineLength);
      group.position.y += ANCHOR_HEIGHT;
      if (state.kite.crashed) group.position.y = state.pos.y + 0.4; // lying on the water

      // Tangents of the window sphere: up = d/d(el), right = d/d(az).
      up.set(-Math.sin(az) * Math.sin(el), Math.cos(el), Math.cos(az) * Math.sin(el));
      right.set(Math.cos(az), 0, Math.sin(az));
      y.copy(up).multiplyScalar(Math.cos(heading)).addScaledVector(right, Math.sin(heading));
      x.crossVectors(y, state.kiteDir);
      group.position.addScaledVector(up, BOB * Math.sin(time * 1.7)); // breathes in the wind
      group.quaternion.setFromRotationMatrix(basis.makeBasis(x, y, state.kiteDir));
      // Banks into turns (the inside tip pulled in by its line) and leans back as the lines load up,
      // with a slight flutter of the canopy.
      const k = 1 - Math.exp(-12 * dt);
      bank += (THREE.MathUtils.clamp(-BANK * turn, -MAX_BANK, MAX_BANK) - bank) * k;
      pitch += (AOA + AOA_POWER * power - pitch) * k;
      group.rotateY(bank + 0.015 * Math.sin(time * 9.1));
      group.rotateX(pitch + 0.02 * Math.sin(time * 6.3 + 1));
      group.updateMatrixWorld(true);
    },
    // World position of the left (0) or right (1) wingtip.
    tip: (i, out) => out.copy(tipsLocal[i]).applyMatrix4(group.matrixWorld),
  };
}

const SEGMENTS = 16; // per flying line
const SAG = 0.2; // m the lines bow at power 1 (parked); like a catenary, sag ∝ 1 / tension...
const MAX_SAG = 2.5; // ...up to this when slack (a lull, a crashed kite)

// Two flying lines, rebuilt in place every frame. They bow under their weight more the less the
// kite pulls: taut in a dive, sagging in a lull or after a crash.
export function createKiteLines() {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0x222222 });
  const lines = [0, 1].map(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * (SEGMENTS + 1)), 3));
    const line = new THREE.Line(geo, material);
    line.frustumCulled = false;
    group.add(line);
    return line;
  });
  const dir = new THREE.Vector3();
  const sag = new THREE.Vector3();

  return {
    group,
    set(i, from, to, power) {
      dir.subVectors(to, from).normalize();
      // Gravity's part across the line (a line straight up hardly bows), as deep as the tension allows.
      sag.set(0, -1, 0).addScaledVector(dir, dir.y).multiplyScalar(Math.min(MAX_SAG, SAG / Math.max(power, 1e-3)));
      const attr = lines[i].geometry.attributes.position;
      for (let k = 0; k <= SEGMENTS; k++) {
        const u = k / SEGMENTS;
        const bow = 4 * u * (1 - u); // parabola: 0 at the ends, 1 mid-line
        attr.setXYZ(k, from.x + (to.x - from.x) * u + sag.x * bow, from.y + (to.y - from.y) * u + sag.y * bow, from.z + (to.z - from.z) * u + sag.z * bow);
      }
      attr.needsUpdate = true;
    },
  };
}
