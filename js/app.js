// Entry point: creates the views and the optional 3D scene, connects the data sources, wires everything together.
// It is the engine's: everything specific to a blockchain goes through BTC.chain (js/core/chain.js).
// Layers (script order in index.html): core/ (pure logic) -> state/ -> scene/ (Three.js) -> ui/ (DOM views)
// -> controllers/ (orchestration) -> this file; the chain's own files (js/chains/<name>/) load between them.
(() => {
  'use strict';
  const BTC = window.BTC;
  const { $ } = BTC.dom;
  const F = BTC.format;
  const { nextId } = BTC.config.scene;
  const { state, nav } = BTC;
  const chain = BTC.chain;
  const ui = BTC.ui;

  // ----- 3D scene (optional: needs Three.js and WebGL) -----
  let scene = null;
  try {
    scene = BTC.scene3d?.create($('#scene'), {
      tooltip: $('#tip3d'),
      describe: chain.describeTower, // tooltip text: the chain's words
      onPick: (t) => chain.openTx(t.txid),
      onFocus: (id) => nav.focus(id),
      onHighlight: () => chain.onHighlight(),
    }) ?? null;
  } catch (e) { console.warn('3D scene unavailable (no WebGL?)', e); scene = null; }

  // ----- views -----
  ui.dialog.init();
  ui.feed.init({ onOpenTx: chain.openTx });
  ui.blocksRow.init({
    onSelect: (id) => (scene ? nav.focus(id) : chain.openBlock(id)), // without 3D, a click opens the details
    onOpen: chain.openBlock,
    onSelectNext: () => nav.focus(nextId),
    onLoadOlder: nav.loadOlder,
  });
  const prefs = ui.hud.init({
    onFollow: nav.onFollow,
    onOrder: (mode) => BTC.sceneSync.setOrder(mode),
    onPlacement: (mode) => BTC.sceneSync.setPlacement(mode),
    onDetails: () => state.selectedId && chain.openBlock(state.selectedId),
  });
  if (scene) {
    BTC.sceneSync.init(scene);
    BTC.sceneSync.setOrder(prefs.order);
    BTC.sceneSync.setPlacement(prefs.placement);
  } else ui.hud.hideStage();

  // ----- search -----
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (q) chain.search(q);
  });

  // ----- data sources -----
  chain.live.connect({
    onStatus: ui.hud.setStatus,
    onOpen: () => nav.refreshBlocks().catch((e) => console.warn('blocks', e)), // backfill the blocks mined while offline
    onBlock(b) { nav.addBlock(b); chain.onBlock(b); },
    onUpcoming(list) {
      state.upcoming = list;
      ui.blocksRow.renderUpcoming(list, state.focusId === nextId);
      if (state.focusId === nextId) nav.refreshHud();
    },
    onProjected(raw) { if (scene) BTC.feedCtl.ingest(BTC.sceneSync.onProjected(raw)); },
    onTransactions: BTC.feedCtl.ingest,
    onTxids: BTC.feedCtl.ingest,
  });

  nav.loadBlocks();
  chain.start({ scene }); // the chain's own screens and timers
  BTC.feedCtl.poll();
  setInterval(BTC.feedCtl.poll, BTC.config.feed.pollMs);
  setInterval(BTC.feedCtl.flush, BTC.config.feed.flushMs);
  setInterval(ui.blocksRow.refreshAgo, 30000);
  document.addEventListener('visibilitychange', () => { // back to the tab: catch up now rather than at the next tick
    if (document.hidden) return;
    ui.blocksRow.refreshAgo();
    chain.onVisible();
    BTC.feedCtl.poll();
  });
})();
