import { useMemo } from 'react';
import { store, useEditor } from '../state/store.js';

/** The serialized document, live. Proof the splice serializer is preserving what it should. */
export function SourcePanel(): React.JSX.Element {
  useEditor();
  const text = useMemo(() => store.document.serialize(), [store.getSnapshot()]);

  return (
    <pre
      className="scroll-thin h-full overflow-auto px-3 py-2 font-mono text-[12px] leading-[18px] whitespace-pre"
      style={{ background: 'var(--surface-0)', color: 'var(--text-secondary)' }}
    >
      {text}
    </pre>
  );
}

export function HistoryPanel(): React.JSX.Element {
  useEditor();
  const history = store.document.history;

  if (history.length === 0) {
    return (
      <p className="p-3" style={{ color: 'var(--text-tertiary)' }}>
        No changes yet. Every edit appears here with a description you can click to jump back to.
      </p>
    );
  }

  return (
    <ol className="scroll-thin h-full overflow-auto py-1">
      {[...history].reverse().map((command, i) => (
        <li
          key={`${command.label}-${history.length - i}`}
          className="flex items-center gap-2 px-3 py-1"
          style={{ color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: i === 0 ? 'var(--accent)' : 'var(--border-strong)' }}
          />
          <span className="truncate">{command.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Problems.
 *
 * Only well-formedness for now — XSD and Schematron findings land in the same list once those
 * engines exist, which is why the row shape is already severity + message + jump-to-node rather
 * than something parser-specific.
 */
export function ProblemsPanel(): React.JSX.Element {
  useEditor();
  const problems = store.problems;

  if (problems.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ color: 'var(--ok)' }} aria-hidden>
          <path
            d="M2.5 7.5 L5.5 10.5 L11.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span style={{ color: 'var(--text-secondary)' }}>
          No problems. This document is well-formed.
        </span>
      </div>
    );
  }

  return (
    <ul className="scroll-thin h-full overflow-auto py-1">
      {problems.map((problem, i) => (
        <li key={i} className="flex items-start gap-2 px-3 py-1">
          <span
            className="mt-1 size-2 shrink-0 rounded-full"
            style={{ background: 'var(--error)' }}
            aria-hidden
          />
          <div className="min-w-0">
            <div style={{ color: 'var(--text-primary)' }}>{problem.message}</div>
            <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              character {problem.offset} · {problem.code}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
