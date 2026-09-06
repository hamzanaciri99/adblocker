An ad blocker that does not announce itself to the page.

## Install on Chrome

Chrome cannot install an extension from a `.zip`, and it rejects unsigned `.crx`
files outright, so loading the unpacked folder is the only route outside the Web
Store. It takes about twenty seconds:

1. Download **`umbra-chrome-<version>.zip`** below and unzip it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.

Keep the folder somewhere permanent — Chrome reads from it on every start, so
moving or deleting it uninstalls the extension. Works the same on Edge, Brave and
other Chromium browsers.

**Firefox 142+**: `about:debugging#/runtime/this-firefox` → *Load Temporary
Add-on* → select `manifest.json` inside the `.xpi`. A permanent install needs
signing through addons.mozilla.org.

## What's in it

Generic ad, tracker and pop-under blocking on every site, plus tuned packs for
`kayoanime.com` and the `aniwave.*` family.

The point of difference is the anti-detection work. Blocking is easy; staying
invisible while you do it is not. Umbra serves neutered stubs instead of failing
ad-script requests, keeps patched builtins reporting `[native code]`, returns a
decoy `Window` rather than `null` from `window.open`, injects styles at user
origin so nothing shows up in `document.styleSheets`, and leaves honeypot bait
elements alone — hiding those is how most blockers give themselves away.

The twelve detection techniques it defends against, and how, are catalogued in
[`docs/DESIGN.md`](../blob/HEAD/docs/DESIGN.md).

## Verifying it

Paste [`tools/self-test.js`](../blob/HEAD/tools/self-test.js) into the DevTools
console on any page. It runs the probes an anti-adblock script would and prints a
pass/fail table. The bar is that the output is identical with Umbra enabled and
disabled.
