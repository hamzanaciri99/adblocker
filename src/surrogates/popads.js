// Stub for PopAds / PopCash style pop-under loaders.
(function () {
  'use strict';
  const w = window;
  const noop = function () {};
  w.PopAds = { loaded: true, serve: noop, init: noop };
  w.popns = { loaded: true };
  w.popMagic = {
    init: noop, initPopunder: noop, createIframe: noop, open: noop,
    setEvents: noop, hasAdblock: function () { return false; },
  };
  w.uid = w.uid || '';
  w.wid = w.wid || 0;
  w.pop_target = w.pop_target || null;
})();
