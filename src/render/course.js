import * as THREE from 'three';
import { GAME } from '../config.js';
import { waveHeight } from '../waves.js';
import { loadProp } from './props.js';

// Rings and obstacles of the current run (ramps are drawn by the water shader). A mesh appears once
// the run has fixed the object's position; a new run drops them all.
const RING_YAW = 0.6; // rad the ring turns from facing along the course toward the chase camera: a hoop, not a line
const BUOY_SPACING = 2.5; // m between the three buoys of a line, across the course
const SINK = 0.4; // m the models sit below the surface

export function createCourseView() {
  const group = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(GAME.ringRadius, 0.3, 10, 48);
  const ringMat = new THREE.MeshToonMaterial({ color: 0xffb01f, emissive: 0x663300 });
  const hitMat = new THREE.MeshToonMaterial({ color: 0x7dffa8, emissive: 0x1f6633 });
  const models = {};
  loadProp('buoy', GAME.buoys.height + SINK).then((parts) => (models.buoys = parts));
  loadProp('sailboat', GAME.boat.height + SINK).then((parts) => (models.boat = parts));
  const meshes = new Map(); // course item -> Object3D
  let items = null;

  function build(item) {
    if (item.kind === 'ring') {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(item.x, item.y, item.z);
      ring.rotation.y = Math.PI / 2 + RING_YAW;
      return ring;
    }
    const parts = models[item.kind];
    if (!parts) return null; // still loading: try again next frame
    const obstacle = new THREE.Group();
    const offsets = item.kind === 'buoys' ? [-BUOY_SPACING, 0, BUOY_SPACING] : [0];
    for (const dz of offsets) {
      const model = new THREE.Group();
      for (const { geometry, material } of parts) model.add(new THREE.Mesh(geometry, material));
      model.position.set(0, 0, dz);
      obstacle.add(model);
    }
    obstacle.position.set(item.x, 0, item.z);
    return obstacle;
  }

  return {
    group,
    update(run, t) {
      if (run.items !== items) {
        items = run.items;
        group.clear();
        meshes.clear();
      }
      for (const item of items) {
        if (item.z === null) break; // fixed in x order
        if (item.kind === 'ramp') continue;
        let mesh = meshes.get(item);
        if (!mesh) {
          mesh = build(item);
          if (!mesh) continue;
          meshes.set(item, mesh);
          group.add(mesh);
        }
        if (item.kind === 'ring') mesh.material = item.hit ? hitMat : ringMat;
        else for (const model of mesh.children) model.position.y = waveHeight(item.x, item.z + model.position.z, t) - SINK;
      }
    },
  };
}
