// Filter engine lifecycle: load lists, build the matchers, answer queries.

import { parseList } from '../core/parser.js';
import { NetworkFilterSet } from '../core/matcher.js';
import { CosmeticFilterSet } from '../core/cosmetic.js';
import { api, readPackagedText } from '../shared/browser.js';
import { CUSTOM_FILTERS_KEY } from '../shared/storage-keys.js';
import { hostnameOf } from '../core/domains.js';

export const BUNDLED_LISTS = [
  'filters/core.txt',
  'filters/popups.txt',
  'filters/sites/kayoanime.txt',
  'filters/sites/aniwave.txt',
];

const COSMETIC_CACHE_LIMIT = 256;

export class Engine {
  constructor() {
    this.network = new NetworkFilterSet();
    this.cosmetic = new CosmeticFilterSet();
    this.stats = { network: 0, cosmetic: 0, errors: [] };
    this.cache = new Map();
  }

  /**
   * @param {string[]} [paths] packaged lists to read
   * @param {string|null} [extraText] custom rules; `null` reads them from storage,
   *   which is what a cold start needs -- otherwise the user's own filters would
   *   quietly vanish every time the service worker was recycled.
   */
  async load(paths = BUNDLED_LISTS, extraText = null) {
    const networkRules = [];
    const cosmeticRules = [];
    const controls = [];
    const errors = [];

    const sources = await Promise.all(paths.map(async (path) => {
      try { return await readPackagedText(path); }
      catch (err) { errors.push({ path, reason: err.message }); return ''; }
    }));
    const custom = extraText === null ? await readCustomFilters() : extraText;
    if (custom) sources.push(custom);

    for (const text of sources) {
      const parsed = parseList(text);
      for (const rule of parsed.network) {
        if (rule.cosmeticControl) controls.push(rule);
        else networkRules.push(rule);
      }
      cosmeticRules.push(...parsed.cosmetic);
      errors.push(...parsed.errors);
    }

    this.network = new NetworkFilterSet(networkRules);
    this.cosmetic = new CosmeticFilterSet(cosmeticRules, controls);
    this.stats = { network: networkRules.length, cosmetic: cosmeticRules.length, errors };
    this.cache.clear();
    return this.stats;
  }

  /** Cosmetic bundle for a hostname, memoised — most tabs revisit the same host. */
  cosmeticFor(hostname) {
    let entry = this.cache.get(hostname);
    if (entry === undefined) {
      entry = this.cosmetic.selectFor(hostname);
      if (this.cache.size >= COSMETIC_CACHE_LIMIT) {
        this.cache.delete(this.cache.keys().next().value);
      }
      this.cache.set(hostname, entry);
    }
    return entry;
  }

  match({ url, documentUrl, type }) {
    return this.network.match({
      url,
      hostname: hostnameOf(url),
      documentHostname: hostnameOf(documentUrl || url),
      type,
    });
  }
}

async function readCustomFilters() {
  try {
    const stored = await api.storage.local.get(CUSTOM_FILTERS_KEY);
    return stored[CUSTOM_FILTERS_KEY] ?? '';
  } catch { return ''; }
}

export const engine = new Engine();
