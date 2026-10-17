// The watched address: how its transactions are listed next to the 3D scene. Pure.
// `getSignaturesForAddress` lists the transactions of an address, newest first, a page at a time (`before` goes further back, `until`
// stops at a transaction already known). It does not say what they moved: a line only says where and when, and whether it failed.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const S = (Explorer.solana = Explorer.solana || {});

  /**
   * One result of getSignaturesForAddress -> a line of the list: { txid, net: 0, pending: false, height (the block of the page that
   * the slot belongs to), time (Unix seconds)|null, slot, where, ok }. null for something that is not a signature.
   */
  function entry(s) {
    if (!s || typeof s.signature !== 'string' || !Number.isFinite(s.slot)) return null;
    return { txid: s.signature, net: 0, pending: false, height: S.blocks.groupOf(s.slot), time: s.blockTime ?? null, slot: s.slot, where: `slot ${Explorer.format.number(s.slot)}`, ok: !s.err };
  }

  /** `added` and `old` in one list: each transaction once (the first one wins: put the newer lines first), the newest slot first. */
  function merge(added, old) {
    const seen = new Set();
    return [...added, ...old].filter((e) => !seen.has(e.txid) && seen.add(e.txid)).sort((a, b) => b.slot - a.slot);
  }

  /** The lowest block among the lines (null when there are none): how far back the list goes. */
  function reach(list) {
    let low = null;
    for (const e of list) if (low === null || e.height < low) low = e.height;
    return low;
  }

  S.watch = { entry, merge, reach };
})();
