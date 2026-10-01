// Headless rides through the real step() and autopilot at 60 Hz, driven exactly like main.js: the
// only input is the button. Prints tables; exits 1 on a kite crash, a cruise under 35 km/h, a jump
// table that isn't ordered early < perfect > overload, any difference between two identical runs,
// a scripted game run that scores differently twice or misses its combo/crash rules, a ramp pop no
// higher than a flat one, or wrong ring hit detection.
// Run: npm run sim:check
import { createState, step } from '../src/sim/physics.js';
import { autopilot } from '../src/sim/autopilot.js';
import { lastLanding, timeScale } from '../src/feel.js';
import { createRun, stepRun } from '../src/game/run.js';
import { GAME } from '../src/config.js';

const DT = 1 / 60;
const KMH = 3.6;
const WARMUP = 20; // s from a standstill: speed and kite settled before anything is measured
const MIN_KMH = 35;
const failures = [];

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
const speedOf = (s) => Math.hypot(s.vel.x, s.vel.z);

// A ride from a standstill. run() steps it for `T` s with `press(s)` as the button and `each(s)`
// after every step. `edgeOnly` holds the edge with the kite parked (the charge is pinned at 0, so
// the autopilot never sends it): edging measured on its own.
function session() {
  const s = createState();
  let t = 0;
  let crashes = 0;
  const run = (T, press = () => false, each = () => {}, edgeOnly = false) => {
    for (let i = Math.round(T / DT); i > 0; i--) {
      t += DT;
      const wasCrashed = s.kite.crashed;
      const controls = edgeOnly ? { ...autopilot(s, false), jump: true } : autopilot(s, press(s));
      step(s, controls, DT, t);
      if (edgeOnly) s.charge = 0;
      timeScale(s); // grades landings (lastLanding), as main.js does every frame
      if (!wasCrashed && s.kite.crashed) crashes++;
      each(s);
    }
  };
  return { s, run, crashes: () => crashes };
}

// --- Cruise: no input vs edge held, 20 s after the warmup.
const cruiseRows = [];
const cruises = {};
for (const [name, edgeOnly] of [['unedged (no input)', false], ['edged (kite parked)', true]]) {
  const r = session();
  r.run(WARMUP);
  const m = { v: [], power: [], az: [], el: [], vmg: [] };
  r.run(20, undefined, (s) => {
    m.v.push(speedOf(s));
    m.power.push(s.kite.power);
    m.az.push(s.kite.az);
    m.el.push(s.kite.el);
    m.vmg.push(s.vel.z); // wind blows toward -Z: +Z is upwind
  }, edgeOnly);
  cruises[name] = mean(m.v) * KMH;
  cruiseRows.push({
    ride: name,
    'km/h': (mean(m.v) * KMH).toFixed(1),
    top: (Math.max(...m.v) * KMH).toFixed(1),
    'speed sd': (sd(m.v) * KMH).toFixed(2),
    'vmg up m/s': mean(m.vmg).toFixed(2),
    'kite az': `${mean(m.az).toFixed(3)} ±${sd(m.az).toFixed(4)}`,
    'kite el': `${mean(m.el).toFixed(3)} ±${sd(m.el).toFixed(4)}`,
    power: mean(m.power).toFixed(3),
    'power sd': sd(m.power).toFixed(4),
    crashes: r.crashes(),
  });
  if (r.crashes()) failures.push(`${name}: ${r.crashes()} kite crashes`);
}
console.log('Cruise (beam reach, fixed course, constant wind)');
console.table(cruiseRows);
if (cruises['unedged (no input)'] < MIN_KMH) failures.push(`cruise ${cruises['unedged (no input)'].toFixed(1)} km/h < ${MIN_KMH}`);

// --- One jump from a settled cruise: hold for `hold` s starting `delay` s after the warmup, release,
// ride on until the kite is parked again.
function jump(hold, delay = 0) {
  const r = session();
  r.run(WARMUP + delay);
  const pressSpeed = speedOf(r.s);
  const parkedPower = r.s.kite.power;
  r.run(hold, () => true);
  const out = { result: null, takeoff: speedOf(r.s), hang: 0, landed: null, recover: null, kiteTop: 0 };
  let t = 0;
  r.run(8, undefined, (s) => {
    t += DT;
    out.result ??= s.jumpResult;
    if (s.airborne) out.hang += DT;
    out.kiteTop = Math.max(out.kiteTop, s.kite.el);
    if (out.landed === null && out.result && !s.airborne) out.landed = t;
    if (out.landed !== null && out.recover === null && Math.abs(s.kite.power - parkedPower) < 0.02 * parkedPower) out.recover = t - out.landed;
  });
  return { ...out, height: r.s.bestJump, pressSpeed, grade: lastLanding?.grade, crashes: r.crashes() };
}

const HOLDS = [
  ['early', 0.5],
  ['early', 0.7],
  ['perfect', 0.8],
  ['perfect', 0.85],
  ['overload', 0.95],
  ['overload (held 1.5 s)', 1.5],
];
const jumpRows = [];
const heights = {};
for (const [label, hold] of HOLDS) {
  const j = jump(hold);
  // Same press at 12 different moments of the cruise: waves are the only thing that differs.
  const spread = Array.from({ length: 12 }, (_, i) => jump(hold, 0.25 * (i + 1)).height);
  heights[hold] = j.height;
  jumpRows.push({
    'hold s': hold,
    expect: label,
    result: j.result,
    'press km/h': (j.pressSpeed * KMH).toFixed(1),
    'pop km/h': (j.takeoff * KMH).toFixed(1),
    'height m': j.height.toFixed(2),
    'height range (12 press times)': `${Math.min(...spread).toFixed(2)}–${Math.max(...spread).toFixed(2)}`,
    'hang s': j.hang.toFixed(2),
    'kite top el': j.kiteTop.toFixed(2),
    landing: j.grade,
    'reparked s': j.recover?.toFixed(1) ?? 'never',
    crashes: j.crashes,
  });
  if (j.result !== label.split(' ')[0]) failures.push(`hold ${hold}s gave '${j.result}', expected '${label}'`);
  if (j.crashes) failures.push(`hold ${hold}s: ${j.crashes} kite crashes`);
}
console.log('Jumps: hold the button for `hold s`, release');
console.table(jumpRows);
if (!(heights[0.8] > heights[0.7] && heights[0.7] > heights[0.5] && heights[0.8] > heights[0.95])) failures.push('jump heights not ordered early < perfect > overload');

// --- A long session of mixed jumps, twice: must match bit for bit and never crash the kite.
function longSession() {
  const r = session();
  const log = [];
  r.run(WARMUP);
  const holds = [0.5, 0.8, 0.95, 1.5, 0.85, 0.3].flatMap((h) => [h, h, h]);
  for (const hold of holds) {
    r.run(hold, () => true);
    r.run(6, undefined, (s) => s.jumpResult && log.push(s.jumpResult));
    log.push(r.s.airHeight, r.s.pos.toArray(), r.s.vel.toArray(), { ...r.s.kite });
  }
  const seconds = WARMUP + holds.reduce((x, h) => x + h + 6, 0);
  return { log: JSON.stringify(log), crashes: r.crashes(), jumps: holds.length, seconds };
}
const a = longSession();
const b = longSession();
console.log(`Determinism: ${a.jumps} mixed jumps over ${a.seconds.toFixed(0)} s, run twice → ${a.log === b.log ? 'identical' : 'DIFFERENT'}; kite crashes ${a.crashes}`);
if (a.log !== b.log) failures.push('two identical runs differ');
if (a.crashes) failures.push(`long session: ${a.crashes} kite crashes`);

// --- Game runs (src/game/run.js). The button is a list of press intervals [from, to] in s from the start.
function ride(presses, course, until = (run) => run.phase !== 'playing', each = () => {}) {
  const s = createState();
  const run = createRun('playing', course);
  let t = 0;
  while (!until(run, s, t)) {
    t += DT;
    stepRun(run, s, presses.some(([a, b]) => t >= a && t < b), DT, t);
    each(s, run, t);
  }
  return { s, run };
}

// A full 75 s run over the real course: a jump every 8 s with a scripted hold and air taps.
const PLAN = [
  [0.8], [0.8, 'grab'], [0.85, 'spin'], [0.5, 'spin'], [0.8], [0.8, 'late spin'], [0.95], [0.8, 'grab'], [0.8], [0.8],
];
const TAPS = { grab: [1], spin: [0.6, 0.8], 'late spin': [4.6, 4.75] }; // s after release; a late 360 can't finish
const presses = PLAN.flatMap(([hold, trick], k) => {
  const at = 1 + 8 * k;
  return [[at, at + hold], ...(TAPS[trick] ?? []).map((d) => [at + hold + d, at + hold + d + 0.05])];
});
const scripted = () => ride(presses).run;
const runA = scripted();
const runB = scripted();
const lands = runA.events.filter((e) => e.type === 'land');
console.log('Scripted run (real course)');
console.table(runA.events.map((e) => ({ ...e, height: e.height?.toFixed(2) })));
console.log(`score ${runA.score} (twice → ${runA.score === runB.score && JSON.stringify(runA.events) === JSON.stringify(runB.events) ? 'identical' : 'DIFFERENT'}), perfects ${runA.perfects}, max combo ×${runA.maxCombo}, best ${runA.best.height.toFixed(2)} m ${runA.best.result}, rings ${runA.items.filter((i) => i.kind === 'ring' && i.hit).length}`);
if (runA.score !== runB.score || JSON.stringify(runA.events) !== JSON.stringify(runB.events)) failures.push('scripted run scored differently twice');
if (!lands.some((e) => e.mult >= 2)) failures.push('chained Perfects never raised the multiplier');
if (!lands.some((e) => e.spins > 0)) failures.push('no 360 landed');
if (runA.events.filter((e) => e.type === 'crash').length < 2) failures.push('late 360 and overload landings should both be wipeouts');

// Ramp vs flat: the same perfect press from a settled cruise, released half-way up a ramp's face.
const POP = [[WARMUP, WARMUP + 0.8]];
const afterJump = (run, s, t) => t > WARMUP + 10;
let release = null;
const flat = ride(POP, [], afterJump, (s) => s.jumpResult && (release = s.pos.clone())).run.best.height;
const ramped = ride(POP, [[release.x + GAME.ramp.halfLength / 2, 'ramp', 0, release.z]], afterJump).run.best.height;
console.log(`Ramp: perfect pop on flat water ${flat.toFixed(2)} m, half-way up a ramp's face ${ramped.toFixed(2)} m`);
if (!(ramped > flat)) failures.push(`ramp launch ${ramped.toFixed(2)} m not above flat ${flat.toFixed(2)} m`);

// Rings: one placed where a perfect jump is 1 s after release scores; one a diameter higher or
// outside the depth tolerance doesn't.
let through = null;
let releasedAt = null;
ride(POP, [], afterJump, (s, run, t) => {
  if (s.jumpResult) releasedAt = t;
  if (releasedAt !== null && t - releasedAt <= 1) through = s.pos.clone();
});
const ringRows = [
  ['through the centre', 0, 0, true],
  ['a diameter too high', 2 * GAME.ringRadius, 0, false],
  ['just inside the rim', 0.9 * GAME.ringRadius, 0, true],
  ['beyond the depth tolerance', 0, 1.1 * GAME.ringDepth, false],
].map(([where, dy, dz, expect]) => {
  const { run } = ride(POP, [[through.x, 'ring', through.y + dy, through.z + dz]], afterJump);
  const hit = run.items[0].hit;
  if (hit !== expect) failures.push(`ring ${where}: hit ${hit}, expected ${expect}`);
  return { ring: where, hit, points: run.score };
});
console.log(`Rings at ${through.y.toFixed(1)} m on a perfect jump's rise`);
console.table(ringRows);

if (failures.length) {
  console.error(`FAIL:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('OK');
