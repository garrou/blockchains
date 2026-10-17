// The watched address: its transactions drawn in the 3D scene (their towers glow, a beacon rises from each) and listed in a panel
// over it. There is no history to ask a node for, so the list is made of what the page sees (see core/watch.js): the blocks it
// holds when the watch starts, then every block that comes in, and the pending transactions of the mempool sample.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const E = (Explorer.ethereum = Explorer.ethereum || {});
  const state = Explorer.state;
  const cfg = () => Explorer.chain.config.watch;

  const ui = () => Explorer.ui;
  const sync = () => Explorer.sceneSync;

  let timer = 0;              // next look at the mempool
  let dim = true;             // "dim the other transactions": a preference of the panel
  let frame = 0;              // pending animation frame of a refresh of the lit marks
  let byTxid = new Map();     // txid -> line of the watched address (tooltip of the scene)

  const linesOf = (w) => E.watch.list(w.pending, w.txs);
  const noteOf = (list) => new Map(list.filter((e) => e.pending).map((e) => [e.txid, 'in the mempool']));

  /** Draws the panel. */
  function render() {
    const w = state.wallet;
    if (!w) return;
    const list = linesOf(w);
    ui().tracker.render({
      address: w.address, entries: list, lit: sync().litTxids(), notes: noteOf(list), reach: w.since, more: false, busy: false, failed: false, dim,
      empty: 'Nothing yet: this page lists the transactions of the address that it sees from now on, and in the blocks it already holds.',
    });
  }

  /** The ids of the blocks of the page that hold transactions of the address: the scene outlines them. */
  const blocksOf = (list) => {
    const heights = new Set(list.filter((e) => !e.pending).map((e) => e.height));
    return new Set([...state.blocks, ...state.liveBlocks].filter((b) => heights.has(b.height)).map((b) => b.id));
  };

  /** Makes the scene and the panel match the watched address (or its absence). */
  function apply() {
    const w = state.wallet;
    if (!w) {
      byTxid = new Map();
      sync().setHighlight(null);
      ui().tracker.hide();
      return;
    }
    const list = linesOf(w);
    byTxid = new Map(list.map((e) => [e.txid, e]));
    sync().setHighlight({ txids: new Set(byTxid.keys()), blocks: blocksOf(list), dim });
    render();
  }

  /** The scene draws or removes towers: the panel shows which transactions are lit (many calls at once are merged). */
  function onSceneChange() {
    if (!state.wallet || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const w = state.wallet;
      if (w) ui().tracker.refreshLit(sync().litTxids(), noteOf(linesOf(w)));
    });
  }

  /** The block `b` and its transactions (core/txs.row): the lines of the address are added, and the block counts as looked at. */
  function scan(b, rows) {
    const w = state.wallet;
    if (!w) return;
    w.since = w.since == null ? b.height : Math.min(w.since, b.height);
    const mine = rows.map((r) => E.watch.entry(r, b, w.address)).filter(Boolean);
    if (mine.length) w.txs = E.watch.merge(w.txs, mine, cfg().max);
    apply();
  }

  /** Looks at the mempool sample: the pending transactions of the address. Only a change redraws. */
  function look() {
    const w = state.wallet;
    if (!w) return;
    const pending = E.live.pool.involving(w.address).map((p) => E.watch.pendingEntry(p, w.address));
    const same = pending.length === w.pending.length && pending.every((e, i) => e.txid === w.pending[i].txid);
    w.pending = pending;
    if (!same) apply();
  }

  function schedule() {
    clearTimeout(timer);
    if (!state.wallet) return;
    timer = setTimeout(() => { if (!document.hidden) look(); schedule(); }, cfg().pollMs);
  }

  /** The blocks the page already holds (the ones whose transactions are still in the cache of data/blocks.js). */
  function scanKnown() {
    const w = state.wallet;
    for (const b of [...Explorer.nav.liveBlocks(), ...state.blocks]) {
      const p = E.data.cached(b);
      if (p) p.then(({ rows }) => { if (state.wallet === w) scan(b, rows); }, () => {});
    }
  }

  /** Brings the camera to the block of a transaction. */
  async function jump(e) {
    if (!sync().active() || e.height == null) return;
    const loaded = state.blocks.find((b) => b.height === e.height);
    if (loaded) { Explorer.nav.focus(loaded.id); return; }
    try { // a block outside the loaded list: like a search for it
      await Explorer.nav.goToBlock({ height: e.height }, Explorer.requests.begin());
    } catch (err) {
      console.warn('watch jump', err);
      ui().hud.setMessage("Couldn't open this block right now.");
    }
  }

  /** Starts watching an address (any spelling of a valid one). */
  function track(address) {
    state.wallet = { address: address.toLowerCase(), txs: [], pending: [], since: null, busy: false, failed: false };
    apply();
    look();
    scanKnown();
    schedule();
    ui().tracker.reveal();
  }

  function clear() {
    clearTimeout(timer);
    state.wallet = null;
    apply();
  }

  E.watchCtl = {
    track, clear, jump, onSceneChange, scan,
    /** A block was mined: its transactions are read (the cache serves them when the scene read them first) and looked through. */
    onBlock(b) {
      const w = state.wallet;
      if (w) E.data.rowsOf(b).then(({ rows }) => { if (state.wallet === w) scan(b, rows); }, () => {});
    },
    /** Back to the tab: look at the mempool now. */
    catchUp() { if (state.wallet) look(); },
    /** The panel's reload button: the same as coming back to the tab, and the blocks held are looked through again. */
    refresh() { look(); scanKnown(); },
    setDim(on) { dim = on; if (state.wallet) apply(); },
    /** The line of the watched address for a transaction (undefined when it is not one of its). */
    entryOf: (txid) => byTxid.get(txid),
  };
})();
