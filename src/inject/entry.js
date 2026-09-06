// MAIN-world entry point.
//
// The build emits one copy of this bundle per pack, with `__UMBRA_PACK__`
// replaced by that pack's scriptlet list. Baking the list in at build time is
// what lets the pack run as a `document_start` content script: there is no
// message round-trip, so no window where page script runs before we do.

import { SCRIPTLETS } from './scriptlets/index.js';

// eslint-disable-next-line no-undef -- substituted by build.mjs
const PACK = __UMBRA_PACK__;

for (const invocation of PACK) {
  const [name, ...args] = invocation;
  const scriptlet = SCRIPTLETS[name];
  if (typeof scriptlet !== 'function') continue;
  try { scriptlet(...args); } catch { /* a failed scriptlet must never surface */ }
}
