// The tracked account: how the transactions of an address are listed next to the 3D scene. Pure.
// `account_tx` lists the validated transactions of an account, newest first, a page at a time (a `marker` says where the next page starts).
// There is no "pending" here: a transaction is listed once it is in a validated ledger.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});

  /** What a transaction did to the XRP balance of an account, in drops (BigInt; the fee is included when the account paid it). */
  function netOf(meta, address) {
    for (const node of meta?.AffectedNodes ?? []) {
      const n = node.ModifiedNode ?? node.CreatedNode ?? node.DeletedNode;
      if (!n || n.LedgerEntryType !== 'AccountRoot') continue;
      try {
        if (node.CreatedNode) { if (n.NewFields?.Account === address) return BigInt(n.NewFields.Balance ?? 0); continue; }
        if (n.FinalFields?.Account !== address) continue;
        const before = n.PreviousFields?.Balance, after = n.FinalFields.Balance;
        if (before == null || after == null) return 0n; // the account changed, its balance did not
        return BigInt(after) - BigInt(before);
      } catch { /* an amount we cannot read: skipped */ }
    }
    return 0n; // the account is not an AccountRoot of this transaction: it moved an issued currency, or was only named
  }

  /**
   * One account_tx entry -> a line of the wallet list: { txid, net (drops), pending: false, height (ledger index), time (Unix seconds),
   * label, kind, ok, result }. null for an entry we cannot read.
   */
  function entry(raw, address) {
    const r = X.txs.row(raw);
    if (!r) return null;
    const p = X.txs.parts(raw);
    const height = p.extra.ledger_index ?? p.tx.ledger_index ?? p.tx.inLedger ?? null;
    const time = p.tx.date != null ? X.format.unixTime(p.tx.date) : p.extra.close_time_iso ? Date.parse(p.extra.close_time_iso) / 1000 : null;
    return {
      txid: r.hash, net: netOf(r.meta, address), pending: false, height: height == null ? null : Number(height), time,
      label: r.label, kind: r.kind, ok: r.ok, result: r.result,
    };
  }

  /** The lines of a list of entries: each transaction once, the newest ledger first (inside a ledger, the order of the server). */
  function entries(list) {
    const seen = new Set();
    return list.filter((e) => e && !seen.has(e.txid) && seen.add(e.txid)).sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  }

  /** The lowest ledger among the lines (null when there are none): how far back the list goes. */
  function reach(list) {
    let low = null;
    for (const e of list) if (e.height != null && (low === null || e.height < low)) low = e.height;
    return low;
  }

  /**
   * The list after a reload. `fresh` is the first page of the account (the newest transactions): the truth for the ledgers it covers.
   * What was loaded below it stays (older pages), unless the page holds the whole history (the server gave no marker).
   */
  function merge(old, fresh, { whole = false } = {}) {
    if (whole) return [...fresh];
    const lowest = reach(fresh);
    if (lowest === null) return [...old];
    const known = new Set(fresh.map((e) => e.txid));
    // a transaction in the lowest ledger of the page may have been cut off by the page: it is not newer, keep it
    return [...fresh, ...old.filter((e) => e.height != null && e.height <= lowest && !known.has(e.txid))];
  }

  /** The text of an amount in the list: the change of XRP, or what the transaction was when the balance did not move (an account only named, which paid no fee). */
  const amountText = (e) => (e.net !== 0n ? X.format.xrpSigned(e.net) : e.label);

  X.wallet = { netOf, entry, entries, reach, merge, amountText };
})();
