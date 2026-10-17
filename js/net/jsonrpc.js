// JSON-RPC 2.0 over HTTP and WebSocket: the protocol several chains speak (Ethereum, Solana). Network only: no DOM, no
// app state, nothing about what the calls mean. A chain makes its own client with the nodes it wants.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});

  /**
   * An HTTP client. urls(): the nodes, tried in turn: when one fails (network error, timeout, HTTP error such as a rate
   * limit) the next is tried, and the one that answered is kept for the next calls. timeoutMs(): per request.
   * Returns { call(method, params), batch([[method, params], ...]) }.
   */
  function create({ urls, timeoutMs }) {
    let current = 0, nextId = 1;

    async function post(body) {
      const list = urls();
      let last;
      for (let k = 0; k < list.length; k++) {
        const i = (current + k) % list.length;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs());
        try {
          const res = await fetch(list[i], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
          if (!res.ok) { const err = new Error(`${res.status} ${list[i]}`); err.status = res.status; throw err; }
          const json = await res.json();
          current = i;
          return json;
        } catch (e) { last = e; } finally { clearTimeout(timer); }
      }
      throw last;
    }

    function fail(error) {
      const err = new Error(error.message || 'RPC error');
      err.code = error.code;
      err.rpc = true;
      return err;
    }

    /** One call: resolves with the result (null when the node says "no such thing"), rejects with an Error on a JSON-RPC error. */
    async function call(method, params = []) {
      const json = await post({ jsonrpc: '2.0', id: nextId++, method, params });
      if (json.error) throw fail(json.error);
      return json.result;
    }

    /**
     * Several calls in one HTTP request: -> an array, in the same order, holding each result or, for a call that failed,
     * an Error (one failure does not lose the others). A node that refuses batches gets the calls one by one.
     */
    async function batch(calls) {
      if (!calls.length) return [];
      const ids = calls.map(() => nextId++);
      const json = await post(calls.map(([method, params], i) => ({ jsonrpc: '2.0', id: ids[i], method, params: params ?? [] })));
      if (!Array.isArray(json)) return Promise.all(calls.map(([method, params]) => call(method, params).catch((e) => e))); // refused as a whole
      const byId = new Map(json.map((r) => [r.id, r]));
      return ids.map((id) => {
        const r = byId.get(id);
        return !r ? new Error('no answer') : r.error ? fail(r.error) : r.result;
      });
    }

    return { call, batch };
  }

  /**
   * A WebSocket that reconnects by itself, to the next of the nodes each time, with a growing delay.
   *   urls():                the nodes (ws:// URLs)
   *   staleMs:               a connection that says nothing for this long is considered dead (a silent drop is not always noticed) and replaced
   *   onOpen(send, ctl):     the connection is open: send the subscriptions. Call ctl.ready() once they are accepted: it resets the delay
   *   onMessage(msg, ctl):   a message (parsed JSON)
   *   onClose():             the connection was lost
   * Returns ctl = { send(obj), ready(), close() }.
   */
  function socket({ urls, staleMs = 0, onOpen, onMessage, onClose }) {
    let ws = null, index = 0, retry = 0, watchdog = 0;
    const heard = () => { // the connection is alive: the countdown starts again
      clearTimeout(watchdog);
      if (staleMs) watchdog = setTimeout(() => { if (ws) ws.close(); }, staleMs);
    };
    const ctl = {
      send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
      ready() { retry = 0; },
      close() { if (ws) ws.close(); },
    };
    function open() {
      const list = urls();
      ws = new WebSocket(list[index % list.length]);
      ws.onopen = () => { heard(); onOpen(ctl.send, ctl); };
      ws.onmessage = (ev) => {
        heard();
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; } // ignore malformed frames
        onMessage(msg, ctl);
      };
      ws.onclose = () => {
        clearTimeout(watchdog);
        onClose();
        index++; // the next node, in case this one is the problem
        setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
      };
      ws.onerror = () => ws.close();
    }
    open();
    return ctl;
  }

  BTC.jsonrpc = { create, socket };
})();
