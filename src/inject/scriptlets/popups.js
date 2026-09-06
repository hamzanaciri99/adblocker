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

function isCrossSite(url) {
  try {
    const target = new URL(url, location.href);
    if (!/^https?:$/.test(target.protocol)) return false;
    return registrableDomain(target.hostname) !== registrableDomain(location.hostname);
  } catch { return false; }
}

/**
 * `prevent-popunder()` — heuristic guard for sites whose pop domain rotates
 * faster than any filter list can follow.
 *
 * Two behaviours cover almost every pop SDK: opening a cross-site URL from a
 * click handler, and appending a `target="_blank"` anchor to the document and
 * clicking it programmatically. Same-site `window.open` is left alone, so a
 * site's own "open in new tab" links keep working.
 */
export function preventPopunder() {
  safely(() => {
    replaceMethod(window, 'open', (original) => function (url, target, features) {
      if (url && isCrossSite(url)) return makeDecoyWindow();
      return original.call(this, url, target, features);
    });

    // Programmatic clicks on injected `_blank` anchors. A real user click
    // carries `isTrusted`, which a synthetic one cannot forge.
    replaceMethod(HTMLElement.prototype, 'click', (original) => function () {
      if (this instanceof HTMLAnchorElement &&
          this.target === '_blank' &&
          isCrossSite(this.href)) {
        return undefined;
      }
      return original.call(this);
    });
  });
}
