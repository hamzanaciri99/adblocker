// Chrome network layer.
//
// Chrome MV3 has no blocking webRequest, so the static rulesets compiled by
// build.mjs do the work. All that is left at runtime is standing down on
// user-disabled sites and, where the browser will tell us, counting.

import { api } from '../shared/browser.js';
import { getSettings, recordBlock } from './state.js';

const SESSION_RULE_BASE = 1_000_000;

export async function installChromeNetworkLayer() {
  await syncAllowlist();

  // `onRuleMatchedDebug` only exists for unpacked builds. Without it a packed
  // Chrome build cannot attribute a block to a tab, so the badge counts
  // cosmetic hides alone. Worth stating plainly rather than faking a number.
  if (api.declarativeNetRequest?.onRuleMatchedDebug) {
    api.declarativeNetRequest.onRuleMatchedDebug.addListener(({ request, rule }) => {
      recordBlock(request.tabId, {
        url: request.url,
        action: 'block',
        rule: `dnr#${rule.ruleId} (${rule.rulesetId})`,
      });
    });
  }
}

/**
 * Mirror the disabled-site list into session rules.
 *
 * `allowAllRequests` on the top-level document is how DNR expresses "stand down
 * for this site" — it outranks every block rule for requests under that frame.
 */
export async function syncAllowlist() {
  const { disabledSites, enabled } = getSettings();
  const existing = await api.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing.map((r) => r.id);

  const addRules = [];
  if (!enabled) {
    addRules.push(allowAllRule(SESSION_RULE_BASE, undefined));
  } else {
    disabledSites.forEach((site, index) => {
      addRules.push(allowAllRule(SESSION_RULE_BASE + index + 1, site));
    });
  }

  await api.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
}

function allowAllRule(id, site) {
  const condition = {
    resourceTypes: ['main_frame', 'sub_frame'],
  };
  if (site) condition.requestDomains = [site];
  else condition.urlFilter = '*';
  return { id, priority: 50, action: { type: 'allowAllRequests' }, condition };
}

/** Toggle a compiled ruleset (a site pack) on or off. */
export async function setRulesetEnabled(rulesetId, enabled) {
  await api.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: [rulesetId] } : { disableRulesetIds: [rulesetId] },
  );
}
