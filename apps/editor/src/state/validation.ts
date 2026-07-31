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

  /**
   * True once this worker has said `ready`, which is when it can be posted to at all.
   *
   * The worker module top-level-awaits its WASM instantiation (`libxml2-wasm` does this on
   * import), and a module worker's message port is enabled at that first await — before the
   * worker's own `message` listener exists. A message posted in that window is not queued; it is
   * dispatched to nobody and silently lost. That is exactly where a `compileSchema` posted right
   * after `new Worker(...)` lands on a slow start, after which every validation answers with the
   * engine's "No schema has been compiled." So nothing is posted until the handshake completes.
   */
  private ready = false;

  /**
   * Everything queued behind the document currently in flight, foreground first.
   *
   * A corpus turns one schema edit into N verdicts, and libxml2 runs one document in one worker.
   * The queue is what keeps that from becoming N worker round-trips fired at once: documents are
   * validated one at a time against the schema *already compiled* into the running worker, so a
   * schema change costs one recompile plus N validations rather than N recompiles.
   */
  private queue: { id: number; doc: XmlDocument }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The serialized copy per in-flight revision, not one global.
   *
   * `nodeForLine` maps libxml2's line numbers back through the exact text that produced them. With
   * several documents in flight a single payload would map one document's error onto another
   * document's nodes — silently, and to a plausible-looking node.
   */
  private payloads = new Map<number, ValidationPayload>();
  private revisionFile = new Map<number, number>();
  private sources: readonly SchemaSource[] = [];
  private rootUri = '';

  state: VerdictState = IDLE;

  /**
   * The document the current verdict describes.
   *
   * libxml2 runs one document in one worker, so with a corpus open a verdict is about exactly one
   * file and attributing it to any other would be a confident lie. Until the queue lands (PLAN.md
   * §6.2), findings are shown only against the document they actually ran against.
   */
  documentId: number | null = null;

  /**
   * The verdict per document, which is what the file counts read.
   *
   * `state` remains the single most-recent verdict plus the worker's own status — compiling,
   * failed, unavailable — because those are properties of the schema and the worker rather than of
   * any one document, and the header shows them once.
   */
  readonly states = new Map<number, VerdictState>();

  constructor(private readonly onChange: () => void) {}

  /** Point the worker at a schema. Compiling is what makes the first validation fast. */
  setSchema(sources: readonly SchemaSource[], rootUri: string): void {
    this.sources = sources;
    this.rootUri = rootUri;

    if (sources.length === 0) {
      this.stop();
      this.states.clear();
      this.state = IDLE;
      this.onChange();
      return;
    }

    this.restart();
  }

  /** Ask for a verdict on the current document, debounced. */
  request(document: XmlDocument, documentId: number | null = null): void {
    this.requestAll([{ id: documentId ?? 0, doc: document }]);
  }

  /**
   * Ask for a verdict on every open instance document, debounced.
   *
   * Caller order is honoured and matters: the document being looked at goes first, because a verdict
   * someone is waiting for should not queue behind nine they are not.
   */
  requestAll(documents: readonly { id: number; doc: XmlDocument }[]): void {
    if (this.sources.length === 0 || this.worker === null) return;

    // Existing findings become stale the instant any document changes, so the UI can dim them rather
    // than continue asserting something about a document that no longer exists.
    for (const [id, state] of this.states) {
      if (state.findings.length > 0 || state.valid !== null) {
        this.states.set(id, { ...state, stale: true });
      }
    }
    if (this.state.findings.length > 0 || this.state.valid !== null) {
      this.state = { ...this.state, stale: true };
    }
    this.onChange();

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.queue = [...documents];
      this.pump();
    }, DEBOUNCE_MS);
  }

  /** Sends the next queued document, if the worker is free and has finished starting. */
  private pump(): void {
    if (!this.ready) return;
    if (this.inFlight !== 0) return;
    // The debounce timer can fire after a compile failure and refill the queue, so the "no verdict
    // against a schema that did not compile" decision is enforced here, where sending happens,
    // rather than only where the failure arrives. The next successful compile resets the status.
    if (this.state.status === 'failed') {
      this.queue = [];
      return;
    }
    const next = this.queue.shift();
    if (next === undefined) return;
    this.send(next.doc, next.id);
  }

  private send(document: XmlDocument, documentId: number): void {
    const worker = this.worker;
    if (worker === null) return;

    const payload = serializeForValidation(document);
    this.revision++;
    this.payloads.set(this.revision, payload);
    this.revisionFile.set(this.revision, documentId);
    this.documentId = documentId;
    this.inFlight = this.revision;
    this.state = { ...this.state, status: 'validating' };
    this.onChange();

    this.post(worker, { type: 'validate', revision: this.revision, text: payload.text });
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
    this.ready = false;
    this.inFlight = 0;
    // A respawned worker shares no revisions with the old one, so every pending mapping is void.
    this.queue = [];
    this.payloads.clear();
    this.revisionFile.clear();
  }

  /** The verdict for one document, or null when it has not been checked against this schema. */
  stateFor(id: number): VerdictState | null {
    return this.states.get(id) ?? null;
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
    // The schema is posted from the `ready` handshake, not here: until the worker says so, its
    // message listener may not exist yet and anything posted vanishes.
  }

  private post(worker: Worker, request: WorkerRequest): void {
    worker.postMessage(request);
  }

  private receive(response: WorkerResponse): void {
    switch (response.type) {
      case 'ready': {
        const worker = this.worker;
        if (worker === null) return;
        this.ready = true;
        this.post(worker, {
          type: 'compileSchema',
          revision: this.revision,
          sources: this.sources,
          rootUri: this.rootUri,
        });
        // Anything requested while the worker was starting has been waiting in the queue.
        this.pump();
        return;
      }

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
        // No verdict is possible against a schema that did not compile: each queued document would
        // come back as the engine's generic "No schema has been compiled.", which is both a wasted
        // round-trip and a worse message than the compile error already on screen.
        if (!response.ok) this.queue = [];
        this.onChange();
        return;

      case 'validated': {
        // A result for a revision the user has already edited past is not wrong, only late; it is
        // shown dimmed until the current one arrives.
        // Stale only against its own document: with a corpus in flight, revision N+1 belonging to
        // another file does not make this file's verdict late.
        const fileId = this.revisionFile.get(response.revision) ?? null;
        const payload = this.payloads.get(response.revision) ?? null;
        this.payloads.delete(response.revision);
        this.revisionFile.delete(response.revision);

        const superseded = [...this.revisionFile.entries()].some(
          ([revision, id]) => id === fileId && revision > response.revision,
        );
        const stale = superseded;
        if (this.inFlight === response.revision) this.inFlight = 0;

        // A validate can already be in the worker's mailbox when its schema fails to compile, and
        // the answer it produces is the engine's "No schema has been compiled." — which must not
        // replace the compile error, on the header or on the file. Old findings stay, dimmed.
        if (this.state.status === 'failed') {
          this.pump();
          return;
        }

        const verdict: VerdictState = {
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

        if (fileId !== null) this.states.set(fileId, verdict);
        this.state = verdict;
        this.documentId = fileId;
        this.onChange();

        // Straight on to the next document, against the schema already compiled into this worker.
        this.pump();
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
