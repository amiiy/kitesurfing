import { FEEL, JUMP, WIND } from './config.js';
import { multiplier } from './game/run.js';

const GREEN = '#7dffa8';
const YELLOW = '#ffd21f';
const RED = '#ff6a4d';
const RELEASE = { perfect: ['Perfect!', GREEN], early: ['Early', YELLOW], overload: ['Overloaded', RED], slow: ['Too slow!', YELLOW] };
const TRICK = { grab: ['Grab!', YELLOW], spin: ['360!', YELLOW] };
const fmt = (n) => n.toLocaleString('en-US');

// Callout for a run event (src/game/run.js).
function eventCallout(e) {
  if (e.type === 'ring') return [`Ring! +${fmt(e.points)}`, YELLOW];
  if (e.type === 'crash') return ['Wipeout! Combo lost', RED];
  if (e.type === 'hit') return ['Hit! Combo lost', RED];
  const parts = [`${e.height.toFixed(1)} m`, e.grab && 'grab', e.spins && `${e.spins * 360}`, e.mult > 1 && `×${e.mult}`];
  return [`+${fmt(e.points)}  ${parts.filter(Boolean).join(' · ')}`, GREEN];
}

// A quick scale-up pop on a number that just changed.
const pop = (el) => el.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });

// DOM overlay: stats panel, kite power gauge, jump charge meter with its sweet spot, score, combo
// multiplier and run timer, callouts.
export function createHud() {
  const speed = document.getElementById('speed');
  const wind = document.getElementById('wind');
  const power = document.querySelector('#power > div');
  const powerPct = document.getElementById('power-pct');
  const charge = document.querySelector('#charge > div:last-child');
  const air = document.getElementById('air');
  const best = document.getElementById('best');
  const crash = document.getElementById('crash');
  const score = document.getElementById('score');
  const mult = document.getElementById('mult');
  const timer = document.getElementById('timer');

  const sweet = document.getElementById('sweet');
  sweet.style.left = `${JUMP.sweetMin * 100}%`;
  sweet.style.width = `${(JUMP.sweetMax - JUMP.sweetMin) * 100}%`;

  // Built here rather than in index.html: it's a centred callout, not part of the stats panel.
  const landing = document.createElement('div');
  landing.style.cssText =
    'position:fixed;top:22%;left:0;right:0;text-align:center;font:bold 32px system-ui,sans-serif;' +
    'text-shadow:0 2px 6px #000a;pointer-events:none;transition:opacity .3s;opacity:0';
  document.body.append(landing);
  let shownAt = -Infinity;
  let shownScore = 0;
  let shownMult = 1;
  let shownTrick = null;
  const callout = (text, color, time) => {
    landing.textContent = text;
    landing.style.color = color;
    shownAt = time;
  };

  return {
    update(state, run) {
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

      const now = performance.now();
      for (const e of run.events.splice(0)) callout(...eventCallout(e), now);
      if (state.trick !== shownTrick) {
        shownTrick = state.trick;
        if (shownTrick) callout(...TRICK[shownTrick], now);
      }
      if (state.jumpResult) callout(...RELEASE[state.jumpResult], now);
      landing.style.opacity = run.phase === 'playing' && now - shownAt < FEEL.landingShowMs ? 1 : 0; // not over the screens

      if (run.score !== shownScore) {
        score.textContent = fmt((shownScore = run.score));
        pop(score);
      }
      if (multiplier(run) !== shownMult) {
        mult.textContent = `×${(shownMult = multiplier(run))}`;
        pop(mult);
      }
      mult.style.color = shownMult > 1 ? YELLOW : '#fff';
      const left = Math.max(0, Math.ceil(run.time));
      timer.textContent = `${left} s`;
      timer.style.color = left <= 10 && run.phase === 'playing' ? RED : '#fff';
    },
  };
}
