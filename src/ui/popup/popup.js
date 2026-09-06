import { api } from '../../shared/browser.js';

const el = (id) => document.getElementById(id);

let currentTab = null;
let status = null;

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  status = await api.runtime.sendMessage({
    type: 'ui:status',
    url: tab?.url ?? '',
    tabId: tab?.id,
  });
  if (!status) return;

  render();
  wire();
}

function render() {
  el('host').textContent = status.hostname || 'this page';
  el('count').textContent = status.counter.count;
  el('master').checked = status.enabled;
  el('siteDisabled').checked = status.siteDisabled;
  el('blockPopups').checked = status.blockPopups;
  el('stats').textContent = `${status.stats.network} network · ${status.stats.cosmetic} cosmetic rules`;

  const list = el('entries');
  list.replaceChildren();

  const entries = status.counter.entries.slice(-25).reverse();
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing blocked here yet.';
    list.append(li);
    return;
  }

  for (const entry of entries) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = entry.action;
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = shorten(entry.url);
    url.title = `${entry.url}\n${entry.rule}`;
    li.append(tag, url);
    list.append(li);
  }
}

function shorten(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch { return url; }
}

function wire() {
  el('master').addEventListener('change', async (e) => {
    await api.runtime.sendMessage({ type: 'ui:setSettings', patch: { enabled: e.target.checked } });
    reload();
  });

  el('siteDisabled').addEventListener('change', async (e) => {
    await api.runtime.sendMessage({
      type: 'ui:toggleSite',
      hostname: status.hostname,
      disabled: e.target.checked,
    });
    reload();
  });

  el('blockPopups').addEventListener('change', async (e) => {
    await api.runtime.sendMessage({ type: 'ui:setSettings', patch: { blockPopups: e.target.checked } });
  });

  el('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    api.runtime.openOptionsPage();
  });
}

/** Settings changes only take effect on the next load, so offer that directly. */
function reload() {
  if (currentTab?.id !== undefined) api.tabs.reload(currentTab.id);
  window.close();
}

init();
