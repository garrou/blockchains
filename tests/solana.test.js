// Unit tests of the pure Solana code (js/chains/solana/core/). No dependency: node tests/solana.test.js
'use strict';
const assert = require('assert');
const path = require('path');

global.window = {};
window.BTC = {
  format: { number: (n) => Number(n).toLocaleString('en-US'), short: (s, h = 10, t = 8) => (s.length > h + t + 1 ? `${s.slice(0, h)}…${s.slice(-t)}` : s) },
  chain: { config: { sample: 10, txRef: 3000 } },
};
const ROOT = path.join(__dirname, '..', 'js', 'chains', 'solana', 'core');
for (const f of ['format', 'base58', 'programs', 'blocks', 'txs', 'search']) require(path.join(ROOT, `${f}.js`));
const S = window.BTC.sol;

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; } };

const SYSTEM = '11111111111111111111111111111111';
const VOTE = 'Vote111111111111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const BUDGET = 'ComputeBudget111111111111111111111111111111';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const encode = (bytes) => { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x); let o = ''; while (n > 0n) { o = A[Number(n % 58n)] + o; n /= 58n; } for (const x of bytes) { if (x !== 0) break; o = `1${o}`; } return o; };

test('base58', () => {
  assert.deepStrictEqual([...S.base58.decode('2g')], [0x61]);              // "a"
  assert.deepStrictEqual([...S.base58.decode('1112')], [0, 0, 0, 1]);      // leading 1s are zero bytes
  assert.strictEqual(S.base58.decode('0OIl'), null);                       // characters outside the alphabet
  assert.strictEqual(S.base58.kindOf(SYSTEM), 'key');                       // the System program: 32 zero bytes
  assert.strictEqual(S.base58.kindOf(TOKEN), 'key');
  assert.strictEqual(S.base58.kindOf(VOTE), 'key');
  assert.strictEqual(S.base58.kindOf('1'.repeat(64)), 'signature');         // 64 zero bytes
  assert.strictEqual(S.base58.kindOf('abc'), null);
  assert.strictEqual(S.base58.kindOf('0x' + 'ab'.repeat(20)), null);
});

test('search box classification', () => {
  const c = S.search.classify;
  assert.deepStrictEqual(c('300,000,000'), { type: 'slot', slot: 300000000 });
  assert.deepStrictEqual(c('#42'), { type: 'slot', slot: 42 });
  assert.deepStrictEqual(c(` ${TOKEN} `), { type: 'account', address: TOKEN });
  const sig = encode(Array.from({ length: 64 }, (_, i) => i + 1));
  assert.deepStrictEqual(c(sig), { type: 'signature', signature: sig });
  for (const bad of ['', 'hello', '0x' + 'ab'.repeat(32), '99999999999999999999999']) assert.strictEqual(c(bad).type, 'unknown', bad);
});

test('formatting', () => {
  const f = S.format;
  assert.strictEqual(f.sol(1500000000), '1.5 SOL');
  assert.strictEqual(f.sol(5000), '0.000005 SOL');
  assert.strictEqual(f.sol(1), '<0.000001 SOL');
  assert.strictEqual(f.sol(0), '0 SOL');
  assert.strictEqual(f.sol(-2500000000), '-2.5 SOL');
  assert.strictEqual(f.solSigned(2500000000), '+2.5 SOL');
  assert.strictEqual(f.price(0), '0');
  assert.strictEqual(f.price(850), '850');
  assert.strictEqual(f.price(12000), '12k');
  assert.strictEqual(f.price(2137), '2.1k');
  assert.strictEqual(f.price(3400000), '3.4M');
  assert.strictEqual(f.price(1e6), '1M');
  assert.strictEqual(f.cu(2100), '2,100');
  assert.strictEqual(f.cu(48200000), '48.2M');
  assert.strictEqual(f.units(1234560000n, 6), '1,234.56');
  assert.strictEqual(f.units(-1500000n, 6), '-1.5');
});

test('what a transaction likely is, from its accounts', () => {
  const k = S.programs.kindOf;
  assert.strictEqual(k(['payer', 'x', VOTE]), 'vote');
  assert.strictEqual(k(['payer', 'a', 'b', TOKEN, JUPITER, BUDGET]), 'swap');
  assert.strictEqual(k(['payer', 'a', TOKEN, BUDGET]), 'token');
  assert.strictEqual(k(['payer', 'dest', SYSTEM]), 'transfer');
  assert.strictEqual(k(['payer', 'dest', SYSTEM, BUDGET]), 'transfer');
  assert.strictEqual(k(['payer', 'a', 'b', 'c', 'd', 'e', SYSTEM]), 'program');   // the System program among many accounts: something else
  assert.strictEqual(k(['payer', 'whatever']), 'program');
  assert.strictEqual(S.programs.labelOf('swap', ['p', JUPITER]), 'Swap (Jupiter)');
  assert.strictEqual(S.programs.labelOf('vote'), 'Validator vote');
});

const keys = (...a) => a.map((pubkey, i) => ({ pubkey, signer: i === 0 }));
test('a transaction row: priority fee, rate, what moved', () => {
  const swap = S.txs.row({
    transaction: { signatures: ['sig'], accountKeys: keys('payer', 'a', TOKEN, JUPITER, BUDGET) },
    meta: { err: null, fee: 5000 + 20000, computeUnitsConsumed: 100000, preBalances: [10e9, 1, 1, 1, 1], postBalances: [9e9 - 25000, 1, 1, 1, 1] },
  });
  assert.strictEqual(swap.kind, 'swap'); assert.strictEqual(swap.priority, 20000); assert.strictEqual(swap.cu, 100000);
  assert.strictEqual(swap.rate, 200000);                   // 20,000 lamports over 100,000 units = 200,000 micro-lamports per unit
  assert.strictEqual(swap.moved, 1e9);                       // the payer sent 1 SOL away besides the fee
  const vote = S.txs.row({ transaction: { signatures: ['v'], accountKeys: keys('validator', 'vacc', VOTE) }, meta: { fee: 5000, computeUnitsConsumed: 2100, preBalances: [5e9, 0, 1], postBalances: [5e9 - 5000, 0, 1] } });
  assert.strictEqual(vote.kind, 'vote'); assert.strictEqual(vote.priority, 0); assert.strictEqual(vote.rate, 0); assert.strictEqual(vote.moved, 0);
  const failed = S.txs.row({ transaction: { signatures: ['f'], accountKeys: keys('p', 'd', SYSTEM) }, meta: { err: { InstructionError: [0, 'x'] }, fee: 5000, computeUnitsConsumed: 150, preBalances: [3e9, 0, 1], postBalances: [3e9 - 5000, 0, 1] } });
  assert.strictEqual(failed.ok, false); assert.strictEqual(failed.moved, 0);
  const two = S.txs.row({ transaction: { signatures: ['a', 'b'], accountKeys: ['p', 'q', SYSTEM] }, meta: { fee: 10000, computeUnitsConsumed: 300, preBalances: [2e9, 1e9, 1], postBalances: [2e9 - 10000 - 5e8, 1e9 + 5e8, 1] } });
  assert.strictEqual(two.nSigs, 2); assert.strictEqual(two.priority, 0);              // two signatures: 10,000 is the base fee
  assert.strictEqual(two.moved, 5e8);
  assert.strictEqual(two.kind, 'transfer');
  const tower = S.txs.towerOf(swap);
  assert.deepStrictEqual([tower.txid, tower.vsize, tower.rate], ['sig', 100000, 200000]);
  assert.ok(S.txs.towerOf(S.txs.row({ transaction: { signatures: ['n'], accountKeys: keys('p') }, meta: null })).vsize > 0, 'a transaction without meta still has a size');
});

test('a transaction in a format we do not know is skipped, not fatal', () => {
  assert.strictEqual(S.txs.row({ transaction: { signatures: ['s'] }, meta: {} }), null);          // no accounts
  assert.strictEqual(S.txs.row({ transaction: { accountKeys: keys('p'), signatures: [] } }), null); // no signature
  assert.strictEqual(S.txs.row({ meta: {} }), null);
  const v1 = S.txs.row({ transaction: { signatures: ['s'], message: { accountKeys: keys('payer', SYSTEM) } }, meta: { fee: 5000, computeUnitsConsumed: 150 }, version: 1 });
  assert.ok(v1 && v1.sig === 's' && v1.payer === 'payer');                                          // keys under message: read as well
});

test('compute budget and instructions in words', () => {
  const b58 = encode;
  const limit = b58([2, 0x40, 0x0d, 0x03, 0x00]);                    // 200,000 as u32 little-endian
  const price = b58([3, 0xe8, 0x03, 0, 0, 0, 0, 0, 0]);              // 1,000 as u64 little-endian
  assert.deepStrictEqual(S.txs.computeBudget([{ programId: BUDGET, data: limit }, { programId: BUDGET, data: price }, { programId: SYSTEM, data: 'xx' }]), { limit: 200000, price: 1000 });
  assert.deepStrictEqual(S.txs.computeBudget([]), { limit: null, price: null });
  const d = S.txs.describeInstruction({ program: 'system', programId: SYSTEM, parsed: { type: 'transfer', info: { source: 'AAAAAAAAAAAAAAAA', destination: 'BBBBBBBBBBBBBBBB', lamports: 2500000000 } } });
  assert.strictEqual(d.program, 'System'); assert.strictEqual(d.action, 'transfer'); assert.ok(d.text.includes('2.5 SOL'));
  const c = S.txs.describeInstruction({ programId: BUDGET, data: limit });
  assert.strictEqual(c.action, 'set compute unit limit'); assert.strictEqual(c.text, '200,000 units');
  const u = S.txs.describeInstruction({ programId: 'Unknown1111111111111111111111111111111111', accounts: ['a', 'b'], data: b58([1, 2, 3]) });
  assert.ok(/2 accounts/.test(u.text));
});

test('balance changes', () => {
  const meta = { preBalances: [10, 5, 7], postBalances: [4, 11, 7],
    preTokenBalances: [{ accountIndex: 1, mint: 'M', owner: 'o', uiTokenAmount: { amount: '5000000', decimals: 6 } }],
    postTokenBalances: [{ accountIndex: 1, mint: 'M', owner: 'o', uiTokenAmount: { amount: '3500000', decimals: 6 } }, { accountIndex: 2, mint: 'M', owner: 'p', uiTokenAmount: { amount: '1500000', decimals: 6 } }] };
  assert.deepStrictEqual(S.txs.balanceChanges(meta, ['a', 'b', 'c']), [{ address: 'a', change: -6 }, { address: 'b', change: 6 }]);
  const t = S.txs.tokenChanges(meta);
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual(t.map((x) => x.change).sort(), [-1500000n, 1500000n]);
});

test('blocks: groups, links, fill', () => {
  const b = S.blocks;
  assert.strictEqual(b.groupOf(300000000), 30000000); assert.strictEqual(b.groupOf(300000009), 30000000); assert.strictEqual(b.groupOf(300000010), 30000001);
  assert.strictEqual(b.firstSlotOf(30000001), 300000010);
  const blk = b.normalize(300000013, { blockhash: 'H', previousBlockhash: 'P', parentSlot: 300000012, blockTime: 1700000000, blockHeight: 5, signatures: ['a', 'b', 'c'] }, 'PREV');
  assert.deepStrictEqual([blk.id, blk.height, blk.slot, blk.previousblockhash, blk.parentHash, blk.tx_count], ['H', 30000001, 300000013, 'PREV', 'P', 3]);
  const list = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  b.link(list);
  assert.deepStrictEqual(list.map((x) => x.previousblockhash), ['b', 'a', undefined]);
  assert.strictEqual(b.fill({ tx_count: 1500 }), 0.5); assert.strictEqual(b.fill({ tx_count: 99999 }), 1);
});

console.log(`${passed} tests passed`);
