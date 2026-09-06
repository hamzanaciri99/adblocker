// Redirect resources ("surrogates").
//
// Blocking a script the page depends on is loud: `onerror` fires, the expected
// global stays undefined, and a detector notices in one line. Redirecting to a
// behavioural stub is quiet: the request completes 200, the API surface exists,
// and nothing observable changed except that no ad arrives.

export const SURROGATES = Object.freeze({
  // Generic no-ops
  'noop.js': 'noop.js',
  'noopjs': 'noop.js',
  'noop.txt': 'noop.txt',
  'nooptext': 'noop.txt',
  'noopframe': 'noop.html',
  'noop.html': 'noop.html',
  '1x1.gif': '1x1.gif',
  '1x1-transparent.gif': '1x1.gif',
  '2x2.png': '1x1.gif',
  '3x2.png': '1x1.gif',

  // Behavioural stubs: these define the globals a detector looks for.
  'googlesyndication_adsbygoogle.js': 'googlesyndication_adsbygoogle.js',
  'googlesyndication.com/adsbygoogle.js': 'googlesyndication_adsbygoogle.js',
  'googletagservices_gpt.js': 'googletagservices_gpt.js',
  'googletagservices.com/gpt.js': 'googletagservices_gpt.js',
  'google-analytics_analytics.js': 'google-analytics_analytics.js',
  'googletagmanager_gtm.js': 'googletagmanager_gtm.js',
  'fuckadblock.js-3.2.0': 'fuckadblock.js',
  'prebid-ads.js': 'prebid-ads.js',
  'popads.js': 'popads.js',
  'popads-dummy.js': 'popads.js',
  'amazon_apstag.js': 'amazon_apstag.js',
});

export const SURROGATE_DIR = 'surrogates';

/** Resolve a `$redirect=` token to a packaged file, or null if unknown. */
export function resolveSurrogate(name) {
  const file = SURROGATES[name] ?? SURROGATES[`${name}.js`];
  return file ? `${SURROGATE_DIR}/${file}` : null;
}
