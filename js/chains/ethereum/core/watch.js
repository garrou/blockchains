// The watched address: how the transactions the page sees for one address are listed next to the 3D scene. Pure.
// An Ethereum node cannot list the transactions of an address (that takes an indexer), so the list is built from what the page sees
// go by: the blocks it holds and the ones that come in, and the pending transactions of the mempool sample. Only the ones that
// name the address as sender or recipient (not the movements inside a contract, nor the tokens).
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const E = (Explorer.ethereum = Explorer.ethereum || {});

  /**
   * A mined transaction (core/txs.row) of block b -> a line of the list, or null when it is not one of the address's (lower case).
   * { txid, net (wei, BigInt: what it did to the balance, the fee included when the address paid it), pending: false, height, time, index, label, kind, ok }
   */
  function entry(r, b, address) {
    const sent = r.from === address, got = r.to === address || (r.created != null && r.created.toLowerCase() === address);
    if (!sent && !got) return null;
    const moved = r.ok === false ? 0n : r.valueWei; // a failed transaction moved nothing, but its sender still paid the gas
    const fee = sent ? E.txs.feeWei(r) ?? 0n : 0n;
    return {
      txid: r.hash, net: (sent ? -moved : 0n) + (got ? moved : 0n) - fee, pending: false, height: b.height, time: b.timestamp, index: r.index ?? 0,
      label: E.txs.labelOf(r.kind, r.selector), kind: r.kind, ok: r.ok,
    };
  }

  /** A pending transaction of the pool (core/txs.pending) -> a line of the list (no block yet, no fee yet). */
  function pendingEntry(p, address) {
    const sent = p.from === address, got = p.to === address;
    return {
      txid: p.hash, net: (sent ? -p.valueWei : 0n) + (got ? p.valueWei : 0n), pending: true, height: null, time: p.seen / 1000, index: p.nonce,
      label: E.txs.labelOf(p.kind, p.selector), kind: p.kind, ok: null, seen: p.seen,
    };
  }

  /** Mined lines `old` plus `added`: each transaction once (the newer line wins), newest block first, at most `max`. */
  function merge(old, added, max) {
    const byTxid = new Map(old.map((e) => [e.txid, e]));
    for (const e of added) byTxid.set(e.txid, e);
    return [...byTxid.values()].sort((a, b) => b.height - a.height || b.index - a.index).slice(0, max);
  }

  /** What the panel lists: the pending transactions (the latest seen first) that are not mined yet, then the mined ones. */
  function list(pending, mined) {
    const done = new Set(mined.map((e) => e.txid));
    return [...pending.filter((e) => !done.has(e.txid)).sort((a, b) => b.seen - a.seen), ...mined];
  }

  E.watch = { entry, pendingEntry, merge, list };
})();
