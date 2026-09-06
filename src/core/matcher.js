// Runtime network matcher.
//
// Used directly by the Firefox blocking-webRequest path, and by the test suite
// as the reference implementation the DNR compiler is checked against.

import { DEFAULT_TYPES } from './types.js';
import { tokenizeUrl } from './tokenizer.js';
import { patternToRegex } from './parser.js';
import { isThirdParty, domainConstraintHolds } from './domains.js';

const UNTOKENIZED = Symbol('untokenized');

export class NetworkFilterSet {
  constructor(rules = []) {
    this.blockers = new Map();
    this.exceptions = new Map();
    this.important = new Map();
    this.size = 0;
    this.add(rules);
  }

  add(rules) {
    // `$badfilter` cancels an identical rule from another list. Resolve it up
    // front so cancelled rules never reach a bucket.
    const cancelled = new Set();
    for (const r of rules) {
      if (r.isBadFilter) cancelled.add(r.raw.replace(/,?badfilter/, '').replace(/\$$/, ''));
    }

    for (const rule of rules) {
      if (rule.isBadFilter || cancelled.has(rule.raw)) continue;
      if (rule.cosmeticControl) continue; // owned by CosmeticFilterSet
      const bucket = rule.isException ? this.exceptions
        : rule.isImportant ? this.important
        : this.blockers;
      const key = rule.token ?? UNTOKENIZED;
      let list = bucket.get(key);
      if (list === undefined) bucket.set(key, (list = []));
      list.push(rule);
      this.size++;
    }
  }

  /**
   * @param {{url: string, hostname: string, documentHostname: string, type: number}} ctx
   * @returns {{action: 'block'|'allow'|'redirect'|'removeparam', rule: object}|null}
   */
  match(ctx) {
    const thirdParty = isThirdParty(ctx.hostname, ctx.documentHostname);
    const query = { ...ctx, thirdParty, tokens: tokenizeUrl(ctx.url) };

    const importantHit = this.#search(this.important, query);
    if (importantHit) return verdict(importantHit);

    const exception = this.#search(this.exceptions, query);
    if (exception) return { action: 'allow', rule: exception };

    const hit = this.#search(this.blockers, query);
    return hit ? verdict(hit) : null;
  }

  #search(bucket, query) {
    const seen = new Set();
    for (const token of query.tokens) {
      const list = bucket.get(token);
      if (list === undefined || seen.has(token)) continue;
      seen.add(token);
      for (const rule of list) if (ruleMatches(rule, query)) return rule;
    }
    const rest = bucket.get(UNTOKENIZED);
    if (rest) for (const rule of rest) if (ruleMatches(rule, query)) return rule;
    return null;
  }
}

function verdict(rule) {
  if (rule.redirect) return { action: 'redirect', rule };
  if (rule.removeParams) return { action: 'removeparam', rule };
  return { action: 'block', rule };
}

export function ruleMatches(rule, query) {
  const applicable = rule.types === 0 ? DEFAULT_TYPES : rule.types;
  if ((applicable & query.type) === 0) return false;
  if ((rule.excludedTypes & query.type) !== 0) return false;

  if (rule.thirdParty !== null && rule.thirdParty !== query.thirdParty) return false;

  if ((rule.includeDomains.length || rule.excludeDomains.length) &&
      !domainConstraintHolds(query.documentHostname, rule.includeDomains, rule.excludeDomains)) {
    return false;
  }

  return patternMatches(rule, query.url);
}

function patternMatches(rule, url) {
  if (rule.regex === undefined || rule.regex === null) compileRule(rule);
  return rule.regex.test(url);
}

/** Regexes are compiled on first use; most rules in a list are never consulted. */
function compileRule(rule) {
  rule.regex = rule.kind === 'regex'
    ? new RegExp(rule.regexSource, rule.matchCase ? '' : 'i')
    : patternToRegex(rule.pattern, rule.matchCase);
}
