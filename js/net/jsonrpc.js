// JSON-RPC 2.0 over HTTP and WebSocket: the protocol several chains speak (Ethereum, Solana). Network only: no DOM, no
// app state, nothing about what the calls mean. A chain makes its own client with the nodes it wants.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});

  /**
   * An HTTP client. urls(): the nodes, tried in turn: when one fails (network error, timeout, HTTP error such as a rate
   * limit) the next is tried, and the one that answered is kept for the next calls. timeoutMs(): per request.
   * Returns { call(method, params), batch([[method, params], ...]) }.
   */
  const RATE_LIMIT = /rate|limit|too many|quota|busy|capacity|throttl/i; // a refusal because of the load: asking again, N times over, makes it worse

  function create({ urls, timeoutMs }) {
    let current = 0, nextId = 1;

    async function post(body) {
      const list = urls();
      let last;
      for (let k = 0; k < list.length; k++) {
        const i = (current + k) % list.length;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs());
        const t0 = Date.now();
        try {
          const res = await fetch(list[i], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
          if (!res.ok) { const err = new Error(`${res.status} ${list[i]}`); err.status = res.status; throw err; }
          const json = await res.json();
          if (json == null || typeof json !== 'object') throw new Error(`not JSON-RPC ${list[i]}`);
          if (!Array.isArray(json) && json.error && RATE_LIMIT.test(String(json.error.message ?? ''))) throw Object.assign(fail(json.error), { status: 429 }); // refused for load with an HTTP 200: the next node is tried like for an HTTP 429
          current = i;
          Explorer.diag?.count('http.ok'); Explorer.diag?.gauge('http.node', `${list[i]} (${Date.now() - t0} ms)`);
          return json;
        } catch (e) {
          last = e;
          Explorer.diag?.count('http.failed'); Explorer.diag?.note('net', `${list[i]} failed after ${Date.now() - t0} ms: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
        } finally { clearTimeout(timer); }
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
    const REFUSES_BATCHES = new Set([400, 403, 405, 413, 501]); // HTTP statuses of a node that does not take a batch (not 429: one by one would only add load)
    async function batch(calls) {
      if (!calls.length) return [];
      const ids = calls.map(() => nextId++);
      const one = async () => { // the calls one by one, a few at a time
        const out = [];
        for (let i = 0; i < calls.length; i += 6) out.push(...await Promise.all(calls.slice(i, i + 6).map(([method, params]) => call(method, params).catch((e) => e))));
        return out;
      };
      let json;
      try {
        json = await post(calls.map(([method, params], i) => ({ jsonrpc: '2.0', id: ids[i], method, params: params ?? [] })));
      } catch (e) {
        if (calls.length > 1 && REFUSES_BATCHES.has(e.status)) return one(); // refused as a whole, with an HTTP error
        throw e;
      }
      if (!Array.isArray(json)) { // refused as a whole, with a JSON-RPC error
        if (json.error && RATE_LIMIT.test(String(json.error.message))) throw fail(json.error);
        return one();
      }
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
   *   memoryKey:             (optional) a localStorage key where the nodes to leave alone are kept, so that a reload does not start with the node that just refused
   *   connectMs:             a connection that is not open after this long is given up (a node that never answers the handshake)
   * Returns ctl = { send(obj), ready(), close(), fail(why, ms), node }.
   */
  function socket({ urls, staleMs = 0, onOpen, onMessage, onClose, memoryKey = null, connectMs = 10000 }) {
    let ws = null, index = 0, retry = 0, watchdog = 0, timer = 0;
    // node -> { until, hard }: until when it is not tried first. Soft: it closed on us at once (or never opened): only not the first choice.
    // Hard: the page left it because it is overloaded: not tried before then (if every node is, the page waits for the first to come back).
    // Kept between page loads when asked to.
    const bad = new Map();
    try { for (const [node, until, hard] of JSON.parse(localStorage.getItem(memoryKey) ?? '[]')) if (until > Date.now()) bad.set(node, { until, hard: !!hard }); } catch { /* no storage, or nothing kept */ }
    const isBad = (node) => (bad.get(node)?.until ?? 0) > Date.now();
    const avoid = (node, ms, hard = false) => {
      const old = bad.get(node);
      bad.set(node, { until: Math.max(Date.now() + ms, old?.until ?? 0), hard: hard || !!(old?.hard && old.until > Date.now()) }); // a longer wait is never cut short
      if (memoryKey) { try { localStorage.setItem(memoryKey, JSON.stringify([...bad].filter(([, b]) => b.until > Date.now()).map(([n, b]) => [n, b.until, b.hard]))); } catch { /* storage unavailable */ } }
    };
    const heard = () => { // the connection is alive: the countdown starts again
      clearTimeout(watchdog);
      if (staleMs) watchdog = setTimeout(drop, staleMs);
    };
    /** Replaces a connection that went silent: a dead link may never finish a closing handshake, so it is not waited for. */
    function drop() {
      const old = ws;
      if (old) {
        old.onopen = old.onmessage = old.onclose = old.onerror = null;
        try { old.close(); } catch { /* already closed */ }
      }
      lost('connection silent: replaced');
    }
    /** The connection is gone (closed, failed to open, or dropped): tell the chain, try the next node later. */
    function lost(why = 'connection lost', stay = false) {
      clearTimeout(watchdog);
      Explorer.diag?.count('ws.lost'); Explorer.diag?.gauge('ws.state', 'down, next try in a moment'); Explorer.diag?.note('ws', why);
      ws = null;
      try { onClose(); } catch (e) { console.warn('socket onClose', e); } // the reconnection must not depend on the chain's handler
      if (!stay) index++; // the next node, in case this one is the problem (not after a connection that had been serving the page for a while: that was a blip)
      clearTimeout(timer);
      timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
    }
    const ctl = {
      /** The node of the open connection (null: none). */
      get node() { return ws ? ws.__node : null; },
      /** The page gives this connection up (the node is too busy...): the next node is tried, and this one is left alone for `ms`. */
      fail(why, ms = 120000) {
        if (!ws) return;
        ws.__left = true;
        avoid(ws.__node, ms, true);
        Explorer.diag?.note('ws', `leaving ${ws.__node}: ${why}`);
        ws.close();
      },
      /** Sends a message; false when it could not be (the socket is not open): the caller keeps it for the next connection. */
      send(obj) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(obj));
        return true;
      },
      ready() { retry = 0; },
      close() { if (ws) ws.close(); },
    };
    function open() {
      clearTimeout(timer);
      let sock;
      try {
        const list = urls();
        let skipped = 0; // a node that closed on us at once, or that the page left, is not the first choice again for a while
        while (skipped < list.length && isBad(list[(index + skipped) % list.length])) skipped++;
        if (skipped < list.length) index += skipped;
        else { // every node is set aside
          const waits = list.map((n) => bad.get(n));
          if (waits.every((b) => b && b.hard)) { // all of them overloaded: cycling among them would only add to the load; wait for the first one to come back
            const wait = Math.min(60000, Math.max(1000, Math.min(...waits.map((b) => b.until)) - Date.now()));
            Explorer.diag?.note('ws', `every node is overloaded: waiting ${Math.round(wait / 1000)} s`);
            Explorer.diag?.gauge('ws.state', `every node is overloaded, next try in ${Math.round(wait / 1000)} s`);
            timer = setTimeout(open, wait);
            return;
          }
        }
        const node = list[index % list.length];
        sock = new WebSocket(node); // throws on a bad URL, or a ws:// URL on an https page
        sock.__node = node;
      } catch (e) { console.warn('socket', e); lost(`could not open: ${e.message}`); return; }
      ws = sock;
      sock.__connect = setTimeout(() => { if (!sock.__opened) { Explorer.diag?.note('ws', `${sock.__node} did not open in ${Math.round(connectMs / 1000)} s`); sock.close(); } }, connectMs); // a node that never finishes the handshake
      sock.onopen = () => { clearTimeout(sock.__connect); sock.__opened = true; sock.__openedAt = Date.now(); heard(); Explorer.diag?.count('ws.open'); Explorer.diag?.gauge('ws.state', `open: ${sock.url}`); Explorer.diag?.note('ws', `open ${sock.url}`); onOpen(ctl.send, ctl); };
      sock.onmessage = (ev) => {
        heard();
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; } // ignore malformed frames
        onMessage(msg, ctl);
      };
      sock.onclose = (ev) => {
        clearTimeout(sock.__connect);
        const served = sock.__opened ? Date.now() - sock.__openedAt : 0;
        if (!sock.__left && served < 3000) avoid(sock.__node, 120000); // never opened, or closed within 3 s of opening: not worth trying first again (a node the page left has its own, longer, wait)
        if (ws === sock) lost(`closed by ${sock.__node} (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}${sock.__opened ? '' : ', never opened'})`, served > 30000);
      };
      sock.onerror = () => sock.close();
    }
    open();
    return ctl;
  }

  Explorer.jsonrpc = { create, socket };
})();
