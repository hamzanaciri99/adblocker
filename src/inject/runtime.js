// MAIN-world runtime.
//
// This file runs inside the page's own realm, before page scripts. It has no
// access to extension APIs and must leave no trace: no globals, no DOM nodes,
// no enumerable properties, and — critically — no patched builtin that reports
// anything other than `[native code]` when the page asks (D10).

// Capture originals immediately. Anything looked up later could already be a
// page-installed trap.
const $defineProperty = Object.defineProperty;
const $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const $apply = Reflect.apply;
const $construct = Reflect.construct;
const $nativeToString = Function.prototype.toString;
// `globalThis`, not `window`: identical in a page's MAIN world, but it also
// lets this module be imported by the test suite outside a browser.
const $setTimeout = globalThis.setTimeout;

/** Functions we replaced -> the source text the original reported. */
const spoofedSources = new WeakMap();
let toStringPatched = false;

/**
 * Install a single `Function.prototype.toString` trap that answers for every
 * function we swap out. Without this, one regex over the function source gives
 * the whole extension away.
 */
function ensureToStringPatch() {
  if (toStringPatched) return;
  toStringPatched = true;

  const patched = new Proxy($nativeToString, {
    apply(target, thisArg, args) {
      const source = spoofedSources.get(thisArg);
      if (source !== undefined) return source;
      return $apply(target, thisArg, args);
    },
  });

  // The trap must lie about itself too.
  spoofedSources.set(patched, $apply($nativeToString, $nativeToString, []));

  $defineProperty(Function.prototype, 'toString', {
    value: patched,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/**
 * Wrap a native function so calls dispatch to `impl` while every observable
 * property — name, length, prototype chain, source text — still reports what
 * the original did.
 */
export function wrapNative(original, impl) {
  ensureToStringPatch();

  const proxy = new Proxy(original, {
    apply(target, thisArg, args) {
      return $apply(impl, thisArg, args);
    },
    construct(target, args, newTarget) {
      return $construct(target, args, newTarget);
    },
  });

  // When the target is itself one of our proxies -- two scriptlets patching the
  // same method, which happens whenever a site pack combines `no-window-open-if`
  // with `prevent-popunder` -- inherit its recorded source. Asking the native
  // toString about a Proxy yields a bare `function () { [native code] }`, losing
  // the function's name, and a missing name is exactly the kind of difference a
  // detector looks for.
  const inherited = spoofedSources.get(original);
  try {
    spoofedSources.set(proxy, inherited !== undefined ? inherited : $apply($nativeToString, original, []));
  } catch { /* exotic callable; leave it unrecorded */ }

  return proxy;
}

/**
 * Replace a method, preserving the exact property descriptor of the slot. A
 * descriptor that suddenly becomes `enumerable` or `writable` is as much of a
 * tell as a changed source string.
 *
 * `factory` receives the original function and returns the replacement, so the
 * original stays in a closure. Stashing it on `window` instead would hand the
 * page a one-line test for our presence (D12).
 */
export function replaceMethod(target, prop, factory) {
  try {
    const desc = $getOwnPropertyDescriptor(target, prop);
    if (!desc || typeof desc.value !== 'function') return false;
    const original = desc.value;
    $defineProperty(target, prop, { ...desc, value: wrapNative(original, factory(original)) });
    return true;
  } catch { return false; }
}

/** Replace an accessor, keeping getter/setter shape and descriptor flags. */
export function replaceAccessor(target, prop, factories) {
  try {
    const desc = $getOwnPropertyDescriptor(target, prop);
    if (!desc || (!desc.get && !desc.set)) return false;
    const next = { ...desc };
    if (factories.get && desc.get) next.get = wrapNative(desc.get, factories.get(desc.get));
    if (factories.set && desc.set) next.set = wrapNative(desc.set, factories.set(desc.set));
    $defineProperty(target, prop, next);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Property-path helpers, shared by most scriptlets
// ---------------------------------------------------------------------------

/** Resolve `a.b.c` to `{owner, key}`, creating intermediate objects on demand. */
export function resolvePath(root, path, create = false) {
  const parts = path.split('.');
  let owner = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    let next = owner[key];
    if (next === undefined || next === null) {
      if (!create) return null;
      next = {};
      try { owner[key] = next; } catch { return null; }
    }
    owner = next;
  }
  return { owner, key: parts[parts.length - 1] };
}

/**
 * Define a value that survives the page trying to overwrite it, without making
 * the property look unusual: it stays configurable so a descriptor check sees
 * an ordinary data property, but the setter silently ignores writes.
 */
export function defineConstant(path, value) {
  const target = resolvePath(window, path, true);
  if (!target) return false;
  try {
    let current = value;
    $defineProperty(target.owner, target.key, {
      get() { return current; },
      set(v) { if (v === value) current = v; },   // accept idempotent writes only
      enumerable: true,
      configurable: true,
    });
    return true;
  } catch { return false; }
}

/** Parse the value vocabulary shared by `set-constant`-style scriptlets. */
export function coerceValue(raw) {
  switch (raw) {
    case 'true':      return true;
    case 'false':     return false;
    case 'null':      return null;
    case 'undefined': return undefined;
    case '':          return '';
    case 'emptyArr':  return [];
    case 'emptyObj':  return {};
    case 'noopFunc':  return function () {};
    case 'trueFunc':  return function () { return true; };
    case 'falseFunc': return function () { return false; };
    case 'noopPromiseResolve': return function () { return Promise.resolve(); };
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Turn a scriptlet argument into a predicate. Bare text is a substring test;
 * `/re/flags` is a regular expression; an empty argument matches everything.
 */
export function toMatcher(arg) {
  if (arg === undefined || arg === '' || arg === '*') return () => true;
  const re = /^\/(.+)\/([gimsuy]*)$/.exec(arg);
  if (re) {
    try {
      const rx = new RegExp(re[1], re[2].replace('g', ''));
      return (value) => rx.test(String(value));
    } catch { /* fall through to substring */ }
  }
  const negate = arg.startsWith('!');
  const needle = negate ? arg.slice(1) : arg;
  return (value) => (String(value).includes(needle) !== negate);
}

/**
 * Resolve on a microtask plus a small jitter rather than instantly. A synthetic
 * response that returns in 0.0ms when the network takes 40ms is a timing tell
 * (D11); this does not close the channel, but it costs nothing to blur it.
 */
export function jitteredResolve(value) {
  return new Promise((resolve) => {
    $apply($setTimeout, window, [() => resolve(value), 1 + Math.random() * 12]);
  });
}

/** Every scriptlet runs inside this: a thrown error would surface to the page. */
export function safely(fn) {
  try { fn(); } catch { /* never let the page see us fail */ }
}
