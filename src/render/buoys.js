import * as THREE from 'three';
import { waveHeight } from '../waves.js';
import { loadProp } from './props.js';

const TILE = 240; // buoys repeat on this grid so there are always some around the rider
const COUNT = 70;

// Floating markers used as a speed reference.
export function createBuoys() {
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.6, 1.6, 10);
  const materials = [0xff5a1f, 0xffd21f].map((color) => new THREE.MeshStandardMaterial({ color }));
  const buoys = Array.from({ length: COUNT }, (_, i) => {
    const mesh = new THREE.Mesh(geo, materials[i % 2]);
    mesh.castShadow = true;
    group.add(mesh);
    return { mesh, x: Math.random() * TILE, z: Math.random() * TILE };
  });
  // Cartoon buoy replaces the cones once loaded; sunk 0.3 m like the cone's base.
  loadProp('buoy', 1.8).then(([{ geometry, material }]) => {
    geometry.translate(0, -0.8, 0);
    for (const { mesh } of buoys) Object.assign(mesh, { geometry, material });
  });

  return {
    group,
    update(t, center) {
      const wrap = (base, c) => c + THREE.MathUtils.euclideanModulo(base - c, TILE) - TILE / 2;
      for (const b of buoys) {
        const x = wrap(b.x, center.x);
        const z = wrap(b.z, center.z);
        b.mesh.position.set(x, waveHeight(x, z, t) + 0.5, z);
      }
    },
  };
}
