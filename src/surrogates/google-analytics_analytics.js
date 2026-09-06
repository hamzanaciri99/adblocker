// Stub for google-analytics.com/analytics.js
(function () {
  'use strict';
  const w = window;
  const noop = function () {};

  function ga() {
    const args = arguments;
    // The real ga() invokes a callback passed to 'send'/'require' hitCallbacks.
    if (typeof args[args.length - 1] === 'function') {
      try { args[args.length - 1](); } catch (ignored) { /* publisher code */ }
    }
  }
  ga.create = function () { return { get: noop, set: noop, send: noop }; };
  ga.getByName = function () { return null; };
  ga.getAll = function () { return []; };
  ga.remove = noop;
  ga.loaded = true;

  const name = w.GoogleAnalyticsObject || 'ga';
  const queued = w[name];
  w[name] = ga;
  w.ga = ga;
  if (queued && Array.isArray(queued.q)) for (const call of queued.q) { try { ga.apply(null, call); } catch (ignored) { /* noop */ } }
})();
