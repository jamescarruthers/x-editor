import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A bundle budget, failing the build on regression.
 *
 * PLAN.md §11 risk 4 names the failure mode precisely: "a stray top-level import pulling a
 * validator into the main chunk". It is a one-line mistake, it costs every user the download, and
 * nothing about the app looks different afterwards — so it has to be caught mechanically or it will
 * not be caught at all. It has already happened once: adding XSD 1.1 assertions statically imported
 * fontoxpath and put 330KB into the entry chunk.
 *
 * The size limit is the blunt instrument. The chunk-separation checks below are the specific ones,
 * and they are what actually encode the design: the validator and the XPath engine are optional
 * capabilities, fetched when a document needs them.
 */

const DIST = new URL('../apps/editor/dist/assets/', import.meta.url).pathname;

/** Comfortably above today's figure, far below what an accidental static import would produce. */
const ENTRY_GZIP_BUDGET = 170 * 1024;

const files = readdirSync(DIST).filter((name) => name.endsWith('.js'));

const entry = files.find((name) => name.startsWith('index-'));
if (entry === undefined) {
  console.error('No entry chunk found. Did the build run?');
  process.exit(1);
}

const gzipOf = (name) => gzipSync(readFileSync(join(DIST, name))).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

let failed = false;
const fail = (message) => {
  console.error(`✗ ${message}`);
  failed = true;
};

const entrySize = gzipOf(entry);
if (entrySize > ENTRY_GZIP_BUDGET) {
  fail(
    `The entry chunk is ${kb(entrySize)} gzipped, over the ${kb(ENTRY_GZIP_BUDGET)} budget.\n` +
      '  Most likely something now imports a validator or the XPath engine at the top level.\n' +
      '  Both are meant to be loaded on demand — see PLAN.md §11 risk 4.',
  );
} else {
  console.log(`✓ entry chunk ${kb(entrySize)} gzipped (budget ${kb(ENTRY_GZIP_BUDGET)})`);
}

const expectSeparate = (label, matches) => {
  if (files.some(matches)) console.log(`✓ ${label} is its own chunk`);
  else fail(`${label} is not a separate chunk — it has been folded into the main bundle.`);
};

expectSeparate('the XPath engine', (name) => name.includes('fontoxpath'));
expectSeparate('the validation worker', (name) => name.includes('validation.worker'));

// Offline is part of the security story rather than a nicety: the premise is that documents never
// leave the browser, and a validator that stops working on a train contradicts that. The generated
// worker lists dist by hand, so the failure mode is that a build-step change silently drops it.
const serviceWorker = new URL('../apps/editor/dist/sw.js', import.meta.url).pathname;
if (!existsSync(serviceWorker)) {
  fail('dist/sw.js is missing — the service worker was not generated, so the app is not offline-capable.');
} else {
  const cached = readFileSync(serviceWorker, 'utf8');
  const missing = files.filter((name) => !cached.includes(name));
  if (missing.length > 0) {
    fail(`the service worker does not cache ${missing.join(', ')} — those chunks would fail offline.`);
  } else {
    console.log(`✓ the service worker caches all ${files.length} JS chunks`);
  }
}

process.exit(failed ? 1 : 0);
