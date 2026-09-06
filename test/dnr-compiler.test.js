import test from 'node:test';
import assert from 'node:assert/strict';

import { parseList } from '../src/core/parser.js';
import { compileToDnr, PRIORITY, expandEntities } from '../src/core/dnr-compiler.js';

function compile(lines) {
  return compileToDnr(parseList(lines.join('\n')).network);
}

test('a simple block compiles to a DNR block rule', () => {
  const { rules } = compile(['||ads.example.com^$script']);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].action.type, 'block');
  assert.equal(rules[0].condition.urlFilter, '||ads.example.com^');
  assert.deepEqual(rules[0].condition.resourceTypes, ['script']);
});

test('the priority ladder encodes Adblock precedence', () => {
  const { rules } = compile([
    '||a.com^',                    // generic block
    '||b.com^$domain=x.test',      // domain-scoped block
    '||c.com^$redirect=noopjs',    // surrogate
    '@@||d.com^',                  // exception
    '||e.com^$important',          // important
  ]);
  const byHost = Object.fromEntries(rules.map((r) => [r.condition.urlFilter, r.priority]));
  assert.equal(byHost['||a.com^'], PRIORITY.genericBlock);
  assert.equal(byHost['||b.com^'], PRIORITY.domainBlock);
  assert.equal(byHost['||c.com^'], PRIORITY.redirect);
  assert.equal(byHost['||d.com^'], PRIORITY.exception);
  assert.equal(byHost['||e.com^'], PRIORITY.important);
  // A surrogate must outrank a plain block, or the block would win and the
  // page would see a failed load instead of a stub.
  assert.ok(PRIORITY.redirect > PRIORITY.genericBlock);
  assert.ok(PRIORITY.important > PRIORITY.exception);
});

test('$redirect points at a packaged surrogate', () => {
  const { rules } = compile(['||g.com/ads.js$script,redirect=googlesyndication_adsbygoogle.js']);
  assert.equal(rules[0].action.type, 'redirect');
  assert.equal(rules[0].action.redirect.extensionPath, '/surrogates/googlesyndication_adsbygoogle.js');
});

test('an unknown $redirect resource is reported, not emitted', () => {
  const { rules, skipped } = compile(['||g.com^$redirect=does-not-exist']);
  assert.equal(rules.length, 0);
  assert.match(skipped[0].reason, /unknown \$redirect/);
});

test('$removeparam becomes a query transform', () => {
  const { rules } = compile(['$removeparam=utm_source']);
  assert.deepEqual(rules[0].action.redirect.transform.queryTransform.removeParams, ['utm_source']);
});

test('domain scoping maps to initiatorDomains', () => {
  const { rules } = compile(['||ads.io^$domain=a.test|~b.test']);
  assert.deepEqual(rules[0].condition.initiatorDomains, ['a.test']);
  assert.deepEqual(rules[0].condition.excludedInitiatorDomains, ['b.test']);
});

test('entity domains are expanded because DNR has no entity syntax', () => {
  const { rules } = compile(['||ads.io^$domain=aniwave.*']);
  assert.ok(rules[0].condition.initiatorDomains.includes('aniwave.to'));
  assert.ok(rules[0].condition.initiatorDomains.includes('aniwave.at'));
  assert.ok(!rules[0].condition.initiatorDomains.some((d) => d.endsWith('.*')));
});

test('expandEntities leaves plain domains alone', () => {
  assert.deepEqual(expandEntities(['a.com'], ['to']), ['a.com']);
  assert.deepEqual(expandEntities(['a.*'], ['to', 'at']), ['a.to', 'a.at']);
});

test('$third-party maps to domainType', () => {
  assert.equal(compile(['||a.com^$third-party']).rules[0].condition.domainType, 'thirdParty');
  assert.equal(compile(['||a.com^$first-party']).rules[0].condition.domainType, 'firstParty');
});

test('rules DNR cannot express are reported rather than dropped silently', () => {
  const { rules, skipped } = compile([
    '||a.com^$csp=script-src none',
    '||b.com^$popup',
    '/(?<=x)y/$script',
  ]);
  assert.equal(rules.length, 0);
  assert.equal(skipped.length, 3);
  assert.match(skipped[2].reason, /lookaround|backreference/);
});

test('cosmetic controls are not compiled as network rules', () => {
  const { rules, skipped } = compile(['@@||site.test^$generichide']);
  assert.equal(rules.length, 0);
  assert.match(skipped[0].reason, /cosmetic control/);
});

test('every emitted rule has a unique id and a valid priority', () => {
  const { rules } = compile(['||a.com^', '||b.com^', '||c.com^$redirect=noopjs']);
  const ids = new Set(rules.map((r) => r.id));
  assert.equal(ids.size, rules.length);
  for (const rule of rules) assert.ok(rule.priority >= 1);
});
