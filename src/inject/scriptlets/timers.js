// Timer and listener suppression.
//
// Redirect loops, countdown gates and "your ad blocker is showing" polls all run
// on timers, and the callback source is a reliable fingerprint for them.

import { replaceMethod, toMatcher, safely } from '../runtime.js';

function callbackSource(handler) {
  try { return typeof handler === 'function' ? Function.prototype.toString.call(handler) : String(handler); }
  catch { return ''; }
}

function delayMatches(spec, actual) {
  if (spec === undefined || spec === '' || spec === '*') return true;
  const negate = spec.startsWith('!');
  const wanted = Number(negate ? spec.slice(1) : spec);
  if (Number.isNaN(wanted)) return true;
  return (Number(actual) === wanted) !== negate;
}

/** `prevent-setTimeout(needle, delay)` — drop timers whose callback matches. */
export function preventSetTimeout(needle = '', delay = '') {
  safely(() => {
    const matches = toMatcher(needle);
    replaceMethod(window, 'setTimeout', (original) => function (handler, timeout, ...rest) {
      if (matches(callbackSource(handler)) && delayMatches(delay, timeout)) return 0;
      return original.call(this, handler, timeout, ...rest);
    });
  });
}

/** `prevent-setInterval(needle, delay)` — same, for repeating timers. */
export function preventSetInterval(needle = '', delay = '') {
  safely(() => {
    const matches = toMatcher(needle);
    replaceMethod(window, 'setInterval', (original) => function (handler, timeout, ...rest) {
      if (matches(callbackSource(handler)) && delayMatches(delay, timeout)) return 0;
      return original.call(this, handler, timeout, ...rest);
    });
  });
}

/**
 * `nano-setInterval-booster(needle, delay, boost)` — rescale a timer instead of
 * removing it.
 *
 * This is the right tool for a countdown gate: the page's own state machine
 * still runs every step it expected to, it just finishes immediately. Deleting
 * the timer would leave the state machine stuck, which is itself detectable.
 */
export function nanoSetIntervalBooster(needle = '', delay = '', boost = '0.05') {
  safely(() => {
    const matches = toMatcher(needle);
    const factor = Math.max(0.001, Math.min(50, Number(boost) || 0.05));
    const scale = (original) => function (handler, timeout, ...rest) {
      let next = timeout;
      if (matches(callbackSource(handler)) && delayMatches(delay, timeout)) {
        next = Math.max(0, Number(timeout) * factor);
      }
      return original.call(this, handler, next, ...rest);
    };
    replaceMethod(window, 'setInterval', scale);
    replaceMethod(window, 'setTimeout', scale);
  });
}

/**
 * `prevent-addEventListener(type, needle)` — refuse a listener registration.
 *
 * Registration still returns normally, so a page checking that its call did not
 * throw sees nothing unusual.
 */
export function preventAddEventListener(type = '', needle = '') {
  safely(() => {
    const typeMatches = toMatcher(type);
    const bodyMatches = toMatcher(needle);
    replaceMethod(EventTarget.prototype, 'addEventListener',
      (original) => function (eventType, listener, options) {
        if (typeMatches(eventType) && bodyMatches(callbackSource(listener))) return undefined;
        return original.call(this, eventType, listener, options);
      });
  });
}
