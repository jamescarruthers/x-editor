import { describe, expect, it } from 'vitest';
import { Libxml2Engine } from '@x-editor/xsd-libxml2';
import { store } from '../src/state/store.js';
import { EXAMPLES } from '../src/examples/index.js';

/**
 * Every bundled example must open clean.
 *
 * These three files are the first thing a new user ever runs, and the failure this pins actually
 * shipped: the topic example's `metadata.xsd` was registered as a hidden supporting buffer keyed on
 * the example's id, `openWorkspace` detached the schema store and wiped it, and the example opened
 * to "No schema has been compiled." on every verdict. An example that opens broken teaches exactly
 * one thing — that the tool does not work.
 */

/** The files an example opens, exactly as the start screen builds them. */
const filesOf = (example: (typeof EXAMPLES)[number]) => {
  const files = [{ name: example.documentName, source: example.document }];
  if (example.schema !== null && example.schemaName !== null) {
    files.push({ name: example.schemaName, source: example.schema });
  }
  files.push(...example.supporting);
  if (example.rules !== null && example.rulesName !== null) {
    files.push({ name: example.rulesName, source: example.rules });
  }
  return files;
};

describe.each(EXAMPLES.map((example) => [example.id, example] as const))(
  'the %s example',
  (_id, example) => {
    it('compiles in the guidance engine without errors', () => {
      store.openWorkspace(filesOf(example), 'xml');
      expect(store.schemaProblems.filter((p) => p.severity === 'error')).toEqual([]);
    });

    it('compiles under libxml2 and yields a real verdict', () => {
      if (example.schema === null) return;
      const engine = new Libxml2Engine();
      try {
        const sources = [
          { uri: example.schemaName!, text: example.schema },
          ...example.supporting.map((file) => ({ uri: file.name, text: file.source })),
        ];
        const compiled = engine.compile(sources, example.schemaName!);
        expect(compiled.errors).toEqual([]);
        expect(compiled.valid).toBe(true);

        const verdict = engine.validate(example.document);
        expect(verdict.errors.map((error) => error.message)).toEqual([]);
        expect(verdict.valid).toBe(true);
      } finally {
        engine.dispose();
      }
    });
  },
);
