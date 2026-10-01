import { FEEL, JUMP, WIND } from './config.js';
import { lastLanding } from './feel.js';

const GREEN = '#7dffa8';
const YELLOW = '#ffd21f';
const RED = '#ff6a4d';
const LANDING = { clean: ['Clean landing!', GREEN], sketchy: ['Sketchy…', YELLOW], crash: ['Wipeout!', RED] };
const RELEASE = { perfect: ['Perfect!', GREEN], early: ['Early', YELLOW], overload: ['Overloaded', RED], slow: ['Too slow!', YELLOW] };

// DOM overlay: stats panel, kite power gauge, jump charge meter with its sweet spot, callouts.
export function createHud() {
  const speed = document.getElementById('speed');
  const wind = document.getElementById('wind');
  const power = document.querySelector('#power > div');
  const powerPct = document.getElementById('power-pct');
  const charge = document.querySelector('#charge > div:last-child');
  const air = document.getElementById('air');
  const best = document.getElementById('best');
  const crash = document.getElementById('crash');

  const sweet = document.getElementById('sweet');
  sweet.style.left = `${JUMP.sweetMin * 100}%`;
  sweet.style.width = `${(JUMP.sweetMax - JUMP.sweetMin) * 100}%`;

  // Built here rather than in index.html: it's a centred callout, not part of the stats panel.
  const landing = document.createElement('div');
  landing.style.cssText =
    'position:fixed;top:22%;left:0;right:0;text-align:center;font:bold 32px system-ui,sans-serif;' +
    'text-shadow:0 2px 6px #000a;pointer-events:none;transition:opacity .3s;opacity:0';
  document.body.append(landing);
  let shown = null;
  let shownAt = -Infinity;
  const callout = (text, color, time) => {
    landing.textContent = text;
    landing.style.color = color;
    shownAt = time;
  };

  return {
    update(state) {
      speed.textContent = (Math.hypot(state.vel.x, state.vel.z) * 3.6).toFixed(0);
      wind.textContent = (WIND.knots * WIND.strength * state.gust).toFixed(0);
      const pct = Math.min(100, state.kite.power * 100).toFixed(0);
      power.style.width = `${pct}%`;
      powerPct.textContent = pct;
      const c = state.charge;
      charge.style.width = `${(c * 100).toFixed(0)}%`;
      charge.style.background = c > JUMP.sweetMax ? RED : c >= JUMP.sweetMin ? GREEN : YELLOW;
      air.textContent = state.airborne ? `${Math.max(0, state.pos.y - state.takeoffY).toFixed(1)} m` : '–';
      best.textContent = `${state.bestJump.toFixed(1)} m`;
      crash.style.display = state.kite.crashed ? 'block' : 'none';

      if (lastLanding && lastLanding !== shown) {
        shown = lastLanding;
        const [text, color] = LANDING[shown.grade];
        callout(`${text} ${shown.height.toFixed(1)} m`, color, shown.time);
      }
      if (state.jumpResult) callout(...RELEASE[state.jumpResult], performance.now());
      landing.style.opacity = performance.now() - shownAt < FEEL.landingShowMs ? 1 : 0;
    },
  };
}
