// Procedural cosmetic filtering.
//
// These are the rules CSS cannot express — "hide the card that contains the word
// Sponsored", "hide two levels up from this link". They run in the isolated
// world on a debounced MutationObserver.
//
// Matched elements are hidden by generating a *structural path* selector and
// handing it to the background for user-origin injection, rather than by
// setting an inline style. A page that reads `el.getAttribute('style')` on its
// own nodes — several anti-adblock scripts do — sees nothing (D12).

const OPERATORS = [
  'has-text', 'matches-css', 'matches-css-before', 'matches-css-after',
  'matches-attr', 'matches-path', 'upward', 'remove', 'remove-attr',
  'remove-class', 'min-text-length', 'xpath', 'others',
];

/** Split `div.x:has-text(ad):upward(2)` into a base selector and an op chain. */
export function parseProcedural(selector) {
  const ops = [];
  let base = '';
  let i = 0;

  while (i < selector.length) {
    if (selector[i] !== ':') { base += selector[i++]; continue; }

    const name = OPERATORS.find((op) => selector.startsWith(`:${op}(`, i));
    if (!name) { base += selector[i++]; continue; }

    const open = i + name.length + 2;
    const close = matchParen(selector, open - 1);
    if (close === -1) { base += selector[i++]; continue; }

    ops.push({ name, arg: selector.slice(open, close) });
    i = close + 1;
  }

  return { base: base.trim() || '*', ops };
}

function matchParen(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function toTester(arg) {
  const re = /^\/(.+)\/([gimsuy]*)$/.exec(arg);
  if (re) {
    try { const rx = new RegExp(re[1], re[2].replace('g', '')); return (v) => rx.test(v); }
    catch { /* fall through */ }
  }
  return (v) => String(v).includes(arg);
}

/** Run one operator over the current candidate set. */
function applyOperator(elements, op) {
  switch (op.name) {
    case 'has-text': {
      const test = toTester(op.arg);
      return elements.filter((el) => test(el.textContent || ''));
    }
    case 'min-text-length': {
      const min = Number(op.arg) || 0;
      return elements.filter((el) => (el.textContent || '').trim().length >= min);
    }
    case 'matches-css':
    case 'matches-css-before':
    case 'matches-css-after': {
      const pseudo = op.name === 'matches-css' ? null : `::${op.name.slice('matches-css-'.length)}`;
      const colon = op.arg.indexOf(':');
      if (colon === -1) return [];
      const prop = op.arg.slice(0, colon).trim();
      const test = toTester(op.arg.slice(colon + 1).trim());
      return elements.filter((el) => {
        try { return test(getComputedStyle(el, pseudo).getPropertyValue(prop)); }
        catch { return false; }
      });
    }
    case 'matches-attr': {
      const eq = op.arg.indexOf('=');
      const name = (eq === -1 ? op.arg : op.arg.slice(0, eq)).trim();
      const test = eq === -1 ? () => true : toTester(op.arg.slice(eq + 1).trim());
      return elements.filter((el) => el.hasAttribute(name) && test(el.getAttribute(name)));
    }
    case 'matches-path': {
      const test = toTester(op.arg);
      return test(location.pathname + location.search) ? elements : [];
    }
    case 'upward': {
      const steps = Number(op.arg);
      const out = new Set();
      for (const el of elements) {
        let node = el;
        if (Number.isFinite(steps)) {
          for (let n = 0; n < steps && node; n++) node = node.parentElement;
        } else {
          node = el.closest(op.arg);
        }
        if (node && node !== document.documentElement) out.add(node);
      }
      return [...out];
    }
    case 'xpath': {
      const out = new Set();
      for (const el of elements) {
        try {
          const result = document.evaluate(op.arg, el, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let n = 0; n < result.snapshotLength; n++) {
            const node = result.snapshotItem(n);
            if (node && node.nodeType === 1) out.add(node);
          }
        } catch { /* bad expression in a list; skip it */ }
      }
      return [...out];
    }
    default:
      return elements;
  }
}

/**
 * Evaluate one procedural rule.
 * @returns {{hide: Element[], acted: boolean}}
 */
export function evaluate(rule, root = document) {
  const { base, ops } = rule.parsed;
  let elements;
  try { elements = [...root.querySelectorAll(base)]; }
  catch { return { hide: [], acted: false }; }

  for (const op of ops) {
    if (elements.length === 0) break;
    // Terminal actions consume the set rather than filtering it.
    if (op.name === 'remove') { for (const el of elements) el.remove(); return { hide: [], acted: true }; }
    if (op.name === 'remove-attr') {
      const attrs = op.arg.split('|').filter(Boolean);
      for (const el of elements) for (const a of attrs) el.removeAttribute(a);
      return { hide: [], acted: true };
    }
    if (op.name === 'remove-class') {
      const classes = op.arg.split('|').filter(Boolean);
      for (const el of elements) el.classList.remove(...classes);
      return { hide: [], acted: true };
    }
    elements = applyOperator(elements, op);
  }

  return { hide: elements, acted: elements.length > 0 };
}

const CSS_IDENT = /^[a-zA-Z_-][\w-]*$/;

/**
 * A selector that uniquely addresses `el` without touching it.
 *
 * Prefers a stable id when the page provides one, otherwise walks up building
 * `:nth-child()` steps. Returns null for detached nodes.
 */
export function structuralPath(el) {
  if (!el || el.nodeType !== 1) return null;
  const steps = [];
  let node = el;

  while (node && node.nodeType === 1 && node !== document.documentElement) {
    const parent = node.parentElement;
    if (!parent) return null;

    if (node.id && CSS_IDENT.test(node.id)) {
      steps.unshift(`#${CSS.escape(node.id)}`);
      return steps.join(' > ');
    }

    const index = [...parent.children].indexOf(node) + 1;
    steps.unshift(`${node.localName}:nth-child(${index})`);
    node = parent;
  }

  return steps.length ? `html > ${steps.join(' > ')}` : null;
}
