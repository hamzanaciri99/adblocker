// Adblock Plus / uBlock Origin filter syntax -> intermediate representation.
//
// The IR is deliberately browser-agnostic: `matcher.js` interprets it directly
// on Firefox, and `dnr-compiler.js` lowers it to declarativeNetRequest JSON for
// Chrome. Anything the compiler cannot express is reported rather than dropped.

import { ALL_TYPES, POPUP_TYPES, OPTION_TO_TYPE } from './types.js';
import { pickToken, pickTokenFromRegex } from './tokenizer.js';

const COSMETIC_MARKER = /#@?\$?\??#/;

/**
 * Parse a filter list.
 * @returns {{network: object[], cosmetic: object[], errors: {line: number, raw: string, reason: string}[]}}
 */
export function parseList(text) {
  const network = [];
  const cosmetic = [];
  const errors = [];

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === '' || raw.startsWith('!') || raw.startsWith('#!') || raw.startsWith('[')) continue;

    try {
      // A '#' that begins a cosmetic marker distinguishes the two grammars.
      // `#` alone (e.g. inside a URL fragment) does not.
      const m = COSMETIC_MARKER.exec(raw);
      if (m && isCosmeticMarker(raw, m)) {
        cosmetic.push(parseCosmeticFilter(raw, m));
      } else {
        network.push(parseNetworkFilter(raw));
      }
    } catch (err) {
      errors.push({ line: i + 1, raw, reason: err.message });
    }
  }
  return { network, cosmetic, errors };
}

// A marker is cosmetic only if what follows it looks like a selector or a
// scriptlet call, and what precedes it is a domain list (or nothing).
function isCosmeticMarker(raw, m) {
  const before = raw.slice(0, m.index);
  const after = raw.slice(m.index + m[0].length);
  if (after === '') return false;
  if (before.includes('/') || before.includes('$')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Network filters
// ---------------------------------------------------------------------------

export function parseNetworkFilter(raw) {
  let body = raw;
  let isException = false;

  if (body.startsWith('@@')) {
    isException = true;
    body = body.slice(2);
  }

  const { pattern, optionText } = splitOptions(body);
  if (pattern === '') throw new Error('empty pattern');

  const rule = {
    raw,
    kind: 'pattern',
    pattern,
    regexSource: null,
    isException,
    isImportant: false,
    types: 0,            // 0 means "not specified" -> DEFAULT_TYPES at match time
    excludedTypes: 0,
    thirdParty: null,
    includeDomains: [],
    excludeDomains: [],
    redirect: null,
    removeParams: null,
    matchCase: false,
    isPopup: false,
    cosmeticControl: null,
    unsupported: null,
  };

  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    rule.kind = 'regex';
    rule.regexSource = pattern.slice(1, -1);
    // Validate now so a bad list line fails at parse time, not at match time.
    try { new RegExp(rule.regexSource); }
    catch { throw new Error('invalid regular expression'); }
  }

  if (optionText !== null) applyOptions(rule, optionText);

  // `$popup` is a document-level block; without it, untyped rules never touch
  // top-level navigation.
  if (rule.isPopup && rule.types === 0) rule.types = POPUP_TYPES;

  rule.token = rule.kind === 'regex'
    ? pickTokenFromRegex(rule.regexSource)
    : pickToken(rule.pattern);

  return rule;
}

/**
 * Find the '$' that separates pattern from options.
 *
 * Naively taking the last '$' breaks on URLs and on `removeparam` values that
 * contain one, so candidates are validated right-to-left and the first one
 * whose tail actually parses as an option list wins.
 */
function splitOptions(body) {
  // A regex pattern is delimited by slashes; options can only follow the close.
  if (body.startsWith('/')) {
    const close = body.lastIndexOf('/');
    if (close > 0) {
      const tail = body.slice(close + 1);
      if (tail === '') return { pattern: body, optionText: null };
      if (tail.startsWith('$')) return { pattern: body.slice(0, close + 1), optionText: tail.slice(1) };
    }
  }

  // `i >= 0` matters: a list-wide rule like `$removeparam=utm_source` has its
  // separator at index 0 and an empty pattern, which means "every request".
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i] !== '$' || (i > 0 && body[i - 1] === '\\')) continue;
    const tail = body.slice(i + 1);
    if (looksLikeOptions(tail)) return { pattern: body.slice(0, i) || '*', optionText: tail };
  }
  return { pattern: body, optionText: null };
}

const OPTION_SHAPE = /^~?[a-z0-9_-]+(=.*)?$/i;

function looksLikeOptions(tail) {
  if (tail === '') return false;
  // Split on commas that are not inside a value like `domain=a.com|b.com`.
  return tail.split(',').every((part) => OPTION_SHAPE.test(part.trim()));
}

function applyOptions(rule, optionText) {
  for (const rawOpt of optionText.split(',')) {
    const opt = rawOpt.trim();
    if (opt === '') continue;

    const negated = opt.startsWith('~');
    const eq = opt.indexOf('=');
    const name = (negated ? opt.slice(1) : opt).split('=')[0].toLowerCase();
    const value = eq === -1 ? null : opt.slice(eq + 1);

    if (name in OPTION_TO_TYPE) {
      if (negated) rule.excludedTypes |= OPTION_TO_TYPE[name];
      else rule.types |= OPTION_TO_TYPE[name];
      continue;
    }

    switch (name) {
      case 'all':
        rule.types = ALL_TYPES;
        break;
      case 'popup':
        rule.isPopup = true;
        break;
      case 'third-party': case '3p':
        rule.thirdParty = !negated;
        break;
      case 'first-party': case '1p':
        rule.thirdParty = negated;
        break;
      case 'important':
        rule.isImportant = true;
        break;
      case 'match-case':
        rule.matchCase = true;
        break;
      case 'domain': case 'from': {
        if (value === null) throw new Error('$domain requires a value');
        const { include, exclude } = parseDomainList(value, '|');
        rule.includeDomains = include;
        rule.excludeDomains = exclude;
        break;
      }
      case 'redirect': case 'redirect-rule':
        if (value === null) throw new Error('$redirect requires a value');
        rule.redirect = value;
        break;
      case 'removeparam': case 'queryprune':
        rule.removeParams = value === null ? [] : value.split('|');
        break;
      // Recognised but not implemented; kept so the rule still blocks and the
      // build report can list what is being approximated.
      case 'csp': case 'replace': case 'header': case 'permissions':
      case 'inline-script': case 'inline-font': case 'stealth':
        rule.unsupported = `$${name} is not implemented`;
        break;
      case 'badfilter':
        rule.isBadFilter = true;
        break;
      // Cosmetic-control exceptions. These are not network decisions at all --
      // they tell the injector to hold back some class of cosmetic rule on a
      // site, which is how a site pack opts out of broad generic hiding (D1).
      case 'generichide': case 'ghide':
        rule.cosmeticControl = 'generic';
        break;
      case 'specifichide': case 'shide':
        rule.cosmeticControl = 'specific';
        break;
      case 'elemhide': case 'ehide':
        rule.cosmeticControl = 'all';
        break;
      default:
        throw new Error(`unknown option: $${name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cosmetic filters
// ---------------------------------------------------------------------------

const SCRIPTLET_CALL = /^\+js\((.*)\)$/;

export function parseCosmeticFilter(raw, marker) {
  const m = marker ?? COSMETIC_MARKER.exec(raw);
  const sep = m[0];
  const domainText = raw.slice(0, m.index);
  const body = raw.slice(m.index + sep.length).trim();

  const isException = sep.includes('@');
  const { include, exclude } = parseDomainList(domainText, ',');

  const rule = {
    raw,
    includeDomains: include,
    excludeDomains: exclude,
    isException,
  };

  const call = SCRIPTLET_CALL.exec(body);
  if (call) {
    const args = splitScriptletArgs(call[1]);
    const name = args.shift();
    if (!name) throw new Error('scriptlet call needs a name');
    return { ...rule, type: isException ? 'unscriptlet' : 'scriptlet', scriptlet: { name, args } };
  }

  // uBO marks procedural filters with `#?#`, but authors routinely use `##`
  // for them too, so detect by content as well as by marker.
  const procedural = sep.includes('?') || hasProceduralOperator(body);
  return { ...rule, type: isException ? 'unhide' : 'hide', procedural, selector: body };
}

const PROCEDURAL_OPS = [
  ':has-text(', ':matches-css(', ':matches-css-before(', ':matches-css-after(',
  ':matches-attr(', ':matches-path(', ':upward(', ':remove()', ':remove-attr(',
  ':remove-class(', ':min-text-length(', ':watch-attr(', ':xpath(', ':others(',
];

function hasProceduralOperator(selector) {
  return PROCEDURAL_OPS.some((op) => selector.includes(op));
}

/**
 * Split `a, b, c` on top-level commas only.
 *
 * Arguments are routinely regular expressions, so a comma can legitimately
 * appear inside a quantifier (`/a{1,3}/`), a character class, or a nested call.
 * All four contexts have to be tracked or the argument is silently torn in half.
 */
function splitScriptletArgs(text) {
  const out = [];
  let depth = 0;          // ( [ { nesting
  let quote = null;       // inside ' or "
  let inRegex = false;    // inside a /.../ literal
  let cur = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length) { cur += ch + text[++i]; continue; }

    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
      continue;
    }

    if (inRegex) {
      cur += ch;
      if (ch === '/') inRegex = false;
      continue;
    }

    if (ch === '"' || ch === "'") { quote = ch; continue; }

    // A slash opens a regex literal only where an argument may begin.
    if (ch === '/' && cur.trim() === '') { inRegex = true; cur += ch; continue; }

    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }

    cur += ch;
  }

  if (cur.trim() !== '' || out.length > 0) out.push(cur.trim());
  return out.filter((a, i) => i === 0 || a !== '');
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Parse `a.com|~b.com` or `a.com,~b.com` into include/exclude lists. */
export function parseDomainList(text, sep) {
  const include = [];
  const exclude = [];
  for (const part of text.split(sep)) {
    const d = part.trim().toLowerCase();
    if (d === '') continue;
    if (d.startsWith('~')) exclude.push(d.slice(1));
    else include.push(d);
  }
  return { include, exclude };
}

/**
 * Compile an Adblock pattern into a RegExp.
 *
 * `||` anchors to a domain boundary, `^` is the separator placeholder (anything
 * that is not a letter, digit, `_`, `-`, `.` or `%`), `|` anchors to an end,
 * and `*` is a wildcard. Everything else is literal.
 */
export function patternToRegex(pattern, matchCase = false) {
  let src = '';
  let i = 0;

  if (pattern.startsWith('||')) {
    src += '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?';
    i = 2;
  } else if (pattern.startsWith('|')) {
    src += '^';
    i = 1;
  }

  let end = pattern.length;
  if (end > i && pattern[end - 1] === '|') end -= 1;

  for (; i < end; i++) {
    const ch = pattern[i];
    if (ch === '*') src += '.*';
    else if (ch === '^') src += '(?:[^a-zA-Z0-9_\\-.%]|$)';
    else src += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }

  if (pattern.length > 1 && pattern.endsWith('|')) src += '$';
  return new RegExp(src, matchCase ? '' : 'i');
}
