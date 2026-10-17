// The search box: a height or a block hash shows the block in the 3D scene; a transaction hash or an address opens its
// detail; a name ending in .eth is looked up in ENS.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const E = (BTC.eth = BTC.eth || {});

  async function run(query) {
    const token = BTC.requests.begin(); // a newer search or detail request wins
    try {
      const q = E.search.classify(query);
      if (q.type === 'height') return await BTC.nav.goToBlock({ height: q.height }, token);
      if (q.type === 'hash') {
        // a transaction hash and a block hash look the same: ask for the transaction first
        const tx = await E.rpc.call('eth_getTransactionByHash', [q.hash]);
        if (!BTC.requests.isCurrent(token)) return;
        if (tx) return await E.details.openTx(q.hash);
        try { return await BTC.nav.goToBlock({ hash: q.hash }, token); }
        catch (e) { throw e.status === 404 ? new Error('no block or transaction with this hash') : e; }
      }
      if (q.type === 'address') return await E.details.openAddress(q.address, null, q.checksumOk);
      if (q.type === 'name') return await E.details.openName(q.name);
      BTC.ui.detail.message('Not recognized: enter a block number, a block or transaction hash (0x…), an address or a .eth name.');
    } catch (e) {
      if (BTC.requests.isCurrent(token)) BTC.ui.detail.message(`Not found (${e.message})`);
    }
  }

  E.searchCtl = { run };
})();
