// Navigation: which blocks are loaded and shown (live list, history, searched block), where the camera is, what the
// block row and the HUD display. Reads/writes the state; delegates drawing to the views and the scene to scene-sync.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const S = Explorer.config.scene;
  const state = Explorer.state;

  const ui = () => Explorer.ui;
  const sync = () => Explorer.sceneSync;
  let loadingOlder = false;
  let liveRequest = 0; // identifies the latest "back to live" request: a newer navigation cancels an older one still loading

  // ----- views -----

  function refreshHud() {
    if (state.focusId === S.nextId) ui().hud.showNext(state.upcoming[0]);
    else {
      const b = state.blocks.find((x) => x.id === state.focusId);
      if (b) ui().hud.showBlock(b);
    }
  }

  function updateMoreButton() {
    if (loadingOlder) return;
    const oldest = state.blocks.at(-1);
    ui().blocksRow.setMore(oldest && oldest.height > 0
      ? { title: '+ Older', sub: `before #${Explorer.chain.blockNumber(oldest)}` }
      : { hidden: true }); // nothing older than the genesis block
  }

  function renderRow(freshId = null) {
    Explorer.diag?.gauge('blocks', `${state.blocks.length} held, tip ${state.tip}${state.detached ? ', detached' : ''}`);
    ui().blocksRow.renderBlocks(state.blocks, { selectedId: state.selectedId, freshId });
    updateMoreButton();
  }

  // ----- camera -----

  function setFollow(on) { state.follow = on; ui().hud.setFollow(on); }

  /** Moves the camera to a slot ('next' or a block id). A manual choice (auto = false) turns "follow" off. */
  function focus(id, auto = false) {
    if (!sync().active()) return;
    if (!auto) { setFollow(false); liveRequest++; } // a manual choice also cancels a pending "back to live"
    if (id === S.nextId && state.detached) { showLive(S.nextId); return; } // the next block belongs to the live chain
    state.focusId = id;
    state.selectedId = id === S.nextId ? null : id;
    const shown = id === S.nextId ? null : state.blocks.find((b) => b.id === id);
    if (!auto && shown) Explorer.link?.setCamera(String(Explorer.chain.blockNumber(shown)).replace(/\D/g, '')); // the block a person chose: a link to it
    sync().sync(); // the 3D window slides with the camera; the chain itself never moves, so the camera only glides along it
    sync().focus(id);
    ui().blocksRow.select(id);
    refreshHud();
  }

  /**
   * Back to the live window (latest blocks + next block). Coming back from a searched block (detached list) fetches the
   * latest blocks first, and the current view stays untouched (and usable) until they are here; if the request fails,
   * we stay where we are. thenFocus: slot to select afterwards (default: the latest block).
   */
  async function showLive(thenFocus = null) {
    const request = ++liveRequest;
    if (state.detached) {
      let list;
      try { list = await Explorer.chain.data.latestBlocks(); } catch (e) {
        console.warn('blocks', e);
        setFollow(false);
        ui().hud.setMessage("Couldn't reload the latest blocks. Try again.");
        return;
      }
      if (request !== liveRequest || !state.detached) return; // cancelled by a newer navigation
      state.detached = false;
      state.tip = Math.max(state.tip, Explorer.blocks.tipOf(list));
      // the blocks that came by WebSocket while the list was loading are newer than it: they go on top of it
      const newer = state.liveBlocks.filter((b) => b.height > Explorer.blocks.tipOf(list));
      state.blocks = Explorer.blocks.merge(Explorer.blocks.merge([], list), newer).slice(0, MAX_BLOCKS);
      renderRow();
      sync().sync();
      const hole = newer.length && newer.at(-1).height > Explorer.blocks.tipOf(list) + 1;
      if (hole || state.tip > Explorer.blocks.tipOf(state.blocks)) loadBlocks(); // a block was mined while the list was loading, or one was missed
    }
    sync().publishNow();
    const target = thenFocus ?? state.blocks[0]?.id;
    if (target) focus(target, true);
  }

  /** The "follow the latest block" toggle changed. */
  function onFollow(on) {
    state.follow = on;
    if (!on || !sync().active() || !state.blocks.length) return;
    if (state.detached) showLive(); else focus(state.blocks[0].id, true);
  }

  // ----- block list -----

  /** The camera must not stay on a block that is no longer in the list (replaced by a chain reorganization). */
  function ensureFocusExists() {
    if (!sync().active() || !state.blocks.length) return;
    if (state.focusId !== S.nextId && !state.blocks.some((x) => x.id === state.focusId)) focus(state.blocks[0].id, true);
  }

  const MAX_BLOCKS = 500; // blocks held, newest first: the oldest fall off (a page of "older" blocks is about 15)

  /**
   * The latest blocks merged into `old`, unless there is a gap between them (the page was away for longer than a page of blocks: a
   * sleeping tab, a lost connection): then `list` replaces `old`, because a list with a hole is worse than a short one.
   */
  function joinLatest(old, list) {
    const gap = old.length && list.length && Explorer.blocks.tipOf(old) < list.at(-1).height - 1;
    return Explorer.blocks.merge(gap ? [] : old, list);
  }

  /** A new block was mined (WebSocket). */
  function addBlock(b) {
    state.tip = Math.max(state.tip, b.height);
    if (!state.detached && state.blocks.some((x) => x.id === b.id)) return;
    sync().resetProjection(); // the next block is recomputed, whatever we are looking at
    if (state.detached) { // browsing a searched block: the live list is reloaded when coming back; meanwhile it is only kept for the statistics
      state.liveBlocks = Explorer.blocks.merge(state.liveBlocks, [b]).slice(0, MAX_BLOCKS);
      const below = state.liveBlocks.find((x) => x.height === b.height - 1);
      if (state.liveBlocks.length > 1 && !below) loadBlocks(); // a missed block: the live list is mended (see refreshBlocks)
      return;
    }
    state.blocks = Explorer.blocks.merge(state.blocks, [b]).slice(0, MAX_BLOCKS);
    renderRow(b.id);
    // the new block must sit on the block we have just below it; if not (a missed block, a deeper reorganization),
    // load the latest blocks again
    const parent = state.blocks.find((x) => x.height === b.height - 1);
    if (state.blocks.length > 1 && (!parent || (b.previousblockhash && parent.id !== b.previousblockhash))) loadBlocks();
    if (!sync().active()) return;
    if (!state.follow) ensureFocusExists(); // the camera must not stay on a block that has just dropped out of the list: before the scene is drawn around it
    sync().sync(b.id);
    if (state.follow) focus(b.id, true);
  }

  /** Merges the latest blocks into the state (startup, and backfill after a WebSocket reconnect). */
  async function refreshBlocks() {
    const list = await Explorer.chain.data.latestBlocks();
    state.tip = Math.max(state.tip, Explorer.blocks.tipOf(list));
    if (state.detached) { state.liveBlocks = joinLatest(state.liveBlocks, list); return; } // the live list is rebuilt when coming back
    const merged = joinLatest(state.blocks, list);
    if (Explorer.blocks.sameList(merged, state.blocks)) return; // nothing new
    const first = !state.blocks.length;
    state.blocks = merged;
    renderRow();
    if (!sync().active()) return;
    if (!first) sync().resetProjection();
    sync().sync();
    if (first || state.follow) focus(state.blocks[0].id, true); else ensureFocusExists();
  }

  /** refreshBlocks with retries and a growing delay while the API is unavailable. */
  function loadBlocks(attempt = 0) {
    refreshBlocks().catch((e) => {
      console.warn('blocks', e);
      setTimeout(() => loadBlocks(attempt + 1), Math.min(30000, 2000 * 2 ** attempt));
    });
  }

  /** "+ Older": loads one more page of older blocks. */
  async function loadOlder() {
    const oldest = state.blocks.at(-1);
    if (loadingOlder || !oldest || oldest.height <= 0) return;
    loadingOlder = true;
    let failed = false;
    ui().blocksRow.setMore({ disabled: true, title: 'Loading…', sub: ' ' });
    try {
      const list = await Explorer.chain.data.blocksFrom(oldest.height - 1); // a page of blocks, newest first, starting at that height
      if (!Array.isArray(list) || !list.length) throw new Error('no blocks');
      if (state.blocks.at(-1)?.id !== oldest.id) return; // the list was replaced meanwhile (search, back to live): drop this page
      state.blocks = Explorer.blocks.merge(state.blocks, list);
      renderRow();
      if (sync().active()) {
        sync().sync(); // the chain goes on: the new blocks within reach of the camera appear next to the old ones
        if (state.focusId === oldest.id) focus(list[0].id, true); // the camera was at the end of the chain: it carries on
      }
      ui().blocksRow.reveal(list[0].id);
    } catch (e) {
      console.warn('older blocks', e);
      failed = true;
    } finally {
      loadingOlder = false;
      if (failed) ui().blocksRow.setMore({ title: 'Retry', sub: 'loading failed' });
      else updateMoreButton();
    }
  }

  /**
   * Shows a block (by hash or height) in the 3D scene. A block outside the loaded history replaces the list by the
   * blocks around it ("detached" from the live list). token: a request token (controllers/requests.js).
   * Rejects (with `.status` for HTTP errors) when the block does not exist.
   */
  async function goToBlock(query, token) {
    if (!sync().active()) { // no 3D: open the details, after checking the block exists (a 404 lets the search try a tx instead)
      const hash = query.hash ?? await Explorer.chain.data.hashOf(query.height);
      await Explorer.chain.data.heightOf(hash);
      if (!Explorer.requests.isCurrent(token)) return; // a newer search took over while we were waiting
      return Explorer.chain.openBlock(hash);
    }
    const height = query.height ?? await Explorer.chain.data.heightOf(query.hash);
    if (!Explorer.requests.isCurrent(token)) return;
    if (state.tip && height > state.tip) throw new Error('height above the latest block');
    // a searched hash must be the block the list holds at that height: an orphaned block still has a height, but it is not what is drawn there
    const sameBlock = (b) => !query.hash || String(b.id).toLowerCase() === String(query.hash).toLowerCase();
    const orphan = () => new Error('this block is no longer on the main chain (another one took its height)');
    let target = state.blocks.find((b) => b.height === height);
    if (target && !sameBlock(target)) throw orphan();
    if (!target) {
      const list = await Explorer.chain.data.blocksFrom(Math.min(height + 2, state.tip || height + 2)); // 2 newer blocks + the target + older ones
      if (!Explorer.requests.isCurrent(token)) return;
      target = list.find((b) => b.height === height);
      if (!target) throw new Error('no block at this height');
      if (!sameBlock(target)) throw orphan();
      if (!state.detached) state.liveBlocks = state.blocks; // the live list stays available for the statistics
      state.detached = true;
      state.blocks = list;
      renderRow();
      sync().sync();
    }
    ui().dialog.close();
    focus(target.id); // manual choice: turns "follow" off and moves the camera (the 3D window slides with it)
  }

  /** The latest blocks, newest first: the live list even while the view is detached on a searched block. */
  const liveBlocks = () => (state.detached ? state.liveBlocks : state.blocks);

  Explorer.nav = { focus, onFollow, addBlock, refreshBlocks, loadBlocks, loadOlder, goToBlock, refreshHud, liveBlocks };
})();
