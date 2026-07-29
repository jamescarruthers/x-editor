import { serializeForValidation, nodeForLine, type ValidationPayload } from '@x-editor/xsd';
import type { NodeId, XmlDocument } from '@x-editor/xml-core';
import type {
  SchemaSource,
  WorkerRequest,
  WorkerResponse,
} from '@x-editor/validation-protocol';

/**
 * The authoritative verdict, from libxml2 in a worker.
 *
 * Distinct from the guidance engine's own diagnostics on purpose. The guidance engine runs in a
 * keystroke and drives the palette; this is the second opinion, and when the two disagree that is a
 * finding rather than a nuisance — it is the drift PLAN.md §11 calls the top project risk, showing
 * up in front of a real user instead of only in CI.
 *
 * Three things here are load-bearing:
 *
 * - **Revision tagging.** Every request carries one; a result for a superseded revision is kept but
 *   marked stale rather than shown as truth.
 * - **Stale results dim rather than clear.** Clearing makes the UI flicker through "no problems"
 *   mid-edit, which reads as "you fixed it" at the moment nothing has been checked.
 * - **Cancellation is terminate-and-respawn.** A long validation cannot be interrupted any other
 *   way, and the schema is recompiled into the fresh worker.
 */

export interface EngineFinding {
  readonly node: NodeId;
  readonly message: string;
  readonly line: number;
}

export interface VerdictState {
  readonly status:
    | 'no-schema'
    | 'unavailable'
    | 'compiling'
    | 'validating'
    | 'ready'
    | 'failed';
  readonly valid: boolean | null;
  readonly findings: readonly EngineFinding[];
  /** True when these findings describe a document the user has since edited. */
  readonly stale: boolean;
  readonly message: string | null;
}

const IDLE: VerdictState = {
  status: 'no-schema',
  valid: null,
  findings: [],
  stale: false,
  message: null,
};

/** Long enough that typing does not queue a validation per keystroke; short enough to feel live. */
const DEBOUNCE_MS = 150;

export class ValidationClient {
  private worker: Worker | null = null;
  private revision = 0;
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private payload: ValidationPayload | null = null;
  private sources: readonly SchemaSource[] = [];
  private rootUri = '';

  state: VerdictState = IDLE;

  constructor(private readonly onChange: () => void) {}

  /** Point the worker at a schema. Compiling is what makes the first validation fast. */
  setSchema(sources: readonly SchemaSource[], rootUri: string): void {
    this.sources = sources;
    this.rootUri = rootUri;

    if (sources.length === 0) {
      this.stop();
      this.state = IDLE;
      this.onChange();
      return;
    }

    this.restart();
  }

  /** Ask for a verdict on the current document, debounced. */
  request(document: XmlDocument): void {
    if (this.sources.length === 0 || this.worker === null) return;

    // Existing findings become stale the instant the document changes, so the UI can dim them
    // rather than continue asserting something about a document that no longer exists.
    if (this.state.findings.length > 0 || this.state.valid !== null) {
      this.state = { ...this.state, stale: true };
      this.onChange();
    }

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.send(document);
    }, DEBOUNCE_MS);
  }

  private send(document: XmlDocument): void {
    const worker = this.worker;
    if (worker === null) return;

    this.payload = serializeForValidation(document);
    this.revision++;
    this.inFlight = this.revision;
    this.state = { ...this.state, status: 'validating' };
    this.onChange();

    this.post(worker, { type: 'validate', revision: this.revision, text: this.payload.text });
  }

  /**
   * Abandon whatever the worker is doing.
   *
   * There is no other way to interrupt a WASM call, which is exactly why the protocol is
   * hand-rolled: a transparent proxy would hide the worker's lifecycle, and the lifecycle is the
   * only cancellation mechanism available.
   */
  cancel(): void {
    if (this.inFlight === 0) return;
    this.restart();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = 0;
  }

  private restart(): void {
    this.stop();

    // No worker available — a non-browser host, or a browser that refused to spawn one. The
    // guidance engine is unaffected, so the editor stays fully usable; it simply has no second
    // opinion, and says so rather than showing a verdict it does not have.
    if (typeof Worker === 'undefined') {
      this.state = {
        status: 'unavailable',
        valid: null,
        findings: [],
        stale: false,
        message: 'Background validation is not available here.',
      };
      this.onChange();
      return;
    }

    this.revision++;
    this.state = { status: 'compiling', valid: null, findings: [], stale: false, message: null };
    this.onChange();

    const worker = new Worker(new URL('../worker/validation.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) =>
      this.receive(event.data),
    );
    worker.addEventListener('error', (event) => {
      this.state = {
        status: 'failed',
        valid: null,
        findings: [],
        stale: false,
        message: event.message,
      };
      this.onChange();
    });
    this.worker = worker;

    this.post(worker, {
      type: 'compileSchema',
      revision: this.revision,
      sources: this.sources,
      rootUri: this.rootUri,
    });
  }

  private post(worker: Worker, request: WorkerRequest): void {
    worker.postMessage(request);
  }

  private receive(response: WorkerResponse): void {
    switch (response.type) {
      case 'ready':
        return;

      case 'schemaCompiled':
        this.state = response.ok
          ? { status: 'ready', valid: null, findings: [], stale: false, message: null }
          : {
              status: 'failed',
              valid: null,
              findings: [],
              stale: false,
              message: response.errors[0]?.message ?? 'The schema could not be compiled.',
            };
        this.onChange();
        return;

      case 'validated': {
        // A result for a revision the user has already edited past is not wrong, only late; it is
        // shown dimmed until the current one arrives.
        const stale = response.revision !== this.revision;
        if (!stale) this.inFlight = 0;

        const payload = this.payload;
        this.state = {
          status: 'ready',
          valid: response.valid,
          stale,
          message: null,
          findings: response.errors.map((error) => ({
            // The line map is why this is a lookup rather than a search: we chose the coordinates
            // libxml2 reports, so mapping them back is exact.
            node: payload === null ? (0 as NodeId) : (nodeForLine(payload, error.line) ?? (0 as NodeId)),
            message: error.message,
            line: error.line,
          })),
        };
        this.onChange();
        return;
      }

      case 'failed':
        this.state = {
          status: 'failed',
          valid: null,
          findings: [],
          stale: false,
          message: response.message,
        };
        this.onChange();
        return;
    }
  }
}
