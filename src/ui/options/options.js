import { api } from '../../shared/browser.js';
import { SETTINGS_KEY, CUSTOM_FILTERS_KEY as CUSTOM_KEY } from '../../shared/storage-keys.js';
const el = (id) => document.getElementById(id);

let settings = null;

async function init() {
  const status = await api.runtime.sendMessage({ type: 'ui:status', url: '', tabId: -1 });
  settings = {
    enabled: status.enabled,
    blockPopups: status.blockPopups,
    showBadge: true,
    disabledSites: [],
  };

  const stored = await api.storage.local.get([SETTINGS_KEY, CUSTOM_KEY]);
  Object.assign(settings, stored[SETTINGS_KEY] ?? {});
  el('custom').value = stored[CUSTOM_KEY] ?? '';

  el('enabled').checked = settings.enabled;
  el('blockPopups').checked = settings.blockPopups;
  el('showBadge').checked = settings.showBadge !== false;

  renderSites();
  renderStats(status.stats);
  wire();
}

function renderSites() {
  const list = el('sites');
  list.replaceChildren();

  if (settings.disabledSites.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'None.';
    list.append(li);
    return;
  }

  for (const site of settings.disabledSites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Resume blocking on ${site}`;
    remove.addEventListener('click', () => patch({
      disabledSites: settings.disabledSites.filter((s) => s !== site),
    }));
    li.append(name, remove);
    list.append(li);
  }
}

function renderStats(stats) {
  const dl = el('stats');
  dl.replaceChildren();
  const rows = [
    ['Network rules', stats.network],
    ['Cosmetic rules', stats.cosmetic],
    ['Unparseable lines', stats.errors.length],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    dl.append(dt, dd);
  }
}

async function patch(next) {
  settings = await api.runtime.sendMessage({ type: 'ui:setSettings', patch: next });
  renderSites();
}

function wire() {
  for (const key of ['enabled', 'blockPopups', 'showBadge']) {
    el(key).addEventListener('change', (e) => patch({ [key]: e.target.checked }));
  }

  el('addSite').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = el('siteInput').value.trim().toLowerCase();
    if (!value || settings.disabledSites.includes(value)) return;
    el('siteInput').value = '';
    patch({ disabledSites: [...settings.disabledSites, value] });
  });

  el('save').addEventListener('click', async () => {
    const customFilters = el('custom').value;
    await api.storage.local.set({ [CUSTOM_KEY]: customFilters });
    const stats = await api.runtime.sendMessage({ type: 'ui:reloadLists', customFilters });
    renderStats(stats);
    el('saveState').textContent = `Reloaded · ${stats.network} network, ${stats.cosmetic} cosmetic`;
    setTimeout(() => { el('saveState').textContent = ''; }, 4000);
  });
}

init();
