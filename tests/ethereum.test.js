// Unit tests of the pure Ethereum code (js/chains/ethereum/core/). No dependency: node tests/ethereum.test.js
'use strict';
const assert = require('assert');
const path = require('path');

global.window = {};
window.BTC = { format: { number: (n) => Number(n).toLocaleString('en-US') } };
const ROOT = path.join(__dirname, '..', 'js', 'chains', 'ethereum', 'core');
for (const f of ['keccak', 'format', 'blocks', 'txs', 'mempool', 'projection', 'address', 'search', 'abi']) require(path.join(ROOT, `${f}.js`));
const E = window.BTC.eth;

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; } };
const gwei = (g) => BigInt(Math.round(g * 1e9));

test('keccak256 known vectors', () => {
  assert.strictEqual(E.keccak.hex(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.strictEqual(E.keccak.hex('abc'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.strictEqual(E.keccak.hex('transfer(address,uint256)').slice(0, 8), 'a9059cbb'); // the ERC-20 transfer selector
  assert.strictEqual(`0x${E.keccak.hex('Transfer(address,address,uint256)')}`, E.abi.TRANSFER_TOPIC);
  // inputs around the 136-byte block boundary
  for (const n of [135, 136, 137, 272]) assert.strictEqual(E.keccak.hex('a'.repeat(n)).length, 64);
});

test('EIP-55 checksum (the vectors of the standard)', () => {
  for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb']) {
    assert.strictEqual(E.address.checksum(a.toLowerCase()), a);
    assert.ok(E.address.checksumOk(a));
    assert.ok(E.address.checksumOk(a.toLowerCase()));
    const typo = a.replace(/[a-f]/i, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
    assert.ok(!E.address.checksumOk(typo), 'a flipped letter must be caught');
  }
  assert.ok(E.address.isAddress('0x' + 'a'.repeat(40)) && !E.address.isAddress('0x' + 'a'.repeat(39)));
});

test('ENS namehash (the vectors of EIP-137)', () => {
  assert.strictEqual(E.abi.namehash(''), '0'.repeat(64));
  assert.strictEqual(E.abi.namehash('eth'), '93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
  assert.strictEqual(E.abi.namehash('foo.eth'), 'de9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f');
});

test('base fee: EIP-1559 rule', () => {
  const base = 10n ** 9n, limit = 30e6;
  assert.strictEqual(E.blocks.nextBaseFee(base, 15e6, limit), base);                 // on target: unchanged
  assert.strictEqual(E.blocks.nextBaseFee(base, 30e6, limit), base + base / 8n);     // full block: +12.5 %
  assert.strictEqual(E.blocks.nextBaseFee(base, 0, limit), base - base / 8n);        // empty block: -12.5 %
  assert.strictEqual(E.blocks.nextBaseFee(base, 22.5e6, limit), base + base / 16n);  // halfway to full: +6.25 %
  assert.strictEqual(E.blocks.nextBaseFee(7n, 30e6, limit), 8n);                     // always at least +1 wei above target
  assert.strictEqual(E.blocks.nextBaseFee(0n, 30e6, limit), 1n);
});

test('formatting: wei without float errors', () => {
  const f = E.format;
  assert.strictEqual(f.eth(1500000000000000000n), '1.5 ETH');
  assert.strictEqual(f.eth(0n), '0 ETH');
  assert.strictEqual(f.eth(123456789012345678901234567n), '123,456,789.012345 ETH');   // beyond 2^53: exact
  assert.strictEqual(f.eth(1n), '<0.000001 ETH');
  assert.strictEqual(f.ethSigned(-(10n ** 17n)), '-0.1 ETH');
  assert.strictEqual(f.ethSigned(10n ** 17n), '+0.1 ETH');
  assert.strictEqual(f.gwei(0.0312), '0.031');
  assert.strictEqual(f.gwei(1.234), '1.23');
  assert.strictEqual(f.gwei(12.34), '12.3');
  assert.strictEqual(f.gwei(1234.5), '1235');
  assert.strictEqual(f.gwei(0), '0');
  assert.strictEqual(f.gas(21000), '21,000');
  assert.strictEqual(f.gas(12345678), '12.3M');
  assert.strictEqual(f.units(-5n, 1, 1), '-0.5');
});

test('search box classification', () => {
  const c = E.search.classify;
  assert.deepStrictEqual(c('21000000'), { type: 'height', height: 21000000 });
  assert.deepStrictEqual(c(' #21,000,000 '), { type: 'height', height: 21000000 });
  assert.deepStrictEqual(c('0x' + 'AB'.repeat(32)), { type: 'hash', hash: '0x' + 'ab'.repeat(32) });
  assert.deepStrictEqual(c('ab'.repeat(32)), { type: 'hash', hash: '0x' + 'ab'.repeat(32) });
  assert.strictEqual(c('0x' + 'ab'.repeat(20)).type, 'address');
  assert.strictEqual(c('0x' + 'ab'.repeat(20)).checksumOk, true);
  assert.strictEqual(c('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd').checksumOk, false); // last letter changed
  assert.deepStrictEqual(c('Vitalik.ETH'), { type: 'name', name: 'vitalik.eth' });
  for (const bad of ['', 'hello', '0x12', '0x' + 'zz'.repeat(32), 'vitalik.com', '99999999999999999999999']) assert.strictEqual(c(bad).type, 'unknown', bad);
});

test('ABI: token names, transfers', () => {
  const str = (s) => { const b = Buffer.from(s).toString('hex'); return `0x${'20'.padStart(64, '0')}${s.length.toString(16).padStart(64, '0')}${b.padEnd(64, '0')}`; };
  assert.strictEqual(E.abi.decodeText(str('USD Coin')), 'USD Coin');
  assert.strictEqual(E.abi.decodeText(`0x${Buffer.from('MKR').toString('hex').padEnd(64, '0')}`), 'MKR'); // bytes32 symbol
  assert.strictEqual(E.abi.decodeText('0x'), null);
  assert.strictEqual(E.abi.decodeText(`0x${'20'.padStart(64, '0')}${'ffff'.padStart(64, '0')}`), null);  // absurd length: refused
  const w = (a) => `0x${a.padStart(64, '0')}`;
  const logs = [
    { address: '0xAAAA', topics: [E.abi.TRANSFER_TOPIC, w('11'), w('22')], data: w('64') },        // ERC-20: 100
    { address: '0xBBBB', topics: [E.abi.TRANSFER_TOPIC, w('11'), w('22'), w('7')], data: '0x' },     // ERC-721: token 7
    { address: '0xCCCC', topics: ['0xdeadbeef'], data: '0x' },                                       // something else
  ];
  const t = E.abi.transfers(logs);
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].value, 100n); assert.strictEqual(t[0].from, '0x' + '11'.padStart(40, '0')); assert.strictEqual(t[0].token, '0xaaaa');
  assert.strictEqual(t[1].tokenId, 7n);
  assert.strictEqual(E.abi.addressOf('0x' + '0'.repeat(64)), null);
});

test('builder name from the extra data', () => {
  const hex = (s) => `0x${Buffer.from(s).toString('hex')}`;
  assert.strictEqual(E.blocks.builderOf(hex('beaverbuild.org')), 'beaverbuild.org');
  assert.strictEqual(E.blocks.builderOf(hex('Titan (titanbuilder.xyz)')), 'Titan (titanbuilder.xyz)');
  assert.strictEqual(E.blocks.builderOf('0x'), null);
  assert.doesNotThrow(() => E.blocks.builderOf('0xd883010d0e846765746888676f312e32312e36856c696e7578')); // a client version tag: whatever it reads as, no crash
  assert.strictEqual(E.blocks.builderOf('0x0001020304'), null);                                          // binary junk
});

test('effective gas price', () => {
  const base = gwei(10);
  const t = (o) => ({ ...o });
  assert.strictEqual(E.txs.effectivePrice(t({ maxFeePerGas: '0x' + gwei(50).toString(16), maxPriorityFeePerGas: '0x' + gwei(2).toString(16) }), base), gwei(12)); // base + tip
  assert.strictEqual(E.txs.effectivePrice(t({ maxFeePerGas: '0x' + gwei(11).toString(16), maxPriorityFeePerGas: '0x' + gwei(2).toString(16) }), base), gwei(11)); // capped by the max fee
  assert.strictEqual(E.txs.effectivePrice(t({ gasPrice: '0x' + gwei(30).toString(16) }), base), gwei(30));                                                      // legacy
  assert.strictEqual(E.txs.effectivePrice(t({ maxFeePerGas: '0x' + gwei(5).toString(16), maxPriorityFeePerGas: '0x' + gwei(2).toString(16) }), base), base);     // cannot pay the base fee: no tip
});

const tx = (o) => ({ hash: '0x' + o.id, from: o.from ?? '0xa', nonce: '0x' + (o.nonce ?? 0).toString(16), to: '0xb', value: '0x0', input: '0x', type: '0x2', gas: '0x' + (o.gas ?? 21000).toString(16), maxFeePerGas: '0x' + gwei(o.max ?? 50).toString(16), maxPriorityFeePerGas: '0x' + gwei(o.tip ?? 1).toString(16) });

test('rows and towers', () => {
  const block = { baseFeeWei: gwei(10) };
  const row = E.txs.row({ ...tx({ id: '1', gas: 50000 }), gasPrice: '0x0', transactionIndex: '0x3' }, { gasUsed: '0xc350', effectiveGasPrice: '0x' + gwei(12).toString(16), status: '0x1' }, block);
  assert.strictEqual(row.gasUsed, 50000); assert.strictEqual(row.price, 12); assert.strictEqual(row.ok, true); assert.strictEqual(E.txs.feeWei(row), gwei(12) * 50000n);
  const tower = E.txs.towerOf(row);
  assert.deepStrictEqual([tower.txid, tower.vsize, tower.rate], ['0x1', 50000, 12]);
  const rows = E.txs.estimateGas([E.txs.row(tx({ id: 'a', gas: 21000 }), null, block), E.txs.row(tx({ id: 'b', gas: 63000 }), null, block)], 40000);
  assert.strictEqual(rows[0].gasUsed + rows[1].gasUsed, 40000);
  assert.strictEqual(E.txs.kindOf({ to: null }), 'create');
  assert.strictEqual(E.txs.kindOf({ to: '0x1', input: '0x' }), 'transfer');
  assert.strictEqual(E.txs.labelOf('call', '0xa9059cbb'), 'Token transfer');
  assert.strictEqual(E.txs.labelOf('call', '0x12345678'), 'Contract call (0x12345678)');
});

test('mempool: best tip first, fits the block, replaced and mined txs leave', () => {
  const pool = E.mempool.create({ max: 100, ttlMs: 1000 });
  pool.setBase(gwei(10));
  const add = (o) => pool.add(E.txs.pending(tx(o), o.seen ?? 0));
  add({ id: 'low', from: '0x1', tip: 1 }); add({ id: 'high', from: '0x2', tip: 9 }); add({ id: 'mid', from: '0x3', tip: 4 });
  add({ id: 'cheap', from: '0x4', max: 9, tip: 5 });                       // max fee below the base fee: cannot be included
  assert.deepStrictEqual(pool.pack(1e6).towers.map((t) => t.txid), ['0xhigh', '0xmid', '0xlow']);
  assert.strictEqual(pool.pack(1e6).waiting, 1);
  assert.strictEqual(pool.pack(1e6).towers[0].rate, 19);                  // base 10 + tip 9
  assert.deepStrictEqual(pool.pack(42000).towers.map((t) => t.txid), ['0xhigh', '0xmid']);  // room for two plain transfers
  assert.strictEqual(add({ id: 'dup', from: '0x2', nonce: 0, tip: 12 }), 'replaced'); // same sender, same nonce: replaces 'high'
  assert.ok(!pool.has('0xhigh') && pool.has('0xdup'));
  assert.strictEqual(add({ id: 'dup', from: '0x2', nonce: 0 }), 'dup');
  // a block mines nonce 0 of 0x3: its tx leaves, and so does an older nonce of the same sender
  add({ id: 'old', from: '0x5', nonce: 3 }); add({ id: 'new', from: '0x5', nonce: 7 });
  pool.dropMined([{ hash: '0xmid', from: '0x3', nonce: 0 }, { hash: '0xother', from: '0x5', nonce: 5 }]);
  assert.ok(!pool.has('0xmid') && !pool.has('0xold') && pool.has('0xnew'));
  pool.prune(5000);
  assert.strictEqual(pool.size(), 0);                                     // everything is older than the ttl
  // a full pool drops the cheapest
  const small = E.mempool.create({ max: 2 }); small.setBase(gwei(1));
  small.add(E.txs.pending(tx({ id: 'x', from: '0x1', max: 5 }))); small.add(E.txs.pending(tx({ id: 'y', from: '0x2', max: 50 }))); small.add(E.txs.pending(tx({ id: 'z', from: '0x3', max: 20 })));
  assert.ok(!small.has('0xx') && small.has('0xy') && small.has('0xz'));
});

test('projection holder: snapshot, then deltas', () => {
  const p = E.projection.create();
  assert.strictEqual(p.apply({ added: [{ txid: 'a' }] }), null);          // a delta before any snapshot is ignored
  assert.deepStrictEqual(p.apply({ snapshot: [{ txid: 'a' }, { txid: 'b' }] }), { added: [] });
  assert.ok(p.hasData() && p.has('a') && p.size() === 2);
  const res = p.apply({ added: [{ txid: 'c' }], removed: ['a'] });
  assert.strictEqual(res.added.length, 1);
  assert.deepStrictEqual(p.takeFresh(), ['c']);
  assert.deepStrictEqual(p.takeFresh(), []);
  assert.deepStrictEqual(p.values().map((t) => t.txid), ['b', 'c']);
  p.reset();
  assert.ok(!p.hasData());
});

console.log(`${passed} tests passed`);
