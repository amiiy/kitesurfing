import { ShaderMaterial } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Screen-space speed cue: vignette plus a radial blur that streaks the frame edges.
// One fullscreen pass; the blur taps are skipped entirely when `blur` is 0.
// The follow camera writes the uniforms each frame (shared module state, one composer).
export const postFx = { vignette: { value: 0 }, blur: { value: 0 } };

export function createPostFxPass(taps) {
  // A ShaderMaterial (not a plain shader object) so ShaderPass keeps our uniform objects instead of cloning them.
  return new ShaderPass(new ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, ...postFx },
    defines: { TAPS: taps },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float vignette; // 0..1 edge darkening
      uniform float blur; // fraction of the centre->pixel distance smeared at the frame corners
      varying vec2 vUv;
      void main() {
        vec2 d = vUv - 0.5;
        float r2 = dot(d, d) * 2.0; // 0 centre, 1 at the corners
        vec4 color = texture2D(tDiffuse, vUv);
        #if TAPS > 0
        if (blur > 0.0) {
          // Pull samples toward the centre; the centre stays sharp (smear grows with r²).
          vec2 stepUv = d * blur * r2 / float(TAPS);
          for (int i = 1; i <= TAPS; i++) color += texture2D(tDiffuse, vUv - stepUv * float(i));
          color /= float(TAPS + 1);
        }
        #endif
        color.rgb *= 1.0 - vignette * r2;
        gl_FragColor = color;
      }`,
  }));
}
