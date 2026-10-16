// Which request may still update the screen? The one the user asked for last.
// Opening a detail, running a search, jumping to a block: each starts with begin() and, after every await, checks
// isCurrent(token) before touching the screen. A slow, older response then never overwrites a newer one.
(() => {
  'use strict';
  const BTC = (window.BTC = window.BTC || {});

  let seq = 0;
  /** Starts a request: returns its token. Any earlier request becomes stale. */
  const begin = () => ++seq;
  const isCurrent = (token) => token === seq;

  BTC.requests = { begin, isCurrent };
})();
