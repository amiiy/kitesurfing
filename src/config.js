// All gameplay tuning in one place.
// World convention: wind blows toward -Z; the camera sits upwind (+Z) looking downwind.

export const WIND = {
  strength: 1.5, // base multiplier on kite speed and pull
  gustAmount: 0, // +/- fraction the wind swings around its base strength (0: steady, predictable)
  knots: 18, // shown on the HUD at strength 1
};

export const KITE = {
  lineLength: 15, // m
  // A high-power big-air kite (Core Nexus style): pulls hard parked at the window edge.
  edge: 1.35, // rad from the window centre (straight downwind) to its edge, where the wind stops driving the kite
  park: Math.PI / 3, // rad clock angle on the edge the kite is parked at: 60° from 12 o'clock = 10/2 o'clock
  turnRadius: 4, // m; tightest turn, at full steering: turn rate = airspeed / turnRadius
  rollResponse: 14, // 1/s; how fast the turn rate follows the steering as the kite rolls into a turn
  edgeSpeed: 12, // m/s of airspeed at the window edge (per unit of wind strength)
  poweredSpeed: 8, // extra m/s dead downwind
  diveBoost: 0.3, // target speed is this much higher flying straight down, lower flying straight up
  speedResponse: 1.5, // 1/s; how fast the kite's speed follows its target
  edgeApproach: 3, // 1/s; flown out to the edge the kite closes the gap at this rate: it eases on, never past
  edgePower: 0.95, // line tension at the edge, as a share of dead downwind; power = tension · cos(el)
  motionPower: 0.08, // extra power per edge airspeed of kite motion across the window (parked: none)
  maxPower: 1.3,
  powerResponse: 2.9, // 1/s; power eases toward its target (line tension), ~0.35 s time constant
  climbLift: 0.3, // extra kite.lift per rad/s the kite climbs
  minElevation: 0.1, // rad; just above the water
  recoverRate: 4, // how fast the kite turns back upward at the water
  maxPull: 12, // m/s² at full power, rider stationary
  slackPerSpeed: 0.4, // pull lost per m/s of rider speed toward the kite
  airPullFactor: 0.3, // share of horizontal pull applied while airborne
  maxLift: 6.5, // m/s² of upward lift with the kite overhead
  crashElevation: 0.15, // rad; at or below this the kite can hit the water...
  crashWindow: 0.4, // ...and crashes if its window position (cos az · cos el) is below this
  relaunchRate: 0.5, // rad/s the kite climbs while relaunching
  relaunchElevation: 0.45, // rad; kite is flying again above this
};

// Kite autopilot (src/sim/autopilot.js): parks the kite, sends it to 12 o'clock for jumps.
export const AUTOPILOT = {
  aimTime: 0.4, // s of flight past the edge the kite is aimed at, so it flies onto the edge and parks nose-out
  turnGain: 8, // 1/s of turn rate asked per rad of heading error...
  turnDamping: 0.51, // ...less this share of the turn already under way: critically damped with KITE.rollResponse
  returnSpeed: 6, // m/s of falling after a jump's apex at which the kite is back at the park spot
  sendCharge: 0.5, // jump charge at which the kite's target has slid from the park spot up to 12 o'clock
  lowElevation: 0.8, // rad; below this the kite always turns through up, never down toward the water
};

export const BOARD = {
  course: 90, // degrees off the wind, riding right: a beam reach (fixed, no steering)
  edgePoint: 0.25, // rad the board carves higher upwind at full edge
  edgeResponse: 6, // how quickly edge pressure follows the button
  linearDrag: 0.35,
  quadraticDrag: 0.045,
  waveGravity: 0.35, // share of gravity along the wave slope: climbing a face slows you, descending speeds you up
  // Sideways resistance: a loose board skids downwind, an edged board bites.
  baseGrip: 1.0,
  edgeGrip: 8,
  speedGrip: 0.1,
};

export const JUMP = {
  chargeRate: 1, // charge per s while held: full after 1 s
  sweetMin: 0.75, // release with charge in sweetMin..sweetMax for a perfect pop...
  sweetMax: 0.9,
  earlyQuality: 0.6, // ...earlier pops ramp up to this share of it...
  overloadQuality: 0.35, // ...and later (overloaded) pops get this share
  minSpeed: 2, // m/s needed to pop (fastest speed seen while charging)
  basePop: 1.5, // m/s
  speedPop: 0.22, // m/s of pop per m/s of board speed, at full quality
  kitePop: 5, // m/s of pop from the kite, at full quality
  gravity: 9.8,
};

export const CAMERA = {
  fov: 60,
  offset: [0, 3.2, 17], // relative to the rider, upwind and above
  lookTowardKite: 0.35, // 0 = look at rider, 1 = look at kite
};

export const POSE = {
  smoothRate: 7.7, // 1/s; body animation smoothing
  rideHeight: 0.05, // board sits slightly above the surface
};

export const FEEL = {
  // Camera effects (src/render/followCamera.js, src/render/postFx.js). View only; never touches the sim.
  cameraFx: 1, // 0..1 master scale for every camera/screen effect below (motion-sickness knob)
  cameraFollow: 5, // 1/s; camera position/aim smoothing rate
  lookAhead: 0.25, // s of horizontal velocity the camera aims ahead of the rider
  fovMax: 72, // degrees at fovSpeed; CAMERA.fov at or below fovSpeedMin
  fovSpeedMin: 4, // m/s where the speed push (FOV, chatter) starts...
  fovSpeed: 14, // ...and m/s (50 km/h) where it's full; cruise at 35 km/h gets ~2/3
  fovRate: 2, // 1/s; FOV smoothing rate
  fovCap: 80, // degrees; hard ceiling with every effect stacked
  vibMax: 0.02, // m of high-frequency water chatter at full speed (none in the air)
  vibRoll: 0.002, // rad of chatter roll at full speed
  chargeCamRate: 6, // 1/s; how fast the charge lean follows the load
  chargeDrop: 0.5, // m the camera lowers at full charge
  chargeRoll: 0.05, // rad the camera rolls toward the rider's lean at full charge
  chargeZoom: 4, // degrees of FOV zoom-in, building up to JUMP.sweetMin
  popFovKick: 6, // degrees of FOV kick on takeoff...
  popFovDecay: 3, // ...decaying at this rate (1/s)
  airRise: 0.8, // m the camera lifts above its offset in a big air...
  airRiseHeight: 4, // ...reached at this height above takeoff
  airRate: 3, // 1/s; smoothing of the airborne lift
  airLag: 0.4, // share of the vertical follow rate kept in a big air (camera trails the rider up and down)
  landDip: 0.5, // m amplitude of the landing dip-and-recoil on the hardest landing...
  landImpact: 10, // ...m/s landing speed that gives it
  landFreq: 1.6, // Hz of the dip/recoil spring
  landDecay: 4, // 1/s; spring damping
  landPitch: 0.5, // share of the dip applied to the aim point (<1 nods the view down)
  rollCap: 0.07, // rad; hard ceiling on total roll
  vignette: 0.35, // edge darkening at the corners
  blurSpeed: 0.04, // radial blur at fovSpeed (fraction of the centre-to-corner distance smeared)...
  blurSpeedMin: 8, // ...starting from this speed (m/s)
  blurAir: 0.04, // radial blur in a big air
  blurCap: 0.06, // hard ceiling on radial blur
  slowMoScale: 0.5, // sim speed at the apex of a big jump
  slowMoHeight: 3, // m above takeoff before slow-mo kicks in (fades in over the metre below)
  slowMoApexSpeed: 3, // m/s of vertical speed around the apex where slow-mo is active
  gradeMinHeight: 0.5, // m; smaller hops aren't graded
  cleanAngle: 25, // degrees between board axis and travel for a clean landing
  sketchyAngle: 45, // beyond this the landing is a wipeout
  landingShowMs: 1600, // how long the HUD shows the landing grade
};
