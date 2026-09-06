import test from 'node:test';
import assert from 'node:assert/strict';

import { parseList } from '../src/core/parser.js';
import { CosmeticFilterSet, candidateKeys, buildStylesheet } from '../src/core/cosmetic.js';

function setOf(lines) {
  const { cosmetic, network } = parseList(lines.join('\n'));
  return new CosmeticFilterSet(cosmetic, network.filter((r) => r.cosmeticControl));
}

test('generic rules apply everywhere', () => {
  const set = setOf(['##.generic-ad']);
  assert.match(set.selectFor('anything.test').css, /\.generic-ad/);
});

test('specific rules apply only to their domain', () => {
  const set = setOf(['example.com##.only-here']);
  assert.match(set.selectFor('example.com').css, /\.only-here/);
  assert.equal(set.selectFor('other.test').css, '');
});

test('specific rules also apply to subdomains', () => {
  const set = setOf(['example.com##.x']);
  assert.match(set.selectFor('www.a.example.com').css, /\.x/);
});

test('entity rules follow a site across TLDs', () => {
  const set = setOf(['aniwave.*##.adx']);
  assert.match(set.selectFor('aniwave.to').css, /\.adx/);
  assert.match(set.selectFor('aniwave.at').css, /\.adx/);
  assert.equal(set.selectFor('example.com').css, '');
});

test('a cosmetic exception protects a bait selector', () => {
  // The whole point of D1: a honeypot must keep rendering, or hiding it *is*
  // the detection.
  const set = setOf(['##.adsbox', 'kayoanime.com#@#.adsbox']);
  assert.match(set.selectFor('other.test').css, /\.adsbox/);
  assert.doesNotMatch(set.selectFor('kayoanime.com').css, /\.adsbox/);
  assert.deepEqual(set.selectFor('kayoanime.com').unhidden, ['.adsbox']);
});

test('$generichide suppresses generic rules but keeps specific ones', () => {
  const set = setOf(['##.generic', 'site.test##.specific', '@@||site.test^$generichide']);
  const bundle = set.selectFor('site.test');
  assert.doesNotMatch(bundle.css, /\.generic/);
  assert.match(bundle.css, /\.specific/);
  assert.equal(bundle.genericAllowed, false);
});

test('$elemhide suppresses all cosmetic filtering', () => {
  const set = setOf(['##.generic', 'site.test##.specific', '@@||site.test^$elemhide']);
  assert.equal(set.selectFor('site.test').css, '');
});

test('procedural rules are separated from declarative ones', () => {
  const set = setOf(['site.test##.card:has-text(Ad)', 'site.test##.plain']);
  const bundle = set.selectFor('site.test');
  assert.match(bundle.css, /\.plain/);
  assert.doesNotMatch(bundle.css, /has-text/);
  assert.equal(bundle.procedural.length, 1);
});

test('scriptlets are selected by domain', () => {
  const set = setOf(['aniwave.*##+js(no-window-open-if, _blank)']);
  assert.deepEqual(set.selectFor('aniwave.to').scriptlets, [{ name: 'no-window-open-if', args: ['_blank'] }]);
  assert.deepEqual(set.selectFor('example.com').scriptlets, []);
});

test('a scriptlet exception cancels one by name', () => {
  const set = setOf(['a.test##+js(prevent-popunder)', 'a.test#@#+js(prevent-popunder)']);
  assert.deepEqual(set.selectFor('a.test').scriptlets, []);
});

test('candidate keys cover every suffix plus the entity form', () => {
  const keys = candidateKeys('www.a.example.com');
  assert.ok(keys.includes('www.a.example.com'));
  assert.ok(keys.includes('example.com'));
  assert.ok(keys.includes('example.*'));
});

test('the stylesheet uses user-origin-strength !important', () => {
  assert.match(buildStylesheet(['.a', '.b']), /\.a,\n\.b \{ display: none !important; \}/);
  assert.equal(buildStylesheet([]), '');
});

test('duplicate selectors are emitted once', () => {
  assert.equal(buildStylesheet(['.a', '.a']).match(/\.a/g).length, 1);
});

test('$generichide survives the entity form of a rotating domain', () => {
  // Regression: `||aniwave.*^` was being reduced to `aniwave.` when the trailing
  // wildcard was stripped along with the anchors, so the pack silently lost its
  // opt-out and went back to hiding bait elements.
  const set = setOf(['##.generic', 'aniwave.*##.adx', '@@||aniwave.*^$generichide']);
  const bundle = set.selectFor('aniwave.to');
  assert.equal(bundle.genericAllowed, false);
  assert.doesNotMatch(bundle.css, /\.generic/);
  assert.match(bundle.css, /\.adx/);
});

test('a site pack opt-out does not leak to other sites', () => {
  const set = setOf(['##.generic', '@@||aniwave.*^$generichide']);
  assert.equal(set.selectFor('unrelated.test').genericAllowed, true);
  assert.match(set.selectFor('unrelated.test').css, /\.generic/);
});
