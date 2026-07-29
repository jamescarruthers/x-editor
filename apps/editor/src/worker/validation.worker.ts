/// <reference lib="webworker" />

import { Libxml2Engine } from '@x-editor/xsd-libxml2';
import type { WorkerRequest, WorkerResponse } from '@x-editor/validation-protocol';

/**
 * The validation worker.
 *
 * Everything expensive lives here: the WASM module, the compiled schema, and the validation itself.
 * The main thread keeps the document and the line map, and never blocks on any of it.
 *
 * The worker holds no node ids. It is handed text and hands back line numbers, and the mapping in
 * both directions is the main thread's job — which is what lets the whole engine be swapped for
 * `xmlschema` under Pyodide in Phase 4b without anything on this side of the boundary changing.
 */

const engine = new Libxml2Engine();

const post = (response: WorkerResponse): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
};

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'compileSchema': {
        const result = engine.compile(request.sources, request.rootUri);
        post({
          type: 'schemaCompiled',
          revision: request.revision,
          ok: result.valid,
          errors: result.errors,
        });
        break;
      }

      case 'validate': {
        const result = engine.validate(request.text);
        post({
          type: 'validated',
          revision: request.revision,
          valid: result.valid,
          errors: result.errors,
        });
        break;
      }
    }
  } catch (error) {
    // A worker that dies silently looks exactly like a worker that is still thinking, and the UI
    // would wait for a result that is never coming.
    post({
      type: 'failed',
      revision: request.revision,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

post({ type: 'ready' });
