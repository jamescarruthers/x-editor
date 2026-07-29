import {
  insertText,
  removeNode,
  setAttribute,
  setTextValue,
  type NodeId,
} from '@x-editor/xml-core';
import { store, useEditor } from '../state/store.js';
import { tableFor, type TableColumn, type TableSpec } from '../model/table.js';
import { buildInsertCommands, compose } from '../model/insert.js';
import { WidgetInput } from './SchemaSections.js';

/**
 * Repeated siblings as a grid.
 *
 * Reading *down a column* — are all the quantities sensible, is one of these prices blank — is the
 * question a tree makes hard and a grid makes free. Twelve `<line>` elements with four children each
 * is 60 tree rows describing something obviously twelve-by-four.
 *
 * Cells address real nodes and issue the same commands as everything else, so this stays a lens.
 * A cell whose element is absent from that row shows blank and creates the element on first edit,
 * rather than being a hole the user cannot type into.
 */
export function TableView({ parentId }: { parentId: NodeId }): React.JSX.Element {
  useEditor();
  const spec = tableFor(store.document, store.schema.model, parentId);

  if (spec === null) {
    return (
      <div className="p-3 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
        Nothing here repeats enough to be a table. Select an element that holds a list.
      </div>
    );
  }

  return (
    <div className="scroll-thin h-full overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th
              className="sticky top-0 border-b px-2 py-1 text-left text-[11px] font-medium"
              style={{
                borderColor: 'var(--border-default)',
                background: 'var(--surface-2)',
                color: 'var(--text-tertiary)',
              }}
            >
              #
            </th>
            {spec.columns.map((column) => (
              <th
                key={column.key}
                className="sticky top-0 border-b px-2 py-1 text-left text-[11px] font-medium"
                style={{
                  borderColor: 'var(--border-default)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-secondary)',
                }}
              >
                {column.label}
                {column.source === 'attribute' && (
                  // Attributes stay visibly attributes. Merging them into the columns would teach a
                  // model of XML that breaks the first time someone looks at the source.
                  <span className="ml-1" style={{ color: 'var(--text-tertiary)' }}>
                    (setting)
                  </span>
                )}
              </th>
            ))}
            <th
              className="sticky top-0 border-b px-2 py-1"
              style={{ borderColor: 'var(--border-default)', background: 'var(--surface-2)' }}
            />
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, index) => (
            <tr
              key={row.node}
              style={{ background: row.node === store.selected ? 'var(--accent-soft)' : undefined }}
            >
              <td
                className="tnum border-b px-2 py-0.5"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
              >
                <button type="button" onClick={() => store.select(row.node)}>
                  {index + 1}
                </button>
              </td>
              {row.cells.map((cell, position) => (
                <td
                  key={spec.columns[position]!.key}
                  className="border-b px-1 py-0.5"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <Cell
                    column={spec.columns[position]!}
                    rowId={row.node}
                    node={cell.node}
                    value={cell.value}
                  />
                </td>
              ))}
              <td className="border-b px-1 py-0.5" style={{ borderColor: 'var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => store.run(removeNode(store.document, row.node))}
                  className="text-[11px] hover:underline"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <AddRow spec={spec} parentId={parentId} />
    </div>
  );
}

function Cell({
  column,
  rowId,
  node,
  value,
}: {
  column: TableColumn;
  rowId: NodeId;
  node: NodeId | null;
  value: string;
}): React.JSX.Element {
  const document = store.document;

  const commit = (next: string): void => {
    if (column.source === 'attribute') {
      store.run(
        setAttribute(
          document,
          rowId,
          { prefix: '', localName: column.localName, namespaceUri: column.namespaceUri },
          next,
        ),
      );
      return;
    }

    if (node === null) {
      // The element is missing from this row. Creating it on first keystroke is what makes the blank
      // cell a cell rather than a hole.
      const commands = buildInsertCommands(document, rowId, document.childrenOf(rowId).length, {
        namespaceUri: column.namespaceUri,
        localName: column.localName,
      });
      const command = compose(`Added <${column.localName}>`, commands);
      if (command !== null) store.run(command);
      return;
    }

    const text = document
      .childrenOf(node)
      .map((id) => document.node(id))
      .find((child) => child !== undefined && (child.kind === 'text' || child.kind === 'cdata'));

    store.run(
      text === undefined
        ? insertText(document, node, 0, next)
        : setTextValue(document, text.id, next),
    );
  };

  if (column.widget !== null) {
    return <WidgetInput widget={column.widget} value={value} onCommit={commit} />;
  }

  return (
    <input
      defaultValue={value}
      key={value}
      onBlur={(event) => {
        if (event.target.value !== value) commit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="w-full rounded border px-1 py-0.5 font-mono text-[12px]"
      style={{
        borderColor: 'transparent',
        background: 'transparent',
        color: node === null ? 'var(--text-tertiary)' : 'var(--text-primary)',
      }}
      onFocus={(event) => {
        event.currentTarget.style.borderColor = 'var(--border-default)';
        event.currentTarget.style.background = 'var(--surface-0)';
      }}
      onBlurCapture={(event) => {
        event.currentTarget.style.borderColor = 'transparent';
        event.currentTarget.style.background = 'transparent';
      }}
    />
  );
}

function AddRow({ spec, parentId }: { spec: TableSpec; parentId: NodeId }): React.JSX.Element {
  const document = store.document;
  const last = spec.rows[spec.rows.length - 1];
  if (last === undefined) return <></>;

  const node = document.node(last.node);
  if (node === undefined || node.kind !== 'element') return <></>;

  return (
    <button
      type="button"
      onClick={() => {
        const commands = buildInsertCommands(
          document,
          parentId,
          document.childrenOf(parentId).length,
          { namespaceUri: node.name.namespaceUri, localName: node.name.localName },
        );
        const command = compose(`Added <${spec.name}>`, commands);
        if (command !== null) store.run(command);
      }}
      className="m-2 rounded border px-2 py-1 text-[12px]"
      style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
    >
      + Add {spec.name}
    </button>
  );
}
