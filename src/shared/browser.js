// Thin cross-browser adapter.
//
// `__TARGET__` is substituted at build time, so each bundle contains only the
// branch it needs and neither browser pays for the other's quirks.

/* global __TARGET__ */
export const TARGET = __TARGET__;
export const IS_FIREFOX = TARGET === 'firefox';
export const IS_CHROME = TARGET === 'chrome';

export const api = IS_FIREFOX ? globalThis.browser : globalThis.chrome;

/**
 * Inject a stylesheet at *user* origin.
 *
 * User origin matters for two reasons: `!important` there outranks anything the
 * page's own author-origin CSS can declare, and injected sheets never appear in
 * `document.styleSheets`, so a page walking the CSSOM for hiding rules finds
 * nothing (D8).
 */
export async function insertUserCSS({ tabId, frameId, css }) {
  if (!css) return;
  const target = { tabId };
  if (frameId !== undefined) target.frameIds = [frameId];
  try {
    await api.scripting.insertCSS({ target, css, origin: 'USER' });
  } catch { /* frame died mid-navigation */ }
}

export async function removeUserCSS({ tabId, frameId, css }) {
  if (!css) return;
  const target = { tabId };
  if (frameId !== undefined) target.frameIds = [frameId];
  try {
    await api.scripting.removeCSS({ target, css, origin: 'USER' });
  } catch { /* nothing to undo */ }
}

export function getURL(path) {
  return api.runtime.getURL(path);
}

export async function readPackagedText(path) {
  const response = await fetch(getURL(path));
  if (!response.ok) throw new Error(`cannot read ${path}: ${response.status}`);
  return response.text();
}

/** MAIN-world content scripts are how scriptlets reach the page's realm. */
export function supportsMainWorld() {
  return Boolean(api.scripting?.ExecutionWorld?.MAIN ?? api.scripting?.registerContentScripts);
}
