import { isElement, type NodeId, type XmlDocument } from '@x-editor/xml-core';
import {
  elementContext,
  textTypeOf,
  widgetFor,
  type SchemaModel,
  type Widget,
} from '@x-editor/xsd';

/**
 * The table view for repeated siblings.
 *
 * Twelve `<line>` elements with four children each is 60 tree rows describing what is obviously a
 * table with twelve rows and four columns. Reading down a column — are all the quantities sensible?
 * is one of these prices blank? — is a question a tree makes genuinely hard and a grid makes free.
 *
 * Like the form view this is a projection, not a model: every cell addresses a real node and every
 * edit is the command the tree would have issued. Nothing here holds state.
 */

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  /** Where the value lives: a child element's text, or an attribute on the row element. */
  readonly source: 'child' | 'attribute';
  readonly localName: string;
  readonly namespaceUri: string | null;
  readonly widget: Widget | null;
}

export interface TableCell {
  /** The node holding the value: the child element, or the row element for an attribute. */
  readonly node: NodeId | null;
  readonly value: string;
}

export interface TableRow {
  readonly node: NodeId;
  readonly cells: readonly TableCell[];
}

export interface TableSpec {
  readonly name: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
}

/**
 * Build a table from the repeated children of one parent, or null when there is no table there.
 *
 * A table needs at least two rows, and columns only from children that hold a simple value. A child
 * with its own element children is not a cell — flattening it would produce a grid whose columns
 * mean different things at different depths, which is worse than no table at all.
 */
export function tableFor(
  document: XmlDocument,
  model: SchemaModel | null,
  parentId: NodeId,
): TableSpec | null {
  const groups = new Map<string, NodeId[]>();
  for (const childId of document.childrenOf(parentId)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    const key = `${child.name.namespaceUri ?? ''}|${child.name.localName}`;
    groups.set(key, [...(groups.get(key) ?? []), childId]);
  }

  // The largest repeated group wins. A parent holding both a header and twelve lines is a table of
  // lines with a header beside it, not two half-tables.
  let best: { key: string; ids: NodeId[] } | null = null;
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    if (best === null || ids.length > best.ids.length) best = { key, ids };
  }
  if (best === null) return null;

  const columns = columnsFor(document, model, best.ids);
  if (columns.length === 0) return null;

  const first = document.node(best.ids[0]!);
  const name = first !== undefined && isElement(first) ? first.name.localName : 'row';

  return {
    name,
    columns,
    rows: best.ids.map((id) => ({ node: id, cells: columns.map((column) => cellFor(document, id, column)) })),
  };
}

function columnsFor(
  document: XmlDocument,
  model: SchemaModel | null,
  ids: readonly NodeId[],
): TableColumn[] {
  const columns: TableColumn[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const node = document.node(id);
    if (node === undefined || !isElement(node)) continue;

    for (const attribute of node.attributes) {
      if (attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns') continue;
      const key = `@${attribute.name.localName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({
        key,
        label: attribute.name.localName,
        source: 'attribute',
        localName: attribute.name.localName,
        namespaceUri: attribute.name.namespaceUri,
        widget: null,
      });
    }

    for (const childId of document.childrenOf(id)) {
      const child = document.node(childId);
      if (child === undefined || !isElement(child)) continue;
      // Only leaves become columns.
      if (document.childrenOf(childId).some((sub) => document.node(sub)?.kind === 'element')) continue;

      const key = child.name.localName;
      if (seen.has(key)) continue;
      seen.add(key);

      const context = model === null ? null : elementContext(model, document, childId);
      const type = context === null ? null : textTypeOf(context);
      columns.push({
        key,
        label: child.name.localName,
        source: 'child',
        localName: child.name.localName,
        namespaceUri: child.name.namespaceUri,
        widget: type === null ? null : widgetFor(type),
      });
    }
  }

  // Columns accumulate across every row, so one row missing an optional child does not lose the
  // column for the rest — which is the difference between a table and a ragged list.
  return columns;
}

function cellFor(document: XmlDocument, rowId: NodeId, column: TableColumn): TableCell {
  const row = document.node(rowId);
  if (row === undefined || !isElement(row)) return { node: null, value: '' };

  if (column.source === 'attribute') {
    const attribute = row.attributes.find(
      (candidate) => candidate.name.localName === column.localName,
    );
    return { node: rowId, value: attribute?.value ?? '' };
  }

  for (const childId of document.childrenOf(rowId)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    if (child.name.localName !== column.localName) continue;

    let text = '';
    for (const grandchildId of document.childrenOf(childId)) {
      const grandchild = document.node(grandchildId);
      if (grandchild !== undefined && (grandchild.kind === 'text' || grandchild.kind === 'cdata')) {
        text += grandchild.value;
      }
    }
    return { node: childId, value: text };
  }

  // The child is absent from this row. Null rather than an empty node, so the table can offer to
  // create it rather than silently editing something that does not exist.
  return { node: null, value: '' };
}
