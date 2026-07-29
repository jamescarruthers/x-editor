import {
  ROOT_ID,
  qnameToString,
  type NodeId,
  type XmlDocument,
  type XmlNode,
} from '@x-editor/xml-core';

export interface Row {
  readonly id: NodeId;
  readonly depth: number;
  readonly node: XmlNode;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  /** Index among siblings of the same element name — powers the `2 of 3` cardinality chip. */
  readonly ordinal: number;
  readonly siblingCount: number;
}

/**
 * Flattens the visible part of the tree into the list the virtualizer renders.
 *
 * Whitespace-only text between elements is skipped: it is real and must be preserved on save, but
 * rendering a row for every indentation run would triple the tree's length and teach a beginner
 * nothing. Significant text — anything with a non-space character — always gets a row.
 */
export function buildRows(doc: XmlDocument, expanded: ReadonlySet<NodeId>): Row[] {
  const rows: Row[] = [];

  const visibleChildren = (parent: NodeId): NodeId[] =>
    doc.childrenOf(parent).filter((id) => {
      const node = doc.node(id);
      if (node === undefined) return false;
      if (node.kind === 'text') return node.value.trim() !== '';
      return true;
    });

  const walk = (parent: NodeId, depth: number): void => {
    const children = visibleChildren(parent);

    // Count siblings sharing an element name, so a row can say "2 of 3".
    const counts = new Map<string, number>();
    for (const id of children) {
      const node = doc.node(id);
      if (node?.kind === 'element') {
        const key = qnameToString(node.name);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const seen = new Map<string, number>();

    for (const id of children) {
      const node = doc.node(id)!;
      let ordinal = 1;
      let siblingCount = 1;
      if (node.kind === 'element') {
        const key = qnameToString(node.name);
        ordinal = (seen.get(key) ?? 0) + 1;
        seen.set(key, ordinal);
        siblingCount = counts.get(key) ?? 1;
      }

      const kids = visibleChildren(id);
      const isExpanded = expanded.has(id);
      rows.push({
        id,
        depth,
        node,
        hasChildren: kids.length > 0,
        expanded: isExpanded,
        ordinal,
        siblingCount,
      });
      if (isExpanded && kids.length > 0) walk(id, depth + 1);
    }
  };

  walk(ROOT_ID, 0);
  return rows;
}

/** A short preview of an element's text content, for the inline `= "…"` on a row. */
export function textPreview(doc: XmlDocument, id: NodeId, limit = 48): string | null {
  const children = doc.childrenOf(id);
  if (children.length === 0) return null;

  let text = '';
  for (const child of children) {
    const node = doc.node(child);
    if (node === undefined) continue;
    if (node.kind === 'element') return null; // has element children — not a simple value
    if (node.kind === 'text' || node.kind === 'cdata') text += node.value;
  }

  const trimmed = text.trim();
  if (trimmed === '') return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

export function nodeLabel(node: XmlNode): string {
  switch (node.kind) {
    case 'element':
      return qnameToString(node.name);
    case 'document':
      return 'document';
    case 'text':
      return 'text';
    case 'cdata':
      return 'CDATA';
    case 'comment':
      return 'comment';
    case 'pi':
      return `<?${node.target}?>`;
    case 'xmldecl':
      return 'XML declaration';
    case 'doctype':
      return 'DOCTYPE';
  }
}
