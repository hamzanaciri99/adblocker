// End-to-end checks against the artifacts in dist/.
//
// Everything else tests source modules. These load the files the browser would
// actually load, which is where a build-pipeline mistake shows up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { createDom } from './helpers/dom-shim.js';

const DIST = 'dist/chrome';
const built = existsSync(`${DIST}/manifest.json`);

const skip = built ? false : 'run `npm run build:chrome` first';

test('the adsbygoogle surrogate defines what a detector reads', { skip }, () => {
  const dom = createDom();
  dom.run(readFileSync(`${DIST}/surrogates/googlesyndication_adsbygoogle.js`, 'utf8'));

  assert.notEqual(typeof dom.window.adsbygoogle, 'undefined');
  assert.equal(dom.window.adsbygoogle.loaded, true);
  assert.equal(dom.window.google_ad_status, 1);
  assert.equal(dom.window.adsbygoogle.push({}), 1);
});

test('the FuckAdBlock surrogate always takes the not-detected branch', { skip }, async () => {
  const dom = createDom();
  dom.run(readFileSync(`${DIST}/surrogates/fuckadblock.js`, 'utf8'));

  assert.equal(typeof dom.window.FuckAdBlock, 'function');

  const fired = await new Promise((resolve) => {
    let seen = false;
    dom.window.fuckAdBlock.onDetected(() => { seen = 'detected'; });
    dom.window.fuckAdBlock.onNotDetected(() => { if (!seen) resolve('notDetected'); });
    setTimeout(() => resolve(seen || 'nothing'), 60);
  });
  assert.equal(fired, 'notDetected');
});

test('the GPT surrogate drains its command queue', { skip }, () => {
  const dom = createDom();
  dom.run(readFileSync(`${DIST}/surrogates/googletagservices_gpt.js`, 'utf8'));

  let ran = false;
  dom.window.googletag.cmd.push(() => { ran = true; });
  assert.equal(ran, true);
  assert.equal(dom.window.googletag.apiReady, true);
  assert.equal(dom.window.googletag.pubads().getSlots().length, 0);
  assert.equal(dom.window.googletag.defineSlot('/a/b').getAdUnitPath(), '/a/b');
});

test('the Prebid surrogate calls bidsBackHandler so publisher flows continue', { skip }, async () => {
  const dom = createDom();
  dom.run(readFileSync(`${DIST}/surrogates/prebid-ads.js`, 'utf8'));

  const called = await new Promise((resolve) => {
    dom.window.pbjs.requestBids({ bidsBackHandler: () => resolve(true) });
    setTimeout(() => resolve(false), 60);
  });
  assert.equal(called, true);
});

function loadPack(dom, predicate) {
  const packs = JSON.parse(readFileSync(`${DIST}/inject/packs.json`, 'utf8'));
  const pack = packs.find(predicate);
  assert.ok(pack, 'no matching pack in the build');
  dom.run(readFileSync(`${DIST}/${pack.main}`, 'utf8'), pack.main);
  return pack;
}

test('the kayoanime pack installs its constants', { skip }, () => {
  const dom = createDom({ href: 'https://kayoanime.com/some-post' });
  loadPack(dom, (p) => p.matches.some((m) => m.includes('kayoanime')));

  assert.equal(dom.window.google_ad_status, 1);
  assert.equal(dom.window.canRunAds, true);
});

test('a pack leaves no marker on the global object', { skip }, () => {
  const dom = createDom({ href: 'https://kayoanime.com/x' });
  const before = new Set(Object.getOwnPropertyNames(dom.window));
  loadPack(dom, (p) => p.matches.some((m) => m.includes('kayoanime')));

  const added = Object.getOwnPropertyNames(dom.window).filter((k) => !before.has(k));
  const suspicious = added.filter((k) => /umbra|scriptlet|blocker/i.test(k));
  assert.deepEqual(suspicious, [], `pack leaked: ${suspicious.join(', ')}`);
});

test('window.open still reports [native code] after a pack patches it', { skip }, () => {
  const dom = createDom({ href: 'https://kayoanime.com/x' });
  const original = String(dom.window.open);
  loadPack(dom, (p) => p.matches.some((m) => m.includes('kayoanime')));

  // The patch must be invisible to the standard one-line tamper check (D10).
  assert.equal(dom.run('Function.prototype.toString.call(window.open)'), original);
  assert.equal(dom.window.open.name, 'open');
});

test('a cross-site pop gets a decoy window, not null', { skip }, () => {
  const dom = createDom({ href: 'https://kayoanime.com/x' });
  loadPack(dom, (p) => p.matches.some((m) => m.includes('kayoanime')));

  const popped = dom.window.open('https://pop.example.net/lander', '_blank');
  // Returning null is what a pop blocker does, and sites gate on it (D9).
  assert.notEqual(popped, null);
  assert.equal(popped.closed, false);
  assert.equal(typeof popped.focus, 'function');
  assert.equal(popped.document.readyState, 'complete');
});

test('a same-site window.open is left alone', { skip }, () => {
  const dom = createDom({ href: 'https://kayoanime.com/x' });
  loadPack(dom, (p) => p.matches.some((m) => m.includes('kayoanime')));

  const opened = dom.window.open('https://kayoanime.com/download', '_blank');
  assert.equal(opened.opened, 'https://kayoanime.com/download');
});

test('the aniwave pack sets the interstitial cookie and kills its detector', { skip }, () => {
  const dom = createDom({ href: 'https://aniwave.to/watch/x' });
  loadPack(dom, (p) => p.matches.some((m) => m.includes('aniwave')));

  assert.match(dom.document.cookie, /__pf=1/);
  assert.equal(dom.window.canRunAds, true);
  assert.equal(dom.window.adBlockDetected, false);
  // Reading the detector must throw, so its own script unwinds and nothing else does.
  assert.throws(() => dom.window.AaDetector, (err) => err.name === 'ReferenceError');
});

test('the packs manifest points at files that exist', { skip }, () => {
  const packs = JSON.parse(readFileSync(`${DIST}/inject/packs.json`, 'utf8'));
  assert.ok(packs.length > 0);
  for (const pack of packs) {
    assert.ok(existsSync(`${DIST}/${pack.main}`), `missing ${pack.main}`);
    assert.ok(existsSync(`${DIST}/${pack.iso}`), `missing ${pack.iso}`);
    assert.ok(pack.matches.length > 0, `${pack.id} matches nothing`);
    assert.ok(!pack.excludeMatches || pack.excludeMatches.length > 0);
  }
});

test('every DNR rule redirect target is packaged', { skip }, () => {
  for (const name of ['core', 'popups', 'site-aniwave', 'site-kayoanime']) {
    const rules = JSON.parse(readFileSync(`${DIST}/rules/${name}.json`, 'utf8'));
    for (const rule of rules) {
      const path = rule.action?.redirect?.extensionPath;
      if (!path) continue;
      assert.ok(existsSync(`${DIST}${path}`), `${name}: missing ${path}`);
    }
  }
});

test('the manifest declares the surrogates as web-accessible', { skip }, () => {
  const manifest = JSON.parse(readFileSync(`${DIST}/manifest.json`, 'utf8'));
  const entry = manifest.web_accessible_resources[0];
  assert.ok(entry.resources.includes('surrogates/*'));
  // A stable extension URL is enumerable by any page that knows the id (D7).
  assert.equal(entry.use_dynamic_url, true);
  assert.equal(manifest.key, undefined, 'a manifest key would pin the extension id');
});
