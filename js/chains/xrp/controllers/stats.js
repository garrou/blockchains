// Refreshes the statistics bar: where the chain is (ledger), how many transactions per second, what the ledgers are made of, what a
// transaction costs now. Part is asked of the server (the fee), part is computed from the ledgers the page holds.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});
  const F = Explorer.format;

  let fee = null;

  /** Redraws what comes from the ledgers the page holds (cheap, no request). */
  function refreshLocal() {
    const blocks = Explorer.nav.liveBlocks();
    const last = blocks[0];
    const head = X.live.headIndex() || last?.height;
    if (head) Explorer.ui.statsBar.renderLedger({ value: F.number(head), sub: last ? `closed ${last.closedIn != null ? `after ${last.closedIn} s · ` : ''}${F.number(last.tx_count)} tx` : ' ' });
    if (blocks.length > 1) {
      const span = blocks[0].timestamp - blocks.at(-1).timestamp;
      const txs = blocks.slice(0, -1).reduce((s, b) => s + b.tx_count, 0); // the oldest one only marks the start of the span
      if (span > 0) Explorer.ui.statsBar.renderTps({ value: F.fixed(txs / span, 1), sub: `last ${blocks.length - 1} ledgers · a ledger every ~${F.fixed(span / (blocks.length - 1), 1)} s` });
    }
    const rows = X.data.latestRows();
    if (rows && rows.length) {
      const share = (pred) => (rows.filter(pred).length / rows.length) * 100;
      Explorer.ui.statsBar.renderMix({
        value: F.fixed(share((r) => r.type === 'Payment'), 0),
        sub: `${F.fixed(share((r) => r.kind === 'dex'), 0)}% exchange orders · ${F.fixed(share((r) => r.kind === 'failed'))}% failed`,
      });
    }
    if (fee) Explorer.ui.statsBar.renderFee(fee);
  }

  /** Asks the server: what a transaction costs now, and how full the queue is. */
  async function refresh() {
    try {
      const r = await X.ws.call('fee');
      const d = r.drops ?? {}, open = Number(d.open_ledger_fee), base = Number(d.base_fee);
      fee = {
        value: F.number(open),
        sub: `reference ${F.number(base)} drops · queue ${F.number(r.current_queue_size ?? 0)} of ${F.number(r.max_queue_size ?? 0)}`,
      };
    } catch (e) { console.warn('fee', e); }
    refreshLocal();
  }

  function start() {
    refreshLocal();
    refresh();
    setInterval(refreshLocal, Explorer.chain.config.stats.localMs);
    setInterval(refresh, Explorer.chain.config.stats.refreshMs);
  }

  X.statsCtl = { refresh, refreshLocal, start };
})();
