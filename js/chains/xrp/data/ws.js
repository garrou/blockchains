// The line to the XRP Ledger servers: ONE WebSocket for everything. Commands go out as {id, command, ...} and come back as
// {id, type: 'response', status, result} (or an error); the ledgers that close are pushed as {type: 'ledgerClosed'}.
// One socket for both calls and events means the page needs no HTTP request (and no cross-origin permission from the servers).
// Network only: nothing about what the commands mean.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});
  const cfg = () => Explorer.chain.config;

  const NOT_FOUND = new Set(['lgrNotFound', 'ledgerNotFound', 'txnNotFound', 'actNotFound', 'entryNotFound', 'objectNotFound']);
  const TOO_BUSY = new Set(['tooBusy', 'slowDown']); // the public servers give each client a budget (about 2,000 units per 10 s)

  let ctl = null, open = false, nextId = 1, handlers = {};
  let inFlight = 0, pausedUntil = 0, pumpTimer = 0;
  const waiting = new Map(); // id -> { resolve, reject, timer, msg, sent (on the wire), counted (takes one of the places), retries, background }
  let queue = [];            // commands not sent yet: the ones a person asked for first, the background ones after

  function failure(msg) {
    const err = new Error(msg.error_message || msg.error || 'request failed');
    err.code = msg.error;                               // the server's word for it: "txnNotFound", "actMalformed"...
    if (NOT_FOUND.has(msg.error)) err.status = 404;     // the convention of the contract: an unknown block or transaction
    err.rpc = true;
    return err;
  }

  /** How long the server asks us to wait ("retry in ~6379ms"), within reason. */
  function retryDelay(msg) {
    const m = /retry in ~?(\d+)\s*ms/i.exec(msg.error_message ?? '');
    return Math.min(15000, Math.max(1000, m ? Number(m[1]) + 250 : 3000));
  }

  /** Sends what can be sent: at most `maxInFlight` commands at a time, none while the server asked for a pause. */
  function pump() {
    clearTimeout(pumpTimer);
    if (!open || !ctl) return;
    const wait = pausedUntil - Date.now();
    if (wait > 0) { pumpTimer = setTimeout(pump, wait); return; }
    while (inFlight < cfg().maxInFlight && queue.length) {
      const e = queue.shift();
      clearTimeout(e.queueTimer);
      e.sent = e.counted = true;
      inFlight++;
      e.timer = setTimeout(() => { if (waiting.has(e.msg.id)) { release(e); e.reject(new Error('timeout')); pump(); } }, cfg().rpcTimeoutMs);
      ctl.send(e.msg);
    }
  }

  /** The command is answered (or lost): its place is free. */
  function release(e) {
    waiting.delete(e.msg.id);
    clearTimeout(e.timer);
    if (e.counted) inFlight = Math.max(0, inFlight - 1);
    e.counted = false;
  }

  /**
   * One command: resolves with the `result`, rejects with an Error (`.status` 404 when the thing does not exist). Commands wait their
   * turn (see pump) and while the socket is down. opts.background: for what nobody is waiting for (it goes after the others).
   */
  function call(command, params = {}, opts = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const e = { resolve, reject, msg: { id, command, ...params }, sent: false, retries: 0, background: !!opts.background, timer: 0 };
      e.queueTimer = setTimeout(() => { // still not sent after a long wait: give up
        if (!e.sent && waiting.delete(id)) { queue = queue.filter((q) => q !== e); reject(new Error('timeout')); }
      }, cfg().queueTimeoutMs);
      waiting.set(id, e);
      const firstBackground = queue.findIndex((q) => q.background);
      if (e.background || firstBackground < 0) queue.push(e); else queue.splice(firstBackground, 0, e); // a person's command goes before the background ones
      pump();
    });
  }

  function onOpen(send, c) {
    ctl = c;
    open = true;
    inFlight = 0;
    const id = nextId++;
    const timer = setTimeout(() => { waiting.delete(id); c.close(); }, cfg().rpcTimeoutMs); // a server that does not answer the subscription is replaced
    waiting.set(id, {
      timer, sent: true, counted: false, msg: { id },
      resolve: (result) => { c.ready(); handlers.onSubscribed?.(result); },
      reject: () => c.close(),
    });
    send({ id, command: 'subscribe', streams: ['ledger'] }); // not counted: it is the one line that must open
    pump(); // what was asked while the socket was down
  }

  function onMessage(msg) {
    if (msg.type === 'response' && waiting.has(msg.id)) {
      const e = waiting.get(msg.id);
      if (msg.status === 'error' && TOO_BUSY.has(msg.error) && e.msg.command && e.retries < cfg().maxRetries) {
        // the server's budget is spent: wait as long as it says, then ask again (nothing is sent in between)
        release(e);
        e.retries++; e.sent = false;
        waiting.set(e.msg.id, e);
        queue.unshift(e);
        pausedUntil = Math.max(pausedUntil, Date.now() + retryDelay(msg));
        pump();
        return;
      }
      release(e);
      if (msg.status === 'error' || msg.error) e.reject(failure(msg)); else e.resolve(msg.result ?? msg);
      pump();
    } else if (msg.type === 'ledgerClosed') handlers.onLedger?.(msg);
  }

  function onClose() {
    open = false;
    inFlight = 0;
    clearTimeout(pumpTimer);
    for (const [id, e] of [...waiting]) { // what was on its way is lost; what was not sent yet waits for the next connection
      if (!e.sent) continue;
      waiting.delete(id);
      clearTimeout(e.timer);
      e.reject(new Error('connection lost'));
    }
    handlers.onClose?.();
  }

  X.ws = {
    call,
    /** handlers: onSubscribed(result) the subscription is accepted, onLedger(msg) a ledger closed, onClose(). */
    start(h) {
      handlers = h;
      return Explorer.jsonrpc.socket({ urls: () => cfg().ws, staleMs: cfg().wsStaleMs, onOpen, onMessage, onClose });
    },
  };
})();
