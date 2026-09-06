// Guards on the filter lists we actually ship. A typo in a list is as much of a
// bug as one in the engine, and it fails silently at runtime.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { parseList } from '../src/core/parser.js';
import { resolveSurrogate } from '../src/shared/surrogates.js';
import { SCRIPTLETS } from '../src/inject/scriptlets/index.js';
import { compileToDnr } from '../src/core/dnr-compiler.js';

const LISTS = [
  'assets/filters/core.txt',
  'assets/filters/popups.txt',
  'assets/filters/sites/kayoanime.txt',
  'assets/filters/sites/aniwave.txt',
];

const parsed = LISTS.map((path) => ({ path, ...parseList(readFileSync(path, 'utf8')) }));

test('every shipped list parses without errors', () => {
  for (const list of parsed) {
    assert.deepEqual(list.errors, [], `${list.path} has unparseable lines`);
  }
});

test('every $redirect names a surrogate that exists on disk', () => {
  for (const list of parsed) {
    for (const rule of list.network) {
      if (!rule.redirect) continue;
      const path = resolveSurrogate(rule.redirect);
      assert.ok(path, `${list.path}: unknown surrogate "${rule.redirect}"`);
      assert.ok(existsSync(`src/${path}`), `${list.path}: missing file src/${path}`);
    }
  }
});

test('every scriptlet invoked by a list is implemented', () => {
  for (const list of parsed) {
    for (const rule of list.cosmetic) {
      if (rule.type !== 'scriptlet') continue;
      assert.ok(
        Object.hasOwn(SCRIPTLETS, rule.scriptlet.name),
        `${list.path}: unknown scriptlet "${rule.scriptlet.name}"`,
      );
    }
  }
});

test('no list hard-blocks a script that is a known detector probe', () => {
  // Blocking these is the single most common way a blocker gives itself away
  // (D2/D3). They must be redirected to a surrogate instead.
  const probes = ['adsbygoogle.js', 'gpt.js', 'fuckadblock.js', 'show_ads.js'];
  for (const list of parsed) {
    for (const rule of list.network) {
      if (rule.isException || rule.redirect) continue;
      for (const probe of probes) {
        assert.ok(
          !rule.pattern.includes(probe),
          `${list.path}: "${rule.raw}" blocks a detector probe instead of redirecting it`,
        );
      }
    }
  }
});

test('the shipped lists fit inside the declarativeNetRequest budget', () => {
  let rules = 0;
  let regex = 0;
  for (const list of parsed) {
    const result = compileToDnr(list.network.filter((r) => !r.cosmeticControl));
    rules += result.rules.length;
    regex += result.regexCount;
  }
  assert.ok(rules <= 30_000, `${rules} static rules exceeds the DNR budget`);
  assert.ok(regex <= 1_000, `${regex} regex rules exceeds the DNR budget`);
});

test('the site packs opt out of generic cosmetic hiding', () => {
  // Generic `.ad`-style rules are exactly what hides a site's bait element, so a
  // defended site must rely on its own precise selectors (D1).
  for (const path of ['assets/filters/sites/kayoanime.txt', 'assets/filters/sites/aniwave.txt']) {
    const list = parsed.find((l) => l.path === path);
    assert.ok(
      list.network.some((r) => r.cosmeticControl === 'generic'),
      `${path} should carry a $generichide rule`,
    );
  }
});

test('no site pack uses :remove() on a defended site', () => {
  // Node removal is observable by a MutationObserver the page installs (D5).
  for (const path of ['assets/filters/sites/kayoanime.txt', 'assets/filters/sites/aniwave.txt']) {
    const list = parsed.find((l) => l.path === path);
    for (const rule of list.cosmetic) {
      assert.ok(
        !(rule.selector ?? '').includes(':remove()'),
        `${path}: "${rule.raw}" removes a node on a site that watches for it`,
      );
    }
  }
});
