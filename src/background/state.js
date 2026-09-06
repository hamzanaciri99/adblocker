// Persistent settings and per-tab counters.

import { api } from '../shared/browser.js';
import { hostMatchesPattern } from '../core/domains.js';
import { SETTINGS_KEY as STORAGE_KEY } from '../shared/storage-keys.js';

const defaults = {
  enabled: true,
  disabledSites: [],      // hostnames where Umbra stands down entirely
  showBadge: true,
  blockPopups: true,
};

let settings = { ...defaults };
const counters = new Map();   // tabId -> { count, entries: [] }

export async function loadSettings() {
  try {
    const stored = await api.storage.local.get(STORAGE_KEY);
    settings = { ...defaults, ...(stored[STORAGE_KEY] ?? {}) };
  } catch { settings = { ...defaults }; }
  return settings;
}

export function getSettings() {
  return settings;
}

export async function updateSettings(patch) {
  settings = { ...settings, ...patch };
  await api.storage.local.set({ [STORAGE_KEY]: settings });
  return settings;
}

export function isDisabledFor(hostname) {
  if (!settings.enabled) return true;
  if (!hostname) return false;
  return settings.disabledSites.some((site) => hostMatchesPattern(hostname, site));
}

export async function toggleSite(hostname, disabled) {
  const set = new Set(settings.disabledSites);
  if (disabled) set.add(hostname); else set.delete(hostname);
  return updateSettings({ disabledSites: [...set] });
}

// --- counters ---------------------------------------------------------------

const MAX_LOG_ENTRIES = 200;

export function recordBlock(tabId, entry) {
  if (tabId === undefined || tabId < 0) return;
  let state = counters.get(tabId);
  if (!state) counters.set(tabId, (state = { count: 0, entries: [] }));
  state.count++;
  state.entries.push(entry);
  if (state.entries.length > MAX_LOG_ENTRIES) state.entries.shift();
  if (settings.showBadge) updateBadge(tabId, state.count);
}

export function getCounter(tabId) {
  return counters.get(tabId) ?? { count: 0, entries: [] };
}

export function resetCounter(tabId) {
  counters.delete(tabId);
  if (settings.showBadge) updateBadge(tabId, 0);
}

function updateBadge(tabId, count) {
  const action = api.action ?? api.browserAction;
  if (!action?.setBadgeText) return;
  action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' }).catch?.(() => {});
  action.setBadgeBackgroundColor?.({ tabId, color: '#2b2b33' });
}

export function watchTabs() {
  api.tabs.onRemoved.addListener((tabId) => counters.delete(tabId));
}
