# Umbra

An ad blocker for Chrome and Firefox that does not announce itself to the page.

Blocking ads is the easy half. The hard half is that ad-funded sites increasingly
*check* whether you are blocking — with bait elements, probe requests, missing
globals, `window.open` return values and patched-builtin detection — and gate
their content on the answer. Umbra is built around not failing those checks.

**[docs/DESIGN.md](docs/DESIGN.md)** is the real document: how ad blockers work,
a taxonomy of twelve detection techniques (D1–D12) with the countermeasure for
each, and the architecture that follows from them.

---

## What it does

| Layer | Mechanism |
|---|---|
| Network | `declarativeNetRequest` on Chrome, blocking `webRequest` on Firefox, from one shared rule IR |
| Cosmetic | user-origin stylesheets (invisible to CSSOM enumeration, and they outrank the page's `!important`) |
| Procedural | `:has-text()`, `:matches-css()`, `:upward()`, `:remove()`, evaluated on a debounced observer |
| Scriptlets | uBO-compatible patches injected into the page's MAIN world at `document_start` |
| Surrogates | neutered stubs served in place of ad scripts, so probes succeed instead of failing |
| Pop-unders | decoy `Window` objects, cross-site `window.open` defusal, and a browser-level new-tab guard |

Site packs ship for **kayoanime.com** and the **aniwave.\*** family, which are
the two sites this was built for. Both rotate domains and run detectors; the
packs are plain filter-list text, so keeping them current is an edit, not a
rebuild.

## Build

```bash
npm install
npm run build                 # both targets into dist/
npm run build:chrome          # or one at a time
npm run build:firefox
npm run package               # dist/umbra-chrome.zip, dist/umbra-firefox.xpi
npm test
```

The build reports every rule it could not express in `declarativeNetRequest`.
Those rules still work on Firefox, which runs the real matcher — the report
exists so the gap is visible rather than silent.

## Install

**Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
select `dist/chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*
→ select `dist/firefox/manifest.json`. For a permanent install the `.xpi` needs
signing through [addons.mozilla.org](https://addons.mozilla.org/developers/).

## Verifying the stealth claims

Paste [`tools/self-test.js`](tools/self-test.js) into the DevTools console on any
page. It runs the same probes an anti-adblock script would and prints a table:

```
D1   bait element still has geometry          PASS   offsetHeight=250 display=block
D2   ad script fetch resolves                 PASS   resolved (type=opaque)
D3   window.adsbygoogle exists and is loaded  PASS   loaded=true
D8   no blocker rules in document.styleSheets PASS   4 sheet(s), none ours
D9   window.open returns a usable object      PASS   closed=false
D10  patched builtins report [native code]    PASS   all six clean
D12  no extension URL or marker in the DOM    PASS   clean
```

The bar is that the output is **identical** with Umbra enabled and disabled.
That is the entire claim — anything else means the page can tell.

## Writing filters

Standard Adblock Plus / uBlock Origin syntax, in `assets/filters/` or in the
*Custom filters* box in Settings:

```
||ads.example.com^$script,third-party        block
@@||example.com/needed.js$script             allow
||probe.example.com/ads.js$redirect=noopjs   serve a stub instead of failing
example.com##.ad-slot                        hide
example.com#@#.adsbox                        never hide (bait protection)
example.com##.card:has-text(/Sponsored/)     procedural hide
example.com##+js(no-window-open-if, _blank)  scriptlet
@@||example.com^$generichide                 no generic hiding on this site
```

Three habits matter more than the rest, and the test suite enforces them:

1. **Redirect, do not block, anything a detector probes.** A failed load is the
   loudest signal there is.
2. **Never hide a bait selector.** `.adsbox`, `#AdContainer` and friends are
   meant to stay visible and empty; hiding them *is* the detection.
3. **Do not use `:remove()` on a site that watches its own DOM.** Hide instead.

## Not in scope

No paywall or login bypass, no DRM circumvention, no fabricated ad engagement.
Umbra drops requests and hides elements; it never forges an impression or a
click. "Undetectable" means undetectable *by the web page* — the extension is
ordinary, inspectable, and visible to the browser and to you.

## Limitations

Stated in full in [§8 of the design doc](docs/DESIGN.md#8-known-limits-stated-plainly);
the short version:

- Chrome MV3 is strictly weaker than Firefox — some filters compile away, and a
  packed Chrome build cannot attribute network blocks to a tab, so its badge
  counts cosmetic hides only.
- `getComputedStyle` sees hidden elements whatever we do, which is why the
  do-not-hide list is manual and per-site.
- Timing oracles are not closed. No blocker closes them.
- First-party ads served from the site's own path space cannot be handled at the
  network layer without breaking the site.
