/**
 * libxml2 behind the `XsdEngine` interface.
 *
 * The plan pins this dependency exactly and wraps it, for a stated reason (PLAN.md §11 risk 5):
 * `libxml2-wasm` is pre-1.0 and its schema import/include support is flagged experimental. Keeping
 * it behind one small interface means replacing it — or adding `xmlschema` under Pyodide alongside
 * it for XSD 1.1 in Phase 4b — is a change to one file rather than to the app.
 *
 * **Nothing here fetches.** Schema documents arrive as buffers and are served to libxml2 through a
 * registered input provider that only answers for keys already in the catalogue. That is the whole
 * security boundary for `xs:import` and `xs:include`, and it means there is no code path from a
 * hostile `schemaLocation` to the network — the exposure PLAN.md §8 names as the most likely place a
 * convenience `fetch()` gets added later.
 */

import {
  XmlDocument,
  XmlValidateError,
  XsdValidator,
  xmlCleanupInputProvider,
  xmlRegisterInputProvider,
  type ParseOptions,
} from 'libxml2-wasm';
import type {
  EngineError,
  EngineResult,
  SchemaSource,
  XsdEngine,
} from '@x-editor/validation-protocol';

/**
 * Parser flags, asserted by test rather than assumed.
 *
 * `noNet` is the important one, and the absent ones matter as much as the present: never `noEnt`
 * (entity expansion is how a billion-laughs bomb works), never `dtdLoad`, `dtdAttr`, `xInclude` or
 * `huge`.
 */
const PARSE_OPTIONS: ParseOptions = { option: 1 << 11 /* XML_PARSE_NONET */ };

export class Libxml2Engine implements XsdEngine {
  private validator: XsdValidator | null = null;
  private schemaDoc: XmlDocument | null = null;
  private catalogue: Readonly<Record<string, string>> = {};
  private providerRegistered = false;

  compile(sources: readonly SchemaSource[], rootUri: string): EngineResult {
    this.dispose();

    this.catalogue = Object.fromEntries(sources.map((source) => [source.uri, source.text]));
    const root = this.catalogue[rootUri];
    if (root === undefined) {
      return {
        valid: false,
        errors: [{ message: `The schema document "${rootUri}" was not supplied.`, line: 0, col: 0 }],
      };
    }

    this.registerProvider();

    try {
      this.schemaDoc = XmlDocument.fromString(root, { ...PARSE_OPTIONS, url: rootUri });
      this.validator = XsdValidator.fromDoc(this.schemaDoc);
      return { valid: true, errors: [] };
    } catch (error) {
      this.dispose();
      return { valid: false, errors: errorsFrom(error) };
    }
  }

  validate(text: string): EngineResult {
    const validator = this.validator;
    if (validator === null) {
      return {
        valid: false,
        errors: [{ message: 'No schema has been compiled.', line: 0, col: 0 }],
      };
    }

    let doc: XmlDocument;
    try {
      doc = XmlDocument.fromString(text, PARSE_OPTIONS);
    } catch (error) {
      return { valid: false, errors: errorsFrom(error) };
    }

    try {
      validator.validate(doc);
      return { valid: true, errors: [] };
    } catch (error) {
      return { valid: false, errors: errorsFrom(error) };
    } finally {
      doc.dispose();
    }
  }

  dispose(): void {
    this.validator?.dispose();
    this.validator = null;
    this.schemaDoc?.dispose();
    this.schemaDoc = null;
    if (this.providerRegistered) {
      xmlCleanupInputProvider();
      this.providerRegistered = false;
    }
  }

  private registerProvider(): void {
    const encoder = new TextEncoder();
    const open = new Map<number, { bytes: Uint8Array; offset: number }>();
    let nextHandle = 1;

    xmlRegisterInputProvider({
      // The catalogue is the entire answer to "what may libxml2 read?". Anything not in it is not
      // matched, so libxml2 falls back to its own resolution — which `noNet` then refuses.
      match: (filename: string) => Object.hasOwn(this.catalogue, filename),
      open: (filename: string) => {
        const text = this.catalogue[filename];
        if (text === undefined) return undefined;
        const handle = nextHandle++;
        open.set(handle, { bytes: encoder.encode(text), offset: 0 });
        return handle;
      },
      read: (handle: number, buffer: Uint8Array) => {
        const state = open.get(handle);
        if (state === undefined) return -1;
        const count = Math.min(buffer.length, state.bytes.length - state.offset);
        buffer.set(state.bytes.subarray(state.offset, state.offset + count));
        state.offset += count;
        return count;
      },
      close: (handle: number) => open.delete(handle),
    });
    this.providerRegistered = true;
  }
}

function errorsFrom(error: unknown): EngineError[] {
  if (error instanceof XmlValidateError || hasDetails(error)) {
    return (error as { details: { message: string; line: number; col: number }[] }).details.map(
      (detail) => ({ message: detail.message.trim(), line: detail.line, col: detail.col }),
    );
  }
  return [
    {
      message: error instanceof Error ? error.message : String(error),
      line: 0,
      col: 0,
    },
  ];
}

function hasDetails(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'details' in error &&
    Array.isArray((error as { details: unknown }).details)
  );
}
