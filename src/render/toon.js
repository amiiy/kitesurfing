import * as THREE from 'three';

// Cartoon look: lit materials become banded MeshToonMaterials, hero objects get a navy outline.
// Both are idempotent, so models added to the scene later can just be passed through again.

// Shared light ramp, sampled at N·L * 0.5 + 0.5: shadow / mid / lit thirds. The shadow band
// stays bright so a rider backlit by the sun still reads as coloured shapes, not a silhouette.
const gradientMap = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

const toonOf = new WeakMap(); // source material -> toon copy, so shared materials stay shared

function toToon(m) {
  // Toon, unlit and ShaderMaterials (water, sky, particles) pass through untouched.
  if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return m;
  let toon = toonOf.get(m);
  if (!toon) {
    // Normal, roughness and metalness maps are dropped on purpose: flat bands read better.
    toon = new THREE.MeshToonMaterial({
      gradientMap,
      name: m.name,
      color: m.color,
      map: m.map,
      emissive: m.emissive,
      emissiveMap: m.emissiveMap,
      emissiveIntensity: m.emissiveIntensity,
      alphaMap: m.alphaMap,
      alphaTest: m.alphaTest,
      transparent: m.transparent,
      opacity: m.opacity,
      depthWrite: m.depthWrite,
      side: m.side,
      vertexColors: m.vertexColors,
      fog: m.fog,
    });
    toonOf.set(m, toon);
  }
  return toon;
}

export function toonify(root) {
  root.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(toToon) : toToon(o.material);
  });
}

// Inverted hull: back faces pushed out along the view-space normal, scaled by depth so the line
// keeps a constant on-screen width (~1/400 of the screen height) near and far.
const OUTLINE_WIDTH = 0.0025;
const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x1d1d28, side: THREE.BackSide });
outlineMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    /* glsl */ `#include <project_vertex>
    #ifdef USE_SKINNING
      vec3 outlineNormal = objectNormal; // already skinned
    #else
      vec3 outlineNormal = normal;
    #endif
    mvPosition.xyz += normalize(normalMatrix * outlineNormal) * (${OUTLINE_WIDTH} * -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;`
  );
};

// Adds a hull child to every mesh under `root`; skinned meshes share the source skeleton so
// the outline follows the animation.
export function outline(root) {
  const meshes = [];
  root.traverse((o) => o.isMesh && !o.userData.outlined && meshes.push(o));
  for (const mesh of meshes) {
    const hull = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, outlineMaterial) : new THREE.Mesh(mesh.geometry, outlineMaterial);
    if (mesh.isSkinnedMesh) hull.bind(mesh.skeleton, mesh.bindMatrix);
    hull.frustumCulled = mesh.frustumCulled;
    hull.userData.outlined = mesh.userData.outlined = true;
    mesh.add(hull);
  }
}
