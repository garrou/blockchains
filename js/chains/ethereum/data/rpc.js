// The JSON-RPC client of the Ethereum nodes listed in BTC.chain.config.rpc (the protocol part is js/net/jsonrpc.js).
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});
  const E = (BTC.eth = BTC.eth || {});

  E.rpc = BTC.jsonrpc.create({ urls: () => BTC.chain.config.rpc, timeoutMs: () => BTC.chain.config.rpcTimeoutMs });
})();
