import { useEffect, useMemo, useRef, useState } from 'react';
import {
  insertionPlan,
  requiredMissing,
  serializeSkeleton,
  skeletonFor,
  type CandidateGroup,
  type ElementContext,
  type PlannedInsert,
  type SchemaModel,
} from '@x-editor/xsd';
import { store, useEditor } from '../state/store.js';
import { insertPlanned, insertAllRequired } from '../model/insert.js';

/**
 * The Insert palette.
 *
 * The most important screen in the product, and the one that answers the beginner's actual
 * question — *what am I allowed to put here?* — rather than the expert's "is this valid?".
 *
 * Three things about it are deliberate:
 *
 * - **Groups are in a fixed order and never rearrange.** Required-missing, suggested, optional,
 *   repeat. A palette that reorders by relevance means the beginner has to re-read it every time.
 * - **No caret to place first.** Each row already knows the index its content model expects, so a
 *   missing `<orderId>` inserts *before* the `<line>` that is already there without the user having
 *   to work that out. Placing a caret is an expert's mental model.
 * - **Search matches documentation, not just names.** Typing "price" finds an element named `amt`
 *   documented as "unit price", which is the single most common way schema vocabulary defeats
 *   someone who knows their own domain perfectly well.
 */
export function InsertPalette({
  context,
  model,
  onClose,
  onAnnounce,
}: {
  context: ElementContext;
  model: SchemaModel;
  onClose: () => void;
  onAnnounce: (message: string) => void;
}): React.JSX.Element {
  useEditor();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => insertionPlan(model, context), [model, context]);
  const missing = useMemo(() => requiredMissing(model, context), [model, context]);

  const filtered = useMemo(() => filterCandidates(all, query), [all, query]);
  const groups = useMemo(() => groupInOrder(filtered), [filtered]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => setActive(0), [query]);

  const selected = flat[Math.min(active, flat.length - 1)];

  const commit = (candidate: PlannedInsert): void => {
    insertPlanned(context, candidate);
    onAnnounce(`Added ${candidate.name.localName}.`);
    onClose();
  };

  const addAllRequired = (): void => {
    const count = insertAllRequired(model, context);
    onAnnounce(`Added ${count} missing ${count === 1 ? 'element' : 'elements'}.`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ background: 'rgb(0 0 0 / 0.35)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[70vh] w-[640px] flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{ borderColor: 'var(--border-default)', background: 'var(--surface-1)' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={`Insert inside ${context.name.localName}`}
      >
        <div className="border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mb-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Insert inside <span className="font-mono">{context.name.localName}</span>
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or description…"
            aria-label="Search insertable elements"
            aria-activedescendant={selected === undefined ? undefined : rowId(selected)}
            aria-controls="insert-palette-list"
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--text-primary)' }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, flat.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && selected !== undefined) {
                event.preventDefault();
                commit(selected);
              }
            }}
          />
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            ref={listRef}
            id="insert-palette-list"
            className="scroll-thin min-w-0 flex-1 overflow-y-auto"
            role="listbox"
            aria-label="Elements that may be added here"
          >
            {flat.length === 0 && (
              <p className="p-3 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                {all.length === 0
                  ? 'Nothing may be added inside this element.'
                  : 'No match. Clear the search to see everything allowed here.'}
              </p>
            )}

            {groups.map((group) => (
              <div key={group.group}>
                <div
                  className="sticky top-0 flex items-center gap-2 px-3 py-1 text-[11px] font-semibold tracking-wide uppercase"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
                >
                  <span>{GROUP_LABEL[group.group]}</span>
                  <span className="tnum">({group.items.length})</span>
                  {group.group === 'required-missing' && missing.length > 0 && query === '' && (
                    <button
                      type="button"
                      onClick={addAllRequired}
                      className="ml-auto rounded border px-1.5 py-0.5 text-[11px] normal-case"
                      style={{
                        borderColor: 'var(--border-default)',
                        background: 'var(--surface-0)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Add all {missing.length} required
                    </button>
                  )}
                </div>

                {group.items.map((candidate) => {
                  const index = flat.indexOf(candidate);
                  const isActive = index === Math.min(active, flat.length - 1);
                  return (
                    <div
                      key={rowId(candidate)}
                      id={rowId(candidate)}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={-1}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => commit(candidate)}
                      className="cursor-pointer px-3 py-1.5"
                      style={{ background: isActive ? 'var(--surface-selected)' : 'transparent' }}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[13px]">{candidate.name.localName}</span>
                        <span
                          className="tnum rounded px-1 text-[10px]"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
                          title="How many are present, and how many are allowed"
                        >
                          {candidate.cardinality}
                        </span>
                        {candidate.viaWildcard && (
                          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            via wildcard
                          </span>
                        )}
                      </div>
                      <div
                        className="truncate text-[11px]"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {plain(candidate.description.text)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* The preview removes the leap of faith: the user sees the exact XML before committing. */}
          <div
            className="scroll-thin w-[240px] shrink-0 overflow-auto border-l p-2"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}
            aria-label="Preview"
          >
            {selected === undefined ? (
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                Nothing selected.
              </p>
            ) : (
              <>
                <div className="mb-1 text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
                  Will insert
                </div>
                <pre className="font-mono text-[11px] whitespace-pre" style={{ color: 'var(--text-secondary)' }}>
                  {previewOf(model, selected)}
                </pre>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {plain(selected.description.text)}
                </p>
                {!selected.description.authored && (
                  <span
                    className="mt-1 inline-block rounded px-1 text-[10px]"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
                    title="Worked out from the schema, not written by its author"
                  >
                    auto
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<CandidateGroup, string> = {
  'required-missing': 'Required — missing',
  suggested: 'Suggested next',
  optional: 'Optional',
  repeat: 'Repeat this',
};

const GROUP_ORDER: CandidateGroup[] = ['required-missing', 'suggested', 'optional', 'repeat'];

function groupInOrder(
  candidates: readonly PlannedInsert[],
): { group: CandidateGroup; items: PlannedInsert[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: candidates.filter((candidate) => candidate.group === group),
  })).filter((group) => group.items.length > 0);
}

/**
 * Subsequence matching over the name *and* the description.
 *
 * Not a ranked fuzzy search: the candidate list for one position is short, and a stable order the
 * user can learn beats a relevance score that shuffles as they type.
 */
function filterCandidates(candidates: readonly PlannedInsert[], query: string): PlannedInsert[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...candidates];

  return candidates.filter((candidate) => {
    const name = candidate.name.localName.toLowerCase();
    if (name.includes(needle) || isSubsequence(needle, name)) return true;
    return candidate.description.text.toLowerCase().includes(needle);
  });
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index++;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function previewOf(model: SchemaModel, candidate: PlannedInsert): string {
  if (candidate.declaration === null) return `<${candidate.name.localName}/>`;
  return serializeSkeleton(skeletonFor(model, candidate.declaration, { maxDepth: 3 }));
}

/** Descriptions use `*emphasis*`; the palette rows are too small for rich text. */
function plain(text: string): string {
  return text.replace(/\*/g, '');
}

function rowId(candidate: PlannedInsert): string {
  return `insert-${candidate.name.namespaceUri ?? ''}-${candidate.name.localName}`;
}

/** Convenience wrapper so the app can render the palette without repeating the null checks. */
export function InsertPaletteHost({
  open,
  onClose,
  onAnnounce,
}: {
  open: boolean;
  onClose: () => void;
  onAnnounce: (message: string) => void;
}): React.JSX.Element | null {
  useEditor();
  if (!open) return null;

  const model = store.schema.model;
  if (model === null) return null;

  const context = store.contextFor(store.selected);
  if (context === null) return null;

  return (
    <InsertPalette context={context} model={model} onClose={onClose} onAnnounce={onAnnounce} />
  );
}
