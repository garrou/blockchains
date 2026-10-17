// What the engine asks the network for, in Solana words (BTC.chain.data): the blocks shown (one slot group in `sample`), their
// transactions as towers. Reads the node through data/rpc.js.
//
// Two reads of a block: only its signatures (light: gives the list of blocks and their number of transactions), and with the
// `accounts` detail (heavy, a megabyte or more: fee, compute units and accounts of every transaction) for the blocks the scene draws.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const S = (BTC.sol = BTC.sol || {});
  const cfg = () => BTC.chain.config;

  const known = new Map(); // block id -> block, for the blocks seen (a block cannot be found by its hash on Solana)

  function notFound(what) {
    const err = new Error(`${what} not found`);
    err.status = 404; // the convention of the contract: an unknown block or transaction
    return err;
  }

  const KNOWN_MAX = 600; // about 40 minutes of blocks: enough for the list and its history
  const remember = (blocks) => {
    blocks.forEach((b) => known.set(b.id, b));
    while (known.size > KNOWN_MAX) known.delete(known.keys().next().value);
    return blocks;
  };

  /**
   * The blocks of the groups [top - count + 1 .. top], newest first. A group's block is the first one produced from its first
   * slot (a slot can be skipped). One more, older, is read to link the oldest to its predecessor and is not returned.
   */
  async function groups(top, count) {
    const low = top - count; // the extra one
    const slots = await S.rpc.call('getBlocks', [S.blocks.firstSlotOf(low), S.blocks.firstSlotOf(top + 1) - 1, { commitment: 'confirmed' }]);
    const chosen = [];
    for (let g = top; g >= low; g--) {
      const slot = slots.find((s) => s >= S.blocks.firstSlotOf(g));
      if (slot !== undefined && S.blocks.groupOf(slot) === g) chosen.push(slot);
    }
    const res = await S.rpc.blocks(chosen, 'signatures');
    const blocks = [];
    res.forEach((raw, i) => { if (raw && !(raw instanceof Error)) blocks.push(S.blocks.normalize(chosen[i], raw)); });
    if (!blocks.length) throw res.find((r) => r instanceof Error) ?? notFound('block');
    S.blocks.link(blocks);
    if (blocks.at(-1).height === low) blocks.pop(); // the extra one: only there for the link
    return remember(blocks);
  }

  /** How far from the head a block is safely readable (produced, and confirmed by the node). */
  const LAG = 3;

  async function latestBlocks() {
    const slot = Number(await S.rpc.call('getSlot', [{ commitment: 'confirmed' }]));
    const blocks = await groups(S.blocks.groupOf(slot - LAG), cfg().pageSize);
    if (blocks.length) S.live.noteTip(blocks[0], slot);
    return blocks;
  }

  const blocksFrom = (group) => groups(group, cfg().pageSize);

  async function hashOf(group) { return (await groups(group, 1))[0].id; }

  async function heightOf(hash) {
    const b = known.get(hash);
    if (!b) throw notFound('block');
    return b.height;
  }

  // ----- the transactions of a block -----
  const cache = new Map(); // block id -> Promise<{ block, rows }>, most recently used last
  const KEEP = 12;
  let latest = null;       // { height, rows } of the newest block whose transactions were read: the feed's source

  async function load(b) {
    const raw = await S.rpc.block(b.slot, 'accounts');
    if (!raw) throw notFound('block');
    const rows = raw.transactions.map((t, i) => S.txs.row(t, i)).filter(Boolean);
    if (!latest || b.height >= latest.height) latest = { height: b.height, rows };
    return { block: b, rows };
  }

  /** The transactions of a block (rows, in block order). b: a block of this page ({ id, slot, ... }). Cached. */
  function rowsOf(b) {
    let p = cache.get(b.id);
    if (p) { cache.delete(b.id); cache.set(b.id, p); return p; }
    p = load(b);
    p.catch(() => { if (cache.get(b.id) === p) cache.delete(b.id); });
    cache.set(b.id, p);
    while (cache.size > KEEP) cache.delete(cache.keys().next().value);
    return p;
  }

  /** The block of an exact slot (any slot, shown or not), without the link to its neighbour; null for a skipped slot. */
  async function blockAt(slot) {
    try {
      const raw = await S.rpc.block(slot, 'signatures');
      return raw ? S.blocks.normalize(slot, raw) : null;
    } catch (e) {
      if (e.code === -32007 || e.code === -32009) return null; // skipped / missing
      throw e;
    }
  }

  /** The slot of the block shown for the group of `slot`, or null when unknown (a skipped slot at the start of a group moves it). */
  async function shownSlot(slot) {
    const g = S.blocks.groupOf(slot);
    const slots = await S.rpc.call('getBlocks', [S.blocks.firstSlotOf(g), S.blocks.firstSlotOf(g + 1) - 1, { commitment: 'confirmed' }]);
    return slots.length ? slots[0] : null;
  }

  /** The towers of a block: one per transaction, as large as the compute it used, as high as the priority fee it paid per unit. */
  async function blockTowers(b) {
    const { rows } = await rowsOf(b);
    return rows.map(S.txs.towerOf);
  }

  S.data = {
    latestBlocks, blocksFrom, heightOf, hashOf, blockTowers, rowsOf, blockAt, shownSlot, notFound, known, remember,
    /** The transactions (rows) of the newest block read in detail, or null. */
    latestRows: () => (latest ? latest.rows : null),
    // No mempool to read: the feed shows the transactions of the newest block read, non-votes first (see chain.js)
    recentTxs: async () => (latest ? latest.rows.filter((r) => r.kind !== 'vote').slice(0, cfg().feedPerBlock).map(S.txs.feedItem) : []),
  };
})();
