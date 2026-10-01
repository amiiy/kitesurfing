import { MathUtils, Vector3 } from 'three';
import { BOARD, JUMP, KITE, WIND } from '../config.js';
import { rampAt, waveHeight, waveSlope } from '../waves.js';

// Pure simulation: no scene objects. Renderers and effects read `state` after each step.

// Board yaw on the fixed course (riding right); 0 would be straight downwind.
const COURSE = -(Math.PI - MathUtils.degToRad(BOARD.course));

export function createState() {
  return {
    pos: new Vector3(),
    vel: new Vector3(), // includes vertical speed while airborne
    yaw: COURSE, // board heading; 0 = straight downwind
    edge: 0, // 0..1 heel-edge pressure; 1 while the button is held
    charge: 0, // 0..1 jump load, rising at JUMP.chargeRate while the button is held
    chargeSpeed: 0, // fastest board speed seen while charging; decides whether the pop fires
    jumpResult: null, // 'perfect' | 'early' | 'overload' | 'slow' on the step the button is released, null otherwise
    airborne: false,
    takeoffY: 0,
    airHeight: 0,
    bestJump: 0,
    landImpact: 0, // vertical speed on the frame of touchdown, 0 otherwise
    gust: 1, // current wind multiplier (1 = base strength)
    // Set by the game rules (src/game/run.js); renderers show them.
    trick: null, // 'grab' | 'spin' while airborne
    trickSpin: 0, // rad of extra rider/board yaw from a 360 in progress (0..2π per spin)
    wipeout: 0, // s left of a crash: input ignored, rider down

    kite: parkedKite(),

    // Derived each step
    forward: new Vector3(0, 0, -1), // board nose direction
    side: new Vector3(1, 0, 0), // board's right
    kiteDir: new Vector3(), // unit vector rider -> kite
    pullDir: new Vector3(), // horizontal part of kiteDir, normalised
    slope: { x: 0, z: 0 }, // wave surface gradient under the rider
  };
}

// Unit vector from rider to a kite at (az, el) on the wind window.
export function kiteDirection({ az, el }, out) {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// Wind strength multiplier: two slow sines give irregular gusts and lulls.
export function gustAt(t) {
  return 1 + WIND.gustAmount * (0.65 * Math.sin(t * 0.35) + 0.35 * Math.sin(t * 0.93 + 1.7));
}

// Board nose and right-hand vectors for the current yaw.
export function orientBoard(s) {
  s.forward.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  s.side.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
}

export function step(s, controls, dt, t) {
  s.landImpact = 0;
  s.jumpResult = null;
  s.gust = gustAt(t);
  const wind = WIND.strength * s.gust;
  stepKite(s.kite, controls, wind, dt);

  kiteDirection(s.kite, s.kiteDir);
  s.pullDir.set(s.kiteDir.x, 0, s.kiteDir.z).normalize();
  // Riding toward the kite slackens the lines; riding away from it loads them up.
  const pull = Math.max(0, KITE.maxPull * wind * s.kite.power - KITE.slackPerSpeed * s.vel.dot(s.pullDir));

  // The board holds a fixed course; holding the button digs the edge in, which carves it higher upwind.
  if (!s.airborne) {
    s.edge = MathUtils.lerp(s.edge, Number(controls.jump), 1 - Math.exp(-BOARD.edgeResponse * dt));
    s.yaw = COURSE - BOARD.edgePoint * s.edge;
  }
  orientBoard(s);

  const waterY = waveHeight(s.pos.x, s.pos.z, t);
  waveSlope(s.pos.x, s.pos.z, t, s.slope);
  if (s.airborne) stepAir(s, pull, waterY, dt);
  else stepWater(s, pull, controls.jump, waterY, dt);
}

// Unit vector `theta` rad from the window centre (straight downwind) at clock angle `clock`
// (0 = 12 o'clock, +right, as the rider sees it facing downwind). The window edge is theta = KITE.edge.
export function windowPoint(theta, clock, out) {
  return out.set(Math.sin(theta) * Math.sin(clock), Math.sin(theta) * Math.cos(clock), -Math.cos(theta));
}

// Parked on the window edge at 2 o'clock (the rider starts riding right), nose out into the wind.
function parkedKite() {
  const p = windowPoint(KITE.edge, KITE.park, new Vector3());
  const az = Math.atan2(p.x, -p.z);
  const el = Math.asin(p.y);
  return {
    az, // azimuth in the wind window: 0 = downwind, +right
    el, // elevation: 0 = water, PI/2 = zenith
    heading: Math.atan2(Math.sin(az), Math.cos(az) * Math.sin(el)), // direction the nose points on the window: 0 = up, +right
    turn: 0, // rad/s the heading is turning; lags the steering as the kite rolls into a turn
    speed: WIND.strength * KITE.edgeSpeed, // airspeed along the heading, m/s; lags behind its target
    power: 0, // 0..KITE.maxPower: horizontal pull, set by where the kite sits in the window
    lift: 0, // upward pull on the rider: elevation plus the kite's climb
    crashed: false, // lying on the water until it relaunches itself
  };
}

// A big-air kite on 15 m lines. It flies nose-first: steering rolls it into a turn of fixed radius,
// the wind drives it fastest deep in the window and barely at the edge, and flown out to the edge it
// slows as the wind stops driving it, settling there nose-out: parked, with steady pull.
function stepKite(kite, controls, wind, dt) {
  if (kite.crashed) return stepCrashed(kite, dt);
  const { az, el } = kite;
  const L = KITE.lineLength;
  const theta = Math.acos(Math.cos(az) * Math.cos(el)); // angle from the window centre
  const depth = Math.max(0, KITE.edge - theta) / KITE.edge; // 1 dead downwind, 0 on the edge

  kite.turn += ((controls.kiteSteer * kite.speed) / KITE.turnRadius - kite.turn) * (1 - Math.exp(-KITE.rollResponse * dt));
  kite.heading += kite.turn * dt;
  const target = wind * (KITE.edgeSpeed + KITE.poweredSpeed * depth) * (1 - KITE.diveBoost * Math.cos(kite.heading));
  kite.speed += (target - kite.speed) * (1 - Math.exp(-KITE.speedResponse * dt));

  // Velocity on the window (up, right). The part heading out of the window is capped to close the
  // gap to the edge at KITE.edgeApproach, so the kite eases onto the edge (and back if it drifts past).
  let up = kite.speed * Math.cos(kite.heading);
  let right = kite.speed * Math.sin(kite.heading);
  const sinTheta = Math.max(Math.sin(theta), 1e-6);
  const outUp = (Math.cos(az) * Math.sin(el)) / sinTheta; // unit vector away from the window centre
  const outRight = Math.sin(az) / sinTheta;
  const excess = up * outUp + right * outRight - KITE.edgeApproach * (KITE.edge - theta) * L;
  if (excess > 0) {
    up -= excess * outUp;
    right -= excess * outRight;
  }
  kite.el += (up * dt) / L;
  kite.az += (right * dt) / (L * Math.cos(el));
  kite.heading += (right * Math.tan(el) * dt) / L; // flying straight over a sphere follows a great circle

  // Pull comes from where the kite sits: strong anywhere low (a parked kite pulls hard), strongest
  // deep downwind, little overhead where the line points up. Moving adds only a little.
  const motion = Math.hypot(up, right) / (wind * KITE.edgeSpeed);
  const targetPower = Math.min(
    KITE.maxPower,
    Math.cos(kite.el) * (KITE.edgePower + (1 - KITE.edgePower) * depth) + KITE.motionPower * motion
  );
  // Line tension doesn't jump with every swing of the kite: power eases toward its target.
  kite.power += (targetPower - kite.power) * (1 - Math.exp(-KITE.powerResponse * dt));
  kite.lift = Math.sin(kite.el) + (KITE.climbLift * Math.max(0, up)) / L;

  // The water: the kite can't fly into it and noses back up.
  if (kite.el < KITE.minElevation) {
    kite.el = KITE.minElevation;
    const noseUp = Math.round(kite.heading / (2 * Math.PI)) * 2 * Math.PI; // nearest full turn, so loops don't unwind
    kite.heading = MathUtils.lerp(kite.heading, noseUp, KITE.recoverRate * dt);
  }
  // Too low near the edge of the window: the canopy drops into the water.
  if (kite.el <= KITE.crashElevation && Math.cos(kite.az) * Math.cos(kite.el) < KITE.crashWindow) {
    kite.crashed = true;
    kite.power = 0;
    kite.lift = 0;
    kite.el = 0;
  }
}

// A crashed kite relaunches itself: it drags up the edge of the window and back into the air.
function stepCrashed(kite, dt) {
  kite.power = 0;
  kite.speed = 0;
  kite.turn = 0;
  kite.el += KITE.relaunchRate * dt;
  // Drifts out to the edge (crashes only happen near it), so it relaunches with little power.
  kite.az = MathUtils.clamp(kite.az * Math.exp(dt), -KITE.edge, KITE.edge);
  if (kite.el >= KITE.relaunchElevation) {
    kite.crashed = false;
    kite.heading = kite.az >= 0 ? 0.6 : -0.6; // up and outward, not across the power zone
  }
}

// On the water the board acts like a keel: it slides freely along its length but resists
// sideways motion, so the pull component along the board drives it forward. Edging bites harder
// and points higher: less downwind drift and more ground upwind, for a little less speed.
function stepWater(s, pull, jump, waterY, dt) {
  let vf = s.vel.dot(s.forward);
  let vl = s.vel.dot(s.side);
  const pullF = pull * s.pullDir.dot(s.forward);
  const pullL = pull * s.pullDir.dot(s.side);
  // Gravity along the wave face: slows you climbing it, speeds you down the back.
  const waveF = -BOARD.waveGravity * JUMP.gravity * (s.slope.x * s.forward.x + s.slope.z * s.forward.z);

  vf += (pullF + waveF - BOARD.linearDrag * vf - BOARD.quadraticDrag * vf * Math.abs(vf)) * dt;
  const grip = BOARD.baseGrip + BOARD.edgeGrip * s.edge + BOARD.speedGrip * Math.abs(vf);
  vl = (vl + pullL * dt) / (1 + grip * dt); // implicit: stable for any grip

  s.vel.copy(s.forward).multiplyScalar(vf).addScaledVector(s.side, vl);
  s.pos.addScaledVector(s.vel, dt);
  s.pos.y = waterY;

  updateJumpCharge(s, jump, Math.hypot(vf, vl), waterY, dt);
}

// Hold to load the edge, release to pop. The charge rises at a steady rate: letting go inside the
// sweet spot pops a perfect jump, earlier is weaker, later overloads. Pop grows with board speed.
function updateJumpCharge(s, jumpHeld, speed, waterY, dt) {
  if (jumpHeld) {
    s.charge = Math.min(1, s.charge + JUMP.chargeRate * dt);
    s.chargeSpeed = Math.max(s.chargeSpeed, speed);
    return;
  }
  if (s.charge === 0) return;

  if (s.chargeSpeed > JUMP.minSpeed) {
    const [result, quality] = releaseQuality(s.charge);
    s.jumpResult = result;
    // Popping on a kicker's face adds the rate the face lifts the board (static ramp: dh/dt = v·∇h).
    const ramp = rampAt(s.pos.x, s.pos.z);
    s.vel.y = JUMP.basePop + quality * (JUMP.speedPop * speed + JUMP.kitePop) + Math.max(0, s.vel.x * ramp.x + s.vel.z * ramp.z);
    s.airborne = true;
    s.takeoffY = waterY;
    s.airHeight = 0;
  } else {
    s.jumpResult = 'slow';
  }
  s.charge = 0;
  s.chargeSpeed = 0;
}

// [result, pop quality 0..1] for a release at `charge`.
function releaseQuality(charge) {
  if (charge < JUMP.sweetMin) return ['early', (JUMP.earlyQuality * charge) / JUMP.sweetMin];
  if (charge <= JUMP.sweetMax) return ['perfect', 1];
  return ['overload', JUMP.overloadQuality];
}

function stepAir(s, pull, waterY, dt) {
  s.vel.addScaledVector(s.pullDir, pull * KITE.airPullFactor * dt);
  const lift = KITE.maxLift * s.kite.lift; // a kite sent overhead holds the rider up
  s.vel.y += (lift - JUMP.gravity) * dt;
  s.pos.addScaledVector(s.vel, dt);
  s.airHeight = Math.max(s.airHeight, s.pos.y - s.takeoffY);

  if (s.pos.y <= waterY && s.vel.y < 0) {
    s.airborne = false;
    s.pos.y = waterY;
    s.landImpact = -s.vel.y;
    s.vel.y = 0;
    s.bestJump = Math.max(s.bestJump, s.airHeight);
  }
}
