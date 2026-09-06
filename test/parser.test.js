import test from 'node:test';
import assert from 'node:assert/strict';

import { parseList, parseNetworkFilter, parseCosmeticFilter, patternToRegex } from '../src/core/parser.js';
import { T, DEFAULT_TYPES } from '../src/core/types.js';

test('network options round-trip to the IR', () => {
  const rule = parseNetworkFilter('||ads.example.com^$script,third-party,domain=foo.com|~bar.com,important');
  assert.equal(rule.isException, false);
  assert.equal(rule.isImportant, true);
  assert.equal(rule.thirdParty, true);
  assert.equal(rule.types, T.script);
  assert.deepEqual(rule.includeDomains, ['foo.com']);
  assert.deepEqual(rule.excludeDomains, ['bar.com']);
  assert.equal(rule.token, 'example');
});

test('exception rules are marked', () => {
  const rule = parseNetworkFilter('@@||example.com/ok.js$script');
  assert.equal(rule.isException, true);
  assert.equal(rule.pattern, '||example.com/ok.js');
});

test('negated type options land in excludedTypes', () => {
  const rule = parseNetworkFilter('||example.com^$~script');
  assert.equal(rule.types, 0);
  assert.equal(rule.excludedTypes, T.script);
});

test('first-party is third-party negated', () => {
  assert.equal(parseNetworkFilter('||a.com^$first-party').thirdParty, false);
  assert.equal(parseNetworkFilter('||a.com^$~third-party').thirdParty, false);
  assert.equal(parseNetworkFilter('||a.com^$3p').thirdParty, true);
});

test('a slash-delimited pattern is a regex', () => {
  const rule = parseNetworkFilter('/banner\\d+\\.png/$image');
  assert.equal(rule.kind, 'regex');
  assert.equal(rule.regexSource, 'banner\\d+\\.png');
});

test('a trailing wildcard keeps the pattern literal', () => {
  const rule = parseNetworkFilter('/advertising/*$third-party');
  assert.equal(rule.kind, 'pattern');
  assert.equal(rule.pattern, '/advertising/*');
});

test('an invalid regex is rejected at parse time', () => {
  assert.throws(() => parseNetworkFilter('/a(/$script'), /invalid regular expression/);
});

test('a rule that is only options matches every request', () => {
  const rule = parseNetworkFilter('$removeparam=utm_source');
  assert.equal(rule.pattern, '*');
  assert.deepEqual(rule.removeParams, ['utm_source']);
});

test('a dollar sign inside a URL is not an option separator', () => {
  const rule = parseNetworkFilter('||example.com/a$b/c^$script');
  assert.equal(rule.pattern, '||example.com/a$b/c^');
  assert.equal(rule.types, T.script);
});

test('unknown options are reported, not silently dropped', () => {
  assert.throws(() => parseNetworkFilter('||a.com^$nonsense'), /unknown option/);
});

test('cosmetic filters carry their domain scope', () => {
  const rule = parseCosmeticFilter('example.com,~sub.example.com##.ad');
  assert.equal(rule.type, 'hide');
  assert.deepEqual(rule.includeDomains, ['example.com']);
  assert.deepEqual(rule.excludeDomains, ['sub.example.com']);
  assert.equal(rule.selector, '.ad');
});

test('#@# is a cosmetic exception', () => {
  assert.equal(parseCosmeticFilter('example.com#@#.adsbox').type, 'unhide');
});

test('scriptlet calls parse into name and arguments', () => {
  const rule = parseCosmeticFilter('aniwave.*##+js(no-window-open-if, _blank)');
  assert.equal(rule.type, 'scriptlet');
  assert.deepEqual(rule.scriptlet, { name: 'no-window-open-if', args: ['_blank'] });
});

test('scriptlet arguments survive commas inside a regex argument', () => {
  const rule = parseCosmeticFilter('a.com##+js(no-window-open-if, /a{1,3}/)');
  assert.deepEqual(rule.scriptlet.args, ['/a{1,3}/']);
});

test('procedural operators are detected even behind a plain ## marker', () => {
  assert.equal(parseCosmeticFilter('a.com##.card:has-text(Sponsored)').procedural, true);
  assert.equal(parseCosmeticFilter('a.com##.card').procedural, false);
});

test('cosmetic control options are recognised', () => {
  const rule = parseNetworkFilter('@@||kayoanime.com^$generichide');
  assert.equal(rule.cosmeticControl, 'generic');
});

test('a URL containing # is still a network filter', () => {
  const { network, cosmetic } = parseList('||example.com/path#frag^$script');
  assert.equal(network.length, 1);
  assert.equal(cosmetic.length, 0);
});

test('comments and section headers are skipped', () => {
  const { network, cosmetic, errors } = parseList('! comment\n[Adblock Plus 2.0]\n\n||a.com^');
  assert.equal(network.length, 1);
  assert.equal(cosmetic.length, 0);
  assert.equal(errors.length, 0);
});

test('|| anchors to a domain boundary', () => {
  const re = patternToRegex('||doubleclick.net^');
  assert.ok(re.test('https://sub.doubleclick.net/x'));
  assert.ok(re.test('https://doubleclick.net/'));
  assert.ok(!re.test('https://notdoubleclick.net/x'));
  assert.ok(!re.test('https://example.com/?u=doubleclick.net/'));
});

test('^ matches a separator or the end of the URL', () => {
  const re = patternToRegex('||a.com^');
  assert.ok(re.test('https://a.com/'));
  assert.ok(re.test('https://a.com'));
  assert.ok(re.test('https://a.com?x=1'));
  assert.ok(!re.test('https://a.company/'));
});

test('| anchors to the start and end', () => {
  assert.ok(patternToRegex('|https://a.com/x|').test('https://a.com/x'));
  assert.ok(!patternToRegex('|https://a.com/x|').test('https://a.com/xy'));
});

test('DEFAULT_TYPES excludes top-level documents', () => {
  assert.equal(DEFAULT_TYPES & T.main_frame, 0);
  assert.ok(DEFAULT_TYPES & T.script);
});
