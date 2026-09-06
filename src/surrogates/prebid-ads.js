// Stub for Prebid.js
(function () {
  'use strict';
  const noop = function () {};
  const pbjs = window.pbjs || {};
  const queue = Array.isArray(pbjs.que) ? pbjs.que : [];

  pbjs.addAdUnits = noop;
  pbjs.adServers = {};
  pbjs.adUnits = [];
  pbjs.aliasBidder = noop;
  pbjs.bidderSettings = {};
  pbjs.enableAnalytics = noop;
  pbjs.getAdserverTargeting = function () { return {}; };
  pbjs.getBidResponses = function () { return {}; };
  pbjs.getHighestCpmBids = function () { return []; };
  pbjs.getNoBids = function () { return []; };
  pbjs.libLoaded = true;
  pbjs.removeAdUnit = noop;
  pbjs.renderAd = noop;
  pbjs.requestBids = function (request) {
    if (request && typeof request.bidsBackHandler === 'function') {
      setTimeout(function () { request.bidsBackHandler({}, true); }, 1);
    }
  };
  pbjs.setConfig = noop;
  pbjs.setTargetingForGPTAsync = noop;
  pbjs.version = 'v0.0.0';
  pbjs.que = { push: function (fn) { try { fn(); } catch (ignored) { /* publisher code */ } } };

  window.pbjs = pbjs;
  for (const fn of queue) pbjs.que.push(fn);
})();
