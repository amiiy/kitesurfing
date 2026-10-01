import * as THREE from 'three';
import { FEEL, POSE } from '../config.js';
import { inSweetSpot } from '../feel.js';
import { getAsset } from './assets.js';
import { outlineMaterial } from './toon.js';

const COLORS = { skin: 0xe0ac85, suit: 0x1d1d28, accent: 0x22c3ff, cap: 0xff3d6e, board: 0xf2f2f2, gear: 0x111111 };
const BAR_HALF_WIDTH = 0.27;

const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));

// Capsule pivoting at its top end, hanging down -Y.
function limb(length, radius, color) {
  const geo = new THREE.CapsuleGeometry(radius, length, 4, 8);
  geo.translate(0, -length / 2, 0);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
}

const BOARD_LENGTH = 1.4;
const BOARD_THICKNESS = 0.06;

// Fits board.glb: longest axis -> Z (length), thinnest -> Y (thickness), scaled to BOARD_LENGTH,
// origin at the bottom centre. Which end is the nose (-Z) can't be read from a bbox: if it rides
// backwards in game, rotate the export 180° in Blender (or add `model.rotateY(Math.PI)` here).
function gltfBoard(model) {
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray();
  const [thin, mid, long] = [0, 1, 2].sort((a, b) => size[a] - size[b]);
  const axes = [];
  axes[thin] = new THREE.Vector3(0, 1, 0);
  axes[mid] = new THREE.Vector3(1, 0, 0);
  axes[long] = new THREE.Vector3(0, 0, 1);
  const basis = new THREE.Matrix4().makeBasis(...axes);
  if (basis.determinant() < 0) axes[mid].x = -1; // keep it a rotation, not a mirror
  model.quaternion.setFromRotationMatrix(basis.makeBasis(...axes));
  model.scale.setScalar(BOARD_LENGTH / size[long]);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const board = new THREE.Group();
  board.add(model);
  return board;
}

function proceduralBoard() {
  const deck = box(0.45, BOARD_THICKNESS, 1.45, COLORS.board);
  deck.add(box(0.46, 0.065, 0.25, COLORS.cap));
  deck.position.y = BOARD_THICKNESS / 2;
  const board = new THREE.Group();
  board.add(deck);
  return board;
}

// Board origin = bottom centre; locators (named, find with board.getObjectByName) mark where
// the feet stand and where spray leaves the tail.
function buildBoard() {
  const gltf = getAsset('board');
  const board = gltf ? gltfBoard(gltf.scene) : proceduralBoard();
  board.position.y = -BOARD_THICKNESS / 2; // deck top stays at the tilt pivot height as before
  for (const [name, x, y, z] of [
    ['foot_L', -0.13, BOARD_THICKNESS, -0.35],
    ['foot_R', 0.13, BOARD_THICKNESS, 0.35],
    ['spray_tail', 0, 0, BOARD_LENGTH / 2],
  ]) {
    const locator = new THREE.Object3D();
    locator.name = name;
    locator.position.set(x, y, z);
    board.add(locator);
  }
  return board;
}

// Hierarchy: root (position, yaw = board heading)
//   > tilt (edge roll, air pitch) > board, legs, upper (hips pivot: yaw toward kite, lean back)
function buildRider() {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const board = buildBoard();

  const legL = limb(0.8, 0.08, COLORS.suit);
  legL.position.set(-0.13, 0.95, -0.35);
  const legR = limb(0.8, 0.08, COLORS.suit);
  legR.position.set(0.13, 0.95, 0.35);

  const upper = new THREE.Group();
  upper.rotation.order = 'YXZ';
  upper.position.y = 1.0;

  const torso = box(0.4, 0.55, 0.24, COLORS.accent);
  torso.position.y = 0.4;
  const harness = box(0.44, 0.12, 0.28, COLORS.gear);
  harness.position.y = 0.18;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: COLORS.skin }));
  head.position.y = 0.85;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: COLORS.cap })
  );
  cap.position.y = 0.87;
  const armL = limb(0.55, 0.06, COLORS.accent);
  armL.position.set(-0.24, 0.62, 0);
  const armR = limb(0.55, 0.06, COLORS.accent);
  armR.position.set(0.24, 0.62, 0);

  upper.add(box(0.38, 0.22, 0.26, COLORS.suit), torso, harness, head, cap, armL, armR);
  tilt.add(board, legL, legR, upper);

  // The bar lives in world space so it can aim at the kite independently of the body.
  const bar = new THREE.Group();
  bar.add(box(BAR_HALF_WIDTH * 2 + 0.01, 0.03, 0.03, 0x333333));

  return { root, tilt, board, upper, legL, legR, armL, armR, bar };
}

// rider.glb: Meshy auto-rig (meters, feet at origin, facing +Z) with clips ride, edge, pop, air,
// land, fall, water_idle. It replaces the procedural body; unrigged or missing => procedural rider.
const FADE = 0.2; // s, crossfade between clips
const GET_UP = 0.5; // s, crossfade out of a wipeout
// One-shots play [from, to] seconds of their library animation, then hand back to the state clip.
// pop stops at its extension: later its root motion lifts the feet off the board.
const SHOTS = { pop: [0.3, 0.55], land: [1.5, 2.2], fall: [0, Infinity] };
const CROUCH = ['pop', 0.28]; // pop's wind-up: the deepest crouch in the library, blended in by charge

function attachGltfRider(tilt, hide) {
  const gltf = getAsset('rider');
  let rigged = false;
  gltf?.scene.traverse((o) => (rigged ||= o.isSkinnedMesh));
  if (!rigged) return null;
  const model = gltf.scene;
  model.position.y = BOARD_THICKNESS / 2; // stand on the deck
  tilt.add(model);
  for (const o of hide) o.visible = false;

  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
  for (const name of Object.keys(SHOTS)) {
    actions[name].setLoop(THREE.LoopOnce);
    actions[name].clampWhenFinished = true;
  }
  // Its own action on a clone of the clip, so it holds still apart from the pop one-shot.
  const crouch = mixer.clipAction(gltf.animations.find((c) => c.name === CROUCH[0]).clone());
  crouch.play();
  crouch.paused = true;
  crouch.time = CROUCH[1];
  const spine = model.getObjectByName('Spine02');
  const hands = [model.getObjectByName('LeftHand'), model.getObjectByName('RightHand')];
  const offset = new THREE.Quaternion();
  const parent = new THREE.Quaternion();
  const parentInv = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const handR = new THREE.Vector3();
  const lerp = THREE.MathUtils.lerp;
  let clip = null;
  let side = 1; // kite on the board's left (1) or right (-1)
  let twist = 0;
  let lean = 0;
  let crouchShare = 0; // 0..1 of the pose that is the crouch

  function play(name) {
    if (name === clip) return;
    const next = actions[name].reset();
    next.time = SHOTS[name]?.[0] ?? 0;
    next.play();
    if (clip) actions[clip].crossFadeTo(next, clip === 'fall' ? GET_UP : FADE, false);
    clip = name;
  }
  const busy = (name) => clip === name && actions[name].isRunning() && actions[name].time < SHOTS[name][1];
  function chooseClip(s) {
    if (s.kite.crashed) return (clip === 'fall' && !busy('fall')) || clip === 'water_idle' ? 'water_idle' : 'fall';
    if (s.wipeout > 0) return 'fall'; // the sim's crash timer: landed mid-spin or overloaded, or hit something
    if (s.airborne) return clip !== 'air' && s.vel.y > 0 && (clip !== 'pop' || busy('pop')) ? 'pop' : 'air';
    if (s.landImpact > 0 || busy('land')) return 'land';
    if (s.charge === 0 && Math.hypot(s.vel.x, s.vel.z) < FEEL.idleSpeed) return 'water_idle'; // stands when stopped
    return s.edge > (clip === 'edge' ? 0.4 : 0.5) || s.charge > 0 ? 'edge' : 'ride'; // hysteresis: no flicker
  }

  return {
    update(state, kiteYaw, k, dt) {
      play(chooseClip(state));

      // Loading the jump sinks into the crouch and squashes a little; a grab tucks all the way.
      const grab = state.airborne && state.trick === 'grab';
      const share = clip === 'fall' ? 0 : grab ? 0.9 : state.airborne ? 0 : FEEL.crouchDepth * state.charge;
      crouchShare = lerp(crouchShare, share, 1 - Math.exp(-15 * dt));
      crouch.setEffectiveWeight(crouchShare / (1 - crouchShare)); // the state clips weigh 1: share = w / (1 + w)
      const squash = FEEL.squash * crouchShare;
      model.scale.set(1 + squash / 2, 1 - squash, 1 + squash / 2);
      mixer.update(dt);

      // Side-on with the chest to the kite; switch feet once the kite is clearly on the other side.
      if (Math.abs(kiteYaw) > 0.3) side = Math.sign(kiteYaw);
      model.rotation.y = lerp(model.rotation.y, side > 0 ? -Math.PI / 2 : -1.5 * Math.PI, k); // turn via facing the nose

      // The spine twists the rest of the way to the kite and hangs back against the pull. The offset
      // is a model-space rotation, conjugated into the spine's parent frame: L' = P⁻¹ R P L.
      twist = lerp(twist, THREE.MathUtils.clamp(kiteYaw - (side * Math.PI) / 2, -0.7, 0.7), k);
      lean = lerp(lean, grab ? -0.6 : 0.3 * state.kite.power, k); // a grab folds forward to the board
      offset.setFromEuler(euler.set(-lean, twist, 0));
      parent.identity();
      for (let o = spine.parent; o !== model; o = o.parent) parent.premultiply(o.quaternion);
      offset.premultiply(parentInv.copy(parent).invert()).multiply(parent);
      spine.quaternion.premultiply(offset);
    },
    // Midpoint between the hands (world matrices must be current).
    barPosition: (out) => hands[0].getWorldPosition(out).add(hands[1].getWorldPosition(handR)).multiplyScalar(0.5),
  };
}

// Signed angle of `dir` around Y relative to `yaw`, wrapped to [-PI, PI].
function relativeYaw(dir, yaw) {
  return THREE.MathUtils.euclideanModulo(Math.atan2(-dir.x, -dir.z) - yaw + Math.PI, Math.PI * 2) - Math.PI;
}

export function createRiderModel() {
  const parts = buildRider();
  const { root, tilt, board, upper, legL, legR, armL, armR, bar } = parts;
  const rig = attachGltfRider(tilt, [legL, legR, upper]);
  const barOffset = new THREE.Vector3(0, 0.35, -0.45); // in front of the chest, upper-body space
  const barEndLocal = [new THREE.Vector3(-BAR_HALF_WIDTH, 0, 0), new THREE.Vector3(BAR_HALF_WIDTH, 0, 0)];
  const lerp = THREE.MathUtils.lerp;
  // "Ready" tell: in the sweet spot the outline turns thick and cyan and the body flashes on entry.
  const riderOutline = Object.assign(outlineMaterial.clone(), { onBeforeCompile: outlineMaterial.onBeforeCompile }); // own colour and width, same shader
  const readyColor = new THREE.Color(FEEL.readyColor);
  let bodyMaterials = null; // found on the first update: main toonifies and outlines after creation
  let wasReady = false;
  let flash = 0;

  return {
    objects: [root, bar],
    position: root.position,
    board,
    update(state, kitePosition, t, dt) {
      const k = 1 - Math.exp(-POSE.smoothRate * dt); // frame-rate independent smoothing
      const speed = Math.hypot(state.vel.x, state.vel.z);

      if (!bodyMaterials) {
        bodyMaterials = new Set();
        for (const o of [root, bar]) {
          o.traverse((m) => {
            if (m.material === outlineMaterial) m.material = riderOutline;
            else if (m.isMesh) for (const mat of [m.material].flat()) bodyMaterials.add(mat);
          });
        }
      }
      const ready = inSweetSpot(state.charge);
      if (ready && !wasReady) flash = 1;
      wasReady = ready;
      flash = Math.max(0, flash - 5 * dt);
      riderOutline.color.copy(ready ? readyColor : outlineMaterial.color);
      riderOutline.userData.width.value = outlineMaterial.userData.width.value * (ready ? FEEL.readyOutline : 1);
      for (const mat of bodyMaterials) mat.emissive?.copy(readyColor).multiplyScalar(0.7 * flash);

      root.position.copy(state.pos);
      root.position.y += POSE.rideHeight;
      root.rotation.y = state.yaw + state.trickSpin;

      // Upper body turns toward the kite and hangs back in the harness against the pull.
      const kiteYaw = THREE.MathUtils.clamp(relativeYaw(state.kiteDir, state.yaw), -1.7, 1.7);
      rig?.update(state, kiteYaw, k, dt);
      upper.rotation.y = lerp(upper.rotation.y, kiteYaw, k);
      upper.rotation.x = lerp(upper.rotation.x, 0.15 + 0.35 * state.kite.power + 0.2 * state.edge, k);

      // Crouch while loading a jump.
      upper.position.y = 1.0 - 0.22 * state.charge;
      legL.rotation.x = -0.35 - 0.4 * state.charge;
      legR.rotation.x = 0.35 + 0.4 * state.charge;

      // Heel edge digs in on the side away from the kite; on the water the board also follows
      // the wave slope; in the air the nose pitches with the jump arc and a grab tweaks the board.
      const tweak = state.trick === 'grab' ? 0.5 : 0;
      const roll = state.airborne ? tweak : -Math.sin(kiteYaw) * (0.08 + 0.3 * state.edge) * Math.min(1, speed / 4);
      const waveRoll = state.airborne ? 0 : Math.atan(state.slope.x * state.side.x + state.slope.z * state.side.z);
      const wavePitch = state.airborne ? 0 : Math.atan(state.slope.x * state.forward.x + state.slope.z * state.forward.z);
      tilt.rotation.z = lerp(tilt.rotation.z, roll + waveRoll + Math.sin(t * 2) * 0.03, k);
      tilt.rotation.x = lerp(tilt.rotation.x, state.airborne ? -0.25 * Math.sign(state.vel.y) : wavePitch, 1 - Math.exp(-6.3 * dt));

      // Bar and arms aim at the kite; the bar rolls with the kite's position as a steering cue.
      root.updateMatrixWorld(true);
      if (rig) rig.barPosition(bar.position);
      else bar.position.copy(barOffset).applyMatrix4(upper.matrixWorld);
      bar.lookAt(kitePosition);
      bar.rotateZ(-state.kite.az * 0.5);
      bar.updateMatrixWorld(true);
      for (const arm of [armL, armR]) {
        arm.lookAt(kitePosition);
        arm.rotateX(-Math.PI / 2); // capsule hangs along -Y; lookAt aims +Z
      }
    },
    // World position of the left (0) or right (1) bar end.
    barEnd: (i, out) => out.copy(barEndLocal[i]).applyMatrix4(bar.matrixWorld),
  };
}
