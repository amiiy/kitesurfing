import { MathUtils, Vector3 } from 'three';
import { BOARD, JUMP, KITE, WIND } from '../config.js';
import { rampAt, waveHeight, waveRise, waveSlope } from '../waves.js';
import { windAt } from './wind.js';

// Pure simulation: no scene objects. Renderers and effects read `state` after each step.

// Board yaw on the fixed course (riding right); 0 would be straight downwind.
const KNOT = 0.5144; // m/s
const COURSE = -(Math.PI - MathUtils.degToRad(BOARD.course));
const BASE_WIND = WIND.knots * WIND.strength * KNOT; // m/s at gust 1

export function createState() {
  return {
    pos: new Vector3(),
    vel: new Vector3(), // m/s; vertical too: the board rides the water on a spring, and flies
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
    gust: 1, // current wind multiplier (1 = base strength): the level's wind plan (src/sim/wind.js)
    plane: 0, // 0..1 how far the board is up on the plane, by speed (BOARD.planeSpeed)
    speedLevel: 0, // set by the game rules: the Perfect combo, raising top speed (BOARD.comboSpeed)
    // Set by the game rules (src/game/run.js); renderers show them.
    trick: null, // 'grab' | 'spin' while airborne
    loop: null, // kiteloop this jump: { dir, turned (rad), done, stalled, grade, mega }; the autopilot yields while it runs
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

// Board nose and right-hand vectors for the current yaw.
export function orientBoard(s) {
  s.forward.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  s.side.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
}

export function step(s, controls, dt, t) {
  s.landImpact = 0;
  s.jumpResult = null;
  s.gust = windAt(t);
  const wind = BASE_WIND * s.gust; // m/s
  const looping = s.loop && !s.loop.done && !s.loop.stalled;
  kiteDirection(s.kite, s.kiteDir);
  // Wind along the lines, less the rider's speed toward the kite: riding at it slackens them.
  const along = Math.max(0, -wind * s.kiteDir.z - s.vel.dot(s.kiteDir));
  // The kite flies in the wind relative to the rider: drifting downwind takes some off it, edging
  // upwind adds some. (Not their speed across the wind: this window is the fixed beam-reach course's.)
  stepKite(s.kite, controls, Math.max(0, wind + s.vel.z), along, dt);
  if (looping) {
    s.loop.turned += Math.abs(s.kite.turn) * dt;
    s.loop.done = s.loop.turned >= 2 * Math.PI;
  }

  kiteDirection(s.kite, s.kiteDir);
  s.pullDir.set(s.kiteDir.x, 0, s.kiteDir.z).normalize();
  const pull = KITE.tension * s.kite.power; // m/s² along the lines, on the water and in the air

  // The board holds a fixed course; holding the button digs the edge in, which carves it higher upwind.
  // After a downwind landing it carves back up onto the course at BOARD.carveRate.
  // In the air, coming down, the rider points the board where they're travelling: landing downwind.
  if (!s.airborne) {
    s.edge = MathUtils.lerp(s.edge, Number(controls.jump), 1 - Math.exp(-BOARD.edgeResponse * dt));
    s.yaw += (COURSE - BOARD.edgePoint * s.edge - s.yaw) * (1 - Math.exp(-BOARD.carveRate * dt));
  } else if (s.vel.y < 0 && Math.hypot(s.vel.x, s.vel.z) > 1) {
    const travel = Math.atan2(-s.vel.x, -s.vel.z); // yaw convention: 0 = straight downwind
    s.yaw += Math.atan2(Math.sin(travel - s.yaw), Math.cos(travel - s.yaw)) * (1 - Math.exp(-JUMP.landTurnRate * dt));
  }
  orientBoard(s);

  const waterY = waveHeight(s.pos.x, s.pos.z, t);
  waveSlope(s.pos.x, s.pos.z, t, s.slope);
  if (s.airborne) stepAir(s, pull, wind, waterY, dt, t);
  else stepWater(s, pull, controls.jump, waterY, dt, t);
}

// Unit vector `theta` rad from the window centre (straight downwind) at clock angle `clock`
// (0 = 12 o'clock, +right, as the rider sees it facing downwind). The window edge is theta = KITE.edge.
export function windowPoint(theta, clock, out) {
  return out.set(Math.sin(theta) * Math.sin(clock), Math.sin(theta) * Math.cos(clock), -Math.cos(theta));
}

// Waterstart: on the window edge near 12 o'clock with little pull; the autopilot dives it down
// to the park spot at 2 o'clock (the rider starts riding right).
function parkedKite() {
  const p = windowPoint(KITE.edge, KITE.startClock, new Vector3());
  const az = Math.atan2(p.x, -p.z);
  const el = Math.asin(p.y);
  return {
    az, // azimuth in the wind window: 0 = downwind, +right
    el, // elevation: 0 = water, PI/2 = zenith
    heading: Math.atan2(Math.sin(az), Math.cos(az) * Math.sin(el)), // direction the nose points on the window: 0 = up, +right
    turn: 0, // rad/s the heading is turning; lags the steering as the kite rolls into a turn
    speed: KITE.liftDrag * BASE_WIND * Math.cos(KITE.edge), // airspeed along the heading, m/s; lags behind its target
    power: 0, // 0..KITE.maxPower: line tension; 1 = parked on the edge in the base wind
    crashed: false, // lying on the water until it relaunches itself
  };
}

// A big-air kite on 15 m lines, flying nose-first: steering rolls it into a turn of fixed radius.
// Crosswind law: the wind blowing along the lines (wind · cosθ, θ from the window centre) drives it
// across them at KITE.liftDrag times that, fastest deep downwind. The wind also pushes it along the
// window toward the centre (wind · sinθ): flown nose-out the two cancel at the edge (tanθ = L/D), so
// it parks there with steady pull. `along`: m/s of apparent wind along the lines at the rider.
function stepKite(kite, controls, wind, along, dt) {
  if (kite.crashed) return stepCrashed(kite, dt);
  const { az, el } = kite;
  const L = KITE.lineLength;
  const cosTheta = Math.cos(az) * Math.cos(el);
  const theta = Math.acos(cosTheta); // angle from the window centre

  kite.turn += ((controls.kiteSteer * kite.speed) / KITE.turnRadius - kite.turn) * (1 - Math.exp(-KITE.rollResponse * dt));
  kite.heading += kite.turn * dt;
  const target = KITE.liftDrag * wind * Math.max(0, cosTheta) * (1 - KITE.diveBoost * Math.cos(kite.heading));
  kite.speed += (target - kite.speed) * (1 - Math.exp(-KITE.speedResponse * dt));

  // Velocity on the window (up, right): airspeed along the heading plus the wind's push toward the centre.
  let up = kite.speed * Math.cos(kite.heading) - wind * Math.cos(az) * Math.sin(el);
  let right = kite.speed * Math.sin(kite.heading) - wind * Math.sin(az);
  // Speed lags, so a fast kite can carry past the edge: there it luffs and eases back at KITE.edgeReturn.
  const over = theta - KITE.edge;
  if (over > 0) {
    const outUp = (Math.cos(az) * Math.sin(el)) / Math.sin(theta); // unit vector away from the window centre
    const outRight = Math.sin(az) / Math.sin(theta);
    const excess = up * outUp + right * outRight + KITE.edgeReturn * over * L;
    if (excess > 0) {
      up -= excess * outUp;
      right -= excess * outRight;
    }
  }
  kite.el += (up * dt) / L;
  kite.az += (right * dt) / (L * Math.cos(el));
  kite.heading += (right * Math.tan(el) * dt) / L; // flying straight over a sphere follows a great circle

  // Line tension ∝ apparent wind²: the wind along the lines and the kite's airspeed across them.
  // Parked on the edge the kite sees the whole wind (power 1 in the base wind); diving through the
  // window it pulls several times that, gusts with their square. Past maxPower the rider sheets out.
  const targetPower = Math.min(KITE.maxPower, (along * along + kite.speed * kite.speed) / BASE_WIND ** 2);
  // Line tension doesn't jump with every swing of the kite: power eases toward its target.
  kite.power += (targetPower - kite.power) * (1 - Math.exp(-KITE.powerResponse * dt));

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
// and points higher: less downwind drift and more ground upwind, and the upwind speed loads the kite.
// Vertically the water holds it up like a spring-damper, far stiffer planing than wallowing; the
// kite's lift takes weight off it, and off a crest that falls away faster than that it goes light.
function stepWater(s, pull, jump, waterY, dt, t) {
  let vf = s.vel.dot(s.forward);
  let vl = s.vel.dot(s.side);
  const ramp = rampAt(s.pos.x, s.pos.z);
  const surfaceRise = waveRise(s.pos.x, s.pos.z, t, s.vel.x, s.vel.z) + s.vel.x * ramp.x + s.vel.z * ramp.z; // m/s
  s.plane = MathUtils.smoothstep(Math.abs(vf), BOARD.planeSpeed[0], BOARD.planeSpeed[1]);
  const stiffness = MathUtils.lerp(BOARD.floatStiffness, BOARD.planeStiffness, s.plane);
  const support = Math.max(0, stiffness * (waterY - s.pos.y) + BOARD.supportDamping * (surfaceRise - s.vel.y)); // m/s², water can't pull down
  s.vel.y += (support + pull * s.kiteDir.y - JUMP.gravity) * dt;

  // The water pushes square to its surface: on a face the support tips back (slows you climbing it,
  // speeds you down the back) and sideways.
  const pullF = pull * s.kiteDir.dot(s.forward) - support * (s.slope.x * s.forward.x + s.slope.z * s.forward.z);
  const pullL = pull * s.kiteDir.dot(s.side) - support * (s.slope.x * s.side.x + s.slope.z * s.side.z);

  // Off the plane (below BOARD.planeSpeed) the board ploughs: extra drag, fading out as it gets up.
  // A Perfect combo cuts the drag so top speed climbs.
  const plough = BOARD.ploughDrag * (1 - s.plane) ** 2;
  const quad = BOARD.quadraticDrag / (1 + BOARD.comboSpeed * Math.min(s.speedLevel, BOARD.comboMax));
  vf += (pullF - (BOARD.linearDrag + plough) * vf - quad * vf * Math.abs(vf)) * dt;
  const grip = BOARD.baseGrip + BOARD.edgeGrip * s.edge + BOARD.speedGrip * Math.abs(vf);
  vl = (vl + pullL * dt) / (1 + grip * dt); // implicit: stable for any grip

  s.vel.set(s.forward.x * vf + s.side.x * vl, s.vel.y, s.forward.z * vf + s.side.z * vl);
  s.pos.addScaledVector(s.vel, dt);

  // Carried clear of the water by the kite alone (a gust lofting the rider), no pop: airborne, no jump.
  // Hops off chop don't count: the water catches the board again.
  if (s.pos.y - waterY > JUMP.liftOff && pull * s.kiteDir.y > JUMP.gravity) {
    s.airborne = true;
    s.takeoffY = waterY;
    s.airHeight = 0;
    s.charge = 0;
    s.chargeSpeed = 0;
    return;
  }
  updateJumpCharge(s, jump, Math.hypot(vf, vl), waterY, dt, t);
}

// Hold to load the edge, release to pop. The charge rises at a steady rate: letting go inside the
// sweet spot pops a perfect jump, earlier is weaker, later overloads. Pop grows with board speed.
function updateJumpCharge(s, jumpHeld, speed, waterY, dt, t) {
  if (jumpHeld) {
    s.charge = Math.min(1, s.charge + JUMP.chargeRate * dt);
    s.chargeSpeed = Math.max(s.chargeSpeed, speed);
    return;
  }
  if (s.charge === 0) return;

  if (s.chargeSpeed > JUMP.minSpeed) {
    const [result, quality] = releaseQuality(s.charge);
    s.jumpResult = result;
    // Popping on a rising face adds the rate it lifts the board: kicker ramps (static: dh/dt = v·∇h)
    // fully, the moving swell by JUMP.waveKick. Steepest part of a face kicks most; backs and troughs don't.
    const ramp = rampAt(s.pos.x, s.pos.z);
    const kick = Math.max(0, s.vel.x * ramp.x + s.vel.z * ramp.z) + JUMP.waveKick * Math.max(0, waveRise(s.pos.x, s.pos.z, t, s.vel.x, s.vel.z));
    s.vel.y = JUMP.basePop + quality * (JUMP.speedPop * speed + JUMP.kitePop * s.kite.power) + kick;
    // The kite sent to 12 also drags the rider downwind (-Z) off the lip: a little on a well-timed
    // send, more on an early one (kite still low, pulling forward), a yank when it's overloaded (sent too far).
    s.vel.z -= JUMP.downwindKick[result];
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

function stepAir(s, pull, wind, waterY, dt, t) {
  s.vel.addScaledVector(s.kiteDir, pull * dt);
  s.vel.y -= JUMP.gravity * dt;
  // Body drag in the wind (blowing toward -Z): carries the rider downwind and bleeds crosswind speed.
  const rx = -s.vel.x, ry = -s.vel.y, rz = -wind - s.vel.z; // air relative to the rider
  const drag = JUMP.airDrag * Math.hypot(rx, ry, rz) * dt;
  s.vel.x += drag * rx;
  s.vel.y += drag * ry;
  s.vel.z += drag * rz;
  s.pos.addScaledVector(s.vel, dt);
  s.airHeight = Math.max(s.airHeight, s.pos.y - s.takeoffY);

  if (s.pos.y <= waterY && s.vel.y < 0) {
    s.airborne = false;
    s.pos.y = waterY;
    // Impact is the speed the water comes up at the board: a wave's back falling away softens it, a
    // face rising into it hardens it. Past JUMP.softLanding the hit scrubs off board speed.
    const ramp = rampAt(s.pos.x, s.pos.z);
    const rise = s.vel.x * ramp.x + s.vel.z * ramp.z + waveRise(s.pos.x, s.pos.z, t, s.vel.x, s.vel.z);
    s.landImpact = Math.max(0, rise - s.vel.y);
    const keep = 1 / (1 + JUMP.landLoss * Math.max(0, s.landImpact - JUMP.softLanding));
    s.vel.x *= keep;
    s.vel.z *= keep;
    s.vel.y = rise; // the board rides the surface from here
    s.bestJump = Math.max(s.bestJump, s.airHeight);
  }
}
