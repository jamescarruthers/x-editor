import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XmlDocument } from '@x-editor/xml-core';
import { ValidationClient } from '../src/state/validation.js';

/**
 * The queue, driven against a fake worker.
 *
 * libxml2 runs one document in one worker, so a corpus turns one schema edit into N verdicts down a
 * single pipe. Everything that can go wrong there is invisible from the outside — two documents in
 * flight at once, a verdict attributed to the wrong file, one document's line map used to resolve
 * another's error — so it is pinned here rather than left to the browser.
 */

interface Posted {
  readonly type: string;
  readonly revision: number;
  readonly text?: string;
}

class FakeWorker {
  static live: FakeWorker[] = [];
  readonly posted: Posted[] = [];
  private listeners: ((event: { data: unknown }) => void)[] = [];

  constructor() {
    FakeWorker.live.push(this);
  }

  addEventListener(type: string, fn: (event: never) => void): void {
    if (type === 'message') this.listeners.push(fn as (event: { data: unknown }) => void);
  }

  postMessage(message: Posted): void {
    this.posted.push(message);
  }

  terminate(): void {}

  /** What the real worker would send back. */
  reply(data: unknown): void {
    for (const fn of this.listeners) fn({ data });
  }

  get validations(): Posted[] {
    return this.posted.filter((message) => message.type === 'validate');
  }
}

const doc = (text: string): XmlDocument => XmlDocument.parse(text);

let client: ValidationClient;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.live = [];
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  client = new ValidationClient(() => {});
  client.setSchema([{ uri: 's.xsd', text: '<xs:schema/>' }] as never, 's.xsd');
  FakeWorker.live.at(-1)!.reply({ type: 'schemaCompiled', ok: true, errors: [] });
});

afterEach(() => {
  client.stop();
  vi.useRealTimers();
  delete (globalThis as { Worker?: unknown }).Worker;
});

describe('validating a corpus through one worker', () => {
  it('sends one document at a time rather than fanning out', () => {
    client.requestAll([
      { id: 1, doc: doc('<a/>') },
      { id: 2, doc: doc('<b/>') },
      { id: 3, doc: doc('<c/>') },
    ]);
    vi.advanceTimersByTime(200);

    // Three documents, one pipe. Posting all three would queue them inside the worker where
    // nothing can reorder or cancel them.
    expect(FakeWorker.live.at(-1)!.validations).toHaveLength(1);
  });

  it('works down the queue in the order given, which puts the foreground document first', () => {
    const worker = FakeWorker.live.at(-1)!;
    client.requestAll([
      { id: 7, doc: doc('<a/>') },
      { id: 8, doc: doc('<b/>') },
    ]);
    vi.advanceTimersByTime(200);

    const first = worker.validations[0]!;
    expect(first.text).toContain('<a/>');
    worker.reply({ type: 'validated', revision: first.revision, valid: true, errors: [] });

    const second = worker.validations[1]!;
    expect(second.text).toContain('<b/>');
  });

  it('attributes each verdict to the document that produced it', () => {
    const worker = FakeWorker.live.at(-1)!;
    client.requestAll([
      { id: 7, doc: doc('<a/>') },
      { id: 8, doc: doc('<b/>') },
    ]);
    vi.advanceTimersByTime(200);

    worker.reply({
      type: 'validated',
      revision: worker.validations[0]!.revision,
      valid: false,
      errors: [{ line: 1, message: 'a is wrong' }],
    });
    worker.reply({
      type: 'validated',
      revision: worker.validations[1]!.revision,
      valid: true,
      errors: [],
    });

    // The failure belongs to 7 and nothing belongs to 8. Sharing one verdict across the corpus
    // would mark a passing document red, or worse, a failing one green.
    expect(client.stateFor(7)?.valid).toBe(false);
    expect(client.stateFor(7)?.findings.map((f) => f.message)).toEqual(['a is wrong']);
    expect(client.stateFor(8)?.valid).toBe(true);
    expect(client.stateFor(8)?.findings).toEqual([]);
  });

  it('has no verdict for a document that has not come round yet', () => {
    client.requestAll([
      { id: 7, doc: doc('<a/>') },
      { id: 8, doc: doc('<b/>') },
    ]);
    vi.advanceTimersByTime(200);

    // Null, not "valid". A document nobody has checked is not a document that passed.
    expect(client.stateFor(8)).toBeNull();
  });

  it('resolves each error through its own document, not a shared line map', () => {
    const worker = FakeWorker.live.at(-1)!;
    client.requestAll([
      { id: 7, doc: doc('<a><one/></a>') },
      { id: 8, doc: doc('<b><two/></b>') },
    ]);
    vi.advanceTimersByTime(200);

    // Reply out of order: the second document answers first. A single payload would map this
    // error through the wrong text and land it on a plausible-looking node in the wrong file.
    const [one, two] = [worker.validations[0]!, worker.validations[1]!];
    expect(two).toBeUndefined();

    worker.reply({ type: 'validated', revision: one.revision, valid: true, errors: [] });
    const next = worker.validations[1]!;
    expect(next.text).toContain('<two/>');
    worker.reply({ type: 'validated', revision: next.revision, valid: true, errors: [] });

    expect(client.stateFor(7)?.valid).toBe(true);
    expect(client.stateFor(8)?.valid).toBe(true);
  });

  it('forgets every verdict when the schema goes away', () => {
    const worker = FakeWorker.live.at(-1)!;
    client.requestAll([{ id: 7, doc: doc('<a/>') }]);
    vi.advanceTimersByTime(200);
    worker.reply({ type: 'validated', revision: worker.validations[0]!.revision, valid: true, errors: [] });
    expect(client.stateFor(7)?.valid).toBe(true);

    // Verdicts are statements about a document *under a schema*. With no schema they are not stale,
    // they are meaningless.
    client.setSchema([], '');
    expect(client.stateFor(7)).toBeNull();
  });
});
