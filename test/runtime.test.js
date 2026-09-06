// The stealth guarantees, exercised outside a browser.
//
// These are the properties that decide whether a page can spot the extension in
// one line of JavaScript, so they get direct tests rather than being left to a
// manual pass in a browser.

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;

const { wrapNative, replaceMethod, defineConstant, coerceValue, toMatcher, resolvePath } =
  await import('../src/inject/runtime.js');

test('a wrapped function still reports the original source', () => {
  function nativeish(a, b) { return a + b; }
  const original = String(nativeish);
  const proxy = wrapNative(nativeish, () => 'patched');
  assert.equal(proxy(1, 2), 'patched');
  assert.equal(Function.prototype.toString.call(proxy), original);
});

test('the toString trap lies about itself too', () => {
  assert.match(Function.prototype.toString.call(Function.prototype.toString), /\[native code\]/);
});

test('unrelated functions are unaffected by the trap', () => {
  function untouched(x) { return x; }
  assert.equal(Function.prototype.toString.call(untouched), String(untouched));
});

test('a wrapped function keeps name, length and callability', () => {
  function open(url, target) { return [url, target]; }
  const proxy = wrapNative(open, () => null);
  assert.equal(proxy.name, 'open');
  assert.equal(proxy.length, 2);
  assert.equal(typeof proxy, 'function');
  assert.ok(proxy instanceof Function);
});

test('replaceMethod preserves the property descriptor exactly', () => {
  const target = {};
  Object.defineProperty(target, 'probe', {
    value: function probe() { return 'real'; },
    writable: true, enumerable: false, configurable: true,
  });
  const before = Object.getOwnPropertyDescriptor(target, 'probe');

  replaceMethod(target, 'probe', () => () => 'fake');

  const after = Object.getOwnPropertyDescriptor(target, 'probe');
  assert.equal(target.probe(), 'fake');
  assert.equal(after.writable, before.writable);
  assert.equal(after.enumerable, before.enumerable);
  assert.equal(after.configurable, before.configurable);
});

test('replaceMethod hands the original to the factory, not to a global', () => {
  const target = { call: function call() { return 'original'; } };
  let captured = null;
  replaceMethod(target, 'call', (original) => { captured = original; return () => original(); });
  assert.equal(typeof captured, 'function');
  assert.equal(target.call(), 'original');
  // Nothing may be parked on the global object for the page to find.
  assert.equal(Object.keys(globalThis).filter((k) => k.toLowerCase().includes('umbra')).length, 0);
});

test('defineConstant ignores writes but looks like a normal property', () => {
  defineConstant('testFlag', true);
  assert.equal(globalThis.testFlag, true);
  globalThis.testFlag = false;
  assert.equal(globalThis.testFlag, true);
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'testFlag');
  assert.equal(desc.enumerable, true);
  assert.equal(desc.configurable, true);
});

test('defineConstant creates intermediate objects for a dotted path', () => {
  defineConstant('nested.deep.value', 42);
  assert.equal(globalThis.nested.deep.value, 42);
});

test('coerceValue understands the scriptlet value vocabulary', () => {
  assert.equal(coerceValue('true'), true);
  assert.equal(coerceValue('false'), false);
  assert.equal(coerceValue('null'), null);
  assert.equal(coerceValue('1'), 1);
  assert.equal(coerceValue('1.5'), 1.5);
  assert.deepEqual(coerceValue('emptyArr'), []);
  assert.equal(typeof coerceValue('noopFunc'), 'function');
  assert.equal(coerceValue('noopFunc')(), undefined);
  assert.equal(coerceValue('trueFunc')(), true);
  assert.equal(coerceValue('literal'), 'literal');
});

test('toMatcher supports substrings, regexes, negation and match-all', () => {
  assert.ok(toMatcher('')('anything'));
  assert.ok(toMatcher('*')('anything'));
  assert.ok(toMatcher('ads')('https://x/ads.js'));
  assert.ok(!toMatcher('ads')('https://x/main.js'));
  assert.ok(toMatcher('/ad[sv]/')('https://x/adv'));
  assert.ok(toMatcher('!keep')('drop this'));
  assert.ok(!toMatcher('!keep')('keep this'));
});

test('a malformed regex argument degrades to a literal substring test', () => {
  // Failing closed matters here: a broken argument must make the scriptlet a
  // no-op, never a catch-all that starts suppressing unrelated behaviour.
  const match = toMatcher('/unclosed(/');
  assert.doesNotThrow(() => match('anything'));
  assert.ok(!match('unclosed('));
  assert.ok(match('literally /unclosed(/ here'));
});

test('resolvePath returns null for a missing path unless asked to create', () => {
  assert.equal(resolvePath({}, 'a.b.c'), null);
  const root = {};
  const target = resolvePath(root, 'a.b.c', true);
  assert.equal(target.key, 'c');
  assert.equal(typeof root.a.b, 'object');
});

test('wrapping an already-wrapped function preserves the original source', () => {
  // Regression: two scriptlets patching the same method (a site pack combining
  // `no-window-open-if` with `prevent-popunder` does exactly this) used to
  // degrade the reported source to a bare `function () { [native code] }`,
  // dropping the function's name. The missing name is the detectable part.
  function open(url, target) { return [url, target]; }
  const source = String(open);

  const once = wrapNative(open, () => 'first');
  const twice = wrapNative(once, () => 'second');

  assert.equal(Function.prototype.toString.call(once), source);
  assert.equal(Function.prototype.toString.call(twice), source);
  assert.equal(twice.name, 'open');
  assert.equal(twice(), 'second');
});
