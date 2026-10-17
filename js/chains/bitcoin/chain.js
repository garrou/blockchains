// Bitcoin, as the engine sees it (see the contract in js/core/chain.js): its numbers, its words, its constants.
// Loaded before the engine files that read BTC.chain at load time (core/colors.js). What it delegates to (BTC.api,
// BTC.socket, BTC.txs, BTC.projection, BTC.format, BTC.details, BTC.walletCtl...) is only called later, once every script
// has loaded.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const F = () => BTC.format; // looked up when used: this file loads before core/format.js

  const BLOCK_VSIZE = 1e6;   // virtual bytes in a full block: the scale of the towers (a full block fills the platform)
  const BLOCK_WEIGHT = 4e6;  // weight units in a full block (4 MWU = 1 Mvb, since vsize = weight / 4)

  const fill = (b) => (b.weight || 0) / BLOCK_WEIGHT;

  // The towers of a mined block. The "summary" gives every transaction (size, fee, rate) in one call; if it is missing or
  // incomplete (a fresh block can have only its coinbase for a few seconds: it would be one giant tower), fall back to the
  // bare txids: towers flagged `approx` (sizes unknown), which the engine replaces once the real data is there.
  async function blockTowers(b) {
    try {
      const rows = await BTC.api.blockSummary(b.id);
      if (BTC.txs.isCompleteSummary(rows, b.tx_count)) return BTC.txs.fromSummary(rows);
      console.warn(`block ${b.height} summary incomplete (${Array.isArray(rows) ? rows.length : '?'}/${b.tx_count || 0}), retrying later`);
    } catch (e) { console.warn('summary unavailable, falling back to /txids', e); }
    return BTC.txs.provisional(await BTC.api.blockTxids(b.id), b.extras?.medianFee);
  }

  BTC.defineChain({
    id: 'bitcoin',
    name: 'Bitcoin',

    // Constants only the Bitcoin files read (BTC.chain.config.*)
    config: {
      api: 'https://mempool.space/api',
      ws: 'wss://mempool.space/api/v1/ws',
      summaryMinRatio: 0.95,                                  // a block summary with fewer rows than this share of tx_count is incomplete
      stats: { jPerTh: 25, refreshMs: 60000, minGapMs: 15000 },
      wallet: { pollMs: 30000, afterBlockMs: 3000 },          // see controllers/wallet.js
    },

    theme: { accent: 0xf7931a },

    // ----- numbers -----
    capacity: { size: BLOCK_VSIZE },
    // Fee rates (sat/vB) run from the lowest relay fee, 0.1, to 300 (above: same color and height). The towers and the
    // legend are drawn from the same stops, on a logarithmic scale.
    rates: {
      unit: 'sat/vB', min: 0.1, max: 300,
      stops: [[0.1, 0x5a3d99], [1, 0x2d3a9e], [4, 0x1f8fe0], [10, 0x22c9a6], [25, 0x7ddc4a], [60, 0xf2d33c], [120, 0xf7931a], [300, 0xff3d6e]],
      ticks: [0.1, 1, 10, 100],
    },
    fill,
    typicalRate: (b) => b.extras?.medianFee,

    // ----- words -----
    blockCard: (b) => ({
      title: `#${F().number(b.height)}`,
      lines: [`${F().number(b.tx_count)} tx`, `${(b.size / 1e6).toFixed(2)} MB`, b.extras?.pool?.name ?? '—'],
      fill: Math.min(1, fill(b)),
    }),

    // m: a projected block from the mempool ({nTx, medianFee, feeRange, totalFees, blockVSize})
    nextCard(m) {
      const f = F(), [lo, hi] = m.feeRange ? [m.feeRange[0], m.feeRange.at(-1)] : [0, 0];
      return {
        title: 'Next',
        lines: [`${f.number(m.nTx)} tx`, `median ${f.rate(m.medianFee)} sat/vB`, `range ${f.rate(lo)}–${f.rate(hi)}`, `${f.btc(m.totalFees)} fees`],
        fill: Math.min(1, m.blockVSize / BLOCK_VSIZE),
      };
    },

    blockLine: (b) => `${F().number(b.tx_count)} tx · ${F().fixed(fill(b) * 100)}% full · ${b.extras?.pool?.name ?? 'unknown miner'} · ${F().date(b.timestamp)}`,

    nextLine: (m) => (m ? `mempool projection · ${F().number(m.nTx)} tx · median ${F().rate(m.medianFee)} sat/vB` : 'mempool projection'),

    // t: {txid, fee?, vsize?, value?} of a transaction entering the mempool
    feedRow: (t) => ({
      amount: t.value != null ? F().btc(t.value) : '—',
      rate: t.vsize ? `${F().rate((t.fee || 0) / t.vsize)} sat/vB` : '—',
    }),

    // Tooltip of a tower; a tower that belongs to the tracked wallet adds the amount it moved
    describeTower(t) {
      const f = F();
      const text = t.coinbase
        ? 'Coinbase (block reward)'
        : t.approx
          ? `${f.short(t.txid, 12, 8)}\n(size and fee unavailable)`
          : `${f.short(t.txid, 12, 8)}\n${t.rate.toFixed(1)} sat/vB · ${f.number(t.vsize)} vB\nfee ${f.number(t.fee)} sats`;
      const mine = BTC.walletCtl.entryOf(t.txid);
      return mine ? `${text}\n★ ${f.btcSigned(mine.net)} for ${f.short(BTC.state.wallet.address, 8, 6)}` : text;
    },

    // ----- data (mempool.space REST API: chains/bitcoin/data/api.js) -----
    data: {
      latestBlocks: () => BTC.api.blocks(),
      blocksFrom: (height) => BTC.api.blocksFrom(height),
      heightOf: async (hash) => (await BTC.api.blockBasic(hash)).height,
      hashOf: (height) => BTC.api.blockHash(height),
      blockTowers,
      recentTxs: () => BTC.api.recent(),
    },

    // ----- live (mempool.space WebSocket: chains/bitcoin/data/socket.js) -----
    live: {
      // the WebSocket speaks mempool.space's formats: transactions are turned into pending txs here
      connect: (h) => BTC.socket.connect({
        ...h,
        onTransactions: (txs) => h.onTransactions(txs.map(BTC.txs.normalizeProjected)),
        onTxids: (ids) => h.onTxids(ids.map((txid) => ({ txid }))),
      }),
      trackNext: () => BTC.socket.trackNextBlock(),
    },

    // The next block's towers: a full snapshot then deltas (chains/bitcoin/core/projection.js)
    createPending: () => BTC.projection.create(),

    // ----- hooks: the Bitcoin-only screens and features (all the files below are in chains/bitcoin/) -----
    openTx: (txid) => BTC.details.openTx(txid),
    openBlock: (hash) => BTC.details.openBlock(hash),
    search: (text) => BTC.searchCtl.run(text),                  // a height, a block hash, a txid or an address
    onHighlight: () => BTC.walletCtl.onSceneChange(),           // the towers lit for the tracked address may have changed
    onBlock() {
      BTC.statsCtl.maybeRefresh();                              // a new block moves the retarget progress
      BTC.walletCtl.onBlock();                                  // it may confirm transactions of the tracked address
    },
    onVisible() {
      BTC.walletCtl.catchUp();
      BTC.statsCtl.maybeRefresh();
    },

    start({ scene }) {
      const d = BTC.details;
      BTC.ui.detail.init({
        onOpenTx: d.openTx, onOpenBlock: d.openBlock, onOpenAddress: d.openAddress, onMoreTxs: d.moreAddressTxs,
        onShowInScene: scene ? () => { // light up the transactions of the address page in the 3D scene
          const a = d.shownAddress();
          if (!a) return;
          BTC.walletCtl.track(a.address, a.txs, a.summary);
          BTC.ui.dialog.close();
        } : null,
      });
      if (scene) { // the panel of the tracked address lives over the 3D view
        BTC.walletCtl.setDim(BTC.ui.tracker.init({
          format: (e) => F().btcSigned(e.net),
          onJump: BTC.walletCtl.jump, onOpenAddress: d.openAddress, onRefresh: BTC.walletCtl.refresh,
          onClear: BTC.walletCtl.clear, onMore: BTC.walletCtl.loadOlder, onDim: BTC.walletCtl.setDim,
        }).dim);
      }
      BTC.statsCtl.refresh();
      setInterval(BTC.statsCtl.refresh, BTC.chain.config.stats.refreshMs);
    },
  });
})();
