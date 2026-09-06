// Hostname helpers.
//
// A full Public Suffix List is ~15k entries and mostly dead weight for a
// blocker, so registrable-domain detection uses the common multi-label suffixes
// plus a two-label fallback. Getting this slightly wrong only affects
// third-party classification for exotic TLDs, never correctness of a match.

const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr',
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.cn', 'net.cn', 'org.cn',
  'co.in', 'net.in', 'org.in', 'com.mx', 'com.ar', 'com.tr', 'com.tw',
  'co.za', 'co.nz', 'net.nz', 'org.nz', 'com.sg', 'com.hk', 'com.my',
  'co.id', 'com.pk', 'com.ua', 'com.pl', 'com.ru', 'org.es', 'com.es',
]);

/** Registrable domain, e.g. `a.b.example.co.uk` -> `example.co.uk`. */
export function getDomain(hostname) {
  if (!hostname) return '';
  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join('.');
  return lastTwo;
}

export function isThirdParty(requestHostname, documentHostname) {
  if (!documentHostname || !requestHostname) return false;
  return getDomain(requestHostname) !== getDomain(documentHostname);
}

/**
 * Does `hostname` fall under `pattern`?
 *
 * `example.com`   matches example.com and any subdomain
 * `aniwave.*`     matches aniwave.to, aniwave.at, aniwave.li ... (entity form,
 *                 needed because these sites rotate their TLD constantly)
 * `*`             matches everything
 */
export function hostMatchesPattern(hostname, pattern) {
  if (pattern === '*' || pattern === '') return true;
  if (pattern.endsWith('.*')) {
    const entity = pattern.slice(0, -2);
    const domain = getDomain(hostname);
    const base = domain.split('.')[0];
    if (base === entity) return true;
    return hostname === entity || hostname.endsWith(`.${entity}`) ||
           hostname.includes(`.${entity}.`) || hostname.startsWith(`${entity}.`);
  }
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

/**
 * Evaluate an include/exclude domain constraint.
 * Exclusions always win; an empty include list means "any domain".
 */
export function domainConstraintHolds(hostname, include, exclude) {
  if (exclude.length && exclude.some((d) => hostMatchesPattern(hostname, d))) return false;
  if (include.length === 0) return true;
  return include.some((d) => hostMatchesPattern(hostname, d));
}

export function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
