import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
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

process.exit(failed ? 1 : 0);
