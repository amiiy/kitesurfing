// Title (also the load screen) and results overlays from index.html. Starting and retrying are the
// one button (main.js); Share is a real <button>, which input.js doesn't count as a press.
const BEST_KEY = 'kite-runner-best';
const fmt = (n) => n.toLocaleString('en-US');
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
const $ = (id) => document.getElementById(id);

export function createScreens() {
  const title = $('title');
  const results = $('results');
  const share = $('share');
  let card = '';

  share.addEventListener('click', () => {
    const url = location.origin + location.pathname;
    if (navigator.share) return navigator.share({ title: 'Kite Runner', text: card, url }).catch(() => {}); // dismissed
    navigator.clipboard.writeText(`${card} ${url}`).then(
      () => (share.textContent = 'Copied!'),
      () => (share.textContent = 'Copy failed')
    );
  });

  return {
    ready: () => title.classList.add('ready'),
    hide() {
      title.hidden = results.hidden = true;
    },
    showResults(run) {
      let best = 0;
      try {
        best = Number(localStorage.getItem(BEST_KEY)) || 0;
        if (run.score > best) localStorage.setItem(BEST_KEY, run.score);
      } catch {} // storage blocked: no record, the results still show
      const jump = run.best.result ? `${run.best.height.toFixed(1)} m ${capitalize(run.best.result)}` : '–';
      $('final').textContent = fmt(run.score);
      $('record').textContent = run.score > best ? (best ? `New best! (was ${fmt(best)})` : 'New best!') : `Best ${fmt(best)}`;
      $('best-jump').textContent = jump;
      $('perfects').textContent = run.perfects;
      $('max-combo').textContent = `×${Math.max(1, run.maxCombo)}`;
      card = `Kite Runner: ${fmt(run.score)} pts · ${jump} ×${Math.max(1, run.maxCombo)}`;
      share.textContent = 'Share';
      results.hidden = false;
    },
  };
}
