// Opening the detail dialog: fetches the data and hands it to the view. Only the latest request may update the dialog
// (an older, slower response never overwrites a newer one: see controllers/requests.js).
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const S = (BTC.sol = BTC.sol || {});
  const { begin, isCurrent } = BTC.requests;

  // These requests open the dialog (as "Loading…") before the response arrives: if the user has closed it meanwhile, a
  // late response must not open it again.
  const wanted = (token) => isCurrent(token) && BTC.ui.dialog.isOpen();
  const must = (x) => { if (x instanceof Error) throw x; return x; };
  const OPTS = { maxSupportedTransactionVersion: 0, commitment: 'confirmed' };

  async function openTx(signature) {
    const token = begin();
    BTC.ui.detail.loading();
    try {
      const tx = await S.rpc.call('getTransaction', [signature, { ...OPTS, encoding: 'jsonParsed' }]);
      if (!tx) throw Object.assign(new Error('no such transaction'), { status: 404 });
      if (!wanted(token)) return;
      BTC.ui.detail.tx({ signature, tx, slot: tx.slot, blockTime: tx.blockTime });
    } catch (e) {
      if (wanted(token)) BTC.ui.detail.message(e.status === 404 ? 'Transaction not found (the node keeps recent history only).' : `Transaction not found (${e.message})`);
    }
  }

  /** A block of the page (by its hash, as the cards give it). */
  async function openBlock(id) {
    const token = begin();
    BTC.ui.detail.loading();
    try {
      const b = S.data.known.get(id);
      if (!b) throw S.data.notFound('block');
      const { rows } = await S.data.rowsOf(b);
      if (!wanted(token)) return;
      BTC.ui.detail.block({ block: b, rows });
    } catch (e) {
      if (wanted(token)) BTC.ui.detail.message(`Block not found (${e.message})`);
    }
  }

  /** Any slot, shown on the page or not. */
  async function openSlot(slot) {
    const token = begin();
    BTC.ui.detail.loading();
    try {
      const b = await S.data.blockAt(slot);
      if (!b) throw new Error(`slot ${BTC.format.number(slot)} was skipped (no block) or is too old for the node`);
      const { rows } = await S.data.rowsOf(b);
      if (!wanted(token)) return;
      BTC.ui.detail.block({ block: b, rows });
    } catch (e) {
      if (wanted(token)) BTC.ui.detail.message(`Block not found (${e.message})`);
    }
  }

  /** An account: balance, owner program, what it holds, its latest transactions. */
  async function openAddress(address) {
    const token = begin();
    BTC.ui.detail.loading();
    try {
      const [bal, info, sigs] = await S.rpc.batch([
        ['getBalance', [address, { commitment: 'confirmed' }]],
        ['getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]],
        ['getSignaturesForAddress', [address, { limit: BTC.chain.config.historyShown, commitment: 'confirmed' }]],
      ]);
      const balance = must(bal);
      const account = must(info).value;
      if (!wanted(token)) return;
      BTC.ui.detail.address({
        address, lamports: balance.value, account, history: sigs instanceof Error ? null : sigs, historyError: sigs instanceof Error ? sigs.message : null,
      });
    } catch (e) {
      if (wanted(token)) BTC.ui.detail.message(e.code === -32602 ? 'Not a valid Solana address.' : `Address lookup failed (${e.message})`);
    }
  }

  S.details = { openTx, openBlock, openSlot, openAddress };
})();
