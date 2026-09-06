// Injection orchestration: scriptlet packs and cosmetic stylesheets.

import { api, insertUserCSS, readPackagedText } from '../shared/browser.js';
import { engine } from './engine.js';
import { isDisabledFor, getSettings, recordBlock } from './state.js';
import { hostnameOf } from '../core/domains.js';

const PACK_MANIFEST = 'inject/packs.json';
let mainWorldAvailable = true;
let cachedPacks = null;

export async function installInjector() {
  await registerScriptletPacks();
  api.webNavigation.onCommitted.addListener(onCommitted);
}

/**
 * Register each pack's scriptlet bundle as a `document_start` content script.
 *
 * Registration rather than per-navigation `executeScript` is what closes the
 * timing gap: the bundle is already in place when the document starts parsing,
 * so no page script can run before the patches are installed.
 */
export async function registerScriptletPacks() {
  if (cachedPacks === null) {
    try { cachedPacks = JSON.parse(await readPackagedText(PACK_MANIFEST)); }
    catch { cachedPacks = []; }
  }
  const packs = cachedPacks;

  // Always clear first: this runs again whenever the allowlist changes, and a
  // stale registration would keep injecting on a site the user just switched off.
  try {
    const existing = await api.scripting.getRegisteredContentScripts();
    if (existing.length) {
      await api.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    }
  } catch { /* nothing registered yet */ }

  const settings = getSettings();
  if (!Array.isArray(packs) || packs.length === 0 || !settings.enabled) return;

  // Registered content scripts are matched by the browser, not by us, so a
  // per-site stand-down has to be expressed as an exclusion here. Without this,
  // scriptlets would keep running on a site the user disabled.
  const standDown = settings.disabledSites.flatMap(toMatchPatterns);

  const spec = (pack, file, world) => {
    const entry = {
      id: pack.id,
      matches: pack.matches,
      js: [file],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: false,
    };
    const excludes = [...(pack.excludeMatches ?? []), ...standDown];
    if (excludes.length) entry.excludeMatches = excludes;
    if (world) entry.world = world;
    return entry;
  };

  const toRegister = packs.map((pack) => spec(pack, pack.main, 'MAIN'));

  try {
    await api.scripting.registerContentScripts(toRegister);
  } catch {
    // Older Gecko has no MAIN world for content scripts. Fall back to the
    // isolated wrapper, which appends the same code as a `<script>` element and
    // removes the node in the same tick.
    mainWorldAvailable = false;
    const fallback = packs.map((pack) => spec(pack, pack.iso, null));
    try { await api.scripting.registerContentScripts(fallback); } catch { /* give up quietly */ }
  }
}

function toMatchPatterns(site) {
  const host = String(site).replace(/^\*?\.?/, '');
  return [`http://*.${host}/*`, `https://*.${host}/*`, `http://${host}/*`, `https://${host}/*`];
}

export function usingMainWorld() {
  return mainWorldAvailable;
}

async function onCommitted(details) {
  const hostname = hostnameOf(details.url);
  if (!hostname || isDisabledFor(hostname)) return;

  const bundle = engine.cosmeticFor(hostname);
  if (!bundle.css) return;

  await insertUserCSS({ tabId: details.tabId, frameId: details.frameId, css: bundle.css });
}

/** Answer a content script asking what to run on its frame. */
export function cosmeticRequest(url) {
  const hostname = hostnameOf(url);
  if (!hostname || isDisabledFor(hostname)) return { disabled: true, procedural: [] };
  const bundle = engine.cosmeticFor(hostname);
  return {
    disabled: false,
    procedural: bundle.procedural.map((r) => ({ raw: r.raw, selector: r.selector })),
  };
}

/** Inject the structural-path stylesheet a content script computed for us. */
export async function cosmeticHide(sender, css, count) {
  if (!sender?.tab) return;
  await insertUserCSS({ tabId: sender.tab.id, frameId: sender.frameId, css });
  recordBlock(sender.tab.id, { url: sender.url ?? '', action: 'hide', rule: `${count} element(s)` });
}
