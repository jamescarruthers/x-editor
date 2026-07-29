import { store, useEditor, FILE_KINDS, FILE_LABELS, type FileKind } from '../state/store.js';
import { countsByFile, workspaceProblems } from '../model/workspaceProblems.js';

/**
 * The three files, with what is wrong in each.
 *
 * The count on the chip is the whole reason this is a tab strip rather than a file menu. The point
 * of holding the instance, its schema and its rules together is that a change in one shows up in
 * another, and a tab you have to click to find that out is a tab you do not click. A red 2 on the
 * XSD chip while you are editing the XML is the feature.
 *
 * An empty slot shows as an offer to create one, because "make a schema for this" is a thing people
 * want at the moment they notice there isn't one — which is while looking at the document, not in a
 * file menu somewhere.
 */
export function FileTabs(): React.JSX.Element {
  useEditor();
  const counts = countsByFile(workspaceProblems());

  return (
    <div className="flex items-center gap-1">
      {FILE_KINDS.map((kind) =>
        store.has(kind) ? (
          <FileChip key={kind} kind={kind} counts={counts[kind]} />
        ) : (
          <button
            key={kind}
            type="button"
            onClick={() => store.newFile(kind)}
            className="rounded border border-dashed px-1.5 py-0.5 text-[11px]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-tertiary)' }}
            title={`Start a ${FILE_LABELS[kind]} file from a template`}
          >
            + {FILE_LABELS[kind]}
          </button>
        ),
      )}
    </div>
  );
}

function FileChip({
  kind,
  counts,
}: {
  kind: FileKind;
  counts: { errors: number; warnings: number };
}): React.JSX.Element {
  const active = store.active === kind;
  const name = store.nameFor(kind) ?? '';

  return (
    <span
      className="flex items-center rounded border"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border-default)',
        background: active ? 'var(--accent-soft)' : 'var(--surface-0)',
      }}
    >
      <button
        type="button"
        onClick={() => store.activate(kind)}
        className="px-1.5 py-0.5 text-[11px]"
        style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
        title={name}
        aria-current={active ? 'true' : undefined}
      >
        {FILE_LABELS[kind]}
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
      <button
        type="button"
        onClick={() => store.closeFile(kind)}
        className="pr-1 text-[11px]"
        style={{ color: 'var(--text-tertiary)' }}
        title={`Close ${name}`}
        aria-label={`Close ${name}`}
      >
        ×
      </button>
    </span>
  );
}
