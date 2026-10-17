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
  const waiting = new Map(); // id -> { resolve, reject, timer, msg, sent (on the wire), counted (takes one of the places), retries, priority }
  let queue = [];            // commands not sent yet, by priority (0 a person is waiting, 1 the page loading what it draws, 2 background), then in order
  const busyListeners = new Set();

  function failure(msg) {
    const err = new Error(msg.error_message || msg.error || 'request failed');
    err.code = msg.error;                               // the server's word for it: "txnNotFound", "actMalformed"...
    if (NOT_FOUND.has(msg.error)) err.status = 404;     // the convention of the contract: an unknown block or transaction
    err.rpc = true;
    return err;
  }

  /** The server refuses because of the load: "tooBusy" / "slowDown", or any answer that says it in words. */
  const isBusy = (msg) => msg.status === 'error' && (TOO_BUSY.has(msg.error) || /rate limit|retry in ~?\d+\s*ms|too many requests/i.test(msg.error_message ?? ''));

  /** How long the server asks us to wait ("retry in ~6379ms"), within reason. */
  function retryDelay(msg) {
    const m = /retry in ~?(\d+)\s*ms/i.exec(msg.error_message ?? '');
    return Math.min(15000, Math.max(1000, m ? Number(m[1]) + 250 : 3000));
  }

  /** A command that waits to be sent gives up after a while (a person waits less than the page does). */
  function armQueueTimer(e) {
    clearTimeout(e.queueTimer);
    e.queueTimer = setTimeout(() => {
      if (!e.sent && waiting.delete(e.msg.id)) { queue = queue.filter((q) => q !== e); e.reject(new Error(e.priority === 0 ? 'the server is busy' : 'timeout')); }
    }, e.priority === 0 ? cfg().userQueueTimeoutMs : cfg().queueTimeoutMs);
  }

  /** Sends what can be sent: at most `maxInFlight` commands at a time, none while the server asked for a pause. */
  function pump() {
    clearTimeout(pumpTimer);
    if (!open || !ctl) return;
    const wait = pausedUntil - Date.now();
    if (wait > 0) { pumpTimer = setTimeout(pump, wait); return; }
    while (inFlight < cfg().maxInFlight && queue.length) {
      const e = queue[0];
      if (!ctl.send(e.msg)) return; // the socket is closing: the command stays in the queue for the next connection
      queue.shift();
      clearTimeout(e.queueTimer);
      e.sent = e.counted = true;
      inFlight++;
      e.timer = setTimeout(() => { if (waiting.has(e.msg.id)) { release(e); e.reject(new Error('timeout')); pump(); } }, cfg().rpcTimeoutMs);
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
   * Puts a command in the queue before the first one of a lower priority. First time: after the ones of its own priority. Again (`again`,
   * after a refusal or a lost connection): among them in the order they were first asked, so that a batch of retries keeps its order.
   */
  function enqueue(e, again = false) {
    const i = queue.findIndex((q) => (again ? q.priority > e.priority || (q.priority === e.priority && q.msg.id > e.msg.id) : q.priority > e.priority));
    if (i < 0) queue.push(e); else queue.splice(i, 0, e);
  }

  /** A command goes back in the queue to be asked again (not sent, a fresh wait). */
  function requeue(e) {
    release(e);
    e.retries++;
    e.sent = false;
    waiting.set(e.msg.id, e);
    enqueue(e, true);
    armQueueTimer(e);
  }

  /**
   * One command: resolves with the `result`, rejects with an Error (`.status` 404 when the thing does not exist). Commands wait their
   * turn (see pump) and while the socket is down. opts.priority: 0 (default) a person is waiting for it (a dialog, a search), 1 the page
   * is loading what it draws, 2 nobody is waiting for it. A command of a higher priority is sent first, retries included.
   */
  function call(command, params = {}, opts = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const e = { resolve, reject, msg: { id, command, ...params }, sent: false, counted: false, retries: 0, priority: opts.priority ?? 0, timer: 0, queueTimer: 0 };
      waiting.set(id, e);
      enqueue(e);
      armQueueTimer(e);
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
      if (isBusy(msg) && e.msg.command && e.retries < cfg().maxRetries) {
        // the server's budget is spent: wait as long as it says, then ask again (nothing is sent in between)
        requeue(e);
        pausedUntil = Math.max(pausedUntil, Date.now() + retryDelay(msg));
        busyListeners.forEach((cb) => cb(Math.ceil((pausedUntil - Date.now()) / 1000)));
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
    for (const e of [...waiting.values()]) { // what was on its way is asked again on the next connection (every command is a read); what was not sent waits
      if (!e.sent) continue;
      if (e.msg.command && e.retries < cfg().maxRetries) requeue(e);
      else { release(e); e.reject(new Error('connection lost')); }
    }
    handlers.onClose?.();
  }

  X.ws = {
    call,
    /** cb(seconds) is called when the server asks the page to wait ("tooBusy"): to tell the person who is waiting. Returns a function that stops it. */
    onBusy(cb) { busyListeners.add(cb); return () => busyListeners.delete(cb); },
    /** Seconds the page has been asked to wait still (0 when nothing is paused): for a dialog that waits, to say so and count down. */
    waitSeconds: () => Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000)),
    /** handlers: onSubscribed(result) the subscription is accepted, onLedger(msg) a ledger closed, onClose(). */
    start(h) {
      handlers = h;
      return Explorer.jsonrpc.socket({ urls: () => cfg().ws, staleMs: cfg().wsStaleMs, onOpen, onMessage, onClose });
    },
  };
})();
