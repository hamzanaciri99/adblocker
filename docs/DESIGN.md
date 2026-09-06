# Umbra — a stealth ad blocker for Chrome and Firefox

**Status:** design / implementation plan
**Targets:** Chromium 120+ (MV3), Firefox 121+ (MV3 with blocking `webRequest`)
**Primary goal:** block ads and pop-unders everywhere, while being *invisible to
the page*, with hardened site packs for `kayoanime.com` and the `aniwave.*`
family.

---

## 0. Scope and non-goals

**In scope**

- Network-level blocking of ad, tracker and pop-under requests.
- Cosmetic filtering (hiding leftover ad containers) without leaving a readable
  trace in the page.
- Surgical JavaScript patching (scriptlets) to defuse pop-unders, redirect
  scripts and adblock detectors.
- Resource *substitution* (surrogates) so that scripts a page depends on appear
  to load successfully.
- Anti-detection: the page should not be able to conclude that a blocker is
  installed by any of the standard probes catalogued in §2.

**Out of scope** (deliberately)

- Paywall or login bypass, DRM circumvention, or anything that fabricates
  entitlement to content.
- Click-fraud, impression-fraud, or generating fake ad traffic. We *drop*
  requests; we never forge engagement.
- Hiding from the browser, from the user, or from extension review. Umbra is a
  normal, inspectable extension. "Undetectable" here means *undetectable by the
  web page*, which is exactly the threat model uBlock Origin, AdGuard and
  Brave's shields already operate under.

One honest note about the two named sites: they are ad-funded video/download
portals whose ad stack is dominated by pop-under networks and malvertising
redirects. Blocking that is user-protective. It also means the sites actively
fight back, which is why they need dedicated packs (§5) rather than generic
lists alone.

---

## 1. How ad blockers actually work

A modern blocker is not one mechanism. It is four cooperating layers, each of
which catches what the others cannot.

```
                 ┌─────────────────────────────────────────┐
   request  ───▶ │ 1. NETWORK FILTER   block / redirect     │ ──▶ net stack
                 └─────────────────────────────────────────┘
                 ┌─────────────────────────────────────────┐
   document ───▶ │ 2. SCRIPTLETS (MAIN world, doc_start)   │
                 │ 3. COSMETIC FILTER (user-origin CSS)    │
                 └─────────────────────────────────────────┘
                 ┌─────────────────────────────────────────┐
   blocked  ───▶ │ 4. SURROGATE  serve a neutered stub     │
                 └─────────────────────────────────────────┘
```

### 1.1 Layer 1 — network filtering

The blocker inspects every outgoing subresource request and decides
`allow | block | redirect`. Decisions come from *filter lists* — millions of
rules in the Adblock Plus syntax that uBlock Origin extended.

A rule looks like this:

```
||doubleclick.net^$third-party            ! block any subrequest to the domain
||example.com/ads/*$script,domain=foo.com ! only scripts, only on foo.com
@@||example.com/safe.js$script            ! exception ("allowlist") rule
/banner\d+\.png/$image                    ! regex form
||tracker.com^$redirect=noopjs            ! serve a stub instead of blocking
||site.com^$removeparam=utm_source        ! strip a query parameter
||site.com^$csp=script-src 'self'         ! inject a CSP header
```

Anatomy:

| Part | Meaning |
|---|---|
| `\|\|domain^` | anchor to a domain boundary (matches subdomains, not `notdomain.com`) |
| `^` | separator char (`/ ? & : =` or end-of-URL) |
| `*` | wildcard |
| `$type` | resource type: `script image stylesheet xhr subdocument media font ping websocket other` |
| `$third-party` | request origin differs from document origin |
| `$domain=a.com\|~b.com` | scope by document domain |
| `@@` | exception; unblocks a matching request |
| `$important` | outranks exceptions |

**Why matching is fast.** Naively testing a URL against 300k patterns is
hopeless. Every real engine uses the same trick: **token bucketing**. At compile
time each pattern is reduced to its most selective alphanumeric token (e.g.
`||ads.doubleclick.net^` → `doubleclick`). Patterns are stored in a hash map
keyed by token. At match time the URL is tokenized and only the buckets for
those tokens are tested — typically 2–10 candidate rules instead of 300k. uBO
adds a bit-packed trie plus a Bloom-filter prefilter on top; for our rule
volume, token bucketing plus a small `Set` prefilter is plenty.

**Where the browser lets you do this** — this is the single biggest
cross-browser fork, covered in §3.

### 1.2 Layer 2 — cosmetic filtering

Network blocking leaves holes: a `<div class="ad-slot">` that is now empty but
still occupies 300px. Cosmetic rules hide those.

```
example.com##.ad-container          ! hide, only on example.com
##.sponsored-post                    ! generic: hide everywhere
example.com#@#.ad-container          ! cosmetic exception
##.card:has-text(/Sponsored/)        ! procedural: needs JS, not plain CSS
##div:has(> a[href*="/aff/"])        ! native :has(), CSS-only in modern browsers
##.wrap:upward(2)                    ! procedural: hide the 2nd ancestor
##.banner:remove()                   ! procedural: delete the node entirely
```

Two families:

- **Declarative** rules are concatenated into one big stylesheet
  (`.a,.b,.c{display:none!important}`) and injected once. Cost is ~zero.
- **Procedural** rules cannot be expressed in CSS. They run in JS, re-evaluated
  on a debounced `MutationObserver`, and are the expensive ones — keep them
  scarce and always scoped to a domain.

Two ways to inject, and the choice matters enormously for detectability:

| Method | Visible in `document.styleSheets`? | Visible to `getComputedStyle`? |
|---|---|---|
| `<style>` element in the DOM | **yes** | yes |
| `insertCSS({origin:'AUTHOR'})` | **yes** | yes |
| `insertCSS({origin:'USER'})` | **no** | yes |

User-origin injection is invisible to CSSOM enumeration — the page cannot walk
`document.styleSheets` and find our rules. It does *not* hide the *effect*:
`getComputedStyle(el).display` still reports `none`. That distinction drives the
bait-element policy in §2.

### 1.3 Layer 3 — scriptlets

Some behaviour lives entirely inside first-party JavaScript that we cannot
block without breaking the site: a pop-under handler attached to `document`, a
timer that rewrites `location`, an anti-adblock routine. The answer is a small
library of parameterised patches injected into the page's **main world** at
`document_start`, before any page script runs.

The canonical set (names follow uBO so filter lists port cleanly):

| Scriptlet | What it does |
|---|---|
| `set-constant(prop, value)` | defines `prop` as a non-writable constant (`true`, `noopFunc`, `1`…) |
| `abort-on-property-read(prop)` | throws a caught reference error when the page reads `prop` — kills a detector without killing the page |
| `abort-on-property-write(prop)` | same, on assignment |
| `abort-current-script(prop, needle)` | aborts only the inline script that touches `prop` and contains `needle` |
| `no-window-open-if(pattern)` | neutralises `window.open` for matching URLs |
| `prevent-setTimeout(needle, delay)` | drops timers whose callback source matches |
| `prevent-addEventListener(type, needle)` | drops listener registrations |
| `json-prune(paths)` | strips keys from `JSON.parse` results (ad payloads in API responses) |
| `no-fetch-if(pattern)` | makes matching `fetch()` calls resolve with an empty-but-valid response |
| `no-xhr-if(pattern)` | same for `XMLHttpRequest` |
| `set-cookie(name, value)` | pre-sets a cookie the site uses as an "already shown" flag |
| `remove-attr` / `remove-class` | strips attributes the page uses to gate playback |
| `nano-setInterval-booster` | rewrites timer delays (countdown gates) |

Injection timing is the hard part. The scriptlet must execute **before the first
page script**, in the page's own realm. §3.3 covers how each browser gets there.

### 1.4 Layer 4 — surrogates (redirect resources)

This is the layer that separates a *stealthy* blocker from an obvious one.

If we hard-block `pagead2.googlesyndication.com/pagead/js/adsbygoogle.js`, the
page sees:

```js
s.onerror = () => detected();   // fires
window.adsbygoogle === undefined // true
```

Both are trivially observable. Instead we **redirect** the request to a bundled
resource that is a *behavioural stub* — same API surface, no ads:

```js
// surrogates/googlesyndication_adsbygoogle.js
(() => {
  const g = window;
  g.adsbygoogle = g.adsbygoogle || [];
  g.adsbygoogle.loaded = true;
  g.adsbygoogle.push = function () { return 1; };
  g.google_ad_status = 1;          // what "is my ad showing?" checks read
})();
```

Now `onload` fires, the global exists, the status flag is what a served ad would
have set, and there is no error event anywhere. The page's detector finds
nothing. Surrogates exist for the handful of scripts that are actually
load-bearing: Google's ad tags, GPT, Adsterra/PropellerAds/HilltopAds pop
loaders, `fuckadblock.js`, `prebid.js`, generic no-op JS/image/frame.

The declarative form is `$redirect=<resource>`; the file ships as a
web-accessible resource.

---

## 2. Anti-adblock: how pages detect you, and how we stay invisible

This is the core of the request, so it gets its own taxonomy. Each detection
technique is paired with the countermeasure Umbra implements.

### D1 — Bait / honeypot elements

```html
<div class="ad banner adsbox pub_300x250" id="AdContainer"
     style="height:1px"></div>
<script>
  setTimeout(() => {
    const b = document.querySelector('.adsbox');
    if (!b || b.offsetHeight === 0 ||
        getComputedStyle(b).display === 'none') detected();
  }, 200);
</script>
```

The bait is a decoy that no ad ever fills. Generic filter lists hide anything
matching `.ad`, `.banner`, `.adsbox` — so a naive blocker hides the bait and
convicts itself.

**Countermeasure — precision over breadth.**
1. Generic cosmetic rules are **off by default on sites with a site pack**;
   packs use specific selectors that match only real ad containers.
2. Known bait selectors go on an explicit **do-not-hide list** shipped with each
   pack. The bait renders, keeps a non-zero `offsetHeight`, and reports
   `display:block`. It is empty, but it was always going to be empty.
3. Because `getComputedStyle` sees through user-origin CSS, "hide it quietly" is
   not an option here. The only winning move is not to hide it.

### D2 — Network probes

```js
fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
      {mode:'no-cors'}).then(() => ok()).catch(() => detected());
```
or an `<img>`/`<script>` to a known ad URL with an `onerror` handler.

A blocked request in Chrome fails as `net::ERR_BLOCKED_BY_CLIENT`; a `fetch`
rejects; `onerror` fires. All observable.

**Countermeasure — never hard-block a probe target.** Every URL that appears in
a known detector is served by a surrogate (`$redirect`) instead of blocked, so
the request completes with HTTP 200 and a valid body. For probe URLs with no
useful stub, `no-fetch-if` / `no-xhr-if` resolve them with a synthetic
`Response` (status 200, empty body, correct `type`) so the promise fulfils.

### D3 — Global-variable presence checks

```js
if (typeof window.adsbygoogle === 'undefined' ||
    window.google_ad_status !== 1 ||
    typeof Adcash === 'undefined') detected();
```

**Countermeasure —** surrogates define the globals (D2), and `set-constant`
covers the rest for scripts we block outright. The pack for a site lists exactly
which globals its detector reads.

### D4 — Dedicated detector libraries

`FuckAdBlock` / `BlockAdBlock` / `AaDetector` and friends expose an object with
`.on('detected', …)`. aniwave uses one named `AaDetector`.

**Countermeasure —** `abort-on-property-read(AaDetector)` makes the *reference*
throw inside the detector's own script only; the surrounding page continues
because the throw is caught by the script boundary. Where the site's own code
would break, we instead `set-constant` the object to a no-op shape whose
`.check()` reports "no blocker".

### D5 — Mutation surveillance

The page keeps a `MutationObserver` on its ad containers, or traps
`Element.prototype.remove` / `Node.prototype.removeChild`, and reports any node
that disappears.

**Countermeasure — never remove nodes on a defended site.** Umbra's default
cosmetic action is *hide via user-origin CSS*, not `:remove()`. The `:remove()`
operator stays available for filter authors but the site packs for kayoanime and
aniwave do not use it. Node removal is reserved for elements the page never
looks at again (pop-under bootstrap iframes appended to `<body>`).

### D6 — CSP violation reporting

If a resource is blocked by a *Content-Security-Policy* the page installed, the
page receives a `securitypolicyviolation` event. Some sites deliberately install
a permissive-looking CSP so that extension-side blocking shows up as a
violation.

**Countermeasure —** prefer `redirect` over `block` on defended origins
(redirect targets are same-scheme extension resources, which do not raise
violations), and never use `$csp=` injection on a site whose pack is active.

### D7 — Extension fingerprinting via web-accessible resources

```js
fetch('chrome-extension://<known-id>/web_accessible_resources/noop.js')
  .then(() => busted());
```
Every published blocker has a stable extension ID, so a site can enumerate a
list of them.

**Countermeasures**
1. Do not ship a `key` in the manifest → no stable ID across installs.
2. Chrome MV3: `"use_dynamic_url": true` on every entry in
   `web_accessible_resources`. Chrome then serves them under a UUID that
   **rotates each session**, so an enumeration attempt cannot even guess the
   path. Firefox already assigns a random per-install UUID.
3. Narrow `matches` on each WAR entry so only the origins that actually need a
   surrogate can reference it.
4. Surrogates are fetched by the *network layer's redirect*, not by page script,
   so nothing in the DOM ever contains an extension URL.

### D8 — CSSOM enumeration

```js
[...document.styleSheets].some(s => {
  try { return [...s.cssRules].some(r => /display:\s*none/.test(r.cssText)
        && /\.ad/.test(r.selectorText)); } catch { return false; }
});
```

**Countermeasure —** user-origin injection (`insertCSS({origin:'USER'})` on
Chrome, `insertCSS({cssOrigin:'user'})` on Firefox). User-origin sheets are not
enumerable from `document.styleSheets` at all. We never append a `<style>` node.

### D9 — Pop-under return-value checks

```js
const w = window.open(url, '_blank');
if (!w || w.closed) detected();     // classic pop blocker tell
```

Chrome's own pop-up blocker returns `null`, so returning `null` looks like a
*browser* block rather than an extension — but many sites treat both as
"blocker present" and gate playback on it.

**Countermeasure —** `no-window-open-if` returns a **decoy window object**: a
plain object exposing `closed:false`, `focus/blur/close/postMessage` no-ops, a
`document` stub with `write/open/close`, and a `location` object whose `href`
setter is ignored. The site's check passes, and nothing opens.

### D10 — Native-function tamper detection

```js
if (!/\[native code\]/.test(Function.prototype.toString.call(window.open)))
  detected();
```
Any patched builtin is detectable by its source text, its `name`, its `length`,
or by `Object.getOwnPropertyDescriptor` shape.

**Countermeasure — every patch is applied through a hardened `proxyNative()`
helper** which:
- wraps the original in a `Proxy` so `apply`/`construct` still dispatch natively;
- installs a `Function.prototype.toString` trap (patched once, itself proxied)
  that returns the *original* source text for every function we replaced;
- copies `name`, `length` and the exact property descriptor
  (`writable/enumerable/configurable`) of the slot being replaced;
- keeps the prototype chain and `Symbol.toStringTag` untouched.

This is the difference between "the site can tell in one line" and "the site
needs a timing oracle".

### D11 — Timing oracles

Sub-millisecond differences (a `fetch` that resolves suspiciously fast, a
scriptlet that costs 3ms at `document_start`) are theoretically detectable.

**Countermeasure —** partial, and we say so honestly. Synthetic `fetch`
responses resolve on a microtask plus a small jitter rather than instantly.
Beyond that, timing is the one channel we do not claim to close; no shipping
blocker does.

### D12 — Behavioural fingerprints of the extension itself

Custom DOM attributes, marker classes, an injected `<div id="umbra-root">`, a
`data-*` flag on `<html>`, or a distinctive `MutationObserver` cadence all
identify the blocker.

**Countermeasures —** zero DOM footprint on the page: no injected elements, no
attributes, no classes, no globals. The one exception is the in-page block
counter overlay, which is (a) off by default and (b) rendered in a **closed
shadow root** attached to a node outside `<body>` when enabled. Scriptlet
`<script>` nodes are removed synchronously in the same tick they execute, before
any observer callback can fire.

### Detection-vs-countermeasure summary

| # | Detection | Countermeasure | Layer |
|---|---|---|---|
| D1 | bait element geometry | do-not-hide list; precise selectors | cosmetic |
| D2 | network probe / `onerror` | surrogate redirect; synthetic fetch | network |
| D3 | missing globals | surrogate defines them; `set-constant` | scriptlet |
| D4 | detector library | `abort-on-property-read`; no-op shape | scriptlet |
| D5 | mutation surveillance | hide, never remove | cosmetic |
| D6 | CSP violation events | redirect not block; no `$csp` | network |
| D7 | extension-URL probing | dynamic WAR URLs; no fixed ID | manifest |
| D8 | CSSOM enumeration | user-origin stylesheets | cosmetic |
| D9 | `window.open` returns null | decoy window object | scriptlet |
| D10 | `[native code]` check | `proxyNative()` toString spoof | scriptlet |
| D11 | timing oracles | jittered synthetic responses (partial) | scriptlet |
| D12 | DOM footprint | no injected nodes; closed shadow root | all |

---

## 3. Cross-browser strategy

Chrome and Firefox disagree about the most important API in the project, so the
engine is written once and adapted twice.

### 3.1 Network layer

| | Chrome (MV3) | Firefox (MV3) |
|---|---|---|
| Blocking API | `declarativeNetRequest` only | `webRequest` **with** `blocking`, plus DNR |
| Decision point | browser, from precompiled rules | our JS, per request |
| Regex | limited count, RE2 subset | full JS regex |
| Redirect to extension resource | yes (`redirect.extensionPath`) | yes |
| Dynamic per-tab logic | limited (session rules) | unlimited |

Firefox kept blocking `webRequest`, which is why uBlock Origin remains fully
featured there. We exploit that: **Firefox runs the real matching engine**;
**Chrome gets a compiled approximation**.

```
   filter lists (text)
          │
          ▼
   ┌──────────────┐        ┌────────────────────────────┐
   │  parser      │───────▶│ IR: NetworkRule[] Cosmetic[]│
   └──────────────┘        └────────────────────────────┘
                                │                  │
                build time      │                  │  runtime
                                ▼                  ▼
                   ┌────────────────────┐   ┌──────────────────┐
                   │ DNR compiler       │   │ TokenMatcher     │
                   │ → rules/*.json     │   │ (Firefox wR)     │
                   └────────────────────┘   └──────────────────┘
```

The IR is shared, so a rule authored once behaves the same on both — the
compiler simply reports (and logs at build time) any rule it cannot express in
DNR, which then only takes effect on Firefox.

**Chrome DNR budget** (verify against the live docs in CI; these are the values
we compile against):

| Limit | Value |
|---|---|
| static rulesets declared | 100 |
| static rulesets enabled at once | 50 |
| guaranteed static rules | 30,000 |
| dynamic + session rules | 30,000 |
| regex rules | 1,000 |

The build asserts each generated ruleset stays under budget and fails loudly
otherwise. Rulesets are split by purpose (`core`, `popups`, `trackers`,
`site-kayoanime`, `site-aniwave`) so a site pack can be toggled independently
via `updateEnabledRulesets`.

**DNR priority scheme** — DNR resolves conflicts by numeric priority, so we
encode the ABP precedence ladder explicitly:

| Priority | Meaning |
|---|---|
| 1 | generic block |
| 10 | domain-scoped block |
| 20 | `$redirect` (surrogate) — must beat plain block |
| 30 | exception (`@@`) → `allow` |
| 40 | `$important` block |
| 50 | `allowAllRequests` for user-disabled sites |

### 3.2 Cosmetic layer

Identical on both, modulo the API name:

```js
// adapter
export const insertUserCSS = (tabId, css, frameIds) =>
  IS_FIREFOX
    ? browser.tabs.insertCSS(tabId, { code: css, cssOrigin: 'user', allFrames: true })
    : chrome.scripting.insertCSS({ target: { tabId, frameIds }, css, origin: 'USER' });
```

### 3.3 Scriptlet injection into the MAIN world

Three routes, tried in order:

1. **Declarative MAIN-world content script** — `world: "MAIN"` at
   `run_at: "document_start"`. Supported by Chrome 111+ and by recent Firefox.
   Preferred: it runs before *everything*, with no timing gap.
2. **`chrome.scripting.registerContentScripts({world:'MAIN'})`** — same effect,
   registered dynamically so scriptlets are chosen per-site at runtime rather
   than baked into the manifest.
3. **Firefox X-ray escape hatch** (fallback for older Gecko) — from an isolated
   content script at `document_start`:
   ```js
   const s = document.createElement('script');
   s.textContent = payload;
   (document.head || document.documentElement).appendChild(s);
   s.remove();                  // same tick; nothing observes it
   ```
   plus `window.wrappedJSObject` / `exportFunction` where a live reference into
   the page realm is needed.

The adapter picks a route at startup by feature-detecting
`chrome.scripting.ExecutionWorld?.MAIN`, and the site-pack loader is agnostic.

### 3.4 One codebase, two manifests

`manifest.base.json` holds everything shared; `build.mjs` merges a per-browser
patch:

- **Chrome**: `background.service_worker`, `declarative_net_request.rule_resources`,
  `web_accessible_resources[].use_dynamic_url = true`, `minimum_chrome_version`.
- **Firefox**: `background.scripts` (event page — service workers are still the
  rough edge on Gecko), `permissions += ["webRequest","webRequestBlocking"]`,
  `browser_specific_settings.gecko.id` + `strict_min_version`.

---

## 4. Repository architecture

```
adblocker/
├── docs/DESIGN.md                 ← this document
├── build.mjs                      ← esbuild + manifest merge + DNR compile
├── manifest.base.json
├── manifest.chrome.json           ← patch
├── manifest.firefox.json          ← patch
├── assets/filters/                ← shipped filter lists (text, ABP syntax)
│   ├── core.txt                   ·  general ad/tracker rules
│   ├── popups.txt                 ·  pop-under networks
│   └── sites/{kayoanime,aniwave}.txt
├── src/
│   ├── core/
│   │   ├── parser.js              ·  ABP text  → IR
│   │   ├── ir.js                  ·  rule shapes, option flags
│   │   ├── tokenizer.js           ·  URL + pattern tokenization
│   │   ├── matcher.js             ·  token-bucketed runtime matcher
│   │   ├── dnr-compiler.js        ·  IR → declarativeNetRequest JSON
│   │   └── cosmetic.js            ·  cosmetic rule selection per hostname
│   ├── background/
│   │   ├── index.js               ·  entry, message router
│   │   ├── net-firefox.js         ·  webRequest.onBeforeRequest handler
│   │   ├── net-chrome.js          ·  ruleset toggling, session rules
│   │   ├── injector.js            ·  chooses scriptlets + CSS per navigation
│   │   ├── state.js               ·  per-site enable/disable, counters
│   │   └── surrogates.js          ·  name → resource path map
│   ├── content/
│   │   ├── boot.js                ·  isolated world; asks bg what to run
│   │   ├── procedural.js          ·  :has-text/:matches-css/:upward/:remove
│   │   └── popguard.js            ·  DOM-level pop-under interception
│   ├── inject/                    ← MAIN world, no extension APIs
│   │   ├── runtime.js             ·  proxyNative(), toString registry
│   │   └── scriptlets/*.js        ·  one file per scriptlet
│   ├── surrogates/*.js            ← web-accessible stubs
│   ├── ui/{popup,options}/        ← per-site toggle, log, list management
│   └── shared/browser.js          ← the adapter (IS_FIREFOX, insertUserCSS, …)
└── test/                          ← node:test unit tests for parser/matcher/compiler
```

**Data flow for one navigation**

1. `webNavigation.onBeforeNavigate` → background computes the hostname's
   *cosmetic bundle* (declarative selectors + procedural rules) and *scriptlet
   list* from the site packs, caching by hostname.
2. Background registers the MAIN-world scriptlet bundle for that tab/frame
   (route 1/2 from §3.3) **before** the document loads.
3. Background injects the declarative CSS as user-origin.
4. `boot.js` (isolated world) receives only the procedural rules and starts a
   debounced `MutationObserver`.
5. Network requests are matched by DNR (Chrome) or `matcher.js` (Firefox).
6. Blocked-count telemetry stays local; nothing leaves the browser.

---

## 5. Site packs

A *pack* is a declarative bundle:

```js
{
  match:      ['kayoanime.com'],
  network:    'assets/filters/sites/kayoanime.txt',
  cosmetic:   ['.ads-wrap', '#below-post-ad'],
  neverHide:  ['.adsbox', '#AdContainer'],     // D1 bait protection
  scriptlets: [['no-window-open-if', ''], ['set-constant','ad_blocker','false']],
  genericCosmetic: false,                      // packs opt out of broad rules
  surrogates: { 'adsbygoogle.js': 'googlesyndication_adsbygoogle.js' }
}
```

### 5.1 aniwave (`aniwave.to` / `.at` / `.li` / `.se` and successors)

Known behaviour, from the uAssets issue history:

- Pop-unders on every player interaction (play/pause/seek), routed through
  `window.open` with `_blank`, layered over third-party player hosts
  (Filemoon, mp4upload, vidplay).
- A first-party detector object named **`AaDetector`**.
- A `__pf` cookie used as an "interstitial already shown" flag.
- Banner injection into `.adx` containers.
- Third-party beacons to `bidgear.com`, `amung.us`, `googletagmanager.com`.

Pack contents:

```
! network
||bidgear.com^$important
||whos.amung.us^
||*.rocks^$third-party,domain=aniwave.*        ! rotating pop domains
||googletagmanager.com/gtag/js$redirect=noopjs ! stub, do not hard-block (D2)

! cosmetic — specific, no :remove() (D5)
aniwave.*##.adx
aniwave.*##.player-ads

! scriptlets
aniwave.*##+js(no-window-open-if, _blank)      ! decoy window, not null (D9)
aniwave.*##+js(set-cookie, __pf, 1)            ! pre-satisfy the gate
aniwave.*##+js(abort-on-property-read, AaDetector)
aniwave.*##+js(prevent-addEventListener, click, open)
```

Plus `popguard.js` for the player iframes: intercept the `click` →
`window.open` chain in the *capture* phase, and neutralise
`<a target=_blank>` bootstrap anchors appended to `<body>` by the pop SDK.
Because the domain rotates, the pack matches `aniwave.*` and the pop-network
rules live in `popups.txt` keyed by SDK signature rather than by hostname.

### 5.2 kayoanime

A Blogger-hosted download portal. Its monetisation is Google AdSense plus
link-shortener interstitials in front of the actual Drive links.

Pack contents:

```
! network — surrogate, never block (AdSense is the detector's probe target)
||pagead2.googlesyndication.com/pagead/js/adsbygoogle.js$redirect=googlesyndication_adsbygoogle
||googleads.g.doubleclick.net^$third-party
||*.g.doubleclick.net^$third-party

! cosmetic
kayoanime.com##.adsbygoogle-noablate
kayoanime.com##div[id^="div-gpt-ad"]
kayoanime.com##.widget:has(> .adsbygoogle)

! never hide (bait, D1)
kayoanime.com#@#.adsbox
kayoanime.com#@#.ad-placement

! scriptlets
kayoanime.com##+js(set-constant, google_ad_status, 1)
kayoanime.com##+js(no-window-open-if, /shorten|/redirect|/out\?)
kayoanime.com##+js(nano-setInterval-booster, countdown, *, 0.02)
```

The `nano-setInterval-booster` entry collapses the "wait 10 seconds" gate rather
than removing it — the page's own state machine still runs to completion, so
nothing detects a skipped step.

**Both packs are empirical.** Sites rotate domains and rename detectors, so the
packs are plain text files loaded at runtime and refreshable without a rebuild;
§7 defines the verification loop for keeping them current.

---

## 6. Build, test and packaging

**Build** — `node build.mjs --target=chrome|firefox [--watch]`
1. Bundle `src/**` with esbuild (ES2022, no minification in dev).
2. Parse `assets/filters/*.txt` → IR; run the DNR compiler for Chrome; emit
   `dist/<target>/rules/*.json`; assert DNR budgets.
3. Merge `manifest.base.json` + `manifest.<target>.json` → `dist/<target>/manifest.json`.
4. `--zip` produces `dist/umbra-chrome.zip` and `dist/umbra-firefox.xpi`.

**Tests** — `node --test test/`
- parser: every option in §1.1 round-trips to the expected IR.
- matcher: a fixture table of (url, docHost, type) → expected verdict, including
  exception precedence and `$important`.
- compiler: every IR rule either compiles to DNR or is reported as
  Firefox-only — no silent drops.
- scriptlets: run in a jsdom-ish harness; assert `proxyNative` keeps
  `toString()` reporting `[native code]` and preserves `name`/`length`.

**Manual verification** — a checklist run against both browsers:

| Check | Expectation |
|---|---|
| `document.styleSheets` enumeration | our rules absent (D8) |
| `fetch(adsbygoogle.js)` | resolves 200 (D2) |
| `window.adsbygoogle` | defined, `.loaded === true` (D3) |
| `window.open('x','_blank')` | returns a truthy decoy (D9) |
| `Function.prototype.toString.call(window.open)` | `[native code]` (D10) |
| bait `.adsbox` `offsetHeight` | non-zero (D1) |
| page DOM diff vs. blocker-off | no extension-owned nodes (D12) |
| aniwave: play/pause/seek ×10 | zero new tabs, video plays |
| kayoanime: post → download link | no interstitial, link reachable |

Run against the public detector corpora (`adblock-tester`, `d3ward/toolz`,
`blockads.fivefilters.org`) as a regression suite each release.

---

## 7. Milestones

| # | Deliverable | Exit criterion |
|---|---|---|
| M0 | This document | — |
| M1 | Scaffold: build, manifests, adapter | both browsers load an empty extension |
| M2 | Parser + IR + tokenizer + matcher | unit tests green on a fixture list |
| M3 | DNR compiler + Chrome network layer | ads blocked on a generic news site |
| M4 | Firefox `webRequest` layer | parity with M3 on the same site |
| M5 | Cosmetic engine (user-origin + procedural) | leftover containers collapse; D8 check passes |
| M6 | Scriptlet runtime + `proxyNative` + library | D9/D10 checks pass |
| M7 | Surrogates + stealth manifest hardening | D2/D3/D7 checks pass |
| M8 | Site packs: aniwave, kayoanime | §6 site rows pass |
| M9 | UI, packaging, docs | zip/xpi install cleanly |

**Maintenance loop** (this is the part that decides whether it keeps working):
site packs are re-verified whenever a target site breaks; the log view in the UI
lists unmatched third-party requests on the active tab so a new pop domain can
be identified in seconds and appended to the pack's text file.

---

## 8. Known limits, stated plainly

- **Chrome MV3 is strictly weaker.** No per-request JS decision means some
  filters (complex `$domain` intersections, response-body inspection) exist only
  on Firefox. The compiler reports these at build time rather than pretending.
- **Timing oracles are not closed** (D11). A determined site can measure us.
- **`getComputedStyle` sees hidden elements.** User-origin CSS defeats CSSOM
  enumeration, not geometry inspection — hence the do-not-hide list, which is
  per-site and manual.
- **Domain rotation** on the anime sites means the packs need periodic updates;
  the design makes that a text-file edit, not a code change.
- **First-party ad serving** (ads proxied through the site's own origin, same
  path space as real content) cannot be blocked at the network layer without
  breakage. Cosmetic + scriptlet layers handle it, less reliably.
