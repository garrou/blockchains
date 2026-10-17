// What the engine asks the network for, in XRP Ledger words (Explorer.chain.data): ledgers, their transactions as towers.
// Reads the server through data/ws.js.
//
// Two reads of a ledger: with only the hashes of its transactions (light: the list of ledgers and their number of
// transactions), and with every transaction and its metadata (full, 100 KB or more: for the ledgers the scene draws).
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});
  const cfg = () => Explorer.chain.config;

  function notFound(what) {
    const err = new Error(`${what} not found`);
    err.status = 404; // the convention of the contract: an unknown block or transaction
    return err;
  }

  const light = (by, opts) => X.ws.call('ledger', { ...by, transactions: true, expand: false }, { priority: 1, ...opts }).then(X.blocks.normalize); // the page loading its list: after what a person asked

  /**
   * The ledgers of these indexes (newest first). A ledger the server does not have (404: older than its history) is skipped; any
   * other failure (rate limit, timeout...) fails the whole read, so that it is made again: a list with holes is worse than none.
   */
  async function ledgers(indexes) {
    const res = await Promise.allSettled(indexes.map((i) => light({ ledger_index: i })));
    const failed = res.find((r) => r.status === 'rejected' && r.reason?.status !== 404);
    if (failed) throw failed.reason;
    const blocks = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!blocks.length) throw res[0]?.reason ?? notFound('ledger');
    return blocks;
  }

  const range = (top) => Array.from({ length: cfg().pageSize }, (_, i) => top - i).filter((n) => n >= 0);

  let reading = null; // the read of the latest ledgers under way: the start-up asks twice (the list, the subscription), the second one shares it
  function latestBlocks() {
    reading ??= (async () => {
      const head = await light({ ledger_index: 'validated' });
      X.live.noteTip(head); // the stream goes on from here, whatever happens to the rest
      const rest = head.height > 0 ? await ledgers(range(head.height - 1).slice(0, cfg().pageSize - 1)) : [];
      return [head, ...rest];
    })().finally(() => { reading = null; });
    return reading;
  }

  const blocksFrom = (height) => ledgers(range(height));

  async function heightOf(hash) {
    const l = await X.ws.call('ledger', { ledger_hash: hash });
    const index = Number(l.ledger_index ?? l.ledger?.ledger_index);
    if (!Number.isFinite(index)) throw notFound('ledger');
    return index;
  }

  async function hashOf(height) {
    const l = await X.ws.call('ledger', { ledger_index: height });
    const hash = l.ledger_hash ?? l.ledger?.ledger_hash;
    if (!hash) throw notFound('ledger');
    return hash;
  }

  // ----- the transactions of a ledger -----
  const cache = new Map(); // ledger hash -> Promise<{ block, rows }>, most recently used last
  const KEEP = 12;
  let latest = null;       // { height, rows } of the newest ledger whose transactions were read: the feed's source
  let lastFailure = 0;     // when the last read for the feed failed (no 3D)

  async function load(id, priority) {
    const res = await X.ws.call('ledger', { ledger_hash: id, transactions: true, expand: true }, { priority });
    const block = X.blocks.normalize(res);
    const list = res.ledger?.transactions ?? [];
    const rows = list.map(X.txs.row).filter(Boolean);
    if (!latest || block.height >= latest.height) latest = { height: block.height, rows };
    return { block, rows };
  }

  /**
   * A ledger with every transaction as a row (in ledger order). b: anything with an `id` (the hash). Cached.
   * priority: 1 (default) the page loads what it draws, 0 a person waits for it (see data/ws.js).
   */
  function rowsOf(b, priority = 1) {
    if (!b || !b.id) return Promise.reject(notFound('ledger'));
    let p = cache.get(b.id);
    if (p) { cache.delete(b.id); cache.set(b.id, p); return p; }
    p = load(b.id, priority);
    p.catch(() => { if (cache.get(b.id) === p) cache.delete(b.id); });
    cache.set(b.id, p);
    while (cache.size > KEEP) cache.delete(cache.keys().next().value);
    return p;
  }

  /** The towers of a ledger: one per transaction, as large as the ledger objects it touched, colored by what it is. */
  async function blockTowers(b) {
    const { rows } = await rowsOf(b);
    return rows.map(X.txs.towerOf);
  }

  X.data = {
    latestBlocks, blocksFrom, heightOf, hashOf, blockTowers, rowsOf, notFound, light,
    /** The transactions (rows) of the newest ledger read in detail, or null. */
    latestRows: () => (latest ? latest.rows : null),
    // No mempool to read: the feed shows the transactions of the newest ledger read (see chain.js)
    recentTxs: async () => {
      const newest = Explorer.nav.liveBlocks()[0];
      // without 3D nothing else reads a ledger in detail: read the newest one, each time there is a newer one (and not again at once after a failure)
      if (newest && !Explorer.sceneSync.active() && (!latest || newest.height > latest.height) && Date.now() - lastFailure > 10000) {
        await rowsOf(newest).catch(() => { lastFailure = Date.now(); });
      }
      return latest ? latest.rows.slice(0, cfg().feedPerBlock).map(X.txs.feedItem) : [];
    },
  };
})();
