// Refreshes the statistics bar: where the chain is (slot), how many transactions per second, what the blocks are made of,
// where the epoch is. Part is asked of the node (rate, epoch), part is computed from the blocks the page holds.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const S = (BTC.sol = BTC.sol || {});
  const F = BTC.format;

  let epoch = null, perf = null;

  /** Redraws what comes from the blocks the page holds (cheap, no request). */
  function refreshLocal() {
    const x = S.format;
    const last = BTC.state.blocks[0];
    if (last) BTC.ui.statsBar.renderSlot({ value: F.number(last.slot), sub: `a block every ~0.4 s · one in ${BTC.chain.config.sample} shown` });
    const rows = S.data.latestRows();
    if (rows && rows.length) {
      const share = (pred) => (rows.filter(pred).length / rows.length) * 100;
      const cu = rows.reduce((s, r) => s + (r.cu ?? 0), 0);
      BTC.ui.statsBar.renderMix({
        value: F.fixed(share((r) => r.kind === 'vote'), 0),
        sub: `votes · ${F.fixed(share((r) => !r.ok))}% failed · ${F.fixed(share((r) => r.priority > 0))}% pay a priority fee · ≈ ${x.cu(cu)} CU`,
      });
    }
    if (perf) BTC.ui.statsBar.renderTps(perf);
    if (epoch) BTC.ui.statsBar.renderEpoch(epoch);
  }

  /** Asks the node: the transaction rate over the last minute, the epoch. */
  async function refresh() {
    const [samples, info] = await Promise.allSettled([S.rpc.call('getRecentPerformanceSamples', [1]), S.rpc.call('getEpochInfo', [{ commitment: 'confirmed' }])]);
    if (samples.status === 'fulfilled' && samples.value?.[0]) {
      const s = samples.value[0], secs = s.samplePeriodSecs || 60;
      const all = s.numTransactions / secs, user = s.numNonVoteTransactions != null ? s.numNonVoteTransactions / secs : null;
      perf = { value: F.number(Math.round(all)), sub: user != null ? `${F.number(Math.round(user))} without the validators' votes` : 'transactions per second, last minute' };
    } else console.warn('performance', samples.reason);
    if (info.status === 'fulfilled' && info.value) {
      const e = info.value, progress = (e.slotIndex / e.slotsInEpoch) * 100;
      const msLeft = (e.slotsInEpoch - e.slotIndex) * 400;
      epoch = { value: `#${F.number(e.epoch)}`, bar: progress, sub: `${F.fixed(progress)}% · ends in ~${F.duration(msLeft)}` };
    } else console.warn('epoch', info.reason);
    refreshLocal();
  }

  function start() {
    refreshLocal();
    refresh();
    setInterval(refreshLocal, BTC.chain.config.stats.localMs);
    setInterval(refresh, BTC.chain.config.stats.refreshMs);
  }

  S.statsCtl = { refresh, refreshLocal, start };
})();
