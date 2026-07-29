import { useMemo, useState } from 'react';
import { store, useEditor } from '../state/store.js';
import { documentProblems } from '../model/problems.js';
import { applyFix } from '../model/fixes.js';
import type { Diagnostic } from '@x-editor/xsd';
import { explainDocument } from '../model/explain.js';
import { inferSchema, type InferenceResult } from '../model/infer.js';

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

/**
 * "Explain my document", and the offer to infer a schema when there is none.
 *
 * These sit together because they answer the same situation from two directions: a file has arrived
 * and the person holding it does not know what it is. The explanation tells them; the inference
 * gives them something the rest of the tool can work from.
 */
export function ExplainPanel(): React.JSX.Element {
  useEditor();
  const document = store.document;
  const model = store.schema.model;

  const explanation = useMemo(
    () => explainDocument(document, model),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getSnapshot(), model],
  );
  const [inferred, setInferred] = useState<InferenceResult | null>(null);

  return (
    <div className="scroll-thin h-full overflow-y-auto px-3 py-2.5">
      <p className="mb-3 text-[13px]" style={{ color: 'var(--text-primary)' }}>
        {explanation.summary}
      </p>

      {model === null && (
        <div
          className="mb-3 rounded border px-2 py-2"
          style={{ borderColor: 'var(--border-default)', background: 'var(--surface-2)' }}
        >
          {inferred === null ? (
            <>
              <div className="mb-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                No schema attached. One can be worked out from this document — a starting point
                rather than an answer, but enough for the palette and the form view to work.
              </div>
              <button
                type="button"
                onClick={() => setInferred(inferSchema(document))}
                className="rounded border px-2 py-1 text-[12px]"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                Work out a schema from this document
              </button>
            </>
          ) : (
            <>
              <div className="mb-1 text-[12px] font-medium">
                A schema that fits this document
              </div>
              <ul className="mb-2 flex flex-col gap-1">
                {inferred.caveats.map((caveat) => (
                  <li key={caveat} className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {caveat}
                  </li>
                ))}
              </ul>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => store.attachSchema('inferred.xsd', inferred.source)}
                  className="rounded border px-2 py-1 text-[12px]"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                >
                  Attach it
                </button>
                <button
                  type="button"
                  onClick={() => store.load(inferred.source, 'inferred.xsd')}
                  className="rounded border px-2 py-1 text-[12px]"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                >
                  Open it to edit
                </button>
              </div>
              <pre
                className="scroll-thin mt-2 max-h-64 overflow-auto font-mono text-[11px] whitespace-pre"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {inferred.source}
              </pre>
            </>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {explanation.steps.map((step, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => store.select(step.node)}
              className="text-left"
            >
              <span className="text-[12px] font-medium">{step.title}</span>
              {!step.fromSchema && (
                // Users must always be able to tell a rule from a guess.
                <span
                  className="ml-1.5 rounded px-1 text-[10px]"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
                  title="Read from your document, not from a schema"
                >
                  auto
                </span>
              )}
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {step.text}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
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

  const verdict = store.verdict.state;
  const total =
    problems.length + schemaProblems.length + documentIssues.length + verdict.findings.length;

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
      {verdict.findings.length > 0 && (
        <li
          className="px-3 py-1 text-[11px] font-semibold tracking-wide uppercase"
          style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
        >
          From libxml2{verdict.stale && ' (checking…)'}
        </li>
      )}
      {verdict.findings.map((finding, i) => (
        <ProblemRow
          key={`engine-${i}`}
          severity="error"
          message={finding.message}
          detail={`line ${finding.line} of the validation copy`}
          onClick={() => store.select(finding.node)}
          dim={verdict.stale}
        />
      ))}

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

      {documentIssues.map((diagnostic, i) => (
        <DiagnosticRow key={`doc-${i}`} diagnostic={diagnostic} />
      ))}
    </ul>
  );
}

/**
 * A schema diagnostic, with its fixes.
 *
 * The fix buttons sit on the row rather than behind a menu: the whole point is that the beginner
 * does not have to work out what to do, and a fix hidden one click away is a fix most people never
 * find. The spec-ese goes behind "details", where it is available and not in the way.
 */
function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }): React.JSX.Element {
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <li className="border-b px-3 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
      <button
        type="button"
        onClick={() => store.select(diagnostic.node)}
        className="flex w-full items-start gap-2 text-left"
      >
        <span
          className="mt-0.5 shrink-0 text-[11px]"
          style={{ color: diagnostic.severity === 'error' ? 'var(--error)' : 'var(--text-tertiary)' }}
          aria-hidden
        >
          {diagnostic.severity === 'error' ? '\u2715' : '!'}
        </span>
        <span className="min-w-0" style={{ color: 'var(--text-primary)' }}>
          {diagnostic.message}
        </span>
      </button>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-5">
        {diagnostic.fixes.map((fix) => (
          <button
            key={fix.title}
            type="button"
            onClick={() => applyFix(fix.edit)}
            title={fix.preview === undefined ? undefined : `Result: ${fix.preview}`}
            className="rounded border px-1.5 py-0.5 text-[11px]"
            style={{
              borderColor: 'var(--border-default)',
              background: 'var(--surface-0)',
              color: 'var(--text-secondary)',
            }}
          >
            {fix.title}
            {fix.speculative === true && (
              // A fix that guesses at intent must say so. Quietly inventing data is the one way
              // this feature could leave the user worse off than no fix at all.
              <span className="ml-1" style={{ color: 'var(--text-tertiary)' }} title="A guess — check the result">
                ?
              </span>
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setShowTechnical((v) => !v)}
          className="text-[11px] hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
          aria-expanded={showTechnical}
        >
          {showTechnical ? 'hide details' : 'details'}
        </button>
      </div>

      {showTechnical && (
        <div className="mt-1 pl-5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          <div className="font-mono">{diagnostic.technical}</div>
          <div>{diagnostic.path}</div>
        </div>
      )}
    </li>
  );
}

function ProblemRow({
  severity,
  message,
  detail,
  onClick,
  dim,
}: {
  severity: 'error' | 'warning';
  message: string;
  detail: string;
  onClick?: () => void;
  dim?: boolean;
}): React.JSX.Element {
  return (
    <li style={dim === true ? { opacity: 0.55 } : undefined}>
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
