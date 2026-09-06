// Small DOM and storage nudges.
//
// Several sites gate an interstitial on a cookie or a storage flag they set
// themselves. Pre-satisfying the flag is quieter than blocking the interstitial:
// the site concludes it has already been shown and moves on.

import { safely } from '../runtime.js';

/** `set-cookie(name, value)` — pre-set a gate flag the site checks. */
export function setCookie(name, value, path = '/') {
  safely(() => {
    if (!name) return;
    const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=${path}`;
  });
}

/** `set-local-storage-item(key, value)` — same idea, for localStorage gates. */
export function setLocalStorageItem(key, value) {
  safely(() => { if (key) localStorage.setItem(key, value); });
}

function applyToMatches(selector, fn) {
  const run = () => {
    safely(() => { for (const el of document.querySelectorAll(selector)) fn(el); });
  };
  run();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  }
  const observer = new MutationObserver(run);
  const start = () => observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
}

/** `remove-attr(attrs, selector)` — strip attributes used to gate playback. */
export function removeAttr(attrs = '', selector = '*') {
  safely(() => {
    const list = attrs.split('|').filter(Boolean);
    if (list.length === 0) return;
    applyToMatches(selector, (el) => { for (const a of list) el.removeAttribute(a); });
  });
}

/** `remove-class(classes, selector)` — strip overlay/blur classes. */
export function removeClass(classes = '', selector = '*') {
  safely(() => {
    const list = classes.split('|').filter(Boolean);
    if (list.length === 0) return;
    applyToMatches(selector, (el) => el.classList.remove(...list));
  });
}
