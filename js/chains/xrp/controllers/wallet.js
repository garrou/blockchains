// The tracked account: the transactions of one address, drawn in the 3D scene (their towers glow, a beacon rises from each) and
// listed in a panel over it. The list is reloaded every `wallet.pollMs`, so a transaction that was just sent shows up by itself.
// Same idea as the Bitcoin wallet, with what `account_tx` gives: validated transactions only, a page at a time (a marker).
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});
  const S = Explorer.config.scene;
  const state = Explorer.state;
  const cfg = () => Explorer.chain.config.wallet;

  const ui = () => Explorer.ui;
  const sync = () => Explorer.sceneSync;

  let timer = 0;              // next reload
  let dim = true;             // "dim the other transactions": a preference of the panel
  let frame = 0;              // pending animation frame of a refresh of the lit marks
  let byTxid = new Map();     // txid -> line of the tracked account (tooltip of the scene)

  const linesOf = (w) => X.wallet.entries(w.txs);

  /** The first page of an account's transactions (or the next one: marker) -> { lines, marker }. */
  async function page(address, marker = null, priority = 1) {
    const res = await X.ws.call('account_tx', {
      account: address, ledger_index_min: -1, ledger_index_max: -1, limit: cfg().pageSize, ...(marker ? { marker } : {}),
    }, { priority });
    return { lines: (res.transactions ?? []).map((t) => X.wallet.entry(t, address)).filter(Boolean), marker: res.marker ?? null };
  }

  /** Draws the panel. */
  function render() {
    const w = state.wallet;
    if (!w) return;
    const list = linesOf(w);
    ui().tracker.render({
      address: w.address, entries: list, lit: sync().litTxids(), notes: new Map(), reach: X.wallet.reach(list),
      more: !!w.olderMarker, busy: w.busy, failed: w.failed, dim,
    });
  }

  /** The ids of the ledgers of the list that hold transactions of the account: the scene outlines them. */
  const blocksOf = (list) => {
    const heights = new Set(list.map((e) => e.height));
    return new Set(state.blocks.filter((b) => heights.has(b.height)).map((b) => b.id));
  };

  /** Makes the scene and the panel match the tracked account (or its absence). */
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
      if (w) ui().tracker.refreshLit(sync().litTxids(), new Map());
    });
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (!state.wallet) return;
    timer = setTimeout(() => (document.hidden ? schedule(cfg().pollMs) : refresh()), ms);
  }

  /** Reloads the first page of the account. */
  async function refresh() {
    const w = state.wallet;
    if (!w || w.busy) return;
    w.busy = true;
    ui().tracker.setBusy(true);
    try {
      const { lines, marker } = await page(w.address);
      if (state.wallet !== w) return; // stopped or replaced meanwhile
      const whole = !marker;
      w.txs = X.wallet.merge(w.txs, lines, { whole });
      if (w.pages === 1 || whole) w.olderMarker = marker; // no older page loaded yet: the marker of this page leads to the next one
      w.failed = false;
    } catch (e) {
      console.warn('wallet', e);
      if (state.wallet === w) w.failed = true;
    } finally {
      if (state.wallet === w) { w.busy = false; apply(); schedule(cfg().pollMs); }
    }
  }

  /** "Load older": the next page. */
  async function loadOlder() {
    const w = state.wallet;
    if (!w || w.busy || !w.olderMarker) return;
    w.busy = true;
    ui().tracker.setBusy(true);
    try {
      const { lines, marker } = await page(w.address, w.olderMarker, 0); // a person asked for it
      if (state.wallet !== w) return;
      const known = new Set(w.txs.map((e) => e.txid));
      w.txs.push(...lines.filter((e) => !known.has(e.txid)));
      w.olderMarker = marker;
      w.pages++;
      w.failed = false;
    } catch (e) {
      console.warn('wallet older', e);
      if (state.wallet === w) w.failed = true;
    } finally {
      if (state.wallet === w) { w.busy = false; apply(); schedule(cfg().pollMs); }
    }
  }

  /** Brings the camera to the ledger of a transaction. */
  async function jump(e) {
    if (!sync().active() || e.height == null) return;
    const loaded = state.blocks.find((b) => b.height === e.height);
    if (loaded) { Explorer.nav.focus(loaded.id); return; }
    try { // a ledger outside the loaded list: like a search for it
      await Explorer.nav.goToBlock({ height: e.height }, Explorer.requests.begin());
    } catch (err) {
      console.warn('wallet jump', err);
      ui().hud.setMessage("Couldn't open this ledger right now.");
    }
  }

  /**
   * Starts tracking an account with the transactions its page already holds (lines: core/wallet.entry; marker: where the next page
   * starts, null when it is the whole history). The camera goes to the newest transaction that is within reach, else to the newest one.
   */
  function track(address, lines, marker) {
    state.wallet = { address, txs: [...lines], olderMarker: marker, pages: 1, busy: false, failed: false };
    apply();
    schedule(cfg().pollMs);
    const list = linesOf(state.wallet);
    const first = list.find((e) => state.blocks.some((b) => b.height === e.height)) ?? list[0];
    if (first) jump(first);
    ui().tracker.reveal();
  }

  function clear() {
    clearTimeout(timer);
    state.wallet = null;
    apply();
  }

  X.walletCtl = {
    track, clear, refresh, loadOlder, jump, onSceneChange, page,
    /** A ledger closed: the outlines of the ledgers that hold transactions of the account are redrawn (the list itself is reloaded by the timer). */
    onBlock() { if (state.wallet) apply(); },
    /** Back to the tab: reload now rather than at the next tick. */
    catchUp() { if (state.wallet) schedule(0); },
    setDim(on) { dim = on; if (state.wallet) apply(); },
    /** The line of the tracked account for a transaction (undefined when it is not one of its). */
    entryOf: (txid) => byTxid.get(txid),
  };
})();
