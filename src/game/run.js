import { GAME } from '../config.js';
import { step } from '../sim/physics.js';
import { autopilot } from '../sim/autopilot.js';
import { ramps, waveHeight } from '../waves.js';

// Game rules on top of the sim: a timed run over a fixed course, scored jumps with Perfect combos,
// air tricks, rings and obstacles. Deterministic like the sim: same button presses, same score.

const TAU = 2 * Math.PI;

// The course, start to finish: [x m along the rider's fixed course, kind, ring centre height m].
// A ring just past a ramp sits on the arc of a Perfect popped off that ramp's face.
const COURSE = [
  [60, 'ramp'],
  [140, 'ring', 7],
  [210, 'buoys'],
  [280, 'ramp'],
  [306, 'ring', 16],
  [380, 'boat'],
  [450, 'ring', 5],
  [520, 'buoys'],
  [580, 'ramp'],
  [660, 'ring', 9],
  [730, 'boat'],
  [800, 'ramp'],
  [826, 'ring', 16],
  [900, 'buoys'],
  [960, 'ring', 7],
  [1030, 'ramp'],
  [1110, 'boat'],
  [1180, 'ring', 8],
  [1250, 'buoys'],
];

// phase: 'title' (attract mode: the rider cruises, no rules) | 'playing' | 'results'.
// `course` rows may carry a 4th value, z, to place an object directly (sim-check).
export function createRun(phase = 'playing', course = COURSE) {
  ramps.length = 0; // a new run starts on open water
  return {
    phase,
    time: GAME.runTime, // s left
    score: 0,
    combo: 0, // Perfects in a row; the multiplier is max(1, combo)
    maxCombo: 0,
    perfects: 0,
    best: { height: 0, result: null }, // highest landed jump
    items: course.map(([x, kind, y = 0, z = null]) => ({ kind, x, y, z, done: false, hit: false })),
    events: [], // { type: 'land' | 'ring' | 'crash' | 'hit', ... } for the HUD, which drains it
    jump: null, // { result, mult } of the jump in the air
    grab: false,
    spins: 0, // 360s started this jump
    tapAt: null, // time of a tap that is a grab unless a second tap follows within GAME.doubleTap
    armed: false, // the press that started the run doesn't count until it is let go
    wasDown: false,
  };
}

export const multiplier = (run) => Math.max(1, run.combo);

// One fixed step: the button drives the sim through the autopilot, then the rules read the result.
// main.js and scripts/sim-check.mjs both ride through here.
export function stepRun(run, s, button, dt, t) {
  const playing = run.phase === 'playing';
  run.armed ||= !button;
  const down = playing && run.armed && button && !s.wipeout;
  const tap = down && !run.wasDown;
  run.wasDown = down;
  const { x: x0, y: y0, z: z0 } = s.pos;

  step(s, autopilot(s, down), dt, t);
  s.wipeout = Math.max(0, s.wipeout - dt);
  if (!playing) return;

  run.time -= dt;
  if (s.jumpResult) release(run, s);
  if (s.airborne) air(run, s, tap, dt, t);
  else if (s.landImpact > 0) land(run, s);
  course(run, s, x0, y0, z0, t);
  if (run.time <= 0 && !s.airborne) run.phase = 'results';
}

function release(run, s) {
  if (s.jumpResult === 'perfect') {
    run.combo++;
    run.perfects++;
    run.maxCombo = Math.max(run.maxCombo, run.combo);
  } else run.combo = 0;
  if (s.airborne) run.jump = { result: s.jumpResult, mult: multiplier(run) };
}

// A tap is a grab unless a second tap follows within GAME.doubleTap: then it's a 360.
function air(run, s, tap, dt, t) {
  if (s.wipeout) return;
  if (tap && run.tapAt !== null) {
    run.tapAt = null;
    run.spins++;
  } else if (tap) run.tapAt = t;
  if (run.tapAt !== null && t - run.tapAt > GAME.doubleTap) {
    run.tapAt = null;
    run.grab = true;
  }
  s.trickSpin = Math.min(run.spins * TAU, s.trickSpin + (TAU / GAME.spinTime) * dt);
  s.trick = s.trickSpin < run.spins * TAU ? 'spin' : run.grab ? 'grab' : null;
}

// Straight landings score the jump and its tricks; landing mid-rotation or an overloaded pop is a wipeout.
function land(run, s) {
  const { jump } = run;
  if (!s.wipeout && (jump?.result === 'overload' || run.spins * TAU - s.trickSpin > GAME.spinSlack)) wipe(run, s, 'crash');
  else if (jump) {
    const height = s.airHeight;
    const tricks = (run.grab ? GAME.grabPoints : 0) + run.spins * GAME.spinPoints;
    const points = Math.round((height * GAME.pointsPerMetre * GAME.quality[jump.result] + tricks) * jump.mult);
    run.score += points;
    if (height > run.best.height) run.best = { height, result: jump.result };
    run.events.push({ type: 'land', points, height, mult: jump.mult, result: jump.result, grab: run.grab, spins: run.spins });
  }
  run.jump = null;
  run.grab = false;
  run.spins = 0;
  run.tapAt = null;
  s.trick = null;
  s.trickSpin = 0;
}

function wipe(run, s, type) {
  run.combo = 0;
  run.jump = null; // a jump in the air scores nothing
  s.wipeout = GAME.wipeoutTime;
  s.vel.x *= GAME.wipeoutSpeed;
  s.vel.z *= GAME.wipeoutSpeed;
  run.events.push({ type });
}

// Objects are fixed in x; each one's z is fixed once the rider is GAME.lockDistance away (off screen),
// on the line the rider is holding then. Rings score when the rider crosses their plane inside them;
// obstacles knock the rider down unless they're cleared.
function course(run, s, x0, y0, z0, t) {
  for (const item of run.items) {
    if (item.done) continue;
    const ahead = item.x - s.pos.x;
    if (item.z === null) {
      if (ahead > GAME.lockDistance) break; // items are in x order
      item.z = s.pos.z + (s.vel.z * ahead) / Math.max(s.vel.x, 1);
    }
    if (item.kind === 'ramp') {
      ramps.push(item);
      item.done = true;
    } else if (item.kind === 'ring') {
      if (ahead > 0) continue;
      item.done = true;
      const f = (item.x - x0) / (s.pos.x - x0); // where this step crossed the ring's plane
      const dy = y0 + (s.pos.y - y0) * f - item.y;
      const dz = z0 + (s.pos.z - z0) * f - item.z;
      if ((dy / GAME.ringRadius) ** 2 + (dz / GAME.ringDepth) ** 2 > 1) continue;
      item.hit = true;
      const points = GAME.ringPoints * multiplier(run);
      run.score += points;
      run.events.push({ type: 'ring', points });
    } else {
      const box = GAME[item.kind];
      if (ahead < -box.halfX) item.done = true;
      else if (ahead < box.halfX && Math.abs(s.pos.z - item.z) < box.halfZ && s.pos.y - waveHeight(s.pos.x, s.pos.z, t) < box.height) {
        item.done = item.hit = true;
        wipe(run, s, 'hit');
      }
    }
  }
}
