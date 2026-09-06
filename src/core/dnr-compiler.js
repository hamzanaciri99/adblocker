// IR -> Chrome declarativeNetRequest.
//
// Chrome MV3 removed blocking webRequest, so on that browser every decision has
// to be precompiled. DNR's `urlFilter` grammar is close enough to Adblock's that
// most patterns pass through unchanged; the interesting work is the priority
// ladder and reporting the rules DNR simply cannot express.

import { typeNames, DEFAULT_TYPES } from './types.js';
import { resolveSurrogate } from '../shared/surrogates.js';

/**
 * Priority ladder. DNR resolves conflicts numerically, so the Adblock
 * precedence rules (exception beats block, `$important` beats exception) have to
 * be encoded as explicit numbers rather than left to evaluation order.
 */
export const PRIORITY = Object.freeze({
  genericBlock: 1,
  domainBlock: 10,
  redirect: 20,
  exception: 30,
  important: 40,
  importantException: 45,
  userAllow: 50,
});

// RE2 (which DNR uses) has no lookaround and no backreferences.
const RE2_UNSUPPORTED = /\(\?<?[=!]|\\[1-9]/;

// TLDs an `entity.*` pattern expands to. DNR has no entity form, so the
// alternative would be dropping the rule entirely — and these sites change TLD
// far more often than they change anything else.
export const ENTITY_TLDS = [
  'com', 'net', 'org', 'to', 'at', 'li', 'se', 'tv', 'me', 'cc', 'ws', 'ru',
  'io', 'co', 'sx', 'pw', 'bz', 'gg', 'la', 'vc', 'nz', 'ac', 'ch', 'digital',
];

/**
 * @param {object[]} rules network IR
 * @param {{startId?: number, entityTlds?: string[]}} [opts]
 * @returns {{rules: object[], skipped: {raw: string, reason: string}[], regexCount: number}}
 */
export function compileToDnr(rules, opts = {}) {
  const startId = opts.startId ?? 1;
  const entityTlds = opts.entityTlds ?? ENTITY_TLDS;

  const out = [];
  const skipped = [];
  let regexCount = 0;
  let id = startId;

  const cancelled = new Set();
  for (const r of rules) {
    if (r.isBadFilter) cancelled.add(r.raw.replace(/,?badfilter/, '').replace(/\$$/, ''));
  }

  for (const rule of rules) {
    if (rule.isBadFilter || cancelled.has(rule.raw)) continue;

    const reason = unsupportedReason(rule);
    if (reason) { skipped.push({ raw: rule.raw, reason }); continue; }

    const condition = buildCondition(rule, entityTlds);
    if (typeof condition === 'string') { skipped.push({ raw: rule.raw, reason: condition }); continue; }

    const action = buildAction(rule);
    if (typeof action === 'string') { skipped.push({ raw: rule.raw, reason: action }); continue; }

    if (condition.regexFilter) regexCount++;

    out.push({ id: id++, priority: priorityFor(rule), action, condition });
  }

  return { rules: out, skipped, regexCount };
}

function unsupportedReason(rule) {
  if (rule.cosmeticControl) return 'cosmetic control, applied by the injector';
  if (rule.unsupported) return rule.unsupported;
  // `$popup` needs to know that a *new browsing context* was created, which is
  // not part of a DNR condition. The background popup guard handles these.
  if (rule.isPopup) return '$popup is handled by the popup guard, not DNR';
  if (rule.kind === 'regex' && RE2_UNSUPPORTED.test(rule.regexSource)) {
    return 'regex uses lookaround or backreferences, unsupported by RE2';
  }
  if (rule.redirect && !resolveSurrogate(rule.redirect)) {
    return `unknown $redirect resource: ${rule.redirect}`;
  }
  return null;
}

function priorityFor(rule) {
  if (rule.isImportant) return rule.isException ? PRIORITY.importantException : PRIORITY.important;
  if (rule.isException) return PRIORITY.exception;
  if (rule.redirect || rule.removeParams) return PRIORITY.redirect;
  return rule.includeDomains.length ? PRIORITY.domainBlock : PRIORITY.genericBlock;
}

function buildAction(rule) {
  if (rule.isException) return { type: 'allow' };

  if (rule.redirect) {
    const path = resolveSurrogate(rule.redirect);
    return { type: 'redirect', redirect: { extensionPath: `/${path}` } };
  }

  if (rule.removeParams) {
    if (rule.removeParams.length === 0) return '$removeparam with no value is unsupported';
    return {
      type: 'redirect',
      redirect: { transform: { queryTransform: { removeParams: rule.removeParams } } },
    };
  }

  return { type: 'block' };
}

function buildCondition(rule, entityTlds) {
  const condition = {};

  if (rule.kind === 'regex') {
    condition.regexFilter = rule.regexSource;
  } else if (rule.pattern !== '*' && rule.pattern !== '') {
    if (!/^[\x00-\x7F]*$/.test(rule.pattern)) return 'urlFilter must be ASCII';
    condition.urlFilter = rule.pattern;
  }

  const types = rule.types === 0 ? DEFAULT_TYPES : rule.types;
  condition.resourceTypes = typeNames(types);
  if (condition.resourceTypes.length === 0) return 'rule matches no resource type';

  if (rule.excludedTypes) {
    const excluded = typeNames(rule.excludedTypes).filter((t) => !condition.resourceTypes.includes(t));
    if (excluded.length) condition.excludedResourceTypes = excluded;
    condition.resourceTypes = condition.resourceTypes.filter((t) => !typeNames(rule.excludedTypes).includes(t));
    if (condition.resourceTypes.length === 0) return 'rule matches no resource type after exclusions';
  }

  if (rule.thirdParty !== null) condition.domainType = rule.thirdParty ? 'thirdParty' : 'firstParty';
  if (rule.matchCase) condition.isUrlFilterCaseSensitive = true;

  const include = expandEntities(rule.includeDomains, entityTlds);
  const exclude = expandEntities(rule.excludeDomains, entityTlds);
  if (include.length) condition.initiatorDomains = include;
  if (exclude.length) condition.excludedInitiatorDomains = exclude;

  return condition;
}

/** `aniwave.*` -> `aniwave.to`, `aniwave.at`, ... DNR has no entity syntax. */
export function expandEntities(domains, entityTlds) {
  const out = [];
  for (const d of domains) {
    if (d.endsWith('.*')) {
      const base = d.slice(0, -2);
      for (const tld of entityTlds) out.push(`${base}.${tld}`);
    } else {
      out.push(d);
    }
  }
  return out;
}
