// Pop-under defusal.

import { replaceMethod, toMatcher, safely } from '../runtime.js';

/**
 * A stand-in for the Window a pop-under expected.
 *
 * Returning `null` — what a browser pop-up blocker does — is a detection signal
 * many sites gate playback on (D9). A decoy satisfies `if (!win)`, `win.closed`,
 * `win.focus()` and `win.document.write()` without anything opening.
 */
export function makeDecoyWindow() {
  const noop = function () {};
  const doc = {
    write: noop, writeln: noop, close: noop,
    body: null, cookie: '', readyState: 'complete',
    open() { return doc; },
    createElement() { return null; },
  };

  const decoy = {
    closed: false,
    opener: null,
    name: '',
    innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0,
    screenX: 0, screenY: 0,
    document: doc,
    // Assigning `location` or `location.href` on the decoy navigates nothing,
    // which is what defuses the open-blank-then-redirect pattern.
    location: { href: 'about:blank', assign: noop, replace: noop, reload: noop, toString: () => 'about:blank' },
    focus: noop, blur: noop, print: noop, alert: noop, stop: noop,
    postMessage: noop, scroll: noop, scrollTo: noop, scrollBy: noop,
    resizeTo: noop, moveTo: noop, addEventListener: noop, removeEventListener: noop,
    close() { decoy.closed = true; },
  };
  decoy.window = decoy;
  decoy.self = decoy;
  decoy.top = decoy;
  decoy.parent = decoy;
  return decoy;
}

/** `no-window-open-if(pattern)` — swallow matching `window.open` calls. */
export function noWindowOpenIf(pattern = '') {
  safely(() => {
    const matches = toMatcher(pattern);
    replaceMethod(window, 'open', (original) => function (url, target, features) {
      const subject = `${url ?? ''} ${target ?? ''}`;
      if (matches(url ?? '') || matches(subject)) return makeDecoyWindow();
      return original.call(this, url, target, features);
    });
  });
}

function registrableDomain(hostname) {
  const parts = String(hostname).split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}

function sameSite(a, b) {
  try {
    return registrableDomain(new URL(a, location.href).hostname) ===
           registrableDomain(new URL(b, location.href).hostname);
  } catch { return false; }
}

function isCrossSite(url) {
  try {
    const target = new URL(url, location.href);
    if (!/^https?:$/.test(target.protocol)) return false;
    return registrableDomain(target.hostname) !== registrableDomain(location.hostname);
  } catch { return false; }
}

// The last real user click, and the link it landed on if there was one.
const GESTURE_WINDOW_MS = 1500;
let lastGesture = { at: 0, href: null };

function watchGestures() {
  const record = (event) => {
    if (!event.isTrusted) return;
    let href = null;
    try {
      const anchor = event.target?.closest?.('a[href]');
      href = anchor ? anchor.href : null;
    } catch { /* target is not an Element */ }
    lastGesture = { at: Date.now(), href };
  };
  // Capture phase, so the record happens before the page's own handler runs and
  // calls window.open from inside it.
  for (const type of ['pointerdown', 'mousedown', 'click', 'auxclick', 'keydown']) {
    window.addEventListener(type, record, true);
  }
}

/**
 * Was this `window.open` plausibly what the user asked for?
 *
 * A pop-under works by hijacking whatever the user clicks, so "there was a user
 * gesture" proves nothing — the gesture is the trigger. What does discriminate
 * is *correlation*: a genuine new-tab open goes to the link the user clicked. An
 * ad opens somewhere unrelated to anything on the page.
 */
function userAskedForThis(url) {
  const fresh = Date.now() - lastGesture.at < GESTURE_WINDOW_MS;
  if (!fresh || !lastGesture.href) return false;
  return sameSite(url, lastGesture.href);
}

/**
 * `prevent-popunder()` — the general defence, for the case no filter list can
 * win: pop domains that rotate faster than anyone can list them.
 *
 * Same-site opens are always allowed, so a site's own "open in new tab" keeps
 * working. Cross-site opens are allowed only when they match a link the user
 * just clicked. Everything else gets a decoy.
 *
 * This is deliberately aggressive — it will also swallow a cross-site share or
 * OAuth pop-up opened from a button rather than a link. That is the trade the
 * per-site switch in the toolbar popup exists to reverse.
 */
export function preventPopunder() {
  safely(() => {
    watchGestures();

    replaceMethod(window, 'open', (original) => function (url, target, features) {
      // `window.open()` with no URL is the open-blank-then-redirect pattern;
      // treat it as a pop unless a click on a real link explains it.
      const requested = url ?? '';
      const blank = requested === '' || /^about:blank$/i.test(requested);

      if (!blank && !isCrossSite(requested)) return original.call(this, url, target, features);
      if (userAskedForThis(blank ? (lastGesture.href ?? '') : requested)) {
        return original.call(this, url, target, features);
      }
      return makeDecoyWindow();
    });

    // A `target="_blank"` anchor appended to the document and clicked from
    // script. Three ways in, all of which have to be covered — closing only the
    // first just moves the SDK to one of the others.

    // 1. element.click()
    replaceMethod(HTMLElement.prototype, 'click', (original) => function () {
      if (isSyntheticPopAnchor(this)) return undefined;
      return original.call(this);
    });

    // 2. element.dispatchEvent(new MouseEvent('click'))
    //
    // A synthesized event always reports `isTrusted === false`, and the page
    // cannot forge that, so a real user click can never be caught here. The
    // check is ordered cheapest-first because this method is hot.
    replaceMethod(EventTarget.prototype, 'dispatchEvent', (original) => function (event) {
      try {
        if (event && event.type === 'click' && event.isTrusted === false &&
            isSyntheticPopAnchor(this)) {
          return true;   // "not cancelled", which is what a real dispatch returns
        }
      } catch { /* exotic target; fall through */ }
      return original.call(this, event);
    });

    // 3. <form target="_blank"> submitted from script
    replaceMethod(HTMLFormElement.prototype, 'submit', (original) => function () {
      try {
        if (this.target === '_blank' && isCrossSite(this.action)) return undefined;
      } catch { /* fall through */ }
      return original.call(this);
    });
  });
}

/** A cross-site `target="_blank"` anchor — the shape every pop SDK injects. */
function isSyntheticPopAnchor(node) {
  return node instanceof HTMLAnchorElement &&
         node.target === '_blank' &&
         isCrossSite(node.href);
}
