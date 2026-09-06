// Firefox network layer.
//
// Gecko kept blocking `webRequest`, so Firefox runs the real matcher on every
// request and gets the full filter grammar — no DNR approximation, no rule
// budget, and per-request decisions that Chrome MV3 cannot express.

import { api, getURL } from '../shared/browser.js';
import { fromWebRequestType } from '../core/types.js';
import { resolveSurrogate } from '../shared/surrogates.js';
import { engine } from './engine.js';
import { isDisabledFor, recordBlock } from './state.js';
import { hostnameOf } from '../core/domains.js';

export function installFirefoxNetworkLayer() {
  api.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    ['blocking'],
  );
}

function onBeforeRequest(details) {
  // `documentUrl` is the frame that issued the request; `originUrl` is the
  // document that caused it. For third-party classification we want the former.
  const documentUrl = details.documentUrl || details.originUrl || details.url;
  const documentHostname = hostnameOf(documentUrl);

  if (isDisabledFor(documentHostname)) return undefined;

  const verdict = engine.match({
    url: details.url,
    documentUrl,
    type: fromWebRequestType(details.type),
  });
  if (!verdict) return undefined;

  switch (verdict.action) {
    case 'allow':
      return undefined;

    case 'redirect': {
      const path = resolveSurrogate(verdict.rule.redirect);
      if (!path) return undefined;
      recordBlock(details.tabId, { url: details.url, action: 'redirect', rule: verdict.rule.raw });
      return { redirectUrl: getURL(path) };
    }

    case 'removeparam': {
      const stripped = stripParams(details.url, verdict.rule.removeParams);
      if (stripped === details.url) return undefined;
      recordBlock(details.tabId, { url: details.url, action: 'removeparam', rule: verdict.rule.raw });
      return { redirectUrl: stripped };
    }

    case 'block':
    default:
      recordBlock(details.tabId, { url: details.url, action: 'block', rule: verdict.rule.raw });
      return { cancel: true };
  }
}

function stripParams(url, params) {
  try {
    const parsed = new URL(url);
    for (const param of params) parsed.searchParams.delete(param);
    return parsed.href;
  } catch { return url; }
}
