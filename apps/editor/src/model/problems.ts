/**
 * The guidance engine's verdict, re-exported.
 *
 * The walk itself lives in `@x-editor/xsd` — it belongs beside the engine that produces it, and the
 * differential harness has to be able to run it without pulling in the editor.
 */
export { validateDocument as documentProblems } from '@x-editor/xsd';
export type { Diagnostic } from '@x-editor/xsd';
