// Solana transactions: from the node's JSON to the rows the dialogs show and the towers the scene draws. Pure.
//   tower = { txid (the signature), vsize (compute units used), rate (micro-lamports paid per compute unit) } + what the tooltips say
// What a transaction pays has two parts: 5000 lamports per signature (always), and an optional priority fee that buys a better
// place in the block. The first is flat; the second is what people bid for: it is the "rate" of a tower (a tower of a plain
// transaction that bid nothing is low and dark; a spike is someone who paid to be first). A vote (validators saying they
// agree with a block) is most of the transactions of a block and bids nothing.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const S = (BTC.sol = BTC.sol || {});

  const BASE_FEE = 5000; // lamports per signature

  /**
   * One transaction of a block read with the `accounts` detail ({ transaction: { signatures, accountKeys }, meta }).
   * accountKeys: strings, or { pubkey } objects. Returns null for something that is not a transaction we can read (a format we do
   * not know yet: one odd transaction must not take the whole block with it).
   */
  function row(entry, index = null) {
    const tx = entry && entry.transaction, meta = entry.meta ?? {};
    const rawKeys = tx && (tx.accountKeys ?? tx.message?.accountKeys);
    if (!tx || !Array.isArray(tx.signatures) || !tx.signatures.length || !Array.isArray(rawKeys) || !rawKeys.length) return null;
    const keys = rawKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
    const nSigs = tx.signatures.length;
    const fee = meta.fee ?? BASE_FEE * nSigs;
    const cu = meta.computeUnitsConsumed > 0 ? meta.computeUnitsConsumed : null;
    const priority = Math.max(0, fee - BASE_FEE * nSigs);
    const kind = S.programs.kindOf(keys);
    const out = (meta.preBalances?.[0] ?? 0) - (meta.postBalances?.[0] ?? 0) - fee; // what the first account (the fee payer) sent away
    return {
      sig: tx.signatures[0], payer: keys[0], fee, priority, cu, nAccounts: keys.length, nSigs, index,
      rate: (priority * 1e6) / (cu ?? 1),
      ok: !meta.err, err: meta.err ?? null,
      kind, label: S.programs.labelOf(kind, keys),
      moved: kind === 'vote' || meta.err ? 0 : Math.max(0, out),
    };
  }

  /** The tower of a transaction. */
  function towerOf(r) {
    return { txid: r.sig, vsize: r.cu ?? 200, rate: r.rate, fee: r.fee, priority: r.priority, kind: r.kind, label: r.label, ok: r.ok, payer: r.payer, moved: r.moved };
  }

  /** A line of the feed: the tower already has everything the row needs. */
  const feedItem = towerOf;

  // ----- a transaction read in full (getTransaction, jsonParsed): what its page shows -----

  const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
  const le = (bytes) => bytes.reduce((n, b, i) => n + BigInt(b) * 256n ** BigInt(i), 0n);

  /** The compute budget a transaction asked for: { limit (units), price (micro-lamports per unit) }, either may be null. */
  function computeBudget(instructions) {
    const out = { limit: null, price: null };
    for (const ix of instructions) {
      if (ix.programId !== COMPUTE_BUDGET || typeof ix.data !== 'string') continue;
      const bytes = S.base58.decode(ix.data);
      if (bytes?.[0] === 2 && bytes.length >= 5) out.limit = Number(le(bytes.slice(1, 5)));      // SetComputeUnitLimit(u32)
      if (bytes?.[0] === 3 && bytes.length >= 9) out.price = Number(le(bytes.slice(1, 9)));      // SetComputeUnitPrice(u64)
    }
    return out;
  }

  /** One instruction in words: { program, action, text }. */
  function describeInstruction(ix) {
    const f = BTC.format, x = S.format;
    const short = (a) => f.short(a, 6, 4);
    const name = S.programs.nameOf(ix.programId) ?? ix.program ?? short(ix.programId ?? '?');
    if (ix.parsed && typeof ix.parsed === 'object') {
      const { type, info = {} } = ix.parsed;
      let text = '';
      if (ix.program === 'system' && info.lamports != null && info.destination) text = `${short(info.source)} → ${short(info.destination)} · ${x.sol(info.lamports)}`;
      else if (info.tokenAmount) text = `${short(info.source)} → ${short(info.destination)} · ${info.tokenAmount.uiAmountString} (token ${short(info.mint)})`;
      else if (info.amount != null && info.destination) text = `${short(info.source)} → ${short(info.destination)} · ${f.number(info.amount)} (raw units)`;
      else text = Object.entries(info).slice(0, 3).map(([k, v]) => `${k} ${typeof v === 'string' ? short(v) : JSON.stringify(v)}`).join(' · ');
      return { program: name, action: type, text };
    }
    if (ix.programId === COMPUTE_BUDGET) {
      const b = computeBudget([ix]);
      return { program: name, action: b.limit != null ? 'set compute unit limit' : b.price != null ? 'set compute unit price' : 'compute budget', text: b.limit != null ? `${f.number(b.limit)} units` : b.price != null ? `${f.number(b.price)} µlamports per unit` : '' };
    }
    const bytes = typeof ix.data === 'string' ? (S.base58.decode(ix.data)?.length ?? 0) : 0;
    return { program: name, action: 'instruction', text: `${(ix.accounts ?? []).length} accounts · ${bytes} bytes of data` };
  }

  /** The SOL balance changes of a transaction, biggest first: [{ address, change (lamports) }]. The fee payer's includes the fee. */
  function balanceChanges(meta, keys) {
    return keys.map((address, i) => ({ address, change: (meta.postBalances?.[i] ?? 0) - (meta.preBalances?.[i] ?? 0) }))
      .filter((c) => c.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }

  /** The token balance changes: [{ owner, mint, change (BigInt), decimals }], biggest first. */
  function tokenChanges(meta) {
    const key = (b) => `${b.accountIndex}:${b.mint}`;
    const all = new Map();
    for (const b of meta.preTokenBalances ?? []) all.set(key(b), { owner: b.owner, mint: b.mint, decimals: b.uiTokenAmount.decimals, pre: BigInt(b.uiTokenAmount.amount), post: 0n });
    for (const b of meta.postTokenBalances ?? []) {
      const e = all.get(key(b)) ?? { owner: b.owner, mint: b.mint, decimals: b.uiTokenAmount.decimals, pre: 0n, post: 0n };
      e.post = BigInt(b.uiTokenAmount.amount);
      all.set(key(b), e);
    }
    return [...all.values()].map((e) => ({ owner: e.owner, mint: e.mint, decimals: e.decimals, change: e.post - e.pre })).filter((c) => c.change !== 0n)
      .sort((a, b) => Number((b.change < 0n ? -b.change : b.change) / 10n ** BigInt(b.decimals)) - Number((a.change < 0n ? -a.change : a.change) / 10n ** BigInt(a.decimals)));
  }

  S.txs = { BASE_FEE, row, towerOf, feedItem, computeBudget, describeInstruction, balanceChanges, tokenChanges };
})();
