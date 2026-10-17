// Refreshes the network statistics bar.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  Explorer.bitcoin = Explorer.bitcoin || {};

  let last = 0, running = false, dayAt = 0, dayRunning = false;

  async function refresh() {
    if (running || document.hidden) return; // a slow API must not pile up requests; nobody looks at a hidden tab
    running = true;
    last = Date.now();
    try {
      const [hr, adj, fees] = await Promise.allSettled([Explorer.bitcoin.api.hashrate3d(), Explorer.bitcoin.api.difficultyAdjustment(), Explorer.bitcoin.api.fees()]);
      if (fees.status === 'fulfilled') Explorer.ui.statsBar.renderFees(Explorer.bitcoin.stats.fromFees(fees.value));
      else console.warn('fees', fees.reason);
      if (hr.status === 'fulfilled') Explorer.ui.statsBar.renderHashrate(Explorer.bitcoin.stats.fromHashrate(hr.value));
      else console.warn('hashrate', hr.reason);
      if (adj.status === 'fulfilled') Explorer.ui.statsBar.renderAdjustment(Explorer.bitcoin.stats.fromAdjustment(adj.value));
      else console.warn('difficulty adjustment', adj.reason);
    } finally { running = false; }
    refreshDay();
  }

  /**
   * Counts the transactions of the last 24 hours (before the newest block: the clock of the blocks, not the one of this computer): the
   * blocks the page holds, and as many older pages as it takes to reach back a day. Tried again in a few seconds while there are no blocks
   * yet, and in two minutes after a failure or a count that does not reach back a day.
   */
  let dayRetry = 0;
  async function refreshDay() {
    const cfg = Explorer.chain.config.stats;
    if (dayRunning || document.hidden || Date.now() - dayAt < cfg.dayRefreshMs) return;
    const held = Explorer.nav.liveBlocks();
    if (!held.length) { // the page is still loading its blocks
      if (!dayRetry) dayRetry = setTimeout(() => { dayRetry = 0; refreshDay(); }, 3000);
      return;
    }
    dayRunning = true;
    const later = () => { dayAt = Date.now() - cfg.dayRefreshMs + 120000; };
    try {
      const now = held[0].timestamp, blocks = held.slice();
      for (let pages = 0; blocks.at(-1).timestamp > now - 86400 && blocks.at(-1).height > 0 && pages < cfg.dayPagesMax; pages++) {
        const older = await Explorer.bitcoin.api.blocksFrom(blocks.at(-1).height - 1);
        if (!Array.isArray(older) || !older.length) break;
        blocks.push(...older);
      }
      const day = Explorer.bitcoin.stats.txPerDay(blocks, now);
      Explorer.ui.statsBar.renderDay({
        value: Explorer.format.number(day.count),
        sub: `24 h before the latest block · ${Explorer.format.number(day.blocks)} blocks${day.complete ? '' : ' (not a whole day yet)'}`,
      });
      if (day.complete) dayAt = Date.now(); else later();
    } catch (e) { console.warn('transactions per day', e); later(); } finally { dayRunning = false; }
  }

  /** Refreshes unless it was done very recently. */
  function maybeRefresh() { if (Date.now() - last > Explorer.chain.config.stats.minGapMs) refresh(); }

  Explorer.bitcoin.statsCtl = { refresh, maybeRefresh, refreshDay };
})();
