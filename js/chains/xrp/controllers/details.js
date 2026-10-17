// Opening the detail dialog: fetches the data and hands it to the view. Only the latest request may update the dialog
// (an older, slower response never overwrites a newer one: see controllers/requests.js).
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});
  const { begin, isCurrent } = Explorer.requests;

  // These requests open the dialog (as "Loading…") before the response arrives: if the user has closed it meanwhile, a
  // late response must not open it again.
  const wanted = (token) => isCurrent(token) && Explorer.ui.dialog.isOpen();

  /** While `fn` runs, the dialog says when the server asked the page to wait (so a long "Loading…" is explained). */
  async function whileBusy(token, fn) {
    const say = () => { const s = X.ws.waitSeconds(); if (s > 0 && wanted(token)) Explorer.ui.dialog.loading(`The server is busy: waiting about ${s} s…`); };
    const off = X.ws.onBusy(say);
    const tick = setInterval(say, 500); // also when the page was already waiting before this request, and to count down
    say();
    try { return await fn(); } finally { off(); clearInterval(tick); }
  }

  /** What the dialog says when a request failed: "not found" only for a 404, the reason otherwise (network, timeout...). */
  const failure = (what, e) => (e.status === 404 ? `${what} not found.` : `Could not load the ${what.toLowerCase()} (${e.message})`);

  /** The page of a transaction, from the answer of `tx`. */
  function showTx(res) {
    const r = X.txs.row(res);
    if (!r) throw Object.assign(new Error('not a transaction'), { status: 404 });
    Explorer.ui.detail.tx({ r, ledgerIndex: res.ledger_index ?? res.inLedger ?? null, date: res.date != null ? X.format.unixTime(res.date) : null, validated: res.validated });
  }

  const askTx = (hash) => X.ws.call('tx', { transaction: hash, binary: false });

  async function openTx(hash) {
    const token = begin();
    Explorer.link.set(hash); // the address bar says what is shown (a link to it)
    Explorer.ui.detail.loading();
    try {
      const res = await whileBusy(token, () => askTx(hash));
      if (!wanted(token)) return;
      showTx(res);
    } catch (e) {
      if (wanted(token)) Explorer.ui.detail.message(failure('Transaction', e));
    }
  }

  /** A hash typed in the search box: a transaction, or else a ledger (the same 64 digits). The scene goes to a ledger when it can. */
  async function openHash(hash) {
    const token = begin();
    Explorer.link.set(hash);
    Explorer.ui.detail.loading();
    try {
      let res;
      try { res = await whileBusy(token, () => askTx(hash)); } catch (e) {
        if (e.status !== 404) throw e;
        if (!isCurrent(token)) return;
        if (!Explorer.sceneSync.active()) return await openLedger(hash); // no 3D: the dialog
        try { return await Explorer.nav.goToBlock({ hash }, token); } // closes the dialog by itself
        catch (e2) { throw e2.status === 404 ? Object.assign(new Error('no transaction or ledger with this hash'), { status: 404 }) : e2; }
      }
      if (!wanted(token)) return;
      showTx(res);
    } catch (e) {
      if (wanted(token) || isCurrent(token)) Explorer.ui.detail.message(e.status === 404 ? `Not found (${e.message})` : `Could not complete the search (${e.message})`);
    }
  }

  /** A ledger by its hash (the one the page may already hold), or by its index (any ledger the server still has). */
  async function openLedger(which) {
    const token = begin();
    Explorer.link.set(String(which));
    Explorer.ui.detail.loading();
    try {
      let block, rows;
      if (typeof which === 'string') ({ block, rows } = await whileBusy(token, () => X.data.rowsOf({ id: which }, 0))); // cached when the scene drew it
      else {
        const res = await whileBusy(token, () => X.ws.call('ledger', { ledger_index: which, transactions: true, expand: true }));
        block = X.blocks.normalize(res);
        rows = (res.ledger?.transactions ?? []).map(X.txs.row).filter(Boolean);
      }
      if (!wanted(token)) return;
      Explorer.ui.detail.block({ block, rows });
    } catch (e) {
      if (wanted(token)) Explorer.ui.detail.message(failure('Ledger', e));
    }
  }

  let shown = null; // the account page on screen: { address, lines, marker } (what "Show in 3D" starts tracking)

  /** An account: balance, what it owns, its latest transactions. */
  async function openAddress(address) {
    const token = begin();
    Explorer.link.set(address);
    Explorer.ui.detail.loading();
    shown = null;
    try {
      const [info, history] = await whileBusy(token, () => Promise.allSettled([
        X.ws.call('account_info', { account: address, ledger_index: 'validated' }),
        X.walletCtl.page(address, null, 0), // a person is waiting for it
      ]));
      let data = null;
      if (info.status === 'fulfilled') data = info.value.account_data ?? null;
      else if (info.reason.code !== 'actNotFound') throw info.reason;
      const unfunded = history.status === 'rejected' && history.reason.code === 'actNotFound'; // an account that was never funded: no transactions, nothing failed
      const lines = history.status === 'fulfilled' ? X.wallet.entries(history.value.lines) : unfunded ? [] : null;
      if (!wanted(token)) return;
      if (lines && history.status === 'fulfilled') shown = { address, lines, marker: history.value.marker };
      Explorer.ui.detail.address({ address, data, history: lines && lines.slice(0, Explorer.chain.config.historyShown), historyError: history.status === 'rejected' && !unfunded ? history.reason.message : null, canTrack: !!lines?.length });
    } catch (e) {
      if (wanted(token)) Explorer.ui.detail.message(e.code === 'actMalformed' ? 'Not a valid XRP Ledger address.' : `Account lookup failed (${e.message})`);
    }
  }

  X.details = { openTx, openHash, openLedger, openAddress, shownAddress: () => shown };
})();
