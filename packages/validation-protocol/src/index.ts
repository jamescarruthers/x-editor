/**
 * The worker protocol, and the interface any XSD validator has to satisfy to be the verdict.
 *
 * Hand-rolled rather than Comlink. Two things this layer must do are exactly the things a
 * transparent-proxy RPC hides: **revision tagging**, so a result computed for a document the user
 * has already edited past can be recognised and dimmed rather than shown as truth; and
 * **terminate-and-respawn cancellation**, because a validation of a 50MB document cannot be
 * interrupted any other way and a proxy gives you no handle on the worker's lifecycle.
 *
 * Types only — no imports at all — so both sides of the boundary can depend on it without either
 * dragging the other's dependencies along.
 */

/** One schema document, already fetched. The worker never resolves anything itself. */
export interface SchemaSource {
  readonly uri: string;
  readonly text: string;
}

/**
 * An error as an external validator reports it.
 *
 * `line` is the line in the *validation serialisation*, not in the user's file, and is mapped back
 * to a node through the line map the main thread kept. `col` is here for completeness and is
 * essentially always 0 for schema errors (see `docs/spikes.md`, SPIKE-1) — nothing should depend on
 * it.
 */
export interface EngineError {
  readonly message: string;
  readonly line: number;
  readonly col: number;
}

export interface EngineResult {
  readonly valid: boolean;
  readonly errors: readonly EngineError[];
}

/**
 * What the editor needs from a validator, and nothing more.
 *
 * Deliberately narrow. `libxml2-wasm` is pre-1.0 with an experimental schema-import implementation
 * (PLAN.md §11), and `xmlschema` under Pyodide arrives in Phase 4b for XSD 1.1 — both have to sit
 * behind this without the rest of the app noticing which one answered.
 */
export interface XsdEngine {
  /** Compile a schema set. Returns the schema's own errors; a failure here means no verdict. */
  compile(sources: readonly SchemaSource[], rootUri: string): EngineResult;
  /** Validate a serialised document against the compiled schema. */
  validate(text: string): EngineResult;
  dispose(): void;
}

// --- messages -----------------------------------------------------------

export type WorkerRequest =
  | {
      readonly type: 'compileSchema';
      readonly revision: number;
      readonly sources: readonly SchemaSource[];
      readonly rootUri: string;
    }
  | { readonly type: 'validate'; readonly revision: number; readonly text: string };

export type WorkerResponse =
  | { readonly type: 'ready' }
  | {
      readonly type: 'schemaCompiled';
      readonly revision: number;
      readonly ok: boolean;
      readonly errors: readonly EngineError[];
    }
  | {
      readonly type: 'validated';
      readonly revision: number;
      readonly valid: boolean;
      readonly errors: readonly EngineError[];
    }
  | { readonly type: 'failed'; readonly revision: number; readonly message: string };

/**
 * Whether a response still describes the document on screen.
 *
 * Stale results are rendered dimmed rather than cleared. Clearing them makes the UI flicker through
 * a "no problems" state mid-edit, which reads as "you fixed it" at precisely the moment nothing has
 * been checked.
 */
export function isCurrent(response: { revision: number }, current: number): boolean {
  return response.revision === current;
}
