// Umbra self-test.
//
// Paste this into the DevTools console on any page to run the same probes an
// anti-adblock script would. Every row should read PASS with Umbra installed
// *and* with it disabled -- that is the point: the page should not be able to
// tell the difference.
//
// Row ids match the detection taxonomy in docs/DESIGN.md.

(async () => {
  const results = [];
  const record = (id, name, pass, detail) => results.push({ id, check: name, verdict: pass ? 'PASS' : 'FAIL', detail });

  // D1 - bait element geometry ------------------------------------------------
  {
    const bait = document.createElement('div');
    bait.className = 'ad banner adsbox pub_300x250 ad-placement';
    bait.id = 'AdContainer';
    bait.style.cssText = 'position:absolute;left:-9999px;width:300px;height:250px';
    document.body.appendChild(bait);
    await new Promise((r) => setTimeout(r, 350));
    const style = getComputedStyle(bait);
    const visible = bait.offsetHeight > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    record('D1', 'bait element still has geometry', visible,
      `offsetHeight=${bait.offsetHeight} display=${style.display}`);
    bait.remove();
  }

  // D2 - network probe --------------------------------------------------------
  {
    let ok = false;
    let detail = '';
    try {
      const response = await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        { mode: 'no-cors', cache: 'no-store' });
      ok = true;
      detail = `resolved (type=${response.type})`;
    } catch (err) { detail = `rejected: ${err.message}`; }
    record('D2', 'ad script fetch resolves', ok, detail);
  }

  // D2b - script tag onerror --------------------------------------------------
  {
    const outcome = await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
      s.onload = () => resolve('load');
      s.onerror = () => resolve('error');
      setTimeout(() => resolve('timeout'), 4000);
      document.head.appendChild(s);
    });
    record('D2', 'ad script tag fires onload, not onerror', outcome === 'load', outcome);
  }

  // D3 - expected globals -----------------------------------------------------
  {
    const hasQueue = typeof window.adsbygoogle !== 'undefined';
    const loaded = hasQueue && window.adsbygoogle.loaded === true;
    record('D3', 'window.adsbygoogle exists and is loaded', hasQueue && loaded,
      `adsbygoogle=${typeof window.adsbygoogle} loaded=${hasQueue ? window.adsbygoogle.loaded : 'n/a'}`);
  }

  // D8 - CSSOM enumeration ----------------------------------------------------
  {
    let found = null;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }   // cross-origin sheet
      for (const rule of rules) {
        if (rule.style && rule.style.display === 'none' &&
            /\bad|banner|sponsor/i.test(rule.selectorText ?? '')) {
          found = rule.selectorText.slice(0, 60);
          break;
        }
      }
      if (found) break;
    }
    record('D8', 'no blocker rules visible in document.styleSheets', found === null,
      found ? `found: ${found}` : `${document.styleSheets.length} sheet(s), none ours`);
  }

  // D9 - window.open return value ---------------------------------------------
  {
    let win = null;
    try { win = window.open('https://example.invalid/probe', '_blank'); } catch { /* blocked */ }
    const truthy = Boolean(win) && win.closed === false;
    record('D9', 'window.open returns a usable object', truthy,
      win === null ? 'returned null (looks like a pop blocker)' : `closed=${win && win.closed}`);
    try { if (win && typeof win.close === 'function') win.close(); } catch { /* decoy */ }
  }

  // D10 - native function tamper check ----------------------------------------
  {
    const suspects = [
      ['window.open', window.open],
      ['fetch', window.fetch],
      ['setTimeout', window.setTimeout],
      ['EventTarget.addEventListener', EventTarget.prototype.addEventListener],
      ['EventTarget.dispatchEvent', EventTarget.prototype.dispatchEvent],
      ['JSON.parse', JSON.parse],
      ['HTMLElement.click', HTMLElement.prototype.click],
      ['HTMLFormElement.submit', HTMLFormElement.prototype.submit],
    ];
    const patched = suspects.filter(([, fn]) => {
      try { return !/\[native code\]/.test(Function.prototype.toString.call(fn)); }
      catch { return true; }
    });
    record('D10', 'patched builtins still report [native code]', patched.length === 0,
      patched.length ? `visible: ${patched.map(([n]) => n).join(', ')}` : `all ${suspects.length} clean`);
  }

  // D7/D12 - extension footprint in the DOM -----------------------------------
  {
    const html = document.documentElement.outerHTML;
    const extensionUrl = /(chrome|moz)-extension:\/\//.test(html);
    const marker = /umbra/i.test(html);
    record('D12', 'no extension URL or marker in the DOM', !extensionUrl && !marker,
      extensionUrl ? 'extension:// URL present' : marker ? 'marker string present' : 'clean');
  }

  // D12b - global namespace ----------------------------------------------------
  {
    const leaked = Object.getOwnPropertyNames(window).filter((k) => /umbra|adblock(er)?_|ublock/i.test(k));
    record('D12', 'no blocker globals on window', leaked.length === 0,
      leaked.length ? leaked.join(', ') : 'clean');
  }

  console.table(results);
  const failed = results.filter((r) => r.verdict === 'FAIL');
  console.log(failed.length === 0
    ? '%cAll checks passed - the page cannot tell.'
    : `%c${failed.length} check(s) failed - the page can tell.`,
    `color:${failed.length === 0 ? '#2f7d5d' : '#b3261e'};font-weight:600`);
  return results;
})();
