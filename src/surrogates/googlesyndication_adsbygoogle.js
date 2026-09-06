// Stub for pagead2.googlesyndication.com/pagead/js/adsbygoogle.js
//
// Blocking this file is the most-probed adblock signal on the web: the script
// tag's `onerror` fires, `window.adsbygoogle` stays undefined, and
// `google_ad_status` is never set. Serving this instead means every one of
// those checks reports exactly what a served ad would have.
(function () {
  'use strict';
  const w = window;

  const queue = w.adsbygoogle instanceof Array ? w.adsbygoogle : [];
  queue.loaded = true;
  queue.push = function () { return 1; };
  queue.pauseAdRequests = 0;
  w.adsbygoogle = queue;

  w.google_ad_status = 1;
  w.google_ad_modifications = w.google_ad_modifications || {};
  w.google_ad_modifications.remove_ads_by_default = false;
  w.google_reactive_ads_config = w.google_reactive_ads_config || null;

  // AdSense stamps its own slots once it has decided what to do with them, and
  // page scripts read those attributes back. An unstamped slot reads as
  // "the loader never ran", which is the tell we are removing.
  function markSlots(root) {
    const slots = (root || document).querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])');
    for (const slot of slots) {
      slot.setAttribute('data-adsbygoogle-status', 'done');
      slot.setAttribute('data-ad-status', 'filled');
    }
  }

  const start = function () {
    markSlots(document);
    try {
      new MutationObserver(function () { markSlots(document); })
        .observe(document.documentElement, { childList: true, subtree: true });
    } catch (ignored) { /* document torn down */ }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
