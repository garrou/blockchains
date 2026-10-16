# Architecture

The page is split in two:

- the **engine**: everything that draws blocks and transactions in 3D, keeps the list of blocks, the feed and the camera.
  It knows nothing about any blockchain.
- a **chain** (today: Bitcoin): one object that gives the engine its numbers, its words and its data.
  Everything specific to a chain lives in `js/chains/<name>/`.

The engine talks to the chain only through `BTC.chain`. The contract is written (and validated at startup) in
[`js/core/chain.js`](../js/core/chain.js). `node scripts/check-boundary.js` fails if an engine file names a Bitcoin module or unit.

## Where things are

```
js/
  core/          pure logic, no DOM, no network (treemap layout, colors, block list, feed buffer, formatting)
    chain.js     THE CONTRACT: what a chain must provide (BTC.defineChain)
  state/         the single mutable state of the app
  scene/         the 3D view (Three.js): rendering only
  ui/            DOM views of the engine (block row, HUD, feed, dialog shell)
  controllers/   orchestration (navigation, scene-sync, feed, "latest request wins")
  app.js         entry point: creates the views and the scene, connects the chain, wires everything
  chains/bitcoin/
    chain.js     the Bitcoin spec passed to BTC.defineChain: numbers, words, data, live, hooks
    core/        pure Bitcoin logic (transactions, addresses, wallet history, statistics, search classification)
    data/        mempool.space REST API and WebSocket
    ui/          Bitcoin screens (detail dialog content, statistics bar, tracked-address panel)
    controllers/ Bitcoin orchestration (detail requests, search, statistics, tracked address)
css/  index.html
```

All files are classic scripts sharing the global `BTC` (no modules, no build): the page works when double-clicked.
The order of the `<script>` tags in `index.html` matters; it follows the layers above, and the chain is loaded
right after `core/config.js` because some engine files read `BTC.chain` while loading.

## A short glossary of the 3D view

You do not need to know Three.js to read the engine; these are the ideas.

- **Slot**: the place of one block in the scene. Slots are laid out in a row along an axis, `pitch` units apart.
  The first slot is the **next block** (not mined yet, id `'next'`), then the latest mined block, then older ones.
- **Platform / cage**: a square plate (`size` units wide) with a frame around it. One per slot. A full block covers it.
- **Tower**: one transaction. Its **footprint** is proportional to its size (a block of `capacity.size` units covers the whole
  platform); its **height and color** come from its rate (price per unit of size), through the color scale of `chain.rates`.
  The coinbase (block reward) is drawn gold, in the corner.
- **Treemap** (`core/treemap.js`): the algorithm that decides which rectangle of the platform each tower gets, so that
  areas are proportional to sizes. Pure math, unit-tested. The **next block** uses an incremental variant so that towers
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

## Adding a chain

1. Create `js/chains/<name>/chain.js` calling `BTC.defineChain({...})`. The call lists every missing or mistyped field of
   the contract in one error, so you can start from an empty object and fill it in.
2. Implement the data side: `data.*` (REST-like requests), `live.connect` (push events, in the shapes the contract describes)
   and `createPending` (the towers of the pending block). Turn the chain's raw formats into the tower model
   `{ txid, vsize, rate, coinbase?, approx? }` and the block model `{ id, height, previousblockhash, timestamp }`.
3. Write its words: `blockCard`, `nextCard`, `blockLine`, `nextLine`, `feedRow`, `describeTower`.
4. Optionally provide hooks (`openTx`, `openBlock`, `search`, `onBlock`, `onVisible`, `onHighlight`, `start`) for its own
   detail screens, search and statistics. A chain without a hook simply has no such feature.
5. Make a page: copy `index.html` and load the new chain's scripts instead of Bitcoin's. No build step: scripts only.

## Known limitations

- **One chain per page.** `BTC.chain` is a single global; two chains in one page are not supported.
- **Modules are not namespaced per chain.** Bitcoin registers `BTC.api`, `BTC.txs`, `BTC.wallet`...; a second chain's
  page loads its own files instead, but two chains' files cannot be loaded together without renaming.
- **Page chrome is still Bitcoin's.** Titles, the statistics bar and the labels in `index.html` are Bitcoin text; a new page
  replaces them. The statistics bar and tracked-address panel markup belong to the Bitcoin chain's `ui/`.
- **Historical names.** In the tower model, `vsize` means "size in capacity units" and `rate` "price per unit";
  the names come from Bitcoin (virtual size, sat/vB) and were kept to avoid a risky mass rename.
- **A chain with no proof-of-work** (Ethereum, Solana...) needs decisions the contract does not make for you: what a "block"
  and a "slot" are, what the size of a transaction is (gas?), and what the next block shows. See `core/chain.js`.
