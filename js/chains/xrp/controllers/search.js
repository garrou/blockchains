// The search box: a ledger index shows its ledger (in the 3D scene when it is one of those held, else the scene moves to it); a
// 64-digit hash is a transaction or a ledger; an address (starts with r) opens the account.
(() => {
  'use strict';
  const Explorer = (window.Explorer = window.Explorer || {});
  const X = (Explorer.xrp = Explorer.xrp || {});

  async function run(query) {
    const token = Explorer.requests.begin(); // a newer search or detail request wins
    try {
      const q = X.search.classify(query);
      if (q.type === 'ledger') return await Explorer.nav.goToBlock({ height: q.index }, token);
      if (q.type === 'hash') return await X.details.openHash(q.hash); // a transaction, or else a ledger
      if (q.type === 'account') return await X.details.openAddress(q.address);
      Explorer.ui.detail.message('Not recognized: enter a ledger index, a transaction or ledger hash (64 hex digits) or an address (starts with r).');
    } catch (e) {
      if (Explorer.requests.isCurrent(token)) Explorer.ui.detail.message(e.status === 404 || !e.rpc && !/timeout|busy|connection/.test(e.message) ? `Not found (${e.message})` : `Could not complete the search (${e.message})`);
    }
  }

  X.searchCtl = { run };
})();
