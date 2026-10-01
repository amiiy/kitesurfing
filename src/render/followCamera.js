import * as THREE from 'three';
import { CAMERA, FEEL, JUMP } from '../config.js';
import { postFx } from './postFx.js';

const { clamp, smoothstep } = THREE.MathUtils;

// Chase camera: sits upwind of the rider and aims part-way toward the kite so both stay in frame.
// On top of the follow, small view-only effects sell speed and impact (all scaled by FEEL.cameraFx):
// speed widens the FOV and adds water chatter, charging lowers/rolls/zooms in, popping kicks
// the FOV, the air lifts and loosens the camera, landings dip and recoil.
// Effects never feed back into the follow, and nothing here touches the sim.
export function createFollowCamera(camera) {
  const offset = new THREE.Vector3(...CAMERA.offset);
  const position = new THREE.Vector3().copy(offset);
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  let time = 0; // drives the vibration sines and the landing spring
  let snap = true; // jump straight to the desired view on the next update (first frame, reset)
  let fov = CAMERA.fov; // smoothed speed FOV, before the charge zoom and takeoff kick
  let charge = 0; // smoothed state.charge
  let lean = 0; // smoothed side the rider leans to: -1 screen left, +1 screen right
  let air = 0; // smoothed 0..1 airborne height factor
  let wasAirborne = false;
  let popKick = 0; // degrees of FOV kick left from the last takeoff
  let landAmp = 0; // m; size of the last landing dip
  let landAt = 0; // `time` of the last landing (landAmp 0 until then)

  return {
    // Next update jumps straight to the new framing instead of swooping across the map.
    reset() {
      snap = true;
      charge = air = popKick = landAmp = 0;
      wasAirborne = false;
    },

    update(riderPosition, kitePosition, state, dt) {
      const fx = clamp(FEEL.cameraFx, 0, 1);
      const ease = (rate) => (snap ? 1 : 1 - Math.exp(-rate * dt));
      time += dt;

      const speed = Math.hypot(state.vel.x, state.vel.z);
      const speedK = smoothstep(speed, FEEL.fovSpeedMin, FEEL.fovSpeed);
      charge += (state.charge - charge) * ease(FEEL.chargeCamRate);
      // The rider hangs back against the kite, i.e. away from the travel direction (stable when the kite goes to 12).
      lean += (clamp(-state.vel.x / 2, -1, 1) - lean) * ease(FEEL.chargeCamRate);
      const height = state.airborne ? Math.max(0, state.pos.y - state.takeoffY) : 0;
      air += (smoothstep(height, 0, FEEL.airRiseHeight) - air) * ease(FEEL.airRate);

      // Follow. Airborne, the vertical follow loosens so the rider rises in frame before the camera catches up.
      const k = ease(FEEL.cameraFollow);
      desired.copy(riderPosition).add(offset);
      desired.y += fx * (FEEL.airRise * air - FEEL.chargeDrop * charge);
      const ky = ease(FEEL.cameraFollow * (1 - (1 - FEEL.airLag) * fx * air));
      position.x += (desired.x - position.x) * k;
      position.y += (desired.y - position.y) * ky;
      position.z += (desired.z - position.z) * k;

      // Aim a little ahead along horizontal travel so the rider isn't chasing the frame edge.
      desired.lerpVectors(riderPosition, kitePosition, CAMERA.lookTowardKite);
      desired.x += state.vel.x * FEEL.lookAhead;
      desired.z += state.vel.z * FEEL.lookAhead;
      target.lerp(desired, k);

      // FOV: smoothed speed push, minus a charge zoom-in that tightens up to the sweet spot, plus the takeoff kick.
      fov += (CAMERA.fov + fx * (FEEL.fovMax - CAMERA.fov) * speedK - fov) * ease(FEEL.fovRate);
      const zoom = fx * FEEL.chargeZoom * smoothstep(charge, 0, JUMP.sweetMin);
      if (state.airborne && !wasAirborne) popKick = FEEL.popFovKick * fx;
      wasAirborne = state.airborne;
      popKick *= Math.exp(-FEEL.popFovDecay * dt);
      camera.fov = Math.min(fov - zoom + popKick, FEEL.fovCap);
      camera.updateProjectionMatrix();
      snap = false;

      // Landing: a damped sine, so the view dips first, then recoils past level and settles.
      if (state.landImpact > 0) {
        landAmp = fx * FEEL.landDip * Math.min(1, state.landImpact / FEEL.landImpact);
        landAt = time;
      }
      const tl = time - landAt;
      const dip = -landAmp * Math.exp(-FEEL.landDecay * tl) * Math.sin(2 * Math.PI * FEEL.landFreq * tl);

      const chatter = state.airborne ? 0 : speedK;
      const vib = fx * FEEL.vibMax * chatter;
      camera.position.copy(position);
      camera.position.x += vib * (0.6 * Math.sin(time * 71) + 0.4 * Math.sin(time * 113 + 0.7));
      camera.position.y += vib * (0.5 * Math.sin(time * 89 + 1.3) + 0.5 * Math.sin(time * 137 + 2.1)) + dip;
      desired.copy(target);
      desired.y += dip * FEEL.landPitch; // the aim dips less than the eye: a slight nod down
      camera.lookAt(desired);
      // Roll into the edge while charging, plus a hair of chatter roll.
      const roll = fx * (-FEEL.chargeRoll * charge * lean + FEEL.vibRoll * chatter * Math.sin(time * 97)); // +roll banks left
      camera.rotateZ(clamp(roll, -FEEL.rollCap, FEEL.rollCap));

      // Screen space: vignette always, blur from speed and big airs.
      postFx.vignette.value = fx * FEEL.vignette;
      postFx.blur.value = Math.min(FEEL.blurCap, fx * (FEEL.blurSpeed * smoothstep(speed, FEEL.blurSpeedMin, FEEL.fovSpeed) + FEEL.blurAir * air));
    },
  };
}
