import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { toonify } from './toon.js';

// Cartoon environment props (public/models/<name>.glb, Meshy exports run through optimize:models).
// They load in the background after start-up; until then the scene just lacks them.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Resolves to the prop's parts ({ geometry, material }) with node transforms baked in, scaled to
// `height` metres, origin at the bottom centre. Materials are toonified here: props arrive after
// main.js has run its own toonify pass over the scene.
export async function loadProp(name, height) {
  const { scene } = await loader.loadAsync(`/models/${name}.glb`);
  toonify(scene);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const s = height / (box.max.y - box.min.y);
  const fit = new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    // Meshopt-quantized positions are normalized int16 and would clamp at ±1: copy to float first.
    const p = o.geometry.attributes.position;
    const pos = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) pos.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3);
    const geometry = o.geometry.clone().setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(fit, o.matrixWorld));
    parts.push({ geometry, material: o.material });
  });
  return parts;
}

// One InstancedMesh per part, placed by `matrices`, added to `group` once loaded. No shadows.
export async function instanceProp(group, name, height, matrices) {
  for (const { geometry, material } of await loadProp(name, height)) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    group.add(mesh);
  }
}
