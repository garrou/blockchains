// XRP Ledger "blocks" (ledgers), as the engine sees them. A ledger closes every 3 to 5 seconds, and once validated it is final: there
// are no forks, so every ledger is shown and each one's parent is exactly the one before it. Pure.
//
// The engine's height is the ledger index; the id is the ledger hash.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});

  /**
   * The result of a `ledger` command -> a block. `ledger.transactions` holds hashes (a light read) or whole transactions (a full
   * one); both count the same.
   */
  function normalize(result) {
    const l = result.ledger ?? result;
    const closed = Number(l.close_time), parentClosed = Number(l.parent_close_time);
    return {
      id: result.ledger_hash ?? l.ledger_hash ?? l.hash,
      height: Number(result.ledger_index ?? l.ledger_index ?? l.seqNum),
      previousblockhash: l.parent_hash ?? null,
      timestamp: X.format.unixTime(closed),
      tx_count: Array.isArray(l.transactions) ? l.transactions.length : Number(l.txn_count ?? 0),
      closedIn: Number.isFinite(parentClosed) && closed >= parentClosed ? closed - parentClosed : null, // seconds after the previous ledger
      totalCoins: l.total_coins ?? null,
    };
  }

  /**
   * The message the server pushes when a ledger closes -> the same block, without asking for it: it says the hash, the index, the close time
   * and the number of transactions. `previous` is the block before it (the one just told): the ledger must follow it. null when the message
   * lacks something or does not follow: the ledger is then read.
   */
  function fromEvent(msg, previous) {
    if (typeof msg?.ledger_hash !== 'string' || !previous || typeof msg.ledger_time !== 'number' || typeof msg.txn_count !== 'number') return null; // null or a string would pass for 0
    const closed = msg.ledger_time, index = Number(msg.ledger_index), count = msg.txn_count;
    if (index !== previous.height + 1 || !Number.isFinite(closed) || !Number.isInteger(count) || count < 0) return null;
    const timestamp = X.format.unixTime(closed);
    return { id: msg.ledger_hash, height: index, previousblockhash: previous.id, timestamp, tx_count: count, closedIn: timestamp >= previous.timestamp ? timestamp - previous.timestamp : null, totalCoins: null };
  }

  /** How busy a ledger looks, 0..1: its transactions against a busy ledger (config.txRef). */
  const fill = (b) => Math.min(1, b.tx_count / Explorer.chain.config.txRef);

  X.blocks = { normalize, fromEvent, fill };
})();
