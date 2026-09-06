// Token extraction.
//
// Testing a URL against every rule is hopeless at list scale, so each rule is
// indexed under one literal substring it *must* contain. At match time only the
// buckets for the URL's own tokens are consulted, which turns a linear scan over
// hundreds of thousands of rules into a handful of comparisons.

const TOKEN_RE = /[a-z0-9%]{3,}/g;

// Substrings so common they select nothing. A rule whose only tokens are these
// goes into the untokenized bucket, which is always scanned.
const STOPWORDS = new Set([
  'http', 'https', 'www', 'com', 'net', 'org', 'html', 'htm', 'php', 'index',
  'static', 'assets', 'content', 'images', 'image', 'img', 'css', 'js',
  'the', 'and', 'for', 'this', 'that', 'with', 'from', 'default', 'public',
  'src', 'dist', 'file', 'files', 'data', 'api', 'web', 'site', 'page',
]);

/** All tokens present in a URL, lowercased. */
export function tokenizeUrl(url) {
  const out = [];
  const lower = url.toLowerCase();
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(lower)) !== null) out.push(m[0]);
  return out;
}

/**
 * Split a filter pattern into the literal runs that must appear verbatim in a
 * matching URL. Wildcards and the separator placeholder break a run, because
 * text on either side of them is not contiguous in the URL.
 */
function literalRuns(pattern) {
  return pattern.split(/[*^|]+/).filter(Boolean);
}

/**
 * Pick the most selective token for a pattern, or null when the pattern has
 * none (pure wildcards, or only stopwords). Longest-non-stopword is a crude
 * proxy for rarest, but it is right often enough and costs nothing to compute.
 */
export function pickToken(pattern) {
  let best = null;
  for (const run of literalRuns(pattern.toLowerCase())) {
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(run)) !== null) {
      const tok = m[0];
      if (STOPWORDS.has(tok)) continue;
      if (best === null || tok.length > best.length) best = tok;
    }
  }
  return best;
}

/** Token for a regex filter: pull literal runs out of the source where we can. */
export function pickTokenFromRegex(source) {
  const literal = source.replace(/\\(.)/g, '$1').replace(/[\[\](){}.+?*^$|]/g, ' ');
  return pickToken(literal);
}
