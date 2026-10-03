# 🪁 Kite Runner

A one-button kitesurfing game for the browser, built with [three.js](https://threejs.org) and Vite.

**Play:** https://kite-runner-five.vercel.app

Ride a beam reach, load the kite, pop off the swell and land tricks. The physics simulation is deterministic, and the whole screen is the button, so it plays the same on a phone, a laptop or a gamepad.

## Controls

| Action | Input |
| --- | --- |
| Edge and load the jump | **Hold**: mouse, touch, `Space`, or any gamepad face button, bumper or trigger |
| Jump | **Release**. Release at the right moment for a perfect pop; holding too long overloads the kite |
| Grab | Tap in the air |
| 360 | Double-tap in the air |
| Kiteloop | Hold in the air, then let go in time. Pulling too late crashes |
| Restart run | `R` / gamepad Start |
| Mute | `M` |

## Levels

| Level | Conditions |
| --- | --- |
| Steady | Small swell, steady 27 kn |
| Big Swell | Onshore swell: pop off the wave faces |
| Side-on | Waves at an angle |
| Gusty | Jump in the gusts; watch for dark water |
| Building | 22 → 32 kn, gusty, big side-on swell, storm |

## Getting started

```sh
npm install
npm run dev       # local dev server
npm run build     # production build to dist/
npm run preview   # serve the build
```

## Scripts

- `npm run sim:check`: runs the physics headless and prints cruise speeds, jump timing windows, trick scoring and a determinism check. Run it after touching `src/sim/` or `src/config.js`.
- `npm run optimize:models -- in.glb out.glb`: compresses and simplifies a prop model (meshopt and WebP).
- `npm run optimize:rider -- in.glb out.glb`: same, but keeps the rider's mesh intact for animation.

## Project layout

```
src/
  main.js          entry point and game loop
  config.js        tuning constants
  input.js         one-button input (pointer, keyboard, gamepad)
  audio.js, hud.js, feel.js, waves.js
  sim/             physics, wind and gusts, autopilot
  game/            runs, levels, screens
  render/          water, world, props, kite and rider models, camera, effects, time of day
public/models/     optimized .glb assets
scripts/           sim-check and model tooling
docs/              design notes
```

## Deploy

The project is deployed on Vercel:

```sh
npx vercel --prod
```
