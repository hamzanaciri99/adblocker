// Background entry point.

import { api, IS_FIREFOX } from '../shared/browser.js';
import { engine } from './engine.js';
import { loadSettings, getSettings, updateSettings, toggleSite, getCounter, resetCounter, watchTabs } from './state.js';
import { installInjector, cosmeticRequest, cosmeticHide, registerScriptletPacks } from './injector.js';
import { installPopupGuard } from './popups.js';
import { hostnameOf } from '../core/domains.js';

let ready = null;

function boot() {
  if (ready) return ready;
  ready = (async () => {
    await loadSettings();
    await engine.load();
    watchTabs();
    installPopupGuard();
    await installInjector();

    if (IS_FIREFOX) {
      const { installFirefoxNetworkLayer } = await import('./net-firefox.js');
      installFirefoxNetworkLayer();
    } else {
      const { installChromeNetworkLayer } = await import('./net-chrome.js');
      await installChromeNetworkLayer();
    }
  })();
  return ready;
}

boot();

api.runtime.onInstalled?.addListener(() => { boot(); });
api.runtime.onStartup?.addListener(() => { boot(); });

api.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) resetCounter(tabId);
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, () => sendResponse(null));
  return true;   // response is asynchronous
});

async function handleMessage(message, sender) {
  await boot();

  switch (message?.type) {
    case 'cosmetic:request':
      return cosmeticRequest(message.url);

    case 'cosmetic:hide':
      await cosmeticHide(sender, message.css, message.count);
      return { ok: true };

    case 'cosmetic:acted':
      return { ok: true };

    case 'ui:status': {
      const hostname = hostnameOf(message.url ?? '');
      const settings = getSettings();
      return {
        hostname,
        enabled: settings.enabled,
        blockPopups: settings.blockPopups,
        siteDisabled: settings.disabledSites.includes(hostname),
        counter: getCounter(message.tabId),
        stats: engine.stats,
      };
    }

    case 'ui:toggleSite': {
      await toggleSite(message.hostname, message.disabled);
      await resync();
      return { ok: true };
    }

    case 'ui:setSettings': {
      await updateSettings(message.patch);
      await resync();
      return getSettings();
    }

    case 'ui:reloadLists': {
      const stats = await engine.load(undefined, message.customFilters ?? null);
      await registerScriptletPacks();
      return stats;
    }

    default:
      return null;
  }
}

/**
 * Re-apply settings to the layers that cache them.
 *
 * The Firefox matcher reads settings per request so it needs nothing, but both
 * browsers register scriptlet packs with the browser, and those registrations
 * carry the allowlist as exclusions — they have to be rewritten when it changes.
 */
async function resync() {
  await registerScriptletPacks();
  if (IS_FIREFOX) return;
  const { syncAllowlist } = await import('./net-chrome.js');
  await syncAllowlist();
}
