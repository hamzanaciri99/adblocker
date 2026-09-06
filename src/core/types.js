// Canonical resource types, as bit flags.
//
// The names match Chrome's declarativeNetRequest / webRequest vocabulary so the
// runtime matcher and the DNR compiler can share one representation. Firefox
// emits a few extra webRequest types; `fromWebRequestType` folds them onto the
// canonical set.

export const T = Object.freeze({
  main_frame:     1 << 0,
  sub_frame:      1 << 1,
  stylesheet:     1 << 2,
  script:         1 << 3,
  image:          1 << 4,
  font:           1 << 5,
  object:         1 << 6,
  xmlhttprequest: 1 << 7,
  ping:           1 << 8,
  csp_report:     1 << 9,
  media:          1 << 10,
  websocket:      1 << 11,
  other:          1 << 12,
});

export const ALL_TYPES = Object.values(T).reduce((a, b) => a | b, 0);

/** Types a `$popup` filter implies: a document load in a new context. */
export const POPUP_TYPES = T.main_frame | T.sub_frame;

/**
 * Types an untyped filter applies to. Adblock Plus semantics: a filter with no
 * type option matches every type *except* top-level document loads, because
 * blocking those would break navigation.
 */
export const DEFAULT_TYPES = ALL_TYPES & ~T.main_frame;

const NAME_BY_FLAG = new Map(Object.entries(T).map(([k, v]) => [v, k]));

/** Expand a bitmask into the DNR/webRequest type names it covers. */
export function typeNames(mask) {
  const out = [];
  for (const [flag, name] of NAME_BY_FLAG) if (mask & flag) out.push(name);
  return out;
}

/** Adblock option keyword -> canonical flag(s). */
export const OPTION_TO_TYPE = Object.freeze({
  script:         T.script,
  image:          T.image,
  stylesheet:     T.stylesheet,
  css:            T.stylesheet,
  object:         T.object,
  'object-subrequest': T.object,
  xmlhttprequest: T.xmlhttprequest,
  xhr:            T.xmlhttprequest,
  subdocument:    T.sub_frame,
  frame:          T.sub_frame,
  document:       T.main_frame,
  doc:            T.main_frame,
  ping:           T.ping,
  beacon:         T.ping,
  websocket:      T.websocket,
  media:          T.media,
  font:           T.font,
  other:          T.other,
  'csp-report':   T.csp_report,
  image_or_media: T.image | T.media,
});

// Firefox-only webRequest types folded onto the canonical set.
const WEBREQUEST_ALIASES = Object.freeze({
  imageset:           T.image,
  beacon:             T.ping,
  object_subrequest:  T.object,
  web_manifest:       T.other,
  xml_dtd:            T.other,
  xslt:               T.other,
  speculative:        T.other,
  json:               T.xmlhttprequest,
});

/** Map a browser-supplied type string onto a canonical flag. */
export function fromWebRequestType(name) {
  return T[name] ?? WEBREQUEST_ALIASES[name] ?? T.other;
}
