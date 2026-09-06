// Isolated-world content script.
//
// Deliberately minimal. It owns the procedural cosmetic rules and nothing else:
// declarative CSS is injected by the background at user origin, and scriptlets
// run in the MAIN world from their own bundle. Keeping this script small keeps
// the page-observable surface small.

import { api } from '../shared/browser.js';
import { parseProcedural, evaluate, structuralPath } from './procedural.js';

const DEBOUNCE_MS = 150;
const MAX_PATHS = 500;

let rules = [];
let observer = null;
let pending = 0;
const injected = new Set();

async function start() {
  let response;
  try {
    response = await api.runtime.sendMessage({ type: 'cosmetic:request', url: location.href });
  } catch { return; }                       // background asleep or extension reloading
  if (!response || response.disabled || !response.procedural?.length) return;

  rules = response.procedural.map((r) => ({ raw: r.raw, parsed: parseProcedural(r.selector) }));

  run();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  }
  watch();
}

function watch() {
  if (observer || !document.documentElement) return;
  observer = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => { pending = 0; run(); }, DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'id', 'style'],
  });
}

function run() {
  const paths = [];
  let acted = false;

  for (const rule of rules) {
    const result = evaluate(rule);
    if (result.acted) acted = true;
    for (const el of result.hide) {
      const path = structuralPath(el);
      if (path && !injected.has(path)) paths.push(path);
      if (paths.length >= MAX_PATHS) break;
    }
  }

  if (paths.length === 0) {
    if (acted) report(0);
    return;
  }

  for (const path of paths) injected.add(path);

  // The background injects it: a content script cannot reach user origin, and a
  // `<style>` element of our own would be exactly the footprint we are avoiding.
  api.runtime.sendMessage({
    type: 'cosmetic:hide',
    css: `${paths.join(',\n')} { display: none !important; }`,
    count: paths.length,
  }).catch(() => {});
}

function report(count) {
  api.runtime.sendMessage({ type: 'cosmetic:acted', count }).catch(() => {});
}

start();
