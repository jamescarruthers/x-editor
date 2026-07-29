import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { qnameToString, type NodeId } from '@x-editor/xml-core';
import { store, useEditor } from '../state/store.js';
import { missingRequiredAttributes, requiredMissing } from '@x-editor/xsd';
import { buildRows, nodeLabel, textPreview, type Row } from '../model/rows.js';
import { buildComponentRows } from '../model/componentTree.js';
import { isFlowElement } from '../model/mixed.js';

const ROW_HEIGHT = 28;

/**
 * The tree.
 *
 * Two constraints from the spec shape almost everything here. Rows are fixed-height because
 * virtualization cannot cheaply measure them, which is why the inline text preview truncates rather
 * than wraps. And focus is tracked with `aria-activedescendant` rather than DOM focus, because
 * virtualization unmounts rows — moving real focus onto a row that then scrolls out of the window
 * would throw focus back to the body.
 *
 * `role="tree"` is used rather than `treegrid`: our rows have a variable number of "cells" (the
 * attribute chips collapse into a `+n`), which breaks the grid column model, and treegrid's
 * screen-reader support is inconsistent for dynamically inserted rows.
 */
export function Tree(): React.JSX.Element {
  useEditor();
  const doc = store.document;
  const parentRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 });

  const rows = useMemo(
    () =>
      store.componentView
        ? buildComponentRows(doc, store.expanded)
        : buildRows(doc, store.expanded, (id) => isFlowElement(doc, store.schema.model, id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, store.getSnapshot()],
  );

  const index = useMemo(() => {
    const map = new Map<NodeId, number>();
    rows.forEach((row, i) => map.set(row.id, i));
    return map;
  }, [rows]);

  // Computed once per render rather than per row: the virtualizer renders about thirty rows and the
  // placeholder list can be hundreds long, so per-row scanning would be a product of the two.
  const pending = useMemo(
    () => new Set(store.pending.map((placeholder) => placeholder.node)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getSnapshot()],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const selectedIndex = index.get(store.selected) ?? -1;

  // Keep the selected row in view when selection moves from outside the tree (undo, problems panel).
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer]);

  const moveTo = useCallback(
    (i: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (row !== undefined) store.select(row.id);
    },
    [rows],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const current = rows[selectedIndex];
      const key = event.key;

      switch (key) {
        case 'ArrowDown':
          event.preventDefault();
          moveTo(selectedIndex + 1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveTo(selectedIndex - 1);
          return;
        case 'ArrowRight':
          event.preventDefault();
          if (current === undefined) return;
          // Expand, else step into the first child — the APG tree pattern.
          if (current.hasChildren && !current.expanded) store.setExpanded(current.id, true);
          else if (current.hasChildren) moveTo(selectedIndex + 1);
          return;
        case 'ArrowLeft': {
          event.preventDefault();
          if (current === undefined) return;
          if (current.hasChildren && current.expanded) {
            store.setExpanded(current.id, false);
            return;
          }
          // Collapse, else step out to the parent.
          for (let i = selectedIndex - 1; i >= 0; i--) {
            if (rows[i]!.depth < current.depth) {
              moveTo(i);
              return;
            }
          }
          return;
        }
        case 'Home':
          event.preventDefault();
          moveTo(0);
          return;
        case 'End':
          event.preventDefault();
          moveTo(rows.length - 1);
          return;
        case 'Enter':
          event.preventDefault();
          if (current !== undefined) store.toggleExpanded(current.id);
          return;
      }

      // Typeahead: printable characters jump to the next matching name, with a 500ms buffer.
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        const state = typeahead.current;
        state.buffer = now - state.at > 500 ? key : state.buffer + key;
        state.at = now;

        const needle = state.buffer.toLowerCase();
        for (let step = 1; step <= rows.length; step++) {
          const i = (selectedIndex + step) % rows.length;
          const label = rows[i]!.heading ?? nodeLabel(rows[i]!.node);
          if (label.toLowerCase().startsWith(needle)) {
            moveTo(i);
            return;
          }
        }
      }
    },
    [rows, selectedIndex, moveTo],
  );

  return (
    <div
      ref={parentRef}
      className="scroll-thin h-full overflow-auto"
      style={{ background: 'var(--surface-0)' }}
    >
      <div
        role="tree"
        aria-label="Document structure"
        aria-activedescendant={selectedIndex >= 0 ? `node-${store.selected}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative w-full outline-none"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (row === undefined) return null;
          return (
            <TreeRow
              key={row.id}
              row={row}
              selected={row.id === store.selected}
              top={item.start}
              posInSet={item.index + 1}
              setSize={rows.length}
              pending={pending}
            />
          );
        })}
      </div>
    </div>
  );
}

function TreeRow({
  row,
  selected,
  top,
  posInSet,
  setSize,
  pending,
}: {
  row: Row;
  selected: boolean;
  top: number;
  posInSet: number;
  setSize: number;
  pending: ReadonlySet<NodeId>;
}): React.JSX.Element {
  const doc = store.document;
  const node = row.node;
  const preview = node.kind === 'element' ? textPreview(doc, row.id) : null;
  const unreviewed = pending.has(row.id);

  const attributes =
    node.kind === 'element'
      ? node.attributes.filter((a) => a.name.prefix !== 'xmlns' && a.name.localName !== 'xmlns')
      : [];

  return (
    <div
      id={`node-${row.id}`}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      onMouseDown={() => store.select(row.id)}
      onClick={() => {
        // A section header collapses its group when clicked, the way section headers do everywhere.
        // Selecting one shows "Nothing selected" in the Inspector, which is honest — a heading is
        // not a node — so without this the row would be inert.
        if (row.heading !== undefined) store.toggleExpanded(row.id);
      }}
      className="absolute inset-x-0 flex cursor-default items-center gap-1.5 pr-3 select-none"
      style={{
        height: ROW_HEIGHT,
        transform: `translateY(${top}px)`,
        paddingLeft: 8 + row.depth * 16,
        background: selected ? 'var(--accent-soft)' : undefined,
        boxShadow: selected ? 'inset 2px 0 0 var(--accent)' : undefined,
      }}
    >
      {/* 24x24 hit area even at 24px rows, per WCAG 2.2 SC 2.5.8. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={(e) => {
          e.stopPropagation();
          if (row.hasChildren) store.toggleExpanded(row.id);
        }}
        className="grid size-6 shrink-0 place-items-center"
        style={{ visibility: row.hasChildren ? 'visible' : 'hidden' }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="transition-transform duration-100"
          style={{
            transform: row.expanded ? 'rotate(90deg)' : 'none',
            color: 'var(--text-tertiary)',
          }}
        >
          <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      {row.heading !== undefined ? (
        // A section header renders as itself and nothing else. It used to fall through to the node
        // branch below as well, printing `xs:schema` after every heading — the same label, once per
        // group, saying nothing about the group.
        <span
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {row.heading}
        </span>
      ) : node.kind === 'element' ? (
        <>
          <NodeGlyph kind={node.kind} />
          {node.name.prefix !== '' && (
            <span
              className="rounded px-1 font-mono text-[11px]"
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}
            >
              {node.name.prefix}
            </span>
          )}
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {row.componentLabel ?? node.name.localName}
          </span>

          {row.componentDetail !== undefined && row.componentDetail !== '' && (
            <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {row.componentDetail}
            </span>
          )}

          <SchemaBadge row={row} />

          {row.siblingCount > 1 && (
            <span
              className="tnum shrink-0 rounded px-1 text-[11px]"
              style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
            >
              {row.ordinal} of {row.siblingCount}
            </span>
          )}

          {attributes.slice(0, 2).map((a) => (
            <span
              key={qnameToString(a.name)}
              className="shrink-0 truncate rounded px-1 font-mono text-[11px]"
              style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', maxWidth: 140 }}
            >
              {qnameToString(a.name)}={a.value.length > 14 ? `${a.value.slice(0, 13)}…` : a.value}
            </span>
          ))}
          {attributes.length > 2 && (
            <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              +{attributes.length - 2}
            </span>
          )}

          {row.flow !== undefined && (
            // The whole paragraph on one row. Marked-up runs show as ⟨…⟩ rather than being stripped,
            // so it is never a surprise that half of it is tagged.
            <span className="truncate" style={{ color: 'var(--text-secondary)' }}>
              {row.flow}
            </span>
          )}

          {preview !== null && (
            // A generated value is marked wherever it appears, not only counted in the app bar.
            // "Valid but meaningless" is only visible if the meaningless part is visible.
            <span
              className="truncate italic"
              style={{ color: 'var(--text-tertiary)' }}
              title={unreviewed ? 'A value the wizard invented — F7 steps through them' : undefined}
            >
              {unreviewed && '• '}= {preview}
            </span>
          )}
        </>
      ) : (
        <>
          <NodeGlyph kind={node.kind} />
          <span
            className="truncate"
            style={{
              color: 'var(--text-tertiary)',
              fontStyle: node.kind === 'comment' ? 'italic' : undefined,
            }}
          >
            {inlineText(node)}
          </span>
        </>
      )}
    </div>
  );
}

function inlineText(node: Row['node']): string {
  switch (node.kind) {
    case 'text':
      return node.value.trim();
    case 'cdata':
      return `CDATA: ${node.value.trim()}`;
    case 'comment':
      return `<!-- ${node.value.trim()} -->`;
    case 'pi':
      return `<?${node.target} ${node.value}?>`;
    case 'xmldecl':
      return node.text;
    case 'doctype':
      return node.text.split('\n')[0]!;
    default:
      return nodeLabel(node);
  }
}

/** Lucide has no XML-semantic glyphs, so these are the custom set the spec budgets for. */
/**
 * The validity badge on a tree row.
 *
 * Computed per visible row rather than for the whole document, which is what makes it affordable at
 * the 50k-node target: the virtualizer renders about thirty rows, so about thirty content-model
 * queries happen per frame instead of fifty thousand.
 *
 * Colour is never the only signal — the badge carries a count and a title — because a red dot alone
 * is invisible to a good fraction of users.
 */
function SchemaBadge({ row }: { row: Row }): React.JSX.Element {
  if (store.schema.model === null || row.node.kind !== 'element') return <></>;

  const context = store.contextFor(row.id);
  if (context === null) return <></>;

  const model = store.schema.model;
  const missingChildren = requiredMissing(model, context).length;
  const missingAttributes = missingRequiredAttributes(store.document, context).length;
  const total = missingChildren + missingAttributes;
  if (total === 0) return <></>;

  const parts: string[] = [];
  if (missingChildren > 0) {
    parts.push(`${missingChildren} required ${missingChildren === 1 ? 'child' : 'children'}`);
  }
  if (missingAttributes > 0) {
    parts.push(`${missingAttributes} required ${missingAttributes === 1 ? 'attribute' : 'attributes'}`);
  }

  return (
    <span
      className="tnum shrink-0 rounded px-1 text-[11px]"
      style={{ background: 'var(--error-soft)', color: 'var(--error)' }}
      title={`Missing ${parts.join(' and ')}`}
    >
      {total} missing
    </span>
  );
}

function NodeGlyph({ kind }: { kind: Row['node']['kind'] }): React.JSX.Element {
  const colour =
    kind === 'element'
      ? 'var(--accent)'
      : kind === 'comment'
        ? 'var(--text-tertiary)'
        : kind === 'text' || kind === 'cdata'
          ? 'var(--ok)'
          : 'var(--warning)';

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0" style={{ color: colour }} aria-hidden>
      {kind === 'element' ? (
        <path
          d="M4.5 2 L1.5 6 L4.5 10 M7.5 2 L10.5 6 L7.5 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : kind === 'text' || kind === 'cdata' ? (
        <path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      )}
    </svg>
  );
}
