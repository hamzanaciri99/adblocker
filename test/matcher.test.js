import test from 'node:test';
import assert from 'node:assert/strict';

import { parseList } from '../src/core/parser.js';
import { NetworkFilterSet } from '../src/core/matcher.js';
import { T } from '../src/core/types.js';
import { getDomain, isThirdParty, hostMatchesPattern } from '../src/core/domains.js';

function setOf(lines) {
  return new NetworkFilterSet(parseList(lines.join('\n')).network);
}

function check(set, url, type = T.script, documentHostname = 'site.test') {
  return set.match({ url, hostname: new URL(url).hostname, documentHostname, type });
}

test('a matching rule blocks', () => {
  const set = setOf(['||ads.example.com^$script']);
  assert.equal(check(set, 'https://ads.example.com/a.js').action, 'block');
});

test('a non-matching type does not block', () => {
  const set = setOf(['||ads.example.com^$script']);
  assert.equal(check(set, 'https://ads.example.com/a.png', T.image), null);
});

test('an exception beats a block', () => {
  const set = setOf(['||ads.example.com^', '@@||ads.example.com/ok.js']);
  assert.equal(check(set, 'https://ads.example.com/bad.js').action, 'block');
  assert.equal(check(set, 'https://ads.example.com/ok.js').action, 'allow');
});

test('$important beats an exception', () => {
  const set = setOf(['||tracker.io^$important', '@@||tracker.io^']);
  assert.equal(check(set, 'https://tracker.io/x').action, 'block');
});

test('$redirect produces a redirect verdict, not a block', () => {
  const set = setOf(['||g.com/ads.js$script,redirect=noopjs']);
  const verdict = check(set, 'https://g.com/ads.js');
  assert.equal(verdict.action, 'redirect');
  assert.equal(verdict.rule.redirect, 'noopjs');
});

test('$third-party respects the document host', () => {
  const set = setOf(['||cdn.example.com^$third-party']);
  assert.equal(check(set, 'https://cdn.example.com/a.js', T.script, 'other.test').action, 'block');
  assert.equal(check(set, 'https://cdn.example.com/a.js', T.script, 'example.com'), null);
});

test('$domain scopes a rule to named sites', () => {
  const set = setOf(['||ads.io^$domain=allowed.test']);
  assert.equal(check(set, 'https://ads.io/x', T.script, 'allowed.test').action, 'block');
  assert.equal(check(set, 'https://ads.io/x', T.script, 'other.test'), null);
});

test('a ~domain exclusion wins over the include list', () => {
  const set = setOf(['||ads.io^$domain=~excluded.test']);
  assert.equal(check(set, 'https://ads.io/x', T.script, 'excluded.test'), null);
  assert.equal(check(set, 'https://ads.io/x', T.script, 'anything.test').action, 'block');
});

test('untyped rules never match a top-level document', () => {
  const set = setOf(['||ads.io^']);
  assert.equal(check(set, 'https://ads.io/x', T.main_frame), null);
});

test('$popup rules do match a document load', () => {
  const set = setOf(['||popads.net^$popup']);
  assert.equal(check(set, 'https://popads.net/x', T.main_frame).action, 'block');
});

test('$badfilter cancels an identical rule', () => {
  const set = setOf(['||ads.io^$script', '||ads.io^$script,badfilter']);
  assert.equal(check(set, 'https://ads.io/x'), null);
});

test('cosmetic-control rules are not network decisions', () => {
  const set = setOf(['@@||site.test^$generichide']);
  assert.equal(set.size, 0);
});

test('untokenizable rules are still consulted', () => {
  // 'com' is a stopword and 'a' is too short, so this rule has no token.
  const set = setOf(['||a.com^']);
  assert.equal(check(set, 'https://a.com/x').action, 'block');
});

test('registrable domain handles multi-label suffixes', () => {
  assert.equal(getDomain('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(getDomain('sub.example.com'), 'example.com');
  assert.equal(getDomain('example.com'), 'example.com');
});

test('third-party classification uses the registrable domain', () => {
  assert.equal(isThirdParty('cdn.example.com', 'www.example.com'), false);
  assert.equal(isThirdParty('ads.other.com', 'www.example.com'), true);
});

test('entity patterns match any TLD for the same base name', () => {
  assert.ok(hostMatchesPattern('aniwave.to', 'aniwave.*'));
  assert.ok(hostMatchesPattern('www.aniwave.at', 'aniwave.*'));
  assert.ok(!hostMatchesPattern('aniwaves.to', 'aniwave.*'));
});
