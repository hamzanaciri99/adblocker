// In-page network interception.
//
// The network layer (DNR / webRequest) cannot help with a probe the page makes
// against its *own* origin, and a hard failure is exactly what a detector wants
// to see. These scriptlets answer such probes with a plausible success instead.

import { replaceMethod, toMatcher, jitteredResolve, safely } from '../runtime.js';

/**
 * `no-fetch-if(pattern)` — resolve matching fetches with an empty 200.
 *
 * Rejecting the promise (what blocking does) is the single most common adblock
 * probe there is (D2). Fulfilling it removes the signal entirely.
 */
export function noFetchIf(pattern = '') {
  safely(() => {
    const matches = toMatcher(pattern);
    replaceMethod(window, 'fetch', (original) => function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!matches(url)) return original.call(this, input, init);
      const response = new Response('', {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'text/plain' },
      });
      try { Object.defineProperty(response, 'url', { value: String(url) }); } catch { /* frozen */ }
      return jitteredResolve(response);
    });
  });
}

/** `no-xhr-if(pattern)` — same treatment for XMLHttpRequest. */
export function noXhrIf(pattern = '') {
  safely(() => {
    const matches = toMatcher(pattern);
    const faked = new WeakSet();

    replaceMethod(XMLHttpRequest.prototype, 'open',
      (original) => function (method, url, ...rest) {
        if (matches(String(url))) faked.add(this);
        return original.call(this, method, url, ...rest);
      });

    replaceMethod(XMLHttpRequest.prototype, 'send', (original) => function (body) {
      if (!faked.has(this)) return original.call(this, body);
      const xhr = this;
      const define = (prop, value) => {
        try { Object.defineProperty(xhr, prop, { value, configurable: true }); } catch { /* sealed */ }
      };
      define('readyState', 4);
      define('status', 200);
      define('statusText', 'OK');
      define('responseText', '');
      define('response', '');
      define('responseURL', '');
      setTimeout(() => {
        try {
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new ProgressEvent('load'));
          xhr.dispatchEvent(new ProgressEvent('loadend'));
        } catch { /* listener threw; not ours to handle */ }
      }, 1 + Math.random() * 12);
      return undefined;
    });
  });
}

function prunePaths(root, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1 && node; i++) node = node[parts[i]];
    if (node && typeof node === 'object') delete node[parts[parts.length - 1]];
  }
}

/**
 * `json-prune(paths, needle)` — strip keys out of parsed JSON.
 *
 * Sites increasingly deliver ad payloads inside the same API response as the
 * content, where no network rule can separate them.
 */
export function jsonPrune(paths = '', needle = '') {
  safely(() => {
    const list = paths.split(/\s+/).filter(Boolean);
    if (list.length === 0) return;
    const matches = toMatcher(needle);

    replaceMethod(JSON, 'parse', (original) => function (text, reviver) {
      const result = original.call(this, text, reviver);
      if (result && typeof result === 'object' && matches(String(text))) prunePaths(result, list);
      return result;
    });

    replaceMethod(Response.prototype, 'json', (original) => function () {
      return original.call(this).then((result) => {
        if (result && typeof result === 'object') prunePaths(result, list);
        return result;
      });
    });
  });
}
