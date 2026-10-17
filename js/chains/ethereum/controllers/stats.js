// Refreshes the statistics bar: the base fee, how full the blocks are, what they burn, how far finality is.
// Most of it is computed from the blocks the page already holds; only finality asks the node.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const E = (Explorer.ethereum = Explorer.ethereum || {});
  const F = Explorer.format;
  const X = () => E.format;

  const SLOT_S = 12;       // seconds per block
  const WINDOW = 15;       // blocks the averages cover
  let finalized = null;    // number of the latest finalized block

  const sum = (list, f) => list.reduce((s, b) => s + f(b), 0);

  /** Redraws the bar from the blocks in the state and the guess of the next block. */
  function refresh() {
    const blocks = Explorer.state.blocks.slice(0, WINDOW);
    const last = blocks[0];
    if (!last) return;
    const x = X();

    // the base fee of the next block: known from the last one (EIP-1559), and it is what the guess uses
    const nextWei = last.baseFeeWei != null ? E.blocks.nextBaseFee(last.baseFeeWei, last.gasUsed, last.gasLimit) : null;
    if (nextWei != null) {
      const change = last.baseFee > 0 ? (x.weiToGwei(nextWei) / last.baseFee - 1) * 100 : 0;
      Explorer.ui.statsBar.renderBase({
        value: x.gwei(x.weiToGwei(nextWei)), unit: 'gwei', trend: change > 0.05 ? 'down' : change < -0.05 ? 'up' : '' /* a rising fee is bad news: red */,
        sub: `next block · ${F.signed(change)}% vs the last (max ±12.5%)`,
      });
    }

    const fill = (last.gasUsed / last.gasLimit) * 100;
    const avg = (sum(blocks, (b) => b.gasUsed / b.gasLimit) / blocks.length) * 100;
    Explorer.ui.statsBar.renderUsage({
      value: F.fixed(fill), bar: fill,
      sub: `last ${blocks.length}: ${F.fixed(avg)}% · target 50% (above it the fee rises)`,
    });

    const burnt = sum(blocks, (b) => b.burnt);
    Explorer.ui.statsBar.renderBurn({
      value: F.fixed(last.burnt, 3),
      sub: `${F.fixed(burnt, 2)} ETH over the last ${blocks.length} blocks`,
    });

    if (finalized != null) {
      const behind = Math.max(0, Explorer.state.tip - finalized);
      Explorer.ui.statsBar.renderFinality({
        value: `#${F.number(finalized)}`,
        sub: `${F.number(behind)} blocks behind · ≈ ${F.duration(behind * SLOT_S * 1000)} to be final`,
      });
    }
  }

  /** The latest finalized block: it can no longer be reverted (about 2 epochs, 13 min, behind the head). */
  async function refreshFinality() {
    try {
      const b = await E.rpc.call('eth_getBlockByNumber', ['finalized', false]);
      if (b) { finalized = Number(E.format.big(b.number)); refresh(); }
    } catch (e) { console.warn('finality', e); }
  }

  function start() {
    refresh();
    refreshFinality();
    setInterval(refresh, Explorer.chain.config.stats.refreshMs);
    setInterval(refreshFinality, Explorer.chain.config.stats.finalityMs);
  }

  E.statsCtl = { refresh, refreshFinality, start };
})();
