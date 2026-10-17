// The search box: a slot number shows its block (in the 3D scene when it is one of the blocks shown, else in a dialog); a
// signature opens the transaction; any other 32-byte key opens the account.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const S = (BTC.sol = BTC.sol || {});

  async function run(query) {
    const token = BTC.requests.begin(); // a newer search or detail request wins
    try {
      const q = S.search.classify(query);
      if (q.type === 'slot') {
        // the scene shows one block in `sample`: the slot of a shown block goes to the scene, any other slot to a dialog
        const shown = await S.data.shownSlot(q.slot).catch(() => null);
        if (!BTC.requests.isCurrent(token)) return;
        if (shown === q.slot) return await BTC.nav.goToBlock({ height: S.blocks.groupOf(q.slot) }, token);
        return await S.details.openSlot(q.slot);
      }
      if (q.type === 'signature') return await S.details.openTx(q.signature);
      if (q.type === 'account') return await S.details.openAddress(q.address);
      BTC.ui.detail.message('Not recognized: enter a slot number, a transaction signature or an account address.');
    } catch (e) {
      if (BTC.requests.isCurrent(token)) BTC.ui.detail.message(`Not found (${e.message})`);
    }
  }

  S.searchCtl = { run };
})();
