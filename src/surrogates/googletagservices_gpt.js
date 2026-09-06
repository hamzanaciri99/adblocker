// Stub for Google Publisher Tag (securepubads / googletagservices gpt.js).
(function () {
  'use strict';
  const w = window;
  const noop = function () {};
  const noopThis = function () { return this; };

  function Slot(path) {
    this._path = path;
    this._id = '';
  }
  Slot.prototype = {
    addService: noopThis,
    clearCategoryExclusions: noopThis,
    clearTargeting: noopThis,
    defineSizeMapping: noopThis,
    get: function () { return null; },
    getAdUnitPath: function () { return this._path; },
    getAttributeKeys: function () { return []; },
    getCategoryExclusions: function () { return []; },
    getDomId: function () { return this._id; },
    getResponseInformation: function () { return null; },
    getSlotElementId: function () { return this._id; },
    getSlotId: noopThis,
    getSizes: function () { return []; },
    getTargeting: function () { return []; },
    getTargetingKeys: function () { return []; },
    set: noopThis,
    setCategoryExclusion: noopThis,
    setClickUrl: noopThis,
    setCollapseEmptyDiv: noopThis,
    setConfig: noop,
    setForceSafeFrame: noopThis,
    setSafeFrameConfig: noopThis,
    setTargeting: noopThis,
    updateTargetingFromMap: noopThis,
  };

  const pubads = {
    addEventListener: noopThis,
    removeEventListener: noopThis,
    clear: noop,
    clearCategoryExclusions: noopThis,
    clearTagForChildDirectedTreatment: noopThis,
    clearTargeting: noopThis,
    collapseEmptyDivs: noop,
    defineOutOfPagePassback: function () { return new Slot(''); },
    definePassback: function () { return new Slot(''); },
    disableInitialLoad: noop,
    display: noop,
    enableAsyncRendering: noop,
    enableLazyLoad: noop,
    enableSingleRequest: noop,
    enableSyncRendering: noop,
    enableVideoAds: noop,
    get: function () { return null; },
    getAttributeKeys: function () { return []; },
    getTargeting: function () { return []; },
    getTargetingKeys: function () { return []; },
    getSlots: function () { return []; },
    isInitialLoadDisabled: function () { return true; },
    refresh: noop,
    set: noopThis,
    setCategoryExclusion: noopThis,
    setCentering: noop,
    setCookieOptions: noopThis,
    setForceSafeFrame: noopThis,
    setLocation: noopThis,
    setPrivacySettings: noopThis,
    setPublisherProvidedId: noopThis,
    setRequestNonPersonalizedAds: noopThis,
    setSafeFrameConfig: noopThis,
    setTagForChildDirectedTreatment: noopThis,
    setTargeting: noopThis,
    setVideoContent: noopThis,
    updateCorrelator: noop,
  };

  const googletag = w.googletag || {};
  const cmd = googletag.cmd || [];

  googletag.apiReady = true;
  googletag.pubadsReady = true;
  googletag.cmd = [];
  googletag.cmd.push = function (fn) {
    try { fn(); } catch (ignored) { /* publisher code, not ours */ }
    return 1;
  };
  googletag.companionAds = function () { return pubads; };
  googletag.content = function () { return { setContent: noop }; };
  googletag.defineOutOfPageSlot = function (path) { return new Slot(path); };
  googletag.defineSlot = function (path) { return new Slot(path); };
  googletag.destroySlots = noop;
  googletag.disablePublisherConsole = noop;
  googletag.display = noop;
  googletag.enableServices = noop;
  googletag.getVersion = function () { return '0'; };
  googletag.pubads = function () { return pubads; };
  googletag.setAdIframeTitle = noop;
  googletag.sizeMapping = function () {
    const builder = { addSize: function () { return builder; }, build: function () { return []; } };
    return builder;
  };
  w.googletag = googletag;

  // Drain anything queued before we arrived.
  if (Array.isArray(cmd)) for (const fn of cmd) googletag.cmd.push(fn);
})();
