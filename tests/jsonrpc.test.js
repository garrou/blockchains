// Tests of the shared JSON-RPC client (js/net/jsonrpc.js) against a fake fetch and a fake WebSocket. node tests/jsonrpc.test.js
'use strict';
const assert = require('assert');
const path = require('path');

global.window = {};
global.AbortController = AbortController;
require(path.join(__dirname, '..', 'js', 'net', 'jsonrpc.js'));
const J = window.BTC.jsonrpc;

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- HTTP -----
function fakeFetch(handler) {
  const calls = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = await handler(url, body);
    return { ok: r.status === undefined || r.status < 400, status: r.status ?? 200, json: async () => r.json };
  };
  return calls;
}
const answer = (m) => ({ jsonrpc: '2.0', id: m.id, result: `${m.method}:ok` });

test('call: result, JSON-RPC error, null result', async () => {
  fakeFetch((url, m) => ({ json: m.method === 'bad' ? { id: m.id, error: { code: -32601, message: 'nope' } } : m.method === 'none' ? { id: m.id, result: null } : answer(m) }));
  const rpc = J.create({ urls: () => ['http://a'], timeoutMs: () => 1000 });
  assert.strictEqual(await rpc.call('x'), 'x:ok');
  assert.strictEqual(await rpc.call('none'), null);
  await assert.rejects(rpc.call('bad'), (e) => e.code === -32601 && e.rpc === true && e.message === 'nope');
});

test('failover to the next node, which is then kept', async () => {
  const calls = fakeFetch((url, m) => (url === 'http://a' ? { status: 503, json: {} } : { json: answer(m) }));
  const rpc = J.create({ urls: () => ['http://a', 'http://b'], timeoutMs: () => 1000 });
  assert.strictEqual(await rpc.call('x'), 'x:ok');
  assert.deepStrictEqual(calls.map((c) => c.url), ['http://a', 'http://b']);
  await rpc.call('y');
  assert.deepStrictEqual(calls.slice(2).map((c) => c.url), ['http://b']);   // the node that answered is tried first now
});

test('every node down: the last error', async () => {
  fakeFetch(() => ({ status: 429, json: {} }));
  const rpc = J.create({ urls: () => ['http://a', 'http://b'], timeoutMs: () => 1000 });
  await assert.rejects(rpc.call('x'), (e) => e.status === 429);
});

test('batch: order kept, one failure does not lose the others', async () => {
  fakeFetch((url, body) => ({ json: body.slice().reverse().map((m) => (m.method === 'bad' ? { id: m.id, error: { code: 1, message: 'boom' } } : answer(m))) })); // answered in another order
  const rpc = J.create({ urls: () => ['http://a'], timeoutMs: () => 1000 });
  const res = await rpc.batch([['a', []], ['bad', []], ['c', []]]);
  assert.strictEqual(res[0], 'a:ok'); assert.ok(res[1] instanceof Error && res[1].message === 'boom'); assert.strictEqual(res[2], 'c:ok');
  assert.deepStrictEqual(await rpc.batch([]), []);
});

test('a node that refuses batches gets the calls one by one', async () => {
  const calls = fakeFetch((url, body) => (Array.isArray(body) ? { json: { error: 'batch not supported' } } : { json: answer(body) }));
  const rpc = J.create({ urls: () => ['http://a'], timeoutMs: () => 1000 });
  assert.deepStrictEqual(await rpc.batch([['a', []], ['b', []]]), ['a:ok', 'b:ok']);
  assert.strictEqual(calls.filter((c) => !Array.isArray(c.body)).length, 2);
});

test('timeout: a node that never answers is given up on', async () => {
  global.fetch = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const rpc = J.create({ urls: () => ['http://a'], timeoutMs: () => 50 });
  await assert.rejects(rpc.call('x'), /aborted/);
});

// ----- WebSocket -----
const sockets = [];
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; setTimeout(() => this.onclose && this.onclose(), 1); }
  say(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
}
FakeSocket.OPEN = 1;
global.WebSocket = FakeSocket;

test('socket: subscribes, delivers messages, ignores garbage', async () => {
  sockets.length = 0;
  const got = [];
  J.socket({ urls: () => ['ws://a', 'ws://b'], onOpen: (send) => send({ hello: 1 }), onMessage: (m) => got.push(m), onClose() {} });
  await sleep(20);
  assert.deepStrictEqual(sockets[0].sent, [{ hello: 1 }]);
  sockets[0].say({ n: 1 });
  sockets[0].onmessage({ data: 'not json' });
  sockets[0].say({ n: 2 });
  assert.deepStrictEqual(got, [{ n: 1 }, { n: 2 }]);
});

test('socket: a lost connection is reopened on the next node', async () => {
  sockets.length = 0;
  let closed = 0;
  J.socket({ urls: () => ['ws://a', 'ws://b'], onOpen() {}, onMessage() {}, onClose: () => closed++ });
  await sleep(20);
  sockets[0].close();
  await sleep(1300);                                   // the first retry waits 1 s
  assert.strictEqual(closed, 1);
  assert.deepStrictEqual(sockets.map((s) => s.url), ['ws://a', 'ws://b']);
});

test('socket: silence is detected (watchdog), messages keep it quiet', async () => {
  sockets.length = 0;
  J.socket({ urls: () => ['ws://a', 'ws://b'], staleMs: 120, onOpen() {}, onMessage() {}, onClose() {} });
  await sleep(20);
  for (let i = 0; i < 8; i++) { await sleep(40); sockets[0].say({ tick: i }); }   // 320 ms in all, never 120 ms of silence
  assert.strictEqual(sockets[0].readyState, 1, 'a connection that keeps talking stays open');
  await sleep(200);                                    // now it is silent
  assert.strictEqual(sockets[0].readyState, 3, 'a silent connection is closed');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n  ${e.stack.split('\n').slice(0, 3).join('\n  ')}`); process.exitCode = 1; }
  }
  console.log(`${passed} tests passed`);
  process.exit(process.exitCode || 0);
})();
