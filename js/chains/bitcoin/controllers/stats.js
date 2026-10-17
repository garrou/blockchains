// Refreshes the network statistics bar.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  Explorer.bitcoin = Explorer.bitcoin || {};

  let last = 0, running = false;

  async function refresh() {
    if (running || document.hidden) return; // a slow API must not pile up requests; nobody looks at a hidden tab
    running = true;
    last = Date.now();
    try {
      const [hr, adj] = await Promise.allSettled([Explorer.bitcoin.api.hashrate3d(), Explorer.bitcoin.api.difficultyAdjustment()]);
      if (hr.status === 'fulfilled') Explorer.ui.statsBar.renderHashrate(Explorer.bitcoin.stats.fromHashrate(hr.value));
      else console.warn('hashrate', hr.reason);
      if (adj.status === 'fulfilled') Explorer.ui.statsBar.renderAdjustment(Explorer.bitcoin.stats.fromAdjustment(adj.value));
      else console.warn('difficulty adjustment', adj.reason);
    } finally { running = false; }
  }

  /** Refreshes unless it was done very recently. */
  function maybeRefresh() { if (Date.now() - last > Explorer.chain.config.stats.minGapMs) refresh(); }

  Explorer.bitcoin.statsCtl = { refresh, maybeRefresh };
})();
