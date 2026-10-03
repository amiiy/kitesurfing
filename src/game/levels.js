// Levels: the sea and the wind plan (src/sim/wind.js) for a run; all share the course in run.js.
// knots: [[run s, kn], ...] eased between; gusts: seeded, so a level blows the same every run.
// weather: 'storm' swaps the sunrise-to-sunset sky for a storm with rain (src/render/timeOfDay.js); render only.
export const LEVELS = [
  { name: 'Steady', blurb: 'Small swell, steady 27 kn', swell: 'onshore', size: 0.6, knots: [[0, 27]] },
  { name: 'Big Swell', blurb: 'Onshore: pop off the faces', swell: 'onshore', size: 1, knots: [[0, 27]] },
  { name: 'Side-on', blurb: 'Waves at an angle', swell: 'sideOnshore', size: 1, knots: [[0, 27]] },
  { name: 'Gusty', blurb: 'Jump in the gusts: watch for dark water', swell: 'onshore', size: 1, knots: [[0, 25]], gusts: { seed: 7, every: 8, strength: 0.4 } },
  { name: 'Building', blurb: '22 → 32 kn, gusty, big side-on swell', swell: 'sideOnshore', size: 1.2, knots: [[0, 22], [75, 32]], gusts: { seed: 21, every: 6, strength: 0.35 }, weather: 'storm' },
];
