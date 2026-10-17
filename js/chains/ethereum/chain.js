// Ethereum, as the engine sees it (see the contract in js/core/chain.js): its numbers, its words, its data, its screens.
//
// How Ethereum maps to the engine's ideas:
//   block        a block (a new one every 12 s)
//   tower        a transaction: its footprint is the GAS it used (a pending one: its gas limit), its height and color the GAS PRICE it paid (gwei)
//   full block   the block gas limit (capacity.size). Blocks are meant to be half full (the "target"): the base fee rises
//                above it and falls below it, so a typical block covers half of its platform. Sizes are on the 60M scale for
//                every block: an older block, whose limit was lower, covers less than its card says
//   next block   a guess: the pending transactions this page has seen, best tip first, as many as fit (data/live.js)
// There is no address history to show: a plain node does not index addresses (that takes an indexer), so unlike on Bitcoin
// an address page shows its balance and nature, not its transactions.
//
// Loaded before the engine files that read Explorer.chain at load time (core/colors.js). What it delegates to is only called
// later, once every script has loaded.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const E = (Explorer.ethereum = Explorer.ethereum || {});
  const F = () => Explorer.format;
  const EF = () => E.format;

  const fill = (b) => (b.gasUsed || 0) / (b.gasLimit || 1);

  // The groups of transactions, with the color of each: here because the legend below needs them while this file loads (core/txs.js
  // says which group a transaction belongs to). The colors are used when the person colors the towers by kind instead of by price.
  const KINDS = E.kinds = {
    transfer: { label: 'ETH transfer', color: 0x4fb3f6 },
    token: { label: 'Token', color: 0x6fe3d4 },
    swap: { label: 'Swap / liquidity', color: 0xf7b955 },
    nft: { label: 'NFT', color: 0xff6b9a },
    call: { label: 'Contract call', color: 0xc77dff },
    create: { label: 'Contract creation', color: 0x8bd450 },
    blob: { label: 'Blob (rollup data)', color: 0xe5484d },
  };

  Explorer.defineChain({
    id: 'ethereum',
    name: 'Ethereum',

    // Constants only the Ethereum files read (Explorer.chain.config.*)
    config: {
      // public JSON-RPC nodes (HTTP) and their WebSockets, tried in this order; change them to use your own node
      rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth'],
      ws: ['wss://ethereum-rpc.publicnode.com', 'wss://eth.drpc.org'],
      rpcTimeoutMs: 15000,
      pageSize: 15,                                   // blocks per request of the block list
      gasLimit: 60e6,                                 // block gas limit until a block tells the real one
      wsStaleMs: 60000,                               // a WebSocket that says nothing for this long is dropped and opened again
      pollMs: 6000,                                   // looking for a new block when the WebSocket is down
      projectMs: 1000,                                // the guess of the next block is refreshed at most this often
      watch: { max: 200, pollMs: 2000 },              // the watched address: lines kept, and how often the mempool sample is looked through for its pending transactions
      pending: { fetchPerSec: 20, tickMs: 500 },      // pending transactions fetched per second (a sample of the mempool is enough)
      pool: { max: 4000, ttlMs: 20 * 60e3 },          // pending transactions kept, and how long
      stats: { refreshMs: 2000, finalityMs: 60000, dayMs: 600000, daySamples: 48 }, // the statistics bar: redrawn from the blocks held (cheap), finality asked of the node; the transactions of a day estimated every dayMs from daySamples blocks
      ensRegistry: '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e', // ENS: who resolves a name
      logsShown: 12,                                  // token movements listed on a transaction page
    },

    // Ethereum blue (the colour of the logo)
    theme: { accent: 0x627eea },

    // ----- numbers -----
    capacity: { size: 60e6 },                         // gas in a full block (the limit has been rising: 30M, 36M, 45M, 60M...)
    // Gas prices run from 0.01 gwei (cheap hours) to 100 (a rush: above, same color and height), on a logarithmic scale.
    // Prices live far below 1 most of the time, so tower heights follow the position on that scale ('position').
    rates: {
      unit: 'gwei', min: 0.01, max: 100, heightScale: 'position',
      stops: [[0.01, 0x2b2f7a], [0.1, 0x3a4fc4], [0.3, 0x627eea], [1, 0x4fb3f6], [3, 0x6fe3d4], [10, 0xc4f0a0], [30, 0xffd166], [100, 0xff5c8a]],
      ticks: [0.01, 0.1, 1, 10, 100],
    },
    // The towers are colored by price (the scale above) or, if the person chooses, by kind of transaction (this legend)
    colorSwitch: true,
    legend: { items: Object.values(KINDS).map(({ label, color }) => ({ label, color })) },
    fill,
    typicalRate: (b) => b.baseFee ?? undefined,

    // ----- words -----
    blockCard: (b) => ({
      title: `#${F().number(b.height)}`,
      lines: [`${F().number(b.tx_count)} tx · ${EF().gas(b.gasUsed)}`, b.baseFee != null ? `base ${EF().gwei(b.baseFee)} gwei` : '—', b.builder ? (b.builder.length > 17 ? `${b.builder.slice(0, 16)}…` : b.builder) : F().short(b.miner, 6, 4)], // a long builder name would make the card taller
      fill: Math.min(1, fill(b)),
    }),

    // m: the guess of the next block (data/live.js projectNow)
    nextCard: (m) => ({
      title: 'Next',
      lines: [
        `${F().number(m.nTx)} tx · ${EF().gas(m.gas)}`,
        m.baseFee != null ? `base ${EF().gwei(m.baseFee)} gwei` : '—',
        m.medianPrice != null ? `median ${EF().gwei(m.medianPrice)} gwei` : 'median —',
        `${F().number(m.waiting)} waiting`,
      ],
      fill: Math.min(1, m.gas / m.gasLimit),
    }),

    blockLine: (b) => `${F().number(b.tx_count)} tx · ${F().fixed(fill(b) * 100)}% full · ${b.builder ?? 'unknown builder'} · burned ${b.burnt.toFixed(3)} ETH · ${F().date(b.timestamp)}`,

    nextLine: (m) => (m ? `mempool sample · ${F().number(m.nTx)} tx fit · base fee ${EF().gwei(m.baseFee ?? NaN)} gwei${m.medianPrice != null ? ` · median ${EF().gwei(m.medianPrice)}` : ''}` : 'mempool sample'),

    // t: { txid, fee?, vsize?, valueWei? } of a transaction entering the mempool; fee / vsize is its price in gwei
    feedRow: (t) => ({
      amount: t.valueWei != null && t.valueWei > 0n ? EF().eth(t.valueWei, 4) : '—',
      rate: t.vsize ? `${EF().gwei(t.fee / t.vsize)} gwei` : '—',
    }),

    describeTower(t) {
      const f = F(), e = EF();
      const lines = [
        f.short(t.txid, 12, 8),
        `${E.txs.labelOf(t.kind, t.selector)}${t.ok === false ? ' · FAILED' : ''}`,
        `${e.gwei(t.rate)} gwei · ${e.gas(t.vsize)} gas${t.pending ? ' (limit)' : ''}`,
        t.feeWei != null ? `fee ${e.eth(t.feeWei, 5)}` : null,
        t.valueWei > 0n ? `sends ${e.eth(t.valueWei, 5)}` : null,
        t.pending ? 'waiting in the mempool' : null,
      ];
      const mine = E.watchCtl.entryOf(t.txid); // a tower of the watched address says what it did to its balance
      if (mine) lines.push(`★ ${e.ethSigned(mine.net, 5)} for ${f.short(Explorer.state.wallet.address, 8, 6)}`);
      return lines.filter(Boolean).join('\n');
    },

    // ----- data (JSON-RPC: chains/ethereum/data/blocks.js) -----
    data: {
      latestBlocks: () => E.data.latestBlocks(),
      blocksFrom: (height) => E.data.blocksFrom(height),
      heightOf: (hash) => E.data.heightOf(hash),
      hashOf: (height) => E.data.hashOf(height),
      blockTowers: async (b) => {
        const towers = await E.data.blockTowers(b);
        if (Explorer.state.wallet) E.data.rowsOf(b).then(({ rows }) => E.watchCtl.scan(b, rows), () => {}); // the transactions of the watched address, as the scene reads the block
        return towers;
      },
      recentTxs: () => E.data.recentTxs(),
    },

    // ----- live (WebSocket: chains/ethereum/data/live.js) -----
    live: {
      connect: (h) => E.live.connect(h),
      trackNext: () => E.live.trackNext(),
    },

    // The next block's towers: a full snapshot then deltas (chains/ethereum/core/projection.js)
    createPending: () => E.projection.create(),

    // ----- hooks: the Ethereum-only screens and features -----
    openTx: (hash) => E.details.openTx(hash),
    openBlock: (id) => E.details.openBlock(id),
    search: (text) => E.searchCtl.run(text),
    onHighlight: () => E.watchCtl.onSceneChange(),    // the towers lit for the watched address may have changed
    onBlock: (b) => { E.statsCtl.refresh(); E.watchCtl.onBlock(b); },
    onVisible: () => { E.statsCtl.refresh(); E.statsCtl.refreshFinality(); E.watchCtl.catchUp(); },

    start({ scene }) {
      const d = E.details;
      Explorer.ui.detail.init({
        onOpenTx: d.openTx, onOpenBlock: d.openBlock, onOpenAddress: d.openAddress,
        onWatch: scene ? (address) => { E.watchCtl.track(address); Explorer.ui.dialog.close(); } : null, // light up what the page sees of the address in the 3D scene
      });
      if (scene) { // the panel of the watched address lives over the 3D view
        E.watchCtl.setDim(Explorer.ui.tracker.init({
          format: (e) => (e.net !== 0n ? EF().ethSigned(e.net, 5) : e.label),
          onJump: E.watchCtl.jump, onOpenAddress: d.openAddress, onRefresh: E.watchCtl.refresh,
          onClear: E.watchCtl.clear, onMore: () => {}, onDim: E.watchCtl.setDim,
        }).dim);
      }
      E.statsCtl.start();
    },
  });
})();
