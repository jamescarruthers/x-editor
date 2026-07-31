import {
  store,
  useEditor,
  FILE_KINDS,
  FILE_LABELS,
  type FileId,
  type FileKind,
} from '../state/store.js';
import { countsByFile, countsFor, workspaceProblems, type Counts } from '../model/workspaceProblems.js';

/**
 * The open corpus, with what is wrong in each file.
 *
 * The count on each chip is the whole reason this exists. The schema and the rules are the artefact
 * under development and the instance documents are the evidence about them, so the question being
 * asked all day is *what did that edit just do?* — and the answer is only legible when a known-good
 * and a known-bad document are both on screen with their numbers moving together.
 *
 * Instance documents are listed individually; the schema and rule set are still one each, so their
 * chips address a kind. An empty slot shows as an offer to create one, because "make a schema for
 * this" is wanted at the moment you notice there isn't one — which is while looking at a document,
 * not in a file menu.
 */
export function FileTabs({ onOpenFile }: { onOpenFile?: () => void }): React.JSX.Element {
  useEditor();
  const counts = countsByFile(workspaceProblems());
  const open = store.openFiles;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {open.map((file) => (
        <FileChip
          key={file.id}
          id={file.id}
          kind={file.kind}
          name={file.name}
          counts={countsFor(counts, file.id)}
          closable={open.length > 1}
        />
      ))}

      {/* One more instance document is the common case, so it gets its own affordance. */}
      {onOpenFile !== undefined && (
        <button
          type="button"
          onClick={onOpenFile}
          className="shrink-0 rounded border border-dashed px-1.5 py-0.5 text-[11px]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-tertiary)' }}
          title="Open another file. Instance documents are added to the corpus rather than replacing it."
        >
          + Open
        </button>
      )}

      {FILE_KINDS.filter((kind) => kind !== 'xml' && !store.has(kind)).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => store.newFile(kind)}
          className="shrink-0 rounded border border-dashed px-1.5 py-0.5 text-[11px]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-tertiary)' }}
          title={`Start a ${FILE_LABELS[kind]} file from a template`}
        >
          + {FILE_LABELS[kind]}
        </button>
      ))}
    </div>
  );
}

function FileChip({
  id,
  kind,
  name,
  counts,
  closable,
}: {
  id: FileId;
  kind: FileKind;
  name: string;
  counts: Counts;
  closable: boolean;
}): React.JSX.Element {
  const active = store.activeId === id;
  // Instance documents are told apart by name; there is only ever one schema and one rule set, so
  // those read better by kind.
  const label = kind === 'xml' ? name : FILE_LABELS[kind];

  return (
    <span
      className="flex shrink-0 items-center rounded border"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border-default)',
        background: active ? 'var(--accent-soft)' : 'var(--surface-0)',
      }}
    >
      <button
        type="button"
        onClick={() => store.activate(id)}
        className="max-w-[160px] truncate px-1.5 py-0.5 text-[11px]"
        style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
        title={name}
        aria-current={active ? 'true' : undefined}
      >
        {label}
        {counts.errors > 0 && (
          // Never colour alone: the count is the signal, the colour only reinforces it.
          <span className="tnum ml-1" style={{ color: 'var(--error)' }}>
            {counts.errors}
          </span>
        )}
        {counts.errors === 0 && counts.warnings > 0 && (
          <span className="tnum ml-1" style={{ color: 'var(--warning)' }}>
            {counts.warnings}
          </span>
        )}
        {counts.errors === 0 && counts.warnings === 0 && (
          <span className="ml-1" style={{ color: 'var(--ok)' }} aria-label="no problems">
            ✓
          </span>
        )}
      </button>
      {closable && (
        <button
          type="button"
          onClick={() => store.closeFile(id)}
          className="pr-1 text-[11px]"
          style={{ color: 'var(--text-tertiary)' }}
          title={`Close ${name}`}
          aria-label={`Close ${name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
