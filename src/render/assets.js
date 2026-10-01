import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Optional GLBs in public/models/. Anything missing or broken stays null and the
// procedural placeholder is used instead. Re-export from Blender, then `npm run optimize:models`.
const NAMES = ['board', 'kite', 'rider'];
const assets = {};

export async function loadAssets() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const bar = document.querySelector('#loading > div > div');
  let done = 0;
  await Promise.all(
    NAMES.map(async (name) => {
      try {
        assets[name] = await loader.loadAsync(`/models/${name}.glb`);
      } catch {
        assets[name] = null; // missing (dev server answers with index.html) or unparseable
      }
      if (bar) bar.style.width = `${(++done / NAMES.length) * 100}%`;
    })
  );
  document.getElementById('loading')?.remove();
}

// The loaded gltf ({ scene, animations, ... }) or null.
export const getAsset = (name) => assets[name] ?? null;
