// Diagnostics: what the page has been doing with the network, kept in memory (a short log, counters, a few current values), for
// the panel opened with `?debug` (ui/diag.js) and its "Copy report". No DOM of its own (it listens for the page's errors and wraps console.warn / console.error). The page works the same without it; it only
// remembers, nothing is sent anywhere. It is loaded first so that every later file can note what it does.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});

  const MAX_EVENTS = 80;
  const events = [];      // { at (ms), kind ('warn' | 'error' | 'net' | 'ws' | 'info'), text }
  const counters = {};    // name -> number
  const gauges = {};      // name -> latest value
  const startedAt = Date.now();
  const listeners = new Set();

  /**
   * A key or a token in an address is not for a report that gets pasted into a chat, nor for a screenshot. Hidden: a query parameter
   * whose name says key / token / auth / secret / password ("?api-key=", "&access_token="...), the user:password of an address, and a
   * long segment of an address's path ("/v2/<key>" of Alchemy, "/v3/<key>" of Infura...), except a 64-digit hash or a 40-digit address.
   */
  const HASHLIKE = /^(?:0x)?(?:[0-9a-f]{64}|[0-9a-f]{40})$/i;
  const clean = (text) => String(text).replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (url) => url
    .replace(/\/\/[^/@\s]*@/, '//***@')
    .replace(/([?&;][\w.-]*(?:key|token|auth|secret|passw|sig)[\w.-]*=)[^&#\s]*/gi, '$1***')
    .replace(/\/([A-Za-z0-9_-]{20,})(?=[/?#]|$)/g, (m, seg) => (HASHLIKE.test(seg) ? m : '/***')));

  function note(kind, text) {
    events.push({ at: Date.now(), kind, text: clean(text) });
    if (events.length > MAX_EVENTS) events.shift();
    listeners.forEach((fn) => fn());
  }
  const count = (name, n = 1) => { counters[name] = (counters[name] ?? 0) + n; };
  const gauge = (name, value) => { gauges[name] = typeof value === 'string' ? clean(value) : value; };

  // what the page itself complains about
  for (const kind of ['warn', 'error']) {
    const original = console[kind];
    console[kind] = (...args) => {
      try { note(kind, args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 300)); } catch { /* a log must never break the page */ }
      original.apply(console, args);
    };
  }
  window.addEventListener('error', (e) => note('error', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => note('error', `unhandled: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));

  /** The whole report, as text: what to paste when something looks wrong. */
  function report() {
    const c = Explorer.chain;
    const lines = [
      `Explorer report · ${new Date().toISOString()} · open for ${Math.round((Date.now() - startedAt) / 1000)} s`,
      `page: ${clean(location.href.replace(/#.*$/, ''))}`, // what a person looked up (the #q= of a link) is not for a report
      `browser: ${navigator.userAgent}`,
      `screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}${document.hidden ? ' (tab hidden)' : ''}`,
      `chain: ${c ? `${c.id} (${c.name})` : 'not defined'}`,
      `nodes: ${c && c.config ? clean(JSON.stringify({ rpc: c.config.rpc, ws: c.config.ws, api: c.config.api })) : '-'}`,
      '', 'counters:', ...Object.entries(counters).sort().map(([k, v]) => `  ${k}: ${v}`),
      '', 'now:', ...Object.entries(gauges).sort().map(([k, v]) => `  ${k}: ${clean(typeof v === 'object' ? JSON.stringify(v) : v)}`),
      '', `last ${events.length} events (oldest first):`,
      ...events.map((e) => `  +${((e.at - startedAt) / 1000).toFixed(1)}s ${e.kind} ${e.text}`),
    ];
    return lines.join('\n');
  }

  Explorer.diag = {
    note, count, gauge, report,
    snapshot: () => ({ events: events.slice(), counters: { ...counters }, gauges: { ...gauges }, startedAt }),
    /** fn() is called when something is noted: the panel redraws. Returns a function that stops it. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
