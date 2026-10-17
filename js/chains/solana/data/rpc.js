// The JSON-RPC client of the Solana nodes listed in BTC.chain.config.rpc (the protocol part is js/net/jsonrpc.js).
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const S = (BTC.sol = BTC.sol || {});

  S.rpc = BTC.jsonrpc.create({ urls: () => BTC.chain.config.rpc, timeoutMs: () => BTC.chain.config.rpcTimeoutMs });
})();
