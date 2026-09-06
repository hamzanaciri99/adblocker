// Stub for Amazon Publisher Services apstag.js
(function () {
  'use strict';
  const noop = function () {};
  window.apstag = {
    init: noop,
    fetchBids: function (config, callback) {
      if (typeof callback === 'function') setTimeout(function () { callback([]); }, 1);
    },
    setDisplayBids: noop,
    targetingKeys: function () { return []; },
    debug: noop,
    punt: noop,
    renderImp: noop,
    _Q: [],
  };
})();
