// Should a newly opened tab be closed?
//
// Kept free of browser APIs so it can be unit tested. The background passes in a
// match function; everything else here is pure.

import { T } from './types.js';
import { isThirdParty, hostnameOf } from './domains.js';

/**
 * @param {(url: string, documentUrl: string, type: number) => ({action: string, rule: object}|null)} match
 * @param {string} url        the URL the new tab is heading to
 * @param {string} sourceUrl  the page that opened it
 * @returns {{action: string, rule: object}|null} the rule to close on, or null to leave the tab alone
 */
export function shouldClosePopup(match, url, sourceUrl) {
  // Pass 1: rules written for popups specifically. Untyped filters never match a
  // document load, so only `$popup`, `$document` or `$all` can reach this.
  const direct = match(url, sourceUrl, T.main_frame);
  if (direct) return isClose(direct) ? direct : null;

  // Pass 2: the URL is a known ad or pop domain even though nobody wrote a
  // `$popup` rule for it. This is what keeps up with networks that rotate
  // domains weekly. Restricted to cross-site targets so a site opening its own
  // pages in new tabs is never touched.
  if (!isThirdParty(hostnameOf(url), hostnameOf(sourceUrl))) return null;

  const indirect = match(url, sourceUrl, T.sub_frame);
  return indirect && isClose(indirect) ? indirect : null;
}

/**
 * Only an outright block justifies destroying a tab.
 *
 * This is the whole subtlety. A list-wide rule such as `$removeparam=utm_source`
 * matches *every* URL, and a `$redirect` verdict means "serve a stub" — treating
 * either as grounds to close would shut every cross-site tab the user opened,
 * which looks exactly like a broken browser.
 */
function isClose(verdict) {
  return verdict.action === 'block';
}
