// Cosmetic rule selection.
//
// Given a hostname, produce everything the injector needs: one concatenated
// stylesheet for declarative hiding, the procedural rules that need JavaScript,
// and the scriptlets to run in the page's own realm.

import { getDomain, hostMatchesPattern, domainConstraintHolds } from './domains.js';

export class CosmeticFilterSet {
  constructor(rules = [], controls = []) {
    /** Rules with no include-domain: candidates for every site. */
    this.generic = [];
    /** Rules indexed by each include-domain they name. */
    this.byDomain = new Map();
    this.exceptions = [];
    this.scriptlets = [];
    this.scriptletExceptions = [];
    /** `$generichide` / `$elemhide` / `$specifichide` rules. */
    this.controls = controls;

    this.add(rules);
  }

  add(rules) {
    for (const rule of rules) {
      switch (rule.type) {
        case 'unhide':      this.exceptions.push(rule); break;
        case 'scriptlet':   this.scriptlets.push(rule); break;
        case 'unscriptlet': this.scriptletExceptions.push(rule); break;
        case 'hide':
          if (rule.includeDomains.length === 0) this.generic.push(rule);
          else this.indexByDomain(rule);
          break;
      }
    }
  }

  indexByDomain(rule) {
    for (const domain of rule.includeDomains) {
      let bucket = this.byDomain.get(domain);
      if (bucket === undefined) this.byDomain.set(domain, (bucket = []));
      bucket.push(rule);
    }
  }

  /**
   * @param {string} hostname
   * @returns {{css: string, procedural: object[], scriptlets: {name: string, args: string[]}[],
   *            unhidden: string[], genericAllowed: boolean}}
   */
  selectFor(hostname) {
    const mode = this.cosmeticMode(hostname);
    const unhidden = new Set();
    for (const ex of this.exceptions) {
      if (matchesHost(ex, hostname)) unhidden.add(ex.selector);
    }

    const declarative = [];
    const procedural = [];

    const consider = (rule) => {
      if (!matchesHost(rule, hostname)) return;
      if (unhidden.has(rule.selector)) return;
      if (rule.procedural) procedural.push(rule);
      else declarative.push(rule.selector);
    };

    if (mode !== 'all' && mode !== 'specific') {
      for (const rule of this.specificFor(hostname)) consider(rule);
    }
    if (mode !== 'all' && mode !== 'generic') {
      for (const rule of this.generic) consider(rule);
    }

    const blockedScriptlets = new Set();
    for (const ex of this.scriptletExceptions) {
      if (matchesHost(ex, hostname)) blockedScriptlets.add(ex.scriptlet ? ex.scriptlet.name : '*');
    }

    const scriptlets = [];
    for (const rule of this.scriptlets) {
      if (!matchesHost(rule, hostname)) continue;
      if (blockedScriptlets.has('*') || blockedScriptlets.has(rule.scriptlet.name)) continue;
      scriptlets.push(rule.scriptlet);
    }

    return {
      css: buildStylesheet(declarative),
      procedural,
      scriptlets,
      unhidden: [...unhidden],
      genericAllowed: mode !== 'generic' && mode !== 'all',
    };
  }

  /** Candidate specific rules for a hostname, via its domain suffixes. */
  specificFor(hostname) {
    const out = [];
    for (const key of candidateKeys(hostname)) {
      const bucket = this.byDomain.get(key);
      if (bucket) out.push(...bucket);
    }
    return out;
  }

  /** Which classes of cosmetic rule are suppressed here. */
  cosmeticMode(hostname) {
    let mode = 'none';
    for (const control of this.controls) {
      if (!domainConstraintHolds(hostname, control.includeDomains, control.excludeDomains)) continue;
      if (control.pattern && !hostMatchesPattern(hostname, stripAnchors(control.pattern))) continue;
      if (control.cosmeticControl === 'all') return 'all';
      mode = control.cosmeticControl;
    }
    return mode;
  }
}

/**
 * Reduce a network pattern to the hostname it scopes.
 *
 * Only the anchors and the separator placeholder come off. A trailing `.*` is
 * the *entity* form (`aniwave.*`) and has to survive, or a site pack whose
 * domain rotates loses its `$generichide` and starts hiding bait elements again.
 */
function stripAnchors(pattern) {
  return pattern.replace(/^\|{1,2}/, '').replace(/[|^]+$/, '');
}

function matchesHost(rule, hostname) {
  return domainConstraintHolds(hostname, rule.includeDomains, rule.excludeDomains);
}

/**
 * Lookup keys for a hostname: every domain suffix, plus the entity form so
 * `aniwave.*` rules are found from `aniwave.to`.
 */
export function candidateKeys(hostname) {
  const keys = [];
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length - 1; i++) keys.push(labels.slice(i).join('.'));
  const base = getDomain(hostname).split('.')[0];
  if (base) keys.push(`${base}.*`);
  return keys;
}

/**
 * One rule per stylesheet, not one selector per rule: a single huge selector
 * list is dramatically cheaper for the style engine than thousands of rules,
 * and `!important` at user origin outranks anything the page can write.
 */
export function buildStylesheet(selectors) {
  if (selectors.length === 0) return '';
  const unique = [...new Set(selectors)];
  const chunks = [];
  // Very long selector lists are split so one malformed selector cannot take
  // the whole sheet down with it.
  for (let i = 0; i < unique.length; i += 200) {
    chunks.push(`${unique.slice(i, i + 200).join(',\n')} { display: none !important; }`);
  }
  return chunks.join('\n');
}
