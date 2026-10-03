// All gameplay tuning in one place.
// World convention: wind blows toward -Z; the camera sits upwind (+Z) looking downwind.

export const WIND = {
  strength: 1.5, // base multiplier on kite speed and pull
  knots: 18, // shown on the HUD at strength 1
};

// Swell (src/waves.js). Wind is picked on the title screen.
export const SEA = {
  // rad the swell travels off the wind: onshore runs with it, side-onshore comes at the rider (riding right).
  wind: { onshore: 0, sideOnshore: -Math.PI / 4 },
  // m of open water upwind: a fetch-limited (JONSWAP) sea, peaking at ~46 m waves, Hs ~1.9 m in 27 kn
  fetch: 47000,
};

export const KITE = {
  lineLength: 15, // m
  // A high-power big-air kite (Core Nexus style): pulls hard parked at the window edge.
  edge: 1.35, // rad from the window centre (straight downwind) to its edge, ≈ atan(liftDrag): the kite parks there
  startClock: 0.15, // rad clock angle a run starts the kite at: near 12 o'clock, little pull (waterstart)
  park: Math.PI / 3, // rad clock angle on the edge the kite is parked at: 60° from 12 o'clock = 10/2 o'clock
  turnRadius: 4, // m; tightest turn, at full steering: turn rate = airspeed / turnRadius
  rollResponse: 14, // 1/s; how fast the turn rate follows the steering as the kite rolls into a turn
  liftDrag: 4.5, // L/D: crosswind the kite flies at this times the wind blowing along its lines; edge = atan(L/D)
  diveBoost: 0.3, // target speed is this much higher flying straight down, lower flying straight up
  speedResponse: 3, // 1/s; how fast the kite's speed follows its target
  edgeReturn: 3, // 1/s; a kite carried past the edge luffs and eases back at this rate
  tension: 7, // m/s² of line pull at power 1: parked on the edge in the base wind, rider still
  maxPower: 2, // power the rider sheets out at: a dive or loop pulls up to this
  powerResponse: 2.9, // 1/s; power eases toward its target (line tension), ~0.35 s time constant
  minElevation: 0.1, // rad; just above the water
  recoverRate: 4, // how fast the kite turns back upward at the water
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
  carveRate: 1.5, // 1/s the board turns back onto the course after a downwind landing
  edgeResponse: 6, // how quickly edge pressure follows the button
  linearDrag: 0.15,
  quadraticDrag: 0.037,
  ploughDrag: 1.5, // 1/s extra drag off the plane, easing out (squared) as the board gets up...
  planeSpeed: [2.5, 4.5], // ...from the first m/s to fully planing at the second
  comboSpeed: 0.3, // each Perfect in the combo divides quadratic drag by (1 + comboSpeed · combo)...
  comboMax: 4, // ...up to this combo
  // Water holding the board up: a spring (1/s², m/s² per m sunk) stiffening as it planes, and damping (1/s).
  floatStiffness: 60,
  planeStiffness: 400,
  supportDamping: 20,
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
  kitePop: 4, // m/s of pop per unit of kite power (line tension at the pop), at full quality
  waveKick: 1.5, // share of the swell's lift under the board (waveRise) added to a pop: up a face kicks, over the back nothing
  gravity: 9.8,
  liftOff: 0.3, // m clear of the water without a pop (lofted by a gust) that counts as airborne
  downwindKick: { perfect: 0.5, early: 1.5, overload: 5 }, // m/s downwind added at the pop, by release
  airDrag: 0.003, // 1/m: ½ρ·CdA/m of the rider in the air (~0.5 m² frontal, 80 kg); the wind carries them downwind
  softLanding: 7, // m/s of impact (vertical speed into the water surface) landed without losing speed...
  landLoss: 0.05, // ...beyond it, board speed is divided by (1 + landLoss · excess)
  landTurnRate: 2.5, // 1/s the rider swings the board toward the travel direction while coming down
};

// Runs, scoring, tricks and the course (src/game/run.js).
export const GAME = {
  runTime: 75, // s of sim time per run; a jump still in the air at the buzzer lands and scores
  // Jump score = height (m) · pointsPerMetre · quality[release] · combo multiplier (chained Perfects).
  // Landing an overloaded pop is a wipeout and scores nothing.
  pointsPerMetre: 10,
  quality: { perfect: 2, early: 1 },
  grabPoints: 50, // tricks and rings are multiplied by the combo too
  spinPoints: 150, // per 360
  ringPoints: 200,
  doubleTap: 0.3, // s; a second tap in the air within this is a 360, otherwise the tap is a grab
  spinTime: 0.8, // s per 360
  spinSlack: 0.35,
  // Kiteloop: hold in the air (src/game/run.js). Graded by vertical speed at the pull: just before the apex is Perfect.
  loopHold: 0.25, // s held in the air before it's a loop, not a tap (< doubleTap)
  loopPerfect: [1, 4], // m/s of vertical speed at the pull for a Perfect; faster up is early, below is late
  loopPoints: { perfect: 400, early: 200, late: 150 },
  megaHeight: 14, // m above takeoff at the pull for a megaloop: points ×megaBonus
  megaBonus: 2, // rad short of a full turn that still lands
  wipeoutTime: 1.5, // s down after a crash or hit: no input
  wipeoutSpeed: 0.3, // share of board speed kept by a crash or hit
  // Course objects are fixed in x; z is fixed lockDistance m ahead (off screen) on the rider's predicted line.
  lockDistance: 40,
  ramp: { height: 1.5, halfLength: 12, halfWidth: 14 }, // m; kicker swell, a raised-cosine mound
  ringRadius: 3.5, // m; drawn size and vertical hit radius
  ringDepth: 5, // m of z hit tolerance: depth is hard to judge from the chase camera
  buoys: { halfX: 0.8, halfZ: 3.5, height: 1.6 }, // hit boxes (m); clear by being higher above the water
  boat: { halfX: 3.5, halfZ: 2.5, height: 7 },
};

export const CAMERA = {
  fov: 60,
  offset: [0, 3.2, 17], // relative to the rider, upwind and above
  lookTowardKite: 0.35, // 0 = look at rider, 1 = look at kite
  loopLookTowardKite: 0.6, // ...during a kiteloop
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
  readyZoom: 2.5, // degrees of extra FOV micro-zoom while the charge is in the sweet spot...
  readyRate: 18, // ...snapping in and out at this rate (1/s)
  hitStop: 0.08, // s of real time the world freezes on a perfect pop...
  hitStopScale: 0.02, // ...at this sim speed
  readyColor: 0x00f6ff, // rider outline in the sweet spot ("ready" tell)...
  readyOutline: 1.6, // ...this many times thicker
  crouchDepth: 0.85, // share of the deep-crouch pose blended in at full charge
  squash: 0.08, // cartoon squash (height lost) at full charge
  idleSpeed: 1.5, // m/s; slower than this on the water the rider just stands
};
