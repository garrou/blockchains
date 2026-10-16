#!/usr/bin/env node
// Checks that the engine does not know any blockchain: the engine files may only reach a chain through BTC.chain
// (contract: js/core/chain.js). Usage: node scripts/check-boundary.js   (exit code 1 and a list if the rule is broken)
//
// The engine = every js file except js/chains/ ; the chain = js/chains/<name>/.
// Comments are ignored (they may mention Bitcoin as an example); only the code is checked.
'use strict';
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'js');

// Modules that belong to a chain (and that a chain registers on BTC), and words only Bitcoin uses.
const FORBIDDEN = [
  [/\bBTC\.(api|socket|txs|projection|stats|address|wallet|search|details|searchCtl|statsCtl|walletCtl)\b/, 'a Bitcoin module'],
  [/\bBTC\.ui\.(detail|statsBar|wallet)\b/, 'a Bitcoin screen'],
  [/sat\/vB|\bsats?\b|\bsatoshis?\b|\bvB\b/, 'a Bitcoin unit'],
  [/mempool\.space/, 'a Bitcoin endpoint'],
];

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return p === path.join(JS, 'chains') ? [] : listFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

/** The code of a file with its comments blanked out (strings are kept: a '//' inside a string is not a comment). */
function stripComments(src) {
  let out = '', i = 0, quote = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

const problems = [];
for (const file of listFiles(JS)) {
  stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
    for (const [re, what] of FORBIDDEN) {
      if (re.test(line)) problems.push(`${path.relative(path.join(JS, '..'), file)}:${i + 1}: ${what}: ${line.trim()}`);
    }
  });
}

if (problems.length) {
  console.error(`The engine must not know a blockchain (only BTC.chain). ${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('OK: the engine reaches the chain only through BTC.chain');
