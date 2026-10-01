import { MathUtils } from 'three';
import { FEEL } from './config.js';

// Game feel that sits between sim and render: apex slow-mo and landing grades.

// { grade: 'clean' | 'sketchy' | 'crash', angle (deg), height (m), time (performance.now ms) }
export let lastLanding = null;
let wasAirborne = false;

// Called once per frame with the sim state, before stepping. Reads vel.y rather than
// integrating anything, so the slow-mo eases in and out with the jump arc by itself.
export function timeScale(state) {
  if (wasAirborne && !state.airborne && state.airHeight >= FEEL.gradeMinHeight) gradeLanding(state);
  wasAirborne = state.airborne;
  if (!state.airborne) return 1;

  const height = state.pos.y - state.takeoffY;
  const tall = MathUtils.smoothstep(height, FEEL.slowMoHeight - 1, FEEL.slowMoHeight);
  const apex = 1 - MathUtils.smoothstep(Math.abs(state.vel.y), 0, FEEL.slowMoApexSpeed);
  return 1 - (1 - FEEL.slowMoScale) * tall * apex;
}

// Twin-tip board: landing switch is as good as landing forward, so grade against the board axis.
function gradeLanding({ forward, vel, airHeight }) {
  const speed = Math.hypot(vel.x, vel.z);
  const along = speed > 0.5 ? Math.abs(forward.x * vel.x + forward.z * vel.z) / speed : 1;
  const angle = MathUtils.radToDeg(Math.acos(Math.min(1, along)));
  const grade = angle < FEEL.cleanAngle ? 'clean' : angle < FEEL.sketchyAngle ? 'sketchy' : 'crash';
  lastLanding = { grade, angle, height: airHeight, time: performance.now() };
}
