// Pop-under guard.
//
// A pop that survives the network and scriptlet layers still has to open a
// browsing context, and the browser tells us when one is created. Closing it
// there catches SDKs whose domain rotates faster than any filter list.
//
// Conservative by construction: the URL is matched as a *document* load, and
// untyped filters never apply to documents, so only a rule explicitly written
// for popups (`$popup`, `$document`, `$all`) can ever close a tab.

import { api } from '../shared/browser.js';
import { engine } from './engine.js';
import { isDisabledFor, getSettings, recordBlock } from './state.js';
import { hostnameOf } from '../core/domains.js';
import { shouldClosePopup } from '../core/popup-decision.js';

export function installPopupGuard() {
  if (!api.webNavigation?.onCreatedNavigationTarget) return;
  api.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
}

async function onCreatedNavigationTarget(details) {
  if (!getSettings().blockPopups) return;

  let sourceUrl = '';
  try {
    const tab = await api.tabs.get(details.sourceTabId);
    sourceUrl = tab?.url ?? '';
  } catch { return; }

  const sourceHostname = hostnameOf(sourceUrl);
  if (isDisabledFor(sourceHostname)) return;

  const verdict = shouldClosePopup(
    (url, documentUrl, type) => engine.match({ url, documentUrl, type }),
    details.url,
    sourceUrl,
  );
  if (!verdict) return;

  try {
    await api.tabs.remove(details.tabId);
    recordBlock(details.sourceTabId, {
      url: details.url,
      action: 'popup',
      rule: verdict.rule.raw,
    });
  } catch { /* tab already gone */ }
}
