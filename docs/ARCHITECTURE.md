# Architecture

Each page is split in two:

- the **engine**: everything that draws blocks and transactions in 3D, keeps the list of blocks, the feed and the camera.
  It knows nothing about any blockchain.
- a **chain**: one object that gives the engine its numbers, its words and its data. Everything specific to a chain lives
  in `js/chains/<name>/`. Four exist: Bitcoin (`bitcoin.html`), Ethereum (`ethereum.html`), Solana (`solana.html`), the XRP Ledger (`xrp.html`); `index.html` is the home page that
  links to them.

The engine talks to the chain only through `Explorer.chain`. The contract is written (and validated at startup) in
[`js/core/chain.js`](../js/core/chain.js). An engine file must not name a Bitcoin,
Ethereum or Solana module or unit (`Explorer.bitcoin`, `gwei`, `lamports`...): `grep -rn "Explorer.bitcoin\|Explorer.xrp\|gwei\|lamport\|drops" js --exclude-dir=chains` should find nothing outside comments.

## Where things are

```
js/
  core/          pure logic, no network (treemap layout, colors, block list, feed buffer, formatting); the one exception is diag.js, which listens for the page's errors and wraps console.warn / console.error
    chain.js     THE CONTRACT: what a chain must provide (Explorer.defineChain)
  state/         the single mutable state of the app
  scene/         the 3D view (Three.js): rendering only
  ui/            DOM views of the engine (block row, HUD, feed, dialog shell, tracked-address panel, diagnostics panel)
  controllers/   orchestration (navigation, scene-sync, feed, "latest request wins", links: the address bar)
  net/           JSON-RPC over HTTP and WebSocket (shared by the chains that speak it: nodes tried in turn, batches, reconnection)
  app.js         entry point: creates the views and the scene, connects the chain, wires everything
  chains/<name>/ (bitcoin, ethereum, solana, xrp: the same four folders, each file is that chain's own)
    chain.js     the spec passed to Explorer.defineChain: numbers, words, data, live, hooks
    core/        pure logic of the chain (transactions, addresses, search classification...), no DOM, no network
    data/        where the data comes from (Bitcoin: mempool.space; Ethereum, Solana: a node, over JSON-RPC; XRP: a server, over one WebSocket)
    ui/          the chain's screens (detail dialog content, statistics bar)
    controllers/ the chain's orchestration (detail requests, search, statistics, tracked or watched address)
css/             style.css (shared by every page, home page included), bitcoin.css, ethereum.css, solana.css, xrp.css (what only that chain's page needs)
index.html                                   home: the choice of a chain
bitcoin.html  ethereum.html  solana.html  xrp.html     one page per chain: same engine scripts, the chain's own scripts
img/                                         the logos of the chains (title, switch, home page)
```

All files are classic scripts sharing the global `Explorer` (no modules, no build): the page works when double-clicked.
`Explorer` holds the engine (`Explorer.chain`, `Explorer.ui`, `Explorer.state`...); each chain keeps its own modules under its name
(`Explorer.bitcoin.api`, `Explorer.ethereum.rpc`, `Explorer.solana.txs`...), so the engine and the chains never share a name.
The order of the `<script>` tags in each chain's page matters; it follows the layers above: `core/config.js`, `core/diag.js`, then `core/chain.js` (the contract:
it defines `Explorer.defineChain`, so it comes first) and the chain's own `chain.js`, because some files read `Explorer.chain` while loading
(`core/colors.js` and, in each chain, the files that build their legend or tables from it).

## A short glossary of the 3D view

You do not need to know Three.js to read the engine; these are the ideas.

- **Slot**: the place of one block in the scene. Slots are laid out in a row along an axis, `pitch` units apart.
  The first slot is the **next block** (not mined yet, id `'next'`), then the latest mined block, then older ones.
- **Platform / cage**: a square plate (`size` units wide) with a frame around it. One per slot. A full block covers it.
- **Tower**: one transaction. Its **footprint** is proportional to its size (a block of `capacity.size` units covers the whole
  platform); its **height and color** come from its rate (price per unit of size), through the color scale of `chain.rates`.
  The coinbase (block reward) is drawn gold, in the corner.
- **Treemap** (`core/treemap.js`): the algorithm that decides which rectangle of the platform each tower gets, so that
  areas are proportional to sizes. Pure math. The **next block** uses an incremental variant so that towers
  stay where they are while newcomers take free room ("Stable" placement); "Compact" lays it out again each time.
- **InstancedMesh**: how thousands of towers are drawn cheaply, as one object with one position/color per tower.
  Only `scene/scene3d.js` knows about it.
- **Camera**: orbits around the focused slot (OrbitControls). Changing the focus slides the camera to another slot.
- **Window**: only the slots within `reach` of the camera exist in 3D; the row slides with the camera.
- **Detail radius**: slots within `detailRadius` of the camera show every tower; farther ones are a single **light shape**
  (its height and color from `chain.fill` and `chain.typicalRate`) that fades into the fog. They are loaded (and become
  detailed) when the camera comes close.
- **Highlight**: a way to light some towers and dim the others (used for the tracked address). The scene reports changes
  through `onHighlight`.
- **Arrivals**: a transaction entering the mempool falls from the sky into the next block as the very tower it will be.

## Data flow

```
chain.live.connect  --onBlock-->      nav.addBlock --> state.blocks --> blocks row + scene-sync --> scene
                    --onProjected-->  scene-sync: chain.createPending().apply(raw) --> towers of the next block
                    --onTransactions> feed
chain.data.blockTowers(block) --> scene-sync --> scene (a mined block, downloaded once, cached)
chain.data.latestBlocks / blocksFrom / heightOf / hashOf --> navigation (list, history, search by height or hash)
user: click a tower / block, "Block details", search box --> chain.openTx / openBlock / search --> the chain's screens
```

Provisional data: if a mined block's towers are not known precisely yet (`approx`), the engine draws what it has and asks
`blockTowers` again later (`scene-sync.js`, retries).

## The four chains

| | Bitcoin | Ethereum | Solana | XRP Ledger |
|---|---|---|---|---|
| tower (a transaction) | footprint = size (vB), height & color = fee rate (sat/vB) | footprint = gas used, height & color = gas price (gwei) | footprint = compute units (**estimated**), height & color = priority fee paid (lamports) | footprint = ledger objects touched, **color = kind of transaction**, height = fee above the reference fee |
| full block | 1 Mvb | the gas limit (60M) | compute units (60M) | none: a scale tuned to ordinary ledgers (2,000 objects) |
| a block | every ~10 min | every 12 s | every 0.4 s: the page shows **one in 10** (a block every 4 s), see `core/blocks.js` | a ledger every 3 to 5 s, final once validated (no forks): every one is shown; after a long absence (a sleeping tab) the list starts again from the latest ones |
| next block | the mempool's projection, pushed by the server | a guess built from the pending transactions the page has seen (best tip first) | none: no mempool can be read (`nextBlock: false`) | none (`nextBlock: false`) |
| data | mempool.space REST + WebSocket | a node: JSON-RPC + WebSocket (`eth_subscribe`) | a node: JSON-RPC + WebSocket (`slotSubscribe`) | a server: **one WebSocket** for the commands and the ledgers that close (`subscribe` to `ledger`) |
| accent | orange | Ethereum blue | Solana purple (the scale ends in the logo's green) | XRP blue |
| address page | totals + transactions | balance, nonce, contract or wallet, token name, ENS | balance, owner program, token holdings, latest transactions | balance, objects owned, latest transactions, "Show in 3D" |
| tracked address in 3D | "Show in 3D": the pending transactions and the 25 newest confirmed, "Load older" adds 25 at a time | "Watch in 3D": **from now on** (what the page sees) | "Watch in 3D": `getSignaturesForAddress`, no amounts | "Show in 3D": `account_tx`, validated transactions, a page at a time |

The statistics bar of each chain ends with **Transactions / day**. How it is counted depends on what the chain lets a page read:

| | How | Exact? |
|---|---|---|
| Bitcoin | the sum of `tx_count` of the blocks mined in the last 24 h (the blocks held, then pages of 15 older ones: about 10 requests, every 10 minutes) | yes, to the block |
| Ethereum | `eth_getBlockTransactionCountByNumber` for 48 blocks spread over the last 7,200, scaled to the day | an estimate, a few percent |
| Solana | `getRecentPerformanceSamples`: the node keeps about 12 hours of one-minute samples; the rate over them, scaled to 24 h. The figure leaves the votes out when the node tells them apart (`numNonVoteTransactions`) | an extrapolation of 12 hours |
| XRP Ledger | `ledger` for 36 ledgers spread over the last ~21,600, scaled to the day | an estimate, a few percent |

Tracking an address in 3D differs with what the chain lets a page read. On Bitcoin the page lights up the towers of an address from its history, as far as the page has loaded it (its pending transactions and the 25 newest confirmed, then
"Load older"): the mempool.space API lists the transactions of an address, a page at a time. On Ethereum a plain node cannot (it takes an indexer such as Etherscan, which
needs a key), so the page **watches** instead: `controllers/watch.js` scans the blocks it holds when the watch starts (the cache of `data/blocks.js`),
every block that comes in, and the pending transactions of the mempool sample (every 2 s), and keeps the ones that name the address as sender or
recipient (`core/watch.js`). It never goes back in time, does not see movements inside contracts or tokens, and the panel says how far it looks
(`back to #...`). A Solana node does list the signatures of an address (`getSignaturesForAddress`, newest first, `before`/`until`), so its watch
has a history and is reloaded with `until` the newest line, but it does not say what a transaction moved, and the page draws one block in ten:
the towers of the other slots cannot glow, the panel says how many do (`N lit in 3D`). Both reuse the panel of `ui/tracker.js` (a line may say
`where` instead of the block number, and the panel says `empty` when there is nothing yet).

What is Ethereum-specific and worth knowing: the base fee of the next block is computed from the last block (EIP-1559, `core/blocks.js`);
the gas a transaction really used comes from the receipts (`eth_getBlockReceipts`), estimated from the gas limits when a node
lacks that call; the next block is only a guess since a public node announces the transactions it sees, not the whole mempool.

What is Solana-specific: most transactions of a block are validators' votes (flat dark towers); the base fee is the same for
everybody (5000 lamports per signature), so the height of a tower is the priority fee, what people bid to be first (the fee paid minus 5000 per signature: a transaction that verifies signatures with a precompile program pays more, and shows a small false priority).
The footprint is an estimate: the light read of a block (`accounts` detail) gives fee, accounts and balances but not the compute
units each transaction used (only the full read does, several times heavier), so they are guessed from the accounts a transaction
touches (`estimateCU` in `core/txs.js`). The real figure is on the page of the transaction.
A Solana node refuses a block that holds a transaction newer than the version the client says it supports (error -32015, it names
the version to use); `data/rpc.js` takes that number and asks again, so a new version of the format does not blank the page.

What is XRP-specific: a transaction has no size and no price to bid with (the fee is 10 drops for nearly everybody, and burned), so
the colors of the towers say **what a transaction is** (a payment, an order of the built-in exchange, a trust line, an AMM pool, an
NFT, anything else; red when it was charged its fee but did not do what it was sent for, a result `tec...`). The chain gives each tower its own `color`
and a `legend` of kinds (see `legend` in `js/core/chain.js`). The footprint is the number of ledger objects the transaction touched
(the `AffectedNodes` of its metadata); the height is the fee in multiples of the reference fee, flat for almost all and a spike for
the rare one that paid more. The page needs no HTTP request: the commands (`ledger`, `tx`, `account_info`, `account_tx`, `fee`) travel
over the same WebSocket as the ledgers that close (`data/ws.js`), which also avoids asking the servers for cross-origin permission.
The tracked account (`controllers/wallet.js`, `core/wallet.js`) works like the Bitcoin one: the panel over the scene lists the account's
transactions (a click goes to their ledger), their towers glow and a beacon rises from each, the others are dimmed. It reads
`account_tx` (newest first, a `marker` leads to the next page: "Load older") and reloads every 10 s. The change of XRP balance of each
line comes from the metadata (the account's `AccountRoot`); a transaction that did not change the XRP of the account (it was only named: it paid no fee) shows
its kind instead. The public servers do not all keep the whole history: the list goes back as far as the server's.

The public servers give each client a budget (about 2,000 units per 10 seconds) and answer `tooBusy` beyond it. `data/ws.js` therefore
keeps at most 4 commands out at once, serves a person's request before the background ones (the estimate of the day), and when a
server says `retry in ~6379ms` it stops sending for that long and asks again (up to 4 times, then the dialog says why). Commands have a
priority (0 a person is waiting, 1 the page loading what it draws, 2 background): a click on a tower is not queued behind ledger reads,
and while the server asks to wait the dialog says so.
The start-up asks the servers for little: the list is 15 light reads, then 3 ledgers in full (`detailRadius: 2` in the XRP `chain.js`; the engine default is 4,
and any chain may ask for another radius: see `detailRadius` in `js/core/chain.js`). A ledger that closes later is not read at all: the message the server pushes
(hash, index, close time, number of transactions) makes its block (`fromEvent` in `core/blocks.js`; a push that says too little, or a ledger whose push was missed, is read).
The budget is each server's own, so the page does not sit and wait on a saturated one: a second refusal within 30 s (a burst of refusals counts once)
makes it leave for the next server (`ctl.fail` in `js/net/jsonrpc.js`, which also keeps a node that closed on the page within 3 s, or that it left, from being tried
first again for 2 minutes; a server that says its budget needs 10 s or more to come back is left at once and not tried until then, and the page keeps
that in `localStorage` (`badNodes.xrp`) so that a reload does not start with the server that has just refused), and until the answers come back the commands go out one at a time (300 ms apart, doubling at each refusal up to 2 s). The diagnostics
panel says why each connection ended (who closed it, with which code) and why the page left a server.
A command that was on its way when the connection dropped is asked again on the next one (they are all reads), and the start-up shares
one read of the latest ledgers instead of making two. The ledger clock counts seconds from 2000-01-01 (`unixTime` in `core/format.js`).

What is Bitcoin-specific beyond the towers: the fee card (`Fees to pay now`, `core/stats.js` `fromFees`) reads `/v1/fees/recommended` and says what
the fee rates (sat/vB) that get a transaction into the next block, within half an hour and within an hour, plus the "economy" rate; the page of a transaction that is not mined yet says whether it signals replace-by-fee
(BIP125: `signalsRbf` in `core/txs.js`; an ancestor that signals, or a node running full replace-by-fee, can make it replaceable anyway, and the page says so), when it is expected (`eta`: the position of its fee rate in the projected blocks, one block per ~10 minutes) and,
from `/v1/cpfp/<txid>`, the family it is bundled with (child-pays-for-parent).

Default nodes are public ones (`config.rpc` and `config.ws` for Ethereum and Solana, `config.api` and `config.ws` for Bitcoin, `config.ws` for XRP, in each `chain.js`): they may rate-limit, and their operators see
the IP address of the visitor and the addresses and transactions he looks up. Use your own node by changing those lists.

## Features of the engine that every chain gets

- **Links** (`controllers/links.js`): the address bar says what is shown (`#q=<what you would type in the search box>`): a block the camera
  is on, or the transaction / block / address of the dialog. Back and Forward close and reopen dialogs (each chain's `details.js` calls
  `Explorer.link.set(...)`), a link pasted into the address bar is opened once the page has loaded (`chain.search`), and the dialog has a
  "Copy link" button. Nothing to provide: a chain gets it by having `search`.
- **Color by price or by kind**: `Explorer.colors.mode` is `'price'` (the color of the rate) or `'kind'` (the `color` of the tower, the swatches of the
  `legend`). A chain with a `legend` and no `colorSwitch` is always by kind (XRP). With `colorSwitch: true` (Ethereum, Solana) it starts by price and the
  HUD offers "Color: Price / Kind" (`#colorby`, remembered); the legend and the note under the scene follow, and the scene paints the towers again in place
  (`scene.recolor()`).
- **The legend as a filter**: when the colors are kinds (a chain with a `legend`, and Ethereum / Solana in "Kind" mode), each swatch is a button: a click keeps
  the towers of that kind (their `color`) and dims the others, like the dimming of a tracked address; several kinds can be chosen, a second click on a kind
  puts it back, and leaving the "Kind" mode forgets the choice. The scene does it in `scene.setKindFilter(colors)` (the same factor as the wallet's `dim`: a
  tower of a tracked address stays lit whatever the filter says); the far light shapes of the blocks are not filtered.
- **Diagnostics** (`core/diag.js`, `ui/diag.js`): `?debug` (or Shift+D) opens a panel with what the page did with the network: requests per
  node, errors, the state of the connection and of the blocks held, and a "Copy report" button to paste into an issue. The network layers
  call `Explorer.diag?.note/count/gauge` (always optional: nothing depends on it); keys in URLs are masked in the report.

## Adding a chain

1. Create `js/chains/<name>/chain.js` calling `Explorer.defineChain({...})`. The call lists every missing or mistyped field of
   the contract in one error, so you can start from an empty object and fill it in.
2. Implement the data side: `data.*` (REST-like requests), `live.connect` (push events, in the shapes the contract describes)
   and, unless `nextBlock: false`, `live.trackNext` and `createPending` (the towers of the pending block). Turn the chain's raw formats into the tower model
   `{ txid, vsize, rate, color?, coinbase?, approx? }` and the block model `{ id, height, previousblockhash, timestamp }`.
3. Write its words: `blockCard`, `nextCard`, `blockLine`, `nextLine`, `feedRow`, `describeTower`.
4. Optionally provide hooks (`openTx`, `openBlock`, `search`, `onBlock`, `onVisible`, `onHighlight`, `start`) for its own
   detail screens, search and statistics (call `Explorer.link.set(what)` when a screen opens: that is what makes the address bar a link). A chain without a hook simply has no such feature.
5. Optionally state its look and shape: `theme.accent`, `rates.heightScale`, `rates.label`, `blockNumber`, `legend` (and a `color` on each tower) when colors are kinds rather than prices (`colorSwitch: true` to let the person choose), and `nextBlock: false`
   if there is no pending block to show (see the list of optional parts in `js/core/chain.js`).
6. Make a page: copy the closest one (`xrp.html` if there is no next block, `ethereum.html` if there is) and load the new chain's scripts instead, with its
   own `css/<name>.css` and favicon; add the chain to the switch of the other pages (a logo in `img/`) and a card to `index.html` (the card's colour is
   a `.card.<name>` rule in `css/style.css`). No build step: scripts only.
   A chain that speaks JSON-RPC can use `Explorer.jsonrpc.create` / `Explorer.jsonrpc.socket` from `js/net/jsonrpc.js`.
7. Try it: open the page; a fake node that answers the same JSON is enough to see every screen if the real ones are unreachable.

## Running

Nothing to install or build, and Node is not needed: open `index.html` (or a chain's page) in a browser.

## Known limitations

- **One chain per page.** `Explorer.chain` is a single global; two chains in one page are not supported.
- **Page chrome belongs to the page.** The titles, the statistics bar and the labels are in each chain's own `.html`.
- **The chains' live data was written against mocked nodes.** The public nodes cannot be reached from the environment this was
  built in: every screen and every flow was tested against a fake node that answers the standard JSON-RPC, not against the real
  ones. If a public node answers differently (a call it does not offer, a stricter rate limit), the first symptom is a warning
  in the console and a missing block or screen: see `data/` of the chain.
- **Historical names.** In the tower model, `vsize` means "size in capacity units" and `rate` "price per unit";
  the names come from Bitcoin (virtual size, sat/vB) and were kept to avoid a risky mass rename.
- **A chain with no proof-of-work** (Ethereum, Solana, the XRP Ledger...) needs decisions the contract does not make for you: what a "block"
  and a "slot" are, what the size of a transaction is (gas?), and what the next block shows. See `core/chain.js`.
