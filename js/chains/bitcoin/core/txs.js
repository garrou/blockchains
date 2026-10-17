// Transaction models and calculations. Pure: no DOM, no network.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  Explorer.bitcoin = Explorer.bitcoin || {};

  /** Fee rate in sat/vB of a lightweight tx ({fee, vsize}); undefined when unknown. */
  const feeRate = (t) => (t && t.vsize && t.fee != null ? t.fee / t.vsize : undefined);

  /** Normalizes a tx of the projected block: either a [txid, fee, vsize, value] array or an object. */
  function normalizeProjected(r) {
    const o = Array.isArray(r) ? { txid: r[0], fee: r[1], vsize: r[2], value: r[3] } : r;
    const vsize = o.vsize || 1, fee = o.fee || 0;
    return { txid: o.txid, vsize, fee, value: o.value, rate: o.rate ?? fee / vsize, coinbase: false };
  }

  /** A block summary is complete when it has (almost) as many rows as the block has transactions. */
  function isCompleteSummary(rows, expectedCount, minRatio = Explorer.chain.config.summaryMinRatio) {
    return Array.isArray(rows) && rows.length > 0 && rows.length >= (expectedCount || 0) * minRatio;
  }

  /** Rows of /v1/block/:hash/summary (coinbase first) -> txs. */
  function fromSummary(rows) {
    return rows.map((r, i) => {
      const vsize = r.vsize || 1;
      return { txid: r.txid, vsize, fee: r.fee || 0, rate: r.rate ?? (r.fee || 0) / vsize, coinbase: i === 0 };
    });
  }

  /** Provisional txs from the bare list of txids (no size / fee known): flagged `approx`, replaced once the summary is complete. */
  function provisional(txids, medianFee) {
    const rate = medianFee ?? 5;
    const txs = txids.map((txid, i) => ({ txid, vsize: 1, fee: 0, rate, coinbase: i === 0, approx: true }));
    txs.approx = true;
    return txs;
  }

  /** Total of a full tx's inputs in sats; null for a coinbase (new coins). partial = some prevout value is unavailable. */
  function inputTotal(tx) {
    if (tx.vin.some((i) => i.is_coinbase)) return null;
    let sum = 0, partial = false;
    for (const i of tx.vin) { if (i.prevout?.value != null) sum += i.prevout.value; else partial = true; }
    return { sum, partial };
  }

  const outputTotal = (tx) => tx.vout.reduce((s, o) => s + (o.value || 0), 0);

  /** Whether a transaction says it can be replaced by a version that pays more (BIP 125: an input with a sequence below 0xfffffffe). */
  const signalsRbf = (tx) => tx.vin.some((i) => !i.is_coinbase && typeof i.sequence === 'number' && i.sequence < 0xfffffffe);

  /**
   * When a transaction that pays `rate` sat/vB is expected to be mined, from the blocks the mempool is projected into (`upcoming`: the
   * `mempool-blocks` of the server, each with the `feeRange` of what it holds, lowest rate first): the first block whose lowest rate
   * it reaches. { blocks: n } (n = 1: the next block; atLeast: the projected block is bigger than a block can be, it gathers all the overflow), { beyond: n } when it is below all the n blocks projected, null when unknown.
   */
  function eta(rate, upcoming) {
    if (!Number.isFinite(rate) || !Array.isArray(upcoming) || !upcoming.length) return null;
    for (let i = 0; i < upcoming.length; i++) {
      const lowest = upcoming[i] && upcoming[i].feeRange && upcoming[i].feeRange[0];
      if (typeof lowest === 'number' && rate >= lowest) return upcoming[i].blockVSize > 1.05e6 ? { blocks: i + 1, atLeast: true } : { blocks: i + 1 }; // a projected block bigger than a real one holds all the rest: it says "or more"
    }
    return { beyond: upcoming.length };
  }

  /** Fee rate in sat/vB of a full tx (weight / 4 = vsize). */
  const fullFeeRate = (tx) => (tx.fee != null && tx.weight ? tx.fee / (tx.weight / 4) : null);

  Explorer.bitcoin.txs = { signalsRbf, eta, feeRate, normalizeProjected, isCompleteSummary, fromSummary, provisional, inputTotal, outputTotal, fullFeeRate };
})();
