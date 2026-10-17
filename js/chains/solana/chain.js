// Solana, as the engine sees it (see the contract in js/core/chain.js): its numbers, its words, its data, its screens.
//
// How Solana maps to the engine's ideas:
//   block        one block out of every `sample` slots. Solana makes a block every 0.4 s; showing them all is more data than a
//                public node lets a browser read, so the page shows one in 10 (a block every 4 s). The number people know is the slot
//   tower        a transaction: its footprint is the COMPUTE UNITS it used, its height and color the PRIORITY FEE it paid per unit
//                (micro-lamports per compute unit). The base fee (5000 lamports per signature) is the same for everybody; the priority
//                fee is what people bid to be first. Most of a block is validators' votes: flat, dark, and numerous
//   next block   none: Solana has no mempool a page can read, so there is no "next" slot and no pending transaction
// Like Ethereum, a plain node gives no per-transaction history for the 3D view to light up: there is no tracked address panel here.
//
// Loaded before the engine files that read BTC.chain at load time (core/colors.js).
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const S = (BTC.sol = BTC.sol || {});
  const F = () => BTC.format;
  const X = () => S.format;

  BTC.defineChain({
    id: 'solana',
    name: 'Solana',

    // Constants only the Solana files read (BTC.chain.config.*)
    config: {
      // public JSON-RPC nodes (HTTP) and their WebSockets, tried in this order; change them to use your own node
      rpc: ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'],
      ws: ['wss://solana-rpc.publicnode.com', 'wss://api.mainnet-beta.solana.com'],
      rpcTimeoutMs: 25000,
      maxTxVersion: 1,                                // newest transaction version asked of the node at first (a node that wants more says so, see data/rpc.js)
      sample: 10,                                     // one block out of this many slots is shown (a slot lasts about 0.4 s)
      pageSize: 15,                                   // blocks per request of the block list
      txRef: 3000,                                    // a busy block, in transactions: what the card's fill bar is relative to
      maxCatchUp: 4,                                  // blocks the page may be behind before it asks the engine to reload the list
      wsStaleMs: 15000,                               // a WebSocket that says nothing for this long is dropped and opened again (a slot every 0.4 s)
      pollMs: 5000,                                   // looking at the head slot when the WebSocket is down
      feedPerBlock: 12,                               // transactions of each new block that go to the feed
      stats: { refreshMs: 15000, localMs: 2000 },     // the statistics bar: asked of the node / redrawn from what is held
      historyShown: 12,                               // transactions listed on an address page
      logLines: 40,                                   // lines of the program log shown on a transaction page
    },

    // Solana purple (the first color of the logo; the second, green, ends the color scale)
    theme: { accent: 0x9945ff },

    nextBlock: false,

    // ----- numbers -----
    capacity: { size: 60e6 },                         // compute units in a full block (the limit has been rising: 48M, 50M, 60M...)
    // Priority fees run from nothing (most transactions) to 1,000,000 micro-lamports per compute unit and more (the bots that bid
    // to be first), on a logarithmic scale; tower heights follow the position on it. The scale goes like the logo: deep violet,
    // Solana purple, blue, then green for the highest bids.
    rates: {
      unit: 'µlamports/CU', min: 1, max: 1e6, heightScale: 'position',
      stops: [[1, 0x241552], [30, 0x4a2aa8], [1000, 0x9945ff], [20000, 0x4d7bff], [100000, 0x00c2ff], [300000, 0x14f195], [1e6, 0xe6ff8a]],
      ticks: [1, 100, 1e4, 1e6],
      label: (r) => X().price(r),
    },
    fill: (b) => S.blocks.fill(b),
    typicalRate: () => undefined,

    // ----- words -----
    blockNumber: (b) => F().number(b.slot),

    blockCard: (b) => ({
      title: `#${F().number(b.slot)}`,
      lines: [`${F().number(b.tx_count)} tx`, b.blockHeight != null ? `height ${F().number(b.blockHeight)}` : '—'],
      fill: S.blocks.fill(b),
    }),

    blockLine: (b) => `${F().number(b.tx_count)} transactions · block height ${b.blockHeight != null ? F().number(b.blockHeight) : '—'} · one block in ${BTC.chain.config.sample} slots · ${F().date(b.timestamp)}`,

    // t: a tower of the newest block (see core/txs.js)
    feedRow: (t) => ({
      amount: t.moved > 0 ? X().sol(t.moved, 4) : '—',
      rate: `${X().price(t.rate)} µlamports/CU`,
    }),

    describeTower(t) {
      const f = F(), x = X();
      const lines = [
        f.short(t.txid, 12, 8),
        `${t.label}${t.ok ? '' : ' · FAILED'}`,
        `${x.price(t.rate)} µlamports/CU · ${x.cu(t.vsize)} CU`,
        `fee ${x.sol(t.fee, 6)}${t.priority > 0 ? ` (${x.sol(t.priority, 6)} priority)` : ''}`,
        t.moved > 0 ? `moves ${x.sol(t.moved, 5)}` : null,
      ];
      return lines.filter(Boolean).join('\n');
    },

    // ----- data (JSON-RPC: chains/solana/data/blocks.js) -----
    data: {
      latestBlocks: () => S.data.latestBlocks(),
      blocksFrom: (group) => S.data.blocksFrom(group),
      heightOf: (hash) => S.data.heightOf(hash),
      hashOf: (group) => S.data.hashOf(group),
      blockTowers: (b) => S.data.blockTowers(b),
      recentTxs: () => S.data.recentTxs(),
    },

    // ----- live (WebSocket: chains/solana/data/live.js) -----
    live: {
      connect: (h) => S.live.connect(h),
    },

    // ----- hooks: the Solana-only screens and features -----
    openTx: (sig) => S.details.openTx(sig),
    openBlock: (id) => S.details.openBlock(id),
    search: (text) => S.searchCtl.run(text),
    onBlock: () => S.statsCtl.refreshLocal(),
    onVisible: () => { S.statsCtl.refreshLocal(); S.statsCtl.refresh(); },

    start() {
      const d = S.details;
      BTC.ui.detail.init({ onOpenTx: d.openTx, onOpenSlot: d.openSlot, onOpenAddress: d.openAddress });
      S.statsCtl.start();
    },
  });
})();
