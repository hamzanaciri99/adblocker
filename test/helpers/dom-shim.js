// A DOM small enough to run surrogates and scriptlet bundles under `node:vm`.
//
// Not a browser, and not trying to be. It implements exactly the surface the
// shipped code touches, so the built artifacts in dist/ can be executed and
// asserted against rather than merely eyeballed.

import vm from 'node:vm';

class FakeClassList {
  constructor() { this.items = new Set(); }
  add(...names) { for (const n of names) this.items.add(n); }
  remove(...names) { for (const n of names) this.items.delete(n); }
  contains(name) { return this.items.has(name); }
}

export function createDom({ href = 'https://site.test/page' } = {}) {
  const url = new URL(href);
  const listeners = new Map();
  const elements = [];

  class FakeElement {
    constructor(tag) {
      this.localName = String(tag).toLowerCase();
      this.attributes = new Map();
      this.classList = new FakeClassList();
      this.children = [];
      this.parentElement = null;
      this.textContent = '';
      this.target = '';
      this.href = '';
      this.id = '';
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
      const siblings = this.parentElement?.children;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
    }
    querySelectorAll() { return []; }
    addEventListener() {}
    click() { this.clicked = (this.clicked ?? 0) + 1; }
  }

  class FakeAnchor extends FakeElement {}

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.observing = true; }
    disconnect() { this.observing = false; }
  }

  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const document = {
    readyState: 'complete',
    documentElement,
    head,
    body,
    currentScript: null,
    cookie: '',
    createElement(tag) {
      const el = String(tag).toLowerCase() === 'a' ? new FakeAnchor(tag) : new FakeElement(tag);
      elements.push(el);
      return el;
    },
    querySelectorAll(selector) { return elements.filter((el) => el.matchesSelector === selector); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatch(type) { for (const fn of listeners.get(type) ?? []) fn({ type }); },
  };

  // Only host objects go in. A vm context brings its own intrinsics, and
  // injecting Node's would both let page code patch the test process's
  // `Function.prototype` and make every cross-realm assertion misbehave.
  const errorListeners = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    document,
    addEventListener(type, fn) { if (type === 'error') errorListeners.push(fn); },
    removeEventListener() {},
    location: {
      href: url.href, hostname: url.hostname, protocol: url.protocol,
      pathname: url.pathname, search: url.search,
      toString() { return url.href; },
    },
    navigator: { userAgent: 'node' },
    MutationObserver: FakeMutationObserver,
    HTMLElement: FakeElement,
    HTMLAnchorElement: FakeAnchor,
    EventTarget: class EventTarget { addEventListener() {} removeEventListener() {} },
    localStorage: {
      store: new Map(),
      setItem(k, v) { this.store.set(k, String(v)); },
      getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    },
    // The real `window.open`, so a scriptlet has something native-looking to wrap.
    open: function open(url, target, features) { return { opened: url, target, features }; },
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  return {
    context,
    window: sandbox,
    document,
    run(code, filename = 'inline') { return vm.runInContext(code, context, { filename }); },
  };
}
