// The watched address: its transactions drawn in the 3D scene (their towers glow, a beacon rises from each) and listed in a panel
// over it. The list is reloaded every `watch.pollMs`: only what is new since the newest line is asked for.
// A block of this page is one slot out of ten, so only the towers of the slots the page shows can glow: the panel says how many do.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const S = (Explorer.solana = Explorer.solana || {});
  const state = Explorer.state;
  const cfg = () => Explorer.chain.config.watch;

  const ui = () => Explorer.ui;
  const sync = () => Explorer.sceneSync;

  let timer = 0;              // next reload
  let dim = true;             // "dim the other transactions": a preference of the panel
  let frame = 0;              // pending animation frame of a refresh of the lit marks
  let byTxid = new Map();     // txid -> line of the watched address (tooltip of the scene)

  /** A page of signatures of an address: `limit` of them, newest first, after `before` / up to `until` (exclusive). */
  const signatures = (address, limit, extra = {}) =>
    S.rpc.call('getSignaturesForAddress', [address, { limit, commitment: 'confirmed', ...extra }]).then((res) => (Array.isArray(res) ? res : []));

  /** Draws the panel. */
  function render() {
    const w = state.wallet;
    if (!w) return;
    ui().tracker.render({
      address: w.address, entries: w.txs, lit: sync().litTxids(), notes: new Map(), reach: S.watch.reach(w.txs),
      more: w.more, busy: w.busy, failed: w.failed, dim, empty: w.busy ? 'Loading…' : 'No transaction yet.',
    });
  }

  /** The ids of the blocks of the page that hold transactions of the address: the scene outlines them. */
  const blocksOf = (list) => {
    const heights = new Set(list.map((e) => e.height));
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
    byTxid = new Map(w.txs.map((e) => [e.txid, e]));
    sync().setHighlight({ txids: new Set(byTxid.keys()), blocks: blocksOf(w.txs), dim });
    render();
  }

  /** The scene draws or removes towers: the panel shows which transactions are lit (many calls at once are merged). */
  function onSceneChange() {
    if (!state.wallet || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (state.wallet) ui().tracker.refreshLit(sync().litTxids(), new Map());
    });
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (!state.wallet) return;
    timer = setTimeout(() => (document.hidden ? schedule(cfg().pollMs) : refresh()), ms);
  }

  /** Reloads: the first page, or what came after the newest line (a whole page of news starts the list again from it). */
  async function refresh() {
    const w = state.wallet;
    if (!w || w.busy) return;
    w.busy = true;
    ui().tracker.setBusy(true);
    try {
      const newest = w.txs[0]?.txid;
      const limit = newest ? cfg().pollLimit : cfg().pageSize;
      const list = await signatures(w.address, limit, newest ? { until: newest } : {});
      if (state.wallet !== w) return; // stopped or replaced meanwhile
      const lines = list.map(S.watch.entry).filter(Boolean);
      if (!newest || list.length >= limit) { w.txs = lines; w.more = list.length >= limit; } // the first page, or more news than a page holds: the ones in between cannot be told
      else w.txs = S.watch.merge(lines, w.txs);
      w.txs = w.txs.slice(0, cfg().max);
      w.failed = false;
    } catch (e) {
      console.warn('watch', e);
      if (state.wallet === w) w.failed = true;
    } finally {
      if (state.wallet === w) { w.busy = false; apply(); schedule(cfg().pollMs); }
    }
  }

  /** "Load older": the page before the oldest line. */
  async function loadOlder() {
    const w = state.wallet;
    if (!w || w.busy || !w.more || !w.txs.length) return;
    w.busy = true;
    ui().tracker.setBusy(true);
    try {
      const list = await signatures(w.address, cfg().pageSize, { before: w.txs.at(-1).txid });
      if (state.wallet !== w) return;
      w.txs = S.watch.merge(w.txs, list.map(S.watch.entry).filter(Boolean)).slice(0, cfg().max);
      w.more = list.length >= cfg().pageSize && w.txs.length < cfg().max;
      w.failed = false;
    } catch (e) {
      console.warn('watch older', e);
      if (state.wallet === w) w.failed = true;
    } finally {
      if (state.wallet === w) { w.busy = false; apply(); schedule(cfg().pollMs); }
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

  /** Starts watching an address: the first page is read now. */
  function track(address) {
    clearTimeout(timer);
    state.wallet = { address, txs: [], more: false, busy: false, failed: false };
    apply();
    refresh();
    ui().tracker.reveal();
  }

  function clear() {
    clearTimeout(timer);
    state.wallet = null;
    apply();
  }

  S.watchCtl = {
    track, clear, refresh, loadOlder, jump, onSceneChange,
    /** A block came in: the outlines are redrawn (the list itself is reloaded by the timer). */
    onBlock() { if (state.wallet) apply(); },
    /** Back to the tab: reload now rather than at the next tick. */
    catchUp() { if (state.wallet) schedule(0); },
    setDim(on) { dim = on; if (state.wallet) apply(); },
    /** The line of the watched address for a transaction (undefined when it is not one of its). */
    entryOf: (txid) => byTxid.get(txid),
  };
})();
