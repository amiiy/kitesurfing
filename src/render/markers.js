import * as THREE from 'three';
import { waveHeight } from '../waves.js';
import { COURSE_LENGTH } from '../game/run.js';
import { loadProp } from './props.js';

// Progress cues, render only: a numbered buoy every 100 m, inflatable arches at the start and the
// finish, and a giant lighthouse on the far horizon at the finish's x. The camera looks downwind, so
// it rises at the right edge from the start and swings toward the middle as the finish nears.
// Fixed in x; each one's z is fixed LOCK m ahead on the line the rider is holding then (like run.js).
const MARKER_EVERY = 100; // m
const MARKER_HEIGHT = 5; // m
const MARKER_SIDE = -12; // m off the rider's line, downwind: seen past the rider from the upwind camera
const ARCH_HEIGHT = 14; // m; about 16 m wide
const START = { x: 40, z: -12 }; // m; where a rider out of the waterstart at the origin passes (sim: unedged)
const LIGHTHOUSE_HEIGHT = 150; // m: a headland landmark, readable ~1.5-2 km away
const LIGHTHOUSE_DOWNWIND = 1400; // m downwind of the rider: far past the shore, inside the camera's 2 km far plane
const LOCK = 150; // m ahead
const SINK = 0.4; // m the floating models sit below the surface
// Model yaw offsets (rad). Arches open along Z with the banner on +Z: turn it to the approaching rider (-X),
// then 0.6 rad on toward the upwind chase camera (as course.js turns its rings) so the banner reads.
const ARCH_YAW = -Math.PI / 2 + 0.6;
const MARKER_YAW = 0; // number panel faces +Z: the upwind chase camera
const LIGHTHOUSE_YAW = 0; // door faces +Z: the sea

function model(parts, yaw) {
  const g = new THREE.Group();
  for (const { geometry, material } of parts) g.add(new THREE.Mesh(geometry, material));
  g.rotation.y = yaw;
  return g;
}

function label(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#1d1d28';
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false }));
  sprite.scale.set(8, 4, 1);
  sprite.position.y = MARKER_HEIGHT + 2.5;
  return sprite;
}

export function createMarkers() {
  const group = new THREE.Group();
  const models = {};
  // A missing model just leaves the scene without it.
  for (const [name, height] of [['marker_buoy', MARKER_HEIGHT], ['start_arch', ARCH_HEIGHT], ['finish_arch', ARCH_HEIGHT]]) {
    loadProp(name, height).then((parts) => (models[name] = parts), () => {});
  }
  const lighthouse = new THREE.Group();
  loadProp('lighthouse', LIGHTHOUSE_HEIGHT).then((parts) => {
    for (const p of parts) p.material.fog = false; // a landmark: seen from the start, far past the fog
    lighthouse.add(model(parts, LIGHTHOUSE_YAW));
  }, () => {});
  group.add(lighthouse);

  const marks = [{ x: START.x, name: 'start_arch', yaw: ARCH_YAW, side: 0 }];
  for (let x = MARKER_EVERY; x < COURSE_LENGTH; x += MARKER_EVERY) marks.push({ x, name: 'marker_buoy', yaw: MARKER_YAW, side: MARKER_SIDE, text: `${x} m` });
  marks.push({ x: COURSE_LENGTH, name: 'finish_arch', yaw: ARCH_YAW, side: 0 });
  let run = null;

  return {
    group,
    update(r, view, t) {
      if (r !== run) {
        run = r; // a new run: the rider is back at the start, every z free again
        for (const m of marks) m.z = m.name === 'start_arch' ? START.z : null;
      }
      for (const m of marks) {
        // Wait for the rider to get going: a standing start predicts no line.
        if (m.z === null && m.x - view.pos.x < LOCK && view.vel.x > 2) m.z = view.pos.z + (view.vel.z * (m.x - view.pos.x)) / view.vel.x + m.side;
        if (!m.mesh) {
          if (!models[m.name]) continue; // still loading
          m.mesh = model(models[m.name], m.yaw);
          if (m.text) m.mesh.add(label(m.text));
          group.add(m.mesh);
        }
        m.mesh.visible = m.z !== null;
        if (m.mesh.visible) m.mesh.position.set(m.x, waveHeight(m.x, m.z, t) - SINK, m.z);
      }
      lighthouse.position.set(COURSE_LENGTH, 0, view.pos.z - LIGHTHOUSE_DOWNWIND);
    },
  };
}
