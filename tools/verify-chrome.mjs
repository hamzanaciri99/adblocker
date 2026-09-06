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

const CHROME = process.env.UMBRA_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// Defaults to the build directory; point it at an unpacked release to verify the
// artifact a user actually downloads rather than the one the build just wrote.
const EXTENSION = path.resolve(process.env.UMBRA_EXTENSION ?? 'dist/chrome');
const PORT = Number(process.env.UMBRA_PORT ?? 8099);

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

  <!-- A pop-under: a click anywhere on the page opens something unrelated. -->
  <div id="playerish" style="width:200px;height:60px;background:#eee">click me</div>

  <!-- The other two ways a pop SDK opens a tab without calling window.open. -->
  <div id="popdispatch" style="width:200px;height:40px;background:#ddd">dispatch</div>
  <div id="popform" style="width:200px;height:40px;background:#ccc">form</div>

  <!-- A genuine new-tab link, opened by script the way real sites do it. -->
  <a id="reallink" href="http://thirdparty.test:${PORT}/landing" target="_blank">landing</a>

  <script>
    window.__popResult = 'not-run';
    document.getElementById('playerish').addEventListener('click', () => {
      const w = window.open('http://pop.example.net/lander', '_blank');
      window.__popResult = w === null ? 'null' : 'object';
    });
    window.__linkResult = 'not-run';
    document.getElementById('popdispatch').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = 'http://pop.example.net/via-dispatch';
      a.target = '_blank';
      document.body.appendChild(a);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    document.getElementById('popform').addEventListener('click', () => {
      const f = document.createElement('form');
      f.method = 'GET';
      f.action = 'http://pop.example.net/via-form';
      f.target = '_blank';
      document.body.appendChild(f);
      f.submit();
    });
    document.getElementById('reallink').addEventListener('click', (e) => {
      e.preventDefault();
      const w = window.open(e.currentTarget.href, '_blank');
      if (w === null) { window.__linkResult = 'null'; return; }
      // A real cross-origin window throws on document access; the decoy does not.
      try {
        window.__linkResult = (w.location.href === 'about:blank' && w.document.readyState === 'complete')
          ? 'decoy' : 'real';
      } catch { window.__linkResult = 'real'; }
    });
  </script>
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

  // Every builtin the scriptlets replace has to survive the one-line tamper
  // check, not just window.open — a patch that forgets to spoof its source is
  // as good as a banner announcing the extension (D10).
  const suspects = [
    ['window.open', window.open],
    ['EventTarget.dispatchEvent', EventTarget.prototype.dispatchEvent],
    ['HTMLElement.click', HTMLElement.prototype.click],
    ['HTMLFormElement.submit', HTMLFormElement.prototype.submit],
    ['EventTarget.addEventListener', EventTarget.prototype.addEventListener],
    ['setTimeout', window.setTimeout],
    ['setInterval', window.setInterval],
    ['fetch', window.fetch],
    ['JSON.parse', JSON.parse],
  ];
  results.tampered = suspects
    .filter(([, fn]) => {
      try { return !/\[native code\]/.test(Function.prototype.toString.call(fn)); }
      catch { return true; }
    })
    .map(([name]) => name);
  results.suspectCount = suspects.length;
  results.openNative = results.tampered.length === 0;
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

/**
 * Click via raw mouse input rather than `page.click()`.
 *
 * Playwright's click waits for the action to "settle", which never happens on an
 * anchor whose handler opens a window — it hangs for the full timeout. Driving
 * the mouse directly still produces trusted events, which is the only property
 * that matters here: the pop-under heuristic keys off `event.isTrusted`, so a
 * synthetic `dispatchEvent` would test nothing.
 */
async function trustedClick(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

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

    const probes = await page.evaluate(PROBES);

    // Snapshot here, before any click opens a second tab. That tab is served
    // from thirdparty.test, so the ad requests it makes are first-party to it
    // and correctly not blocked -- counting them would test the wrong thing.
    const adRequestsOnPage = hits.filter((h) => h.includes('/ads/') || h.includes('/pagead/')).length;

    // Pop-under behaviour needs *trusted* clicks, which only a real browser can
    // produce -- page.click() dispatches one, page-authored dispatchEvent does
    // not. This is the part no unit test can stand in for.
    const pagesBefore = context.pages().length;
    await trustedClick(page, '#playerish');
    await page.waitForTimeout(700);
    probes.popFromClickResult = await page.evaluate(() => window.__popResult);

    const pagesAfterPop = context.pages().length;

    // The same pop, reached without touching window.open at all.
    await trustedClick(page, '#popdispatch');
    await page.waitForTimeout(700);
    const pagesAfterDispatch = context.pages().length;

    await trustedClick(page, '#popform');
    await page.waitForTimeout(700);
    const pagesAfterForm = context.pages().length;

    // Now the legitimate case: a real click on a real link, opened by script.
    await trustedClick(page, '#reallink');
    await page.waitForTimeout(1200);
    const pagesAfterLink = context.pages().length;
    probes.linkResult = await page.evaluate(() => window.__linkResult);

    return {
      probes, errors, adRequestsOnPage,
      pagesBefore, pagesAfterPop, pagesAfterDispatch, pagesAfterForm, pagesAfterLink,
    };
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

console.log(`extension: ${EXTENSION}\n`);

try {
  hits.length = 0;
  const off = await run({ withExtension: false });

  hits.length = 0;
  const on = await run({ withExtension: true });

  const rows = [
    ['blocks the third-party ad requests', on.adRequestsOnPage === 0,
      `off: ${off.adRequestsOnPage} request(s) on the page, on: ${on.adRequestsOnPage}`],
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
    ['every patched builtin reports [native code] (D10)', on.probes.tampered.length === 0,
      on.probes.tampered.length
        ? `visible: ${on.probes.tampered.join(', ')}`
        : `all ${on.probes.suspectCount} clean, window.open still named "${on.probes.openName}"`],
    ['cross-site pop returns a decoy, not null (D9)', on.probes.popNotNull === true && on.probes.popClosedFalse === true,
      `notNull=${on.probes.popNotNull} closed=${on.probes.popClosedFalse}`],
    ['no extension URL or marker in the DOM (D12)', on.probes.domFootprint === false,
      `footprint = ${on.probes.domFootprint}`],
    ['no globals on window (D12)', on.probes.globalFootprint.length === 0,
      on.probes.globalFootprint.join(', ') || 'clean'],
    ['no uncaught page errors', on.errors.length === 0, on.errors.join(' | ') || 'none'],

    ['click-triggered pop opens no tab', on.pagesAfterPop === on.pagesBefore,
      `off: ${off.pagesAfterPop - off.pagesBefore} tab(s), on: ${on.pagesAfterPop - on.pagesBefore}`],
    ['click-triggered pop still returns an object, not null (D9)',
      on.probes.popFromClickResult === 'object', `returned ${on.probes.popFromClickResult}`],
    ['synthesized anchor click opens no tab', on.pagesAfterDispatch === on.pagesAfterPop,
      `off: ${off.pagesAfterDispatch - off.pagesAfterPop} tab(s), on: ${on.pagesAfterDispatch - on.pagesAfterPop}`],
    ['form target=_blank submit opens no tab', on.pagesAfterForm === on.pagesAfterDispatch,
      `off: ${off.pagesAfterForm - off.pagesAfterDispatch} tab(s), on: ${on.pagesAfterForm - on.pagesAfterDispatch}`],
    ['a real link click still opens its tab', on.pagesAfterLink > on.pagesAfterForm,
      `on: ${on.pagesAfterLink - on.pagesAfterForm} tab | control: ${off.pagesAfterLink - off.pagesAfterForm} tab`],
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
