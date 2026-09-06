// Scriptlet registry.
//
// Names (and the short aliases) follow uBlock Origin so that filter rules
// written for uBO port across without translation.

import { setConstant, abortOnPropertyRead, abortOnPropertyWrite, abortCurrentScript } from './constants.js';
import { noWindowOpenIf, preventPopunder } from './popups.js';
import { preventSetTimeout, preventSetInterval, nanoSetIntervalBooster, preventAddEventListener } from './timers.js';
import { noFetchIf, noXhrIf, jsonPrune } from './network.js';
import { setCookie, setLocalStorageItem, removeAttr, removeClass } from './dom.js';

export const SCRIPTLETS = Object.freeze({
  'set-constant': setConstant,
  'set': setConstant,
  'abort-on-property-read': abortOnPropertyRead,
  'aopr': abortOnPropertyRead,
  'abort-on-property-write': abortOnPropertyWrite,
  'aopw': abortOnPropertyWrite,
  'abort-current-script': abortCurrentScript,
  'acs': abortCurrentScript,
  'no-window-open-if': noWindowOpenIf,
  'nowoif': noWindowOpenIf,
  'window.open-defuser': noWindowOpenIf,
  'prevent-popunder': preventPopunder,
  'prevent-setTimeout': preventSetTimeout,
  'no-setTimeout-if': preventSetTimeout,
  'nostif': preventSetTimeout,
  'prevent-setInterval': preventSetInterval,
  'no-setInterval-if': preventSetInterval,
  'nosiif': preventSetInterval,
  'nano-setInterval-booster': nanoSetIntervalBooster,
  'nano-sib': nanoSetIntervalBooster,
  'prevent-addEventListener': preventAddEventListener,
  'addEventListener-defuser': preventAddEventListener,
  'aeld': preventAddEventListener,
  'no-fetch-if': noFetchIf,
  'prevent-fetch': noFetchIf,
  'no-xhr-if': noXhrIf,
  'prevent-xhr': noXhrIf,
  'json-prune': jsonPrune,
  'set-cookie': setCookie,
  'set-local-storage-item': setLocalStorageItem,
  'remove-attr': removeAttr,
  'ra': removeAttr,
  'remove-class': removeClass,
  'rc': removeClass,
});

export const SCRIPTLET_NAMES = Object.keys(SCRIPTLETS);
