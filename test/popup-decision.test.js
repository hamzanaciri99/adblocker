import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseList } from '../src/core/parser.js';
import { NetworkFilterSet } from '../src/core/matcher.js';
import { shouldClosePopup } from '../src/core/popup-decision.js';
import { hostnameOf } from '../src/core/domains.js';

function matcherFor(lines) {
  const set = new NetworkFilterSet(parseList(lines.join('\n')).network.filter((r) => !r.cosmeticControl));
  return (url, documentUrl, type) => set.match({
    url, hostname: hostnameOf(url), documentHostname: hostnameOf(documentUrl), type,
  });
}

const SOURCE = 'https://site.test/watch';

test('a $popup rule closes the tab', () => {
  const match = matcherFor(['||popads.net^$popup']);
  assert.ok(shouldClosePopup(match, 'https://popads.net/lander', SOURCE));
});

test('a known ad domain closes the tab even without a $popup rule', () => {
  const match = matcherFor(['||adsterra.net^$third-party']);
  assert.ok(shouldClosePopup(match, 'https://adsterra.net/lander', SOURCE));
});

test('an ordinary cross-site link is left alone', () => {
  const match = matcherFor(['||popads.net^$popup']);
  assert.equal(shouldClosePopup(match, 'https://wikipedia.org/wiki/Anime', SOURCE), null);
});

test('a catch-all $removeparam rule never closes a tab', () => {
  // Regression, and a bad one: `$removeparam=utm_source` compiles to a rule with
  // no URL filter, so it matches every request. Treating any non-allow verdict
  // as grounds to close meant every cross-site tab the user opened was destroyed
  // -- the extension looked like a broken browser rather than an ad blocker.
  const match = matcherFor(['$removeparam=utm_source', '$removeparam=fbclid']);
  assert.equal(shouldClosePopup(match, 'https://example.org/article', SOURCE), null);
  assert.equal(shouldClosePopup(match, 'https://example.org/article?utm_source=x', SOURCE), null);
});

test('a $redirect surrogate verdict never closes a tab', () => {
  // A surrogate means "serve a stub", not "destroy this tab".
  const match = matcherFor(['||cdn.test^$redirect=noopjs']);
  assert.equal(shouldClosePopup(match, 'https://cdn.test/thing', SOURCE), null);
});

test('same-site tabs are never closed by the second pass', () => {
  const match = matcherFor(['||site.test/ads^$third-party']);
  assert.equal(shouldClosePopup(match, 'https://site.test/ads/page', SOURCE), null);
});

test('an exception rule protects the tab', () => {
  const match = matcherFor(['||popads.net^$popup', '@@||popads.net/allowed^$document']);
  assert.equal(shouldClosePopup(match, 'https://popads.net/allowed', SOURCE), null);
});

test('the real shipped lists do not close an innocuous cross-site tab', () => {
  const lists = ['core.txt', 'popups.txt', 'sites/aniwave.txt', 'sites/kayoanime.txt']
    .map((f) => readFileSync(`assets/filters/${f}`, 'utf8'));
  const match = matcherFor(lists);

  for (const url of [
    'https://wikipedia.org/wiki/Anime',
    'https://github.com/some/repo',
    'https://mail.google.com/',
    'http://thirdparty.test:8099/landing',
  ]) {
    assert.equal(shouldClosePopup(match, url, SOURCE), null, `${url} should not be closed`);
  }

  // ...but a real pop target still is.
  assert.ok(shouldClosePopup(match, 'https://popads.net/lander', SOURCE));
});
