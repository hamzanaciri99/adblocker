// Build pipeline.
//
//   node build.mjs --target=chrome|firefox [--watch] [--zip]
//
// Produces dist/<target>/ containing a loadable extension. The interesting
// stages are the declarativeNetRequest compile (Chrome only) and the scriptlet
// pack generation, which turns per-site `##+js(...)` rules into `document_start`
// content scripts.

import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { parseList } from './src/core/parser.js';
import { compileToDnr, ENTITY_TLDS } from './src/core/dnr-compiler.js';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const target = (args.find((a) => a.startsWith('--target=')) ?? '--target=chrome').split('=')[1];
const watch = args.includes('--watch');
const zip = args.includes('--zip');

if (target !== 'chrome' && target !== 'firefox') {
  console.error(`unknown target: ${target}`);
  process.exit(1);
}

const OUT = path.join('dist', target);

// Chrome's published declarativeNetRequest limits. The build fails rather than
// shipping a ruleset the browser would silently truncate.
const DNR_LIMITS = {
  staticRulesets: 100,
  enabledStaticRulesets: 50,
  staticRules: 30_000,
  regexRules: 1_000,
};

const FILTER_LISTS = [
  { id: 'core', path: 'assets/filters/core.txt' },
  { id: 'popups', path: 'assets/filters/popups.txt' },
  { id: 'site-kayoanime', path: 'assets/filters/sites/kayoanime.txt' },
  { id: 'site-aniwave', path: 'assets/filters/sites/aniwave.txt' },
];

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64',
);

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const lists = await loadLists();
  const report = { skipped: [], parseErrors: [], rulesets: [] };
  for (const list of lists) report.parseErrors.push(...list.parsed.errors.map((e) => ({ list: list.id, ...e })));

  const rulesetRefs = target === 'chrome' ? await compileRulesets(lists, report) : [];
  const packs = await buildScriptletPacks(lists);

  await bundleSources();
  await copyStatic();
  await writeManifest(rulesetRefs);

  printReport(report, lists, packs);

  if (zip) await packageBuild();
}

// ---------------------------------------------------------------------------

async function loadLists() {
  return Promise.all(FILTER_LISTS.map(async (entry) => ({
    ...entry,
    parsed: parseList(await readFile(entry.path, 'utf8')),
  })));
}

/** One DNR ruleset per filter list, so a site pack can be toggled on its own. */
async function compileRulesets(lists, report) {
  await mkdir(path.join(OUT, 'rules'), { recursive: true });

  const refs = [];
  let totalRules = 0;
  let totalRegex = 0;

  for (const list of lists) {
    const network = list.parsed.network.filter((r) => !r.cosmeticControl);
    const { rules, skipped, regexCount } = compileToDnr(network, { entityTlds: ENTITY_TLDS });

    report.skipped.push(...skipped.map((s) => ({ list: list.id, ...s })));
    totalRules += rules.length;
    totalRegex += regexCount;

    const file = `rules/${list.id}.json`;
    await writeFile(path.join(OUT, file), JSON.stringify(rules, null, 1));
    refs.push({ id: list.id, enabled: true, path: file });
    report.rulesets.push({ id: list.id, rules: rules.length, regex: regexCount });
  }

  assertBudget(refs, totalRules, totalRegex);
  return refs;
}

function assertBudget(refs, totalRules, totalRegex) {
  const problems = [];
  if (refs.length > DNR_LIMITS.staticRulesets) {
    problems.push(`${refs.length} rulesets exceeds the limit of ${DNR_LIMITS.staticRulesets}`);
  }
  const enabled = refs.filter((r) => r.enabled).length;
  if (enabled > DNR_LIMITS.enabledStaticRulesets) {
    problems.push(`${enabled} enabled rulesets exceeds the limit of ${DNR_LIMITS.enabledStaticRulesets}`);
  }
  if (totalRules > DNR_LIMITS.staticRules) {
    problems.push(`${totalRules} static rules exceeds the guaranteed minimum of ${DNR_LIMITS.staticRules}`);
  }
  if (totalRegex > DNR_LIMITS.regexRules) {
    problems.push(`${totalRegex} regex rules exceeds the limit of ${DNR_LIMITS.regexRules}`);
  }
  if (problems.length) {
    console.error('declarativeNetRequest budget exceeded:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

/**
 * Group scriptlet rules into packs and emit one MAIN-world bundle each.
 *
 * Baking the invocation list into the bundle is what allows registration as a
 * `document_start` content script: no message round-trip, so nothing on the page
 * runs before the patches are installed.
 */
async function buildScriptletPacks(lists) {
  const groups = new Map();

  for (const list of lists) {
    for (const rule of list.parsed.cosmetic) {
      if (rule.type !== 'scriptlet') continue;
      const key = JSON.stringify([rule.includeDomains, rule.excludeDomains]);
      let group = groups.get(key);
      if (!group) {
        groups.set(key, (group = {
          includeDomains: rule.includeDomains,
          excludeDomains: rule.excludeDomains,
          invocations: [],
        }));
      }
      group.invocations.push([rule.scriptlet.name, ...rule.scriptlet.args]);
    }
  }

  await mkdir(path.join(OUT, 'inject', 'packs'), { recursive: true });

  const manifest = [];
  let index = 0;

  for (const group of groups.values()) {
    const id = `pack-${index++}`;
    const mainFile = `inject/packs/${id}.js`;
    const isoFile = `inject/packs/${id}.iso.js`;

    const result = await build({
      entryPoints: ['src/inject/entry.js'],
      bundle: true,
      format: 'iife',
      target: 'es2022',
      write: false,
      legalComments: 'none',
      define: { __UMBRA_PACK__: JSON.stringify(group.invocations) },
    });
    const source = result.outputFiles[0].text;

    await writeFile(path.join(OUT, mainFile), source);
    await writeFile(path.join(OUT, isoFile), isolatedWrapper(source));

    const entry = {
      id,
      matches: toMatchPatterns(group.includeDomains),
      main: mainFile,
      iso: isoFile,
    };
    // Only set exclusions when there are any: an empty list must not become
    // "exclude everything", which would silently disable the pack.
    if (group.excludeDomains.length) {
      entry.excludeMatches = toMatchPatterns(group.excludeDomains);
    }
    manifest.push(entry);
  }

  await writeFile(path.join(OUT, 'inject', 'packs.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

/**
 * Fallback for engines without MAIN-world content scripts: append the code as a
 * `<script>` and remove the node in the same tick, before any observer can see
 * it (D12).
 */
function isolatedWrapper(source) {
  return `(function () {
  try {
    var s = document.createElement('script');
    s.textContent = ${JSON.stringify(source)};
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) { /* nothing we can do, and nothing the page should see */ }
})();
`;
}

/** `aniwave.*` has no match-pattern equivalent, so expand it over the TLD list. */
function toMatchPatterns(domains) {
  if (domains.length === 0) return ['http://*/*', 'https://*/*'];
  const out = [];
  for (const domain of domains) {
    const bases = domain.endsWith('.*')
      ? ENTITY_TLDS.map((tld) => `${domain.slice(0, -2)}.${tld}`)
      : [domain];
    for (const base of bases) {
      out.push(`http://*.${base}/*`, `https://*.${base}/*`);
    }
  }
  return out;
}

async function bundleSources() {
  const options = {
    entryPoints: {
      'background/index': 'src/background/index.js',
      'content/boot': 'src/content/boot.js',
      'ui/popup': 'src/ui/popup/popup.js',
      'ui/options': 'src/ui/options/options.js',
    },
    outdir: OUT,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    define: { __TARGET__: JSON.stringify(target) },
    logLevel: 'warning',
  };

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log(`watching (${target})`);
  } else {
    await build(options);
  }
}

async function copyStatic() {
  await cp('assets/filters', path.join(OUT, 'filters'), { recursive: true });
  await cp('assets/icons', path.join(OUT, 'icons'), { recursive: true });
  await cp('src/surrogates', path.join(OUT, 'surrogates'), { recursive: true });
  await writeFile(path.join(OUT, 'surrogates', '1x1.gif'), TRANSPARENT_GIF);
  for (const page of ['popup', 'options']) {
    await cp(`src/ui/${page}/${page}.html`, path.join(OUT, 'ui', `${page}.html`));
    await cp(`src/ui/${page}/${page}.css`, path.join(OUT, 'ui', `${page}.css`));
  }
}

async function writeManifest(rulesetRefs) {
  const base = JSON.parse(await readFile('manifest.base.json', 'utf8'));
  const patch = JSON.parse(await readFile(`manifest.${target}.json`, 'utf8'));
  const manifest = { ...base, ...patch };

  if (target === 'chrome' && rulesetRefs.length) {
    manifest.declarative_net_request = { rule_resources: rulesetRefs };
  }

  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function printReport(report, lists, packs) {
  const network = lists.reduce((n, l) => n + l.parsed.network.length, 0);
  const cosmetic = lists.reduce((n, l) => n + l.parsed.cosmetic.length, 0);

  console.log(`\n${target}: ${network} network rules, ${cosmetic} cosmetic rules, ${packs.length} scriptlet packs`);

  // Regex rules are the scarce DNR resource and are easy to write by accident
  // (`/foo/` is a regex in Adblock syntax), so every build reports the count.
  for (const rs of report.rulesets) {
    console.log(`  ${rs.id.padEnd(16)} ${String(rs.rules).padStart(4)} DNR rules  ${rs.regex} regex`);
  }

  if (report.parseErrors.length) {
    console.log(`\n${report.parseErrors.length} unparseable line(s):`);
    for (const e of report.parseErrors.slice(0, 20)) {
      console.log(`  ${e.list}:${e.line}  ${e.reason}  -- ${e.raw}`);
    }
  }

  if (report.skipped.length) {
    // Not a failure: these rules still work on Firefox, which runs the real
    // matcher. Listing them is how we keep track of what Chrome gives up.
    const byReason = new Map();
    for (const s of report.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    console.log(`\n${report.skipped.length} rule(s) not expressible in declarativeNetRequest (Firefox-only):`);
    for (const [reason, count] of byReason) console.log(`  ${count}x  ${reason}`);
  }

  console.log(`\nwrote ${OUT}/`);
}

async function packageBuild() {
  const { version } = JSON.parse(await readFile('manifest.base.json', 'utf8'));
  const ext = target === 'firefox' ? 'xpi' : 'zip';
  const stem = `umbra-${target}-${version}`;
  const out = path.resolve('dist', `${stem}.${ext}`);
  const staging = path.resolve('dist', stem);

  await rm(out, { force: true });
  await rm(staging, { recursive: true, force: true });

  // Stage under a named folder so the archive expands to `umbra-chrome-0.1.0/`
  // rather than scattering manifest.json and friends into whatever directory the
  // user happened to unzip in. "Load unpacked" wants a folder to point at.
  await cp(OUT, staging, { recursive: true });
  await writeFile(path.join(staging, 'INSTALL.txt'), installNotes(version));

  try {
    await execFileAsync('zip', ['-qr', out, stem], { cwd: path.resolve('dist') });
    console.log(`packaged dist/${stem}.${ext}`);
  } catch {
    console.warn('`zip` not available; skipping package step');
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function installNotes(version) {
  return `Umbra ${version} - ${target}

Chrome / Edge / Brave / any Chromium browser
--------------------------------------------
Chrome cannot install an extension straight from a .zip, and it refuses
unsigned .crx files outright, so loading the unpacked folder is the only
route outside the Web Store. It takes about twenty seconds:

  1. Unzip this archive. You should have a folder named
     umbra-${target}-${version} containing manifest.json.
     Keep it somewhere permanent - Chrome reads from this folder on every
     start, so deleting or moving it uninstalls the extension.
  2. Open  chrome://extensions
  3. Turn on "Developer mode" (top right).
  4. Click "Load unpacked" and select the folder from step 1.

Umbra's icon appears in the toolbar. Click it for the per-site switch and
a log of what was blocked on the current page.

Chrome will show a "Disable developer mode extensions" nag on some
restarts. That is Chrome's warning about unpacked extensions in general,
not about this one; dismissing it is safe and it does not disable Umbra.

Checking it works
-----------------
Open any ad-supported page, then paste tools/self-test.js from the
repository into the DevTools console. It runs the probes an anti-adblock
script would run and prints a pass/fail table.

Source and documentation
------------------------
https://github.com/hamzanaciri99/adblocker
`;
}

await main();
