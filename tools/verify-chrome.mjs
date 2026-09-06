// Load the built Chrome extension in a real browser and check that it both
// blocks and stays invisible.
//
//   node build.mjs --target=chrome && xvfb-run -a node tools/verify-chrome.mjs
//
// A local server stands in for an ad-supported site. Chromium's
// --host-resolver-rules maps the site packs' real hostnames onto it, so the
// packs activate exactly as they would in the wild, with no outbound traffic.

import http from 'node:http';
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EXTENSION = path.resolve('dist/chrome');
const PORT = 8099;

const hits = [];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title></head>
<body>
  <!-- Honeypot: must keep its geometry, or hiding it is the detection. -->
  <div class="adsbox pub_300x250" id="AdContainer" style="width:300px;height:250px"></div>
  <!-- A real ad container. It uses a selector from the kayoanime pack, not a
       generic one: the pack carries $generichide, so generic rules are
       deliberately inert here. -->
  <div class="below-post-ad" style="width:300px;height:250px">ad</div>
  <img id="banner" src="http://thirdparty.test:${PORT}/ads/banner1.png" width="10" height="10">
  <script src="http://thirdparty.test:${PORT}/pagead/js/ads.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  hits.push(`${req.headers.host}${req.url}`);
  if (req.url.startsWith('/ads/') || req.url.startsWith('/pagead/')) {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('window.__adLoaded = true;');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE);
});

// The probes a detector would run, evaluated inside the page.
const PROBES = () => {
  const results = {};
  const bait = document.querySelector('.adsbox');
  const baitStyle = getComputedStyle(bait);
  results.baitVisible = bait.offsetHeight > 0 && baitStyle.display !== 'none';

  const real = document.querySelector('.below-post-ad');
  results.adHidden = getComputedStyle(real).display === 'none';

  results.sheetsLeak = [...document.styleSheets].some((sheet) => {
    try {
      return [...sheet.cssRules].some((rule) =>
        rule.style && rule.style.display === 'none' && /below-post-ad|\bad/i.test(rule.selectorText ?? ''));
    } catch { return false; }
  });

  results.openNative = /\[native code\]/.test(Function.prototype.toString.call(window.open));
  results.openName = window.open.name;

  let popped = null;
  try { popped = window.open('http://pop.example.net/x', '_blank'); } catch { /* blocked */ }
  results.popNotNull = Boolean(popped);
  results.popClosedFalse = popped ? popped.closed === false : null;
  try { if (popped && popped.close) popped.close(); } catch { /* decoy */ }

  results.adScriptRan = window.__adLoaded === true;
  results.googleAdStatus = window.google_ad_status ?? null;
  results.canRunAds = window.canRunAds ?? null;

  results.domFootprint = /(chrome|moz)-extension:\/\/|umbra/i.test(document.documentElement.outerHTML);
  results.globalFootprint = Object.getOwnPropertyNames(window).filter((k) => /umbra/i.test(k));

  return results;
};

async function run({ withExtension }) {
  const profile = mkdtempSync(path.join(tmpdir(), 'umbra-profile-'));
  const args = [
    `--host-resolver-rules=MAP kayoanime.com 127.0.0.1:${PORT}, MAP thirdparty.test 127.0.0.1:${PORT}`,
    '--no-first-run',
    '--no-sandbox',
  ];
  if (withExtension) {
    args.push(`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`);
  }

  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: false,
    args,
  });

  try {
    if (withExtension) {
      // The service worker has to finish loading its lists before the packs are
      // registered; without this the first navigation races the engine.
      const deadline = Date.now() + 15_000;
      while (context.serviceWorkers().length === 0 && Date.now() < deadline) {
        await context.waitForEvent('serviceworker', { timeout: 2000 }).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 2500));
    }

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(`http://kayoanime.com:${PORT}/`, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForTimeout(1200);

    return { probes: await page.evaluate(PROBES), errors };
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

try {
  hits.length = 0;
  const off = await run({ withExtension: false });
  const hitsOff = [...hits];

  hits.length = 0;
  const on = await run({ withExtension: true });
  const hitsOn = [...hits];

  const adRequests = (list) => list.filter((h) => h.includes('/ads/') || h.includes('/pagead/'));

  const rows = [
    ['blocks the third-party ad image', adRequests(hitsOn).every((h) => !h.includes('/ads/banner')),
      `off: ${adRequests(hitsOff).length} ad request(s), on: ${adRequests(hitsOn).length}`],
    ['blocks the third-party ad script', on.probes.adScriptRan === false,
      `off adScriptRan=${off.probes.adScriptRan}, on=${on.probes.adScriptRan}`],
    ['hides the real ad container', on.probes.adHidden === true, `display:none = ${on.probes.adHidden}`],
    ['leaves the bait element visible (D1)', on.probes.baitVisible === true,
      `off=${off.probes.baitVisible}, on=${on.probes.baitVisible}`],
    ['hiding rules absent from document.styleSheets (D8)', on.probes.sheetsLeak === false,
      `leak = ${on.probes.sheetsLeak}`],
    ['site pack defines google_ad_status (D3)', on.probes.googleAdStatus === 1,
      `google_ad_status = ${on.probes.googleAdStatus}`],
    ['site pack defines canRunAds (D3)', on.probes.canRunAds === true, `canRunAds = ${on.probes.canRunAds}`],
    ['window.open still reports [native code] (D10)', on.probes.openNative === true,
      `name="${on.probes.openName}" native=${on.probes.openNative}`],
    ['cross-site pop returns a decoy, not null (D9)', on.probes.popNotNull === true && on.probes.popClosedFalse === true,
      `notNull=${on.probes.popNotNull} closed=${on.probes.popClosedFalse}`],
    ['no extension URL or marker in the DOM (D12)', on.probes.domFootprint === false,
      `footprint = ${on.probes.domFootprint}`],
    ['no globals on window (D12)', on.probes.globalFootprint.length === 0,
      on.probes.globalFootprint.join(', ') || 'clean'],
    ['no uncaught page errors', on.errors.length === 0, on.errors.join(' | ') || 'none'],
  ];

  let failed = 0;
  for (const [name, pass, detail] of rows) {
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
  }

  console.log(`\n${rows.length - failed}/${rows.length} checks passed`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  server.close();
}
