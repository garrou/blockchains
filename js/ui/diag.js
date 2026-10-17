// The diagnostics panel: opened with `?debug` in the address (or Shift+D). What the page has done with the network, the last events, and
// a button that copies the whole report to paste where somebody can read it. Views only: the memory is core/diag.js.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const { el } = Explorer.dom;

  let panel = null, off = null, timer = 0;

  const fmt = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

  function draw() {
    if (!panel) return;
    const { counters, gauges, events } = Explorer.diag.snapshot();
    panel.querySelector('.dg-now').replaceChildren(...Object.entries(gauges).sort().map(([k, v]) => el('div', {}, el('b', {}, `${k} `), fmt(v))));
    panel.querySelector('.dg-count').textContent = Object.entries(counters).sort().map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing counted yet';
    panel.querySelector('.dg-events').replaceChildren(...events.slice(-8).reverse().map((e) => el('div', { class: `dg-${e.kind}` }, `${new Date(e.at).toLocaleTimeString()} ${e.kind} `, e.text)));
  }

  function copy() {
    const text = Explorer.diag.report();
    const done = () => { panel.querySelector('.dg-copy').textContent = 'Copied'; setTimeout(() => { if (panel) panel.querySelector('.dg-copy').textContent = 'Copy report'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy this report:', text));
    else window.prompt('Copy this report:', text);
  }

  function close() {
    if (off) off();
    clearInterval(timer);
    if (panel) panel.remove();
    panel = null;
  }

  function open() {
    if (panel) return;
    panel = el('aside', { class: 'diag', 'aria-label': 'Diagnostics' },
      el('div', { class: 'dg-head' }, el('b', {}, 'Diagnostics'),
        el('button', { type: 'button', class: 'dg-copy', onclick: copy }, 'Copy report'),
        el('button', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      el('div', { class: 'dg-now' }), el('p', { class: 'dg-count muted' }), el('div', { class: 'dg-events' }));
    document.body.append(panel);
    off = Explorer.diag.onChange(() => { if (!timer) timer = setTimeout(() => { timer = 0; draw(); }, 300); }); // many events at once: one redraw
    draw();
  }

  Explorer.ui.diag = { open, close, toggle: () => (panel ? close() : open()) };

  if (/[?&#]debug\b/.test(location.search + location.hash)) open();
  document.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'D' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) Explorer.ui.diag.toggle();
  });
})();
