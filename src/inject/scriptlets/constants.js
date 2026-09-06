// Scriptlets that shape what page scripts can read.

import { defineConstant, coerceValue, resolvePath, toMatcher, safely } from '../runtime.js';

/** `set-constant(path, value)` — make a global read as something harmless. */
export function setConstant(path, value) {
  safely(() => defineConstant(path, coerceValue(value)));
}

// Errors thrown by abort-* carry this marker so we can swallow exactly ours and
// leave the page's own errors alone.
const MARKER = `​${Math.random().toString(36).slice(2)}`;
let sinkInstalled = false;

/**
 * Swallow the console noise our own aborts produce.
 *
 * Best-effort by design: the sink is a courtesy, the abort is the point, so a
 * failure here must never stop the property from being defined.
 */
function installErrorSink() {
  if (sinkInstalled) return;
  sinkInstalled = true;
  try {
    window.addEventListener('error', (event) => {
      if (event.message && String(event.message).includes(MARKER)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  } catch { /* no listener support; the abort still works */ }
}

/**
 * `abort-on-property-read(path)` — reading the property throws.
 *
 * The throw unwinds only the script that touched it, which is exactly what we
 * want for a detector library: its initialisation dies, the rest of the page is
 * untouched, and nothing reports a blocker.
 */
export function abortOnPropertyRead(path) {
  safely(() => {
    installErrorSink();
    const target = resolvePath(window, path, true);
    if (!target) return;
    Object.defineProperty(target.owner, target.key, {
      get() { throw new ReferenceError(MARKER); },
      set() {},
      enumerable: false,
      configurable: false,
    });
  });
}

/** `abort-on-property-write(path)` — assigning to the property throws. */
export function abortOnPropertyWrite(path) {
  safely(() => {
    installErrorSink();
    const target = resolvePath(window, path, true);
    if (!target) return;
    let stored;
    Object.defineProperty(target.owner, target.key, {
      get() { return stored; },
      set() { throw new ReferenceError(MARKER); },
      enumerable: false,
      configurable: false,
    });
  });
}

/**
 * `abort-current-script(path, needle)` — abort only the inline script that both
 * reads `path` and contains `needle`. Far more surgical than killing the
 * property outright, so use it when the page also has legitimate readers.
 */
export function abortCurrentScript(path, needle = '') {
  safely(() => {
    installErrorSink();
    const matches = toMatcher(needle);
    const target = resolvePath(window, path, true);
    if (!target) return;
    let stored = target.owner[target.key];
    Object.defineProperty(target.owner, target.key, {
      get() {
        const current = document.currentScript;
        if (current && current.textContent && matches(current.textContent)) {
          throw new ReferenceError(MARKER);
        }
        return stored;
      },
      set(v) { stored = v; },
      enumerable: false,
      configurable: true,
    });
  });
}
