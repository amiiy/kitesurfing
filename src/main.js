import * as THREE from 'three';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { timeScale } from './feel.js';
import { createState, kiteDirection, orientBoard } from './sim/physics.js';
import { createRun, stepRun } from './game/run.js';
import { createScreens } from './game/screens.js';
import { loadAssets } from './render/assets.js';
import { createWorld } from './render/world.js';
import { createWater } from './render/water.js';
import { createBoardEffects } from './render/effects.js';
import { createBuoys } from './render/buoys.js';
import { createCourseView } from './render/course.js';
import { createRiderModel } from './render/riderModel.js';
import { createKiteModel, createKiteLines } from './render/kiteModel.js';
import { createFollowCamera } from './render/followCamera.js';
import { outline, toonify } from './render/toon.js';

// Physics steps at a fixed rate so it plays the same on 30, 60 and 144 Hz displays;
// frames in between draw a blend of the last two steps so motion stays smooth.
const STEP = 1 / 60;
const MAX_STEPS = 5; // per frame: a stalled tab drops the lost time instead of spiralling
const SCREEN_LOCK_MS = 1000; // a tap this soon after the results open doesn't skip them

// Vite's default build target predates top-level await, so start from the promise.
loadAssets().then(start);

function start() {
  const world = createWorld(document.body);
  const water = createWater({ sunDir: world.sun });
  const effects = createBoardEffects(world.renderer);
  const buoys = createBuoys();
  const course = createCourseView();
  const rider = createRiderModel();
  const kite = createKiteModel();
  const lines = createKiteLines();
  const followCamera = createFollowCamera(world.camera);
  const hud = createHud();
  const audio = createAudio();
  const screens = createScreens();
  screens.ready(); // loaded: the title (the load screen until now) offers "tap to start"

  world.scene.add(water.mesh, buoys.group, course.group, kite.group, lines.group, ...rider.objects, ...effects.objects);
  toonify(world.scene);
  for (const hero of [...rider.objects, kite.group]) outline(hero);
  world.onResize(effects.updatePixelScale);

  let state = createState();
  let run = createRun('title'); // the rider cruises behind the title screen
  let simTime = 0; // time of `state`; slows with timeScale so waves and gusts slow too
  let pending = 0; // sim time owed but not yet stepped
  let resultsAt = -Infinity; // performance.now() when the results opened
  let wasPressed = false;

  // Motion at the step before `state`; frames interpolate from here.
  const prev = { pos: new THREE.Vector3(), yaw: 0, trickSpin: 0, kite: {} };
  const snapshot = () => {
    prev.pos.copy(state.pos);
    prev.yaw = state.yaw;
    prev.trickSpin = state.trickSpin;
    Object.assign(prev.kite, state.kite);
  };
  snapshot();

  // Reset (also R / Start): a fresh rider at the start of a new run. Sim time restarts too, so every
  // run meets the same water.
  function startRun() {
    const { bestJump } = state;
    state = createState();
    state.bestJump = bestJump;
    run = createRun();
    simTime = pending = 0;
    snapshot(); // otherwise the first frame would lerp from the old position
    effects.reset();
    followCamera.reset();
    screens.hide();
  }
  const input = createInput({ onReset: startRun });

  // What renderers see: same shape as `state`, motion interpolated, derived vectors rebuilt.
  const own = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), side: new THREE.Vector3(), kiteDir: new THREE.Vector3(), kite: {} };
  const view = {};
  const lerp = THREE.MathUtils.lerp;
  function interpolate(a, landImpact, jumpResult) {
    Object.assign(view, state, own);
    Object.assign(view.kite, state.kite);
    view.pos.lerpVectors(prev.pos, state.pos, a);
    view.yaw = lerp(prev.yaw, state.yaw, a);
    // A landing snaps a finished 360 back to 0: don't sweep back through the turn.
    view.trickSpin = state.trickSpin < prev.trickSpin ? state.trickSpin : lerp(prev.trickSpin, state.trickSpin, a);
    view.kite.az = lerp(prev.kite.az, state.kite.az, a);
    view.kite.el = lerp(prev.kite.el, state.kite.el, a);
    view.kite.heading = lerp(prev.kite.heading, state.kite.heading, a);
    kiteDirection(view.kite, view.kiteDir);
    orientBoard(view);
    // The sim clears these one-shot flags every step; report them from any of this frame's steps, once.
    view.landImpact = landImpact;
    view.jumpResult = jumpResult;
  }

  const lineStart = new THREE.Vector3();
  const lineEnd = new THREE.Vector3();

  // `dt` is sim time (slows in slow-mo); the camera gets real time so it stays responsive.
  function render(t, dt, realDt) {
    kite.update(view, dt);
    rider.update(view, kite.group.position, t, dt);
    for (const i of [0, 1]) lines.set(i, rider.barEnd(i, lineStart), kite.tip(i, lineEnd));
    buoys.update(t, view.pos);
    course.update(run, t);
    water.update(t, view);
    followCamera.update(rider.position, kite.group.position, view, realDt);
    world.followSun(rider.position);
    hud.update(view, run);
    audio.update(view, dt);
    world.render();
  }

  const clock = new THREE.Clock();
  world.renderer.setAnimationLoop(() => {
    const realDt = Math.min(clock.getDelta(), MAX_STEPS * STEP);
    const dt = realDt * timeScale(state, view.jumpResult); // view: last frame's one-shots (hit-stop on a Perfect)

    let landImpact = 0;
    let jumpResult = null;
    for (pending += dt; pending >= STEP; pending -= STEP) {
      // Read per step, not per frame, so a press lands on the same steps at any frame rate.
      const { jump } = input.read(); // may restart the run (R / Start), so read before using `state`
      // Off a run (title, results) a fresh press starts one; the results ignore it for a moment so a
      // tap meant for the last jump can't skip them.
      if (run.phase !== 'playing' && jump && !wasPressed && performance.now() - resultsAt > SCREEN_LOCK_MS) startRun();
      wasPressed = jump;
      snapshot();
      simTime += STEP;
      const phase = run.phase;
      stepRun(run, state, jump, STEP, simTime); // the kite flies itself; the button edges and loads the jump
      if (phase === 'playing' && run.phase === 'results') {
        screens.showResults(run);
        resultsAt = performance.now();
      }
      landImpact = Math.max(landImpact, state.landImpact);
      jumpResult ||= state.jumpResult;
    }

    const a = pending / STEP;
    const t = simTime - (1 - a) * STEP;
    interpolate(a, landImpact, jumpResult);
    effects.update(view, dt, t);
    render(t, dt, realDt);
  });
}
