import { useMemo } from 'react';
import { store, useEditor } from '../state/store.js';
import { documentProblems } from '../model/problems.js';

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
 * Problems: well-formedness, schema compilation, and what the guidance engine can see.
 *
 * The three sources stay labelled rather than merged. libxml2 is the authoritative verdict and
 * arrives in Phase 4; when it and the guidance engine eventually disagree, the differential harness
 * has to be able to say which one was wrong, and one undifferentiated list would hide that.
 */
export function ProblemsPanel(): React.JSX.Element {
  useEditor();
  const problems = store.problems;
  const schemaProblems = store.schemaProblems;

  const documentIssues = useMemo(
    () =>
      store.schema.model === null ? [] : documentProblems(store.schema.model, store.document),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getSnapshot()],
  );

  const total = problems.length + schemaProblems.length + documentIssues.length;

  if (total === 0) {
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
          {store.schema.model === null
            ? 'No problems. This document is well-formed.'
            : 'No problems. This document is well-formed and matches the schema.'}
        </span>
      </div>
    );
  }

  return (
    <ul className="scroll-thin h-full overflow-auto py-1">
      {problems.map((problem, i) => (
        <ProblemRow
          key={`wf-${i}`}
          severity="error"
          message={problem.message}
          detail={`character ${problem.offset} · ${problem.code}`}
        />
      ))}

      {schemaProblems.map((problem, i) => (
        <ProblemRow
          key={`schema-${i}`}
          severity={problem.severity}
          message={problem.message}
          detail={`in the schema · ${problem.origin.documentUri} · ${problem.code}`}
        />
      ))}

      {documentIssues.map((problem, i) => (
        <ProblemRow
          key={`doc-${i}`}
          severity={problem.severity}
          message={problem.message}
          detail={`${problem.path} · ${problem.code}`}
          onClick={() => store.select(problem.nodeId)}
        />
      ))}
    </ul>
  );
}

function ProblemRow({
  severity,
  message,
  detail,
  onClick,
}: {
  severity: 'error' | 'warning';
  message: string;
  detail: string;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={onClick === undefined}
        className="flex w-full items-start gap-2 px-3 py-1 text-left disabled:cursor-default"
      >
        {/* Shape as well as colour: a red dot on its own is invisible to a good fraction of users. */}
        <span
          className="mt-0.5 shrink-0 text-[11px]"
          style={{ color: severity === 'error' ? 'var(--error)' : 'var(--text-tertiary)' }}
          aria-hidden
        >
          {severity === 'error' ? '\u2715' : '!'}
        </span>
        <div className="min-w-0">
          <div style={{ color: 'var(--text-primary)' }}>{message}</div>
          <div className="truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {detail}
          </div>
        </div>
      </button>
    </li>
  );
}
