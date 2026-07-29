import { useRef, useState } from 'react';
import { humaniseName } from '@x-editor/xsd';
import type { NodeId } from '@x-editor/xml-core';
import { store, useEditor } from '../state/store.js';
import { flowSource, inlineNames, isFlowElement, setFlow, wrapRange } from '../model/mixed.js';

/**
 * The flow editor for mixed content.
 *
 * A paragraph is one thing, not five nodes, and this is where it is edited as one thing. The source
 * is shown rather than a rendered surface — see `model/mixed.ts` for why that trade was taken —
 * which means the value it has to add is in the wrap buttons: selecting some words and pressing
 * *emph* is the operation a flow editor exists for, and it is the operation that is genuinely
 * painful in a tree.
 *
 * Nothing commits until it parses. Discarding a paragraph someone was midway through typing because
 * an angle bracket was unbalanced for a moment would make the editor unusable for exactly the
 * documents it is meant to serve.
 */
export function FlowEditor({ id }: { id: NodeId }): React.JSX.Element {
  useEditor();
  const document = store.document;
  const model = store.schema.model;

  const committed = flowSource(document, id);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  if (!isFlowElement(document, model, id)) return <></>;

  const value = draft ?? committed;
  const names = inlineNames(document, model, id);

  const commit = (next: string): void => {
    const result = setFlow(document, id, next);
    if (result.error !== null) {
      setError(result.error);
      setDraft(next);
      return;
    }
    setError(null);
    setDraft(null);
    if (result.command !== null) store.run(result.command);
  };

  const wrap = (localName: string): void => {
    const element = area.current;
    if (element === null) return;
    const { selectionStart, selectionEnd } = element;
    if (selectionStart === selectionEnd) return;
    const next = wrapRange(value, selectionStart, selectionEnd, localName);
    setDraft(next);
    commit(next);
  };

  return (
    <section className="border-b px-3 py-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
      <h2
        className="mb-1.5 text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Flow
      </h2>
      <p className="mb-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        This element holds text and markup together. Edit it as one piece here rather than a node at
        a time in the tree.
      </p>

      {names.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {names.slice(0, 8).map((name) => (
            <button
              key={`${name.namespaceUri ?? ''}|${name.localName}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => wrap(name.localName)}
              className="rounded border px-1.5 py-0.5 text-[11px]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              title={`Wrap the selected text in <${name.localName}>`}
            >
              {humaniseName(name.localName)}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={area}
        rows={5}
        value={value}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (draft !== null && draft !== committed) commit(draft);
        }}
        className="scroll-thin w-full resize-y rounded border px-1.5 py-1 font-mono text-[12px]"
        style={{
          borderColor: error === null ? 'var(--border-default)' : 'var(--error)',
          background: 'var(--surface-0)',
          color: 'var(--text-primary)',
        }}
        spellCheck
      />

      {error !== null ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--error)' }}>
          Not committed — {error}
        </p>
      ) : (
        draft !== null && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Unsaved. It commits when you click away.
          </p>
        )
      )}
    </section>
  );
}
