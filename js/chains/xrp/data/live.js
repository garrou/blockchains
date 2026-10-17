// What the server pushes (Explorer.chain.live), over the WebSocket: each time a ledger closes, the page reads it and tells the
// engine. A validated ledger is final (no forks), so a ledger is told once and never replaced. There is no mempool the page can read:
// no next block and no pending transaction. Without the WebSocket the page has no data at all (it is the only line to the server).
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});
  const cfg = () => Explorer.chain.config;

  let handlers = {};
  let connected = false;
  let last = null;          // newest ledger told to the engine
  let headIndex = 0;        // newest ledger index heard of
  let busy = false;
  let lastBackfill = 0;
  let lastPush = Date.now(); // when the server last pushed a ledger (or the subscription was accepted)
  const heard = new Map();  // ledger index -> what the server pushed when it closed: enough to make the ledger's block without asking for it

  /** The newest ledger seen (from the list the engine loads): where the stream goes on from. */
  function noteTip(block) {
    if (!last || block.height > last.height) last = block;
    headIndex = Math.max(headIndex, block.height);
  }

  /** Reads and delivers the ledgers that closed since the last one, in order. */
  async function advance() {
    if (busy || !last) return;
    busy = true;
    try {
      while (headIndex > last.height) {
        if (headIndex - last.height > cfg().maxCatchUp) { // far behind (a sleeping tab): the engine reloads the list
          if (Date.now() - lastBackfill > 5000 && X.ws.waitSeconds() === 0) { lastBackfill = Date.now(); handlers.onOpen?.(); } // (not while the server asks to wait: the reload would be fifteen more reads into it)
          break;
        }
        const next = last.height + 1;
        const block = X.blocks.fromEvent(heard.get(next), last) ?? await X.data.light({ ledger_index: next }); // asked for only when the push did not say enough
        if (block.height > last.height) last = block; else break; // the list may have been reloaded (noteTip) while this one was read
        handlers.onBlock?.(block);
        heard.delete(next);
      }
    } catch (e) {
      console.warn('new ledger', e);
    } finally { busy = false; }
  }

  function onLedger(msg) {
    lastPush = Date.now();
    const index = Number(msg.ledger_index);
    if (!Number.isFinite(index) || index <= headIndex) return;
    headIndex = index;
    heard.set(index, msg);
    for (const k of heard.keys()) if (k < index - 30) heard.delete(k); // an old push that was never used
    advance();
  }

  X.live = {
    noteTip,
    headIndex: () => headIndex, // the newest ledger index heard of
    connect(h) {
      handlers = h;
      setInterval(() => { // the line answers (the page's own commands) but the ledgers no longer come: the subscription is stuck
        if (connected && !document.hidden && Date.now() - lastPush > cfg().ledgerQuietMs) { lastPush = Date.now(); Explorer.diag?.note('ws', 'no ledger pushed for a long time: reconnecting'); X.ws.reconnect(); }
      }, 10000);
      X.ws.start({
        onSubscribed(result) {
          connected = true;
          lastPush = Date.now();
          h.onStatus?.(true);
          const index = Number(result?.ledger_index);
          if (Number.isFinite(index)) headIndex = Math.max(headIndex, index);
          h.onOpen?.();
        },
        onLedger,
        onClose() {
          if (connected) h.onStatus?.(false);
          connected = false;
        },
      });
    },
    trackNext() {}, // nothing to track: there is no next block
  };
})();
