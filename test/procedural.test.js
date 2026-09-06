import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProcedural } from '../src/content/procedural.js';

test('a plain selector has no operators', () => {
  assert.deepEqual(parseProcedural('.card'), { base: '.card', ops: [] });
});

test('operators are split off the base selector', () => {
  const { base, ops } = parseProcedural('div.card:has-text(Sponsored):upward(2)');
  assert.equal(base, 'div.card');
  assert.deepEqual(ops, [
    { name: 'has-text', arg: 'Sponsored' },
    { name: 'upward', arg: '2' },
  ]);
});

test('an omitted base selector defaults to *', () => {
  assert.equal(parseProcedural(':has-text(x)').base, '*');
});

test('nested parentheses inside an argument are preserved', () => {
  const { ops } = parseProcedural('.a:matches-css(background-image: url(x.png))');
  assert.equal(ops[0].arg, 'background-image: url(x.png)');
});

test('native :not() is left in the CSS base selector', () => {
  const { base, ops } = parseProcedural('.a:not(.b):has-text(x)');
  assert.equal(base, '.a:not(.b)');
  assert.equal(ops.length, 1);
});

test(':remove() parses as a terminal operator', () => {
  const { ops } = parseProcedural('.a:remove()');
  assert.deepEqual(ops, [{ name: 'remove', arg: '' }]);
});

test('an unterminated operator does not hang the parser', () => {
  const { base, ops } = parseProcedural('.a:has-text(unclosed');
  assert.equal(ops.length, 0);
  assert.ok(base.startsWith('.a'));
});
