// Stub for googletagmanager.com/gtm.js and gtag/js
(function () {
  'use strict';
  const w = window;
  w.dataLayer = w.dataLayer || [];
  const push = function (item) {
    // GTM invokes eventCallback so publisher flows continue.
    if (item && typeof item.eventCallback === 'function') {
      try { item.eventCallback(); } catch (ignored) { /* publisher code */ }
    }
    return 1;
  };
  try { w.dataLayer.push = push; } catch (ignored) { w.dataLayer = { push: push }; }
  w.gtag = w.gtag || function () {};
  w.google_tag_manager = w.google_tag_manager || {};
})();
