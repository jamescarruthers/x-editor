import {
  XmlDocument as Libxml2Document,
  XmlValidateError,
  XsdValidator,
  xmlCleanupInputProvider,
  xmlRegisterInputProvider,
} from 'libxml2-wasm';

/**
 * libxml2 as a differential oracle.
 *
 * Test-only. The shipped binding lands in Phase 4 behind a worker and an `XsdEngine` interface;
 * this exists so the guidance engine can be checked against an independent implementation of XSD
 * semantics from Phase 3 onward, which is the mitigation the plan names for its top risk — the
 * palette confidently teaching a beginner something the validator then rejects.
 *
 * Two things here are the answers to spikes rather than incidental plumbing (see `docs/spikes.md`):
 *
 * - **SPIKE-1.** libxml2 reports *every* error it can reach, each with a line number, rather than
 *   throwing on the first. Columns are always 0 for schema errors, which is why the plan's
 *   error→node mapping owns the serializer and uses a line map instead of columns.
 * - **SPIKE-2.** Multi-file schema sets resolve through a registered input provider that serves
 *   buffers already in the catalogue. libxml2 never attempts a fetch, and `xs:import` and
 *   `xs:include` both work — so the experimental flag on that support is not a blocker.
 */

export interface OracleError {
  readonly message: string;
  readonly line: number;
  readonly col: number;
}

export interface OracleResult {
  readonly valid: boolean;
  readonly errors: readonly OracleError[];
}

/**
 * Serve a fixed set of schema documents to libxml2, and nothing else.
 *
 * The provider is the whole security boundary: it can only hand back buffers the caller already
 * holds, so there is no code path from a hostile `schemaLocation` to the network.
 */
function withCatalogue<T>(files: Readonly<Record<string, string>>, body: () => T): T {
  const encoder = new TextEncoder();
  const open = new Map<number, { bytes: Uint8Array; offset: number }>();
  let nextHandle = 1;

  xmlRegisterInputProvider({
    match: (filename: string) => Object.hasOwn(files, filename),
    open: (filename: string) => {
      if (!Object.hasOwn(files, filename)) return undefined;
      const handle = nextHandle++;
      open.set(handle, { bytes: encoder.encode(files[filename]!), offset: 0 });
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

  try {
    return body();
  } finally {
    xmlCleanupInputProvider();
  }
}

export function validateWithLibxml2(
  files: Readonly<Record<string, string>>,
  rootUri: string,
  instance: string,
): OracleResult {
  return withCatalogue(files, () => {
    const schemaDoc = Libxml2Document.fromString(files[rootUri]!, { url: rootUri });
    let validator: XsdValidator;
    try {
      validator = XsdValidator.fromDoc(schemaDoc);
    } catch (error) {
      schemaDoc.dispose();
      throw error;
    }

    const doc = Libxml2Document.fromString(instance);
    try {
      validator.validate(doc);
      return { valid: true, errors: [] };
    } catch (error) {
      if (error instanceof XmlValidateError) {
        return {
          valid: false,
          errors: error.details.map((detail) => ({
            message: detail.message.trim(),
            line: detail.line,
            col: detail.col,
          })),
        };
      }
      throw error;
    } finally {
      doc.dispose();
      validator.dispose();
      schemaDoc.dispose();
    }
  });
}
