import {
  isElement,
  qnameToString,
  type NodeId,
  type XmlDocument,
} from '@x-editor/xml-core';
import { XSD_NS } from '@x-editor/xsd';
import type { Row } from './rows.js';

/**
 * The XSD component view — a *projection* over the same CST, never a second editable model.
 *
 * A schema's source order is an accident of how it was written; its component structure is what the
 * author thinks in. Grouping by kind — global elements, then types, then groups, then what it pulls
 * in — turns a 4,000-line UBL schema from a scroll into a directory.
 *
 * Everything here addresses the same `NodeId`s the literal tree does, so selection, the Inspector
 * and undo all work across the toggle with nothing to synchronise. That is the whole reason this is
 * a row builder rather than a parallel model: every sync bug in this class of tool lives in the gap
 * between two representations of one document.
 */

interface Group {
  readonly heading: string;
  readonly members: { id: NodeId; label: string; detail: string }[];
}

export function isSchemaDocument(document: XmlDocument): boolean {
  const rootId = document.documentElement();
  if (rootId === undefined) return false;
  const root = document.node(rootId);
  return (
    root !== undefined &&
    isElement(root) &&
    root.name.namespaceUri === XSD_NS &&
    root.name.localName === 'schema'
  );
}

export function buildComponentRows(document: XmlDocument, expanded: ReadonlySet<NodeId>): Row[] {
  const rootId = document.documentElement();
  if (rootId === undefined) return [];

  const groups = collect(document, rootId);
  const rows: Row[] = [];

  for (const group of groups) {
    if (group.members.length === 0) continue;

    // A heading is addressed by its own key, not by the schema element it groups. Addressing the
    // root meant all eight headings shared one id — so React saw duplicate keys and stacked their
    // rows on top of each other, the DOM carried eight copies of `node-<root>`, and selecting the
    // root painted every heading as selected at once.
    const key = headingKey(rootId, group.heading);
    const open = !expanded.has(key);
    rows.push({
      id: key,
      depth: 0,
      node: document.node(rootId)!,
      hasChildren: true,
      expanded: open,
      ordinal: 1,
      siblingCount: 1,
      heading: `${group.heading} (${group.members.length})`,
    });

    if (!open) continue;

    for (const member of group.members) {
      const node = document.node(member.id);
      if (node === undefined) continue;
      const children = document.childrenOf(member.id).filter((id) => {
        const child = document.node(id);
        return child !== undefined && child.kind === 'element';
      });

      rows.push({
        id: member.id,
        depth: 1,
        node,
        hasChildren: children.length > 0,
        expanded: expanded.has(member.id),
        ordinal: 1,
        siblingCount: 1,
        componentLabel: member.label,
        componentDetail: member.detail,
      });

      // Below a component the literal structure is the right thing to show: that is where the
      // author is actually editing, and inventing a second abstraction for it would only get in
      // the way.
      if (expanded.has(member.id)) {
        appendLiteral(document, member.id, 2, expanded, rows);
      }
    }
  }

  return rows;
}

/**
 * The id of a synthetic heading row, so its collapsed state survives edits.
 *
 * Encoded into the NodeId space rather than a parallel set: expansion, selection and row identity
 * are all keyed by NodeId everywhere else, and a second mechanism would be one more thing to keep in
 * step. Negative by construction, so it can never collide with a real node — and every consumer of a
 * NodeId already treats one it cannot resolve as "nothing", which is the honest answer for a section
 * header.
 */
export function headingKey(rootId: NodeId, heading: string): NodeId {
  return (-(rootId + 1) * 100 - HEADINGS.indexOf(heading)) as NodeId;
}

const HEADINGS = [
  'Global elements',
  'Complex types',
  'Simple types',
  'Groups',
  'Attribute groups',
  'Global attributes',
  'Notations',
  'Includes and imports',
];

function collect(document: XmlDocument, rootId: NodeId): Group[] {
  const groups: Group[] = HEADINGS.map((heading) => ({ heading, members: [] }));
  const by = (heading: string): Group['members'] =>
    groups.find((group) => group.heading === heading)!.members;

  for (const childId of document.childrenOf(rootId)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    if (child.name.namespaceUri !== XSD_NS) continue;

    const name = attribute(document, childId, 'name');
    const type = attribute(document, childId, 'type');

    switch (child.name.localName) {
      case 'element':
        by('Global elements').push({
          id: childId,
          label: name ?? '(unnamed)',
          detail: type ?? inlineTypeLabel(document, childId),
        });
        break;
      case 'complexType':
        by('Complex types').push({
          id: childId,
          label: name ?? '(anonymous)',
          detail: contentSummary(document, childId),
        });
        break;
      case 'simpleType':
        by('Simple types').push({
          id: childId,
          label: name ?? '(anonymous)',
          detail: simpleSummary(document, childId),
        });
        break;
      case 'group':
        by('Groups').push({ id: childId, label: name ?? '(unnamed)', detail: '' });
        break;
      case 'attributeGroup':
        by('Attribute groups').push({ id: childId, label: name ?? '(unnamed)', detail: '' });
        break;
      case 'attribute':
        by('Global attributes').push({
          id: childId,
          label: name ?? '(unnamed)',
          detail: type ?? '',
        });
        break;
      case 'notation':
        by('Notations').push({ id: childId, label: name ?? '(unnamed)', detail: '' });
        break;
      case 'include':
      case 'import':
      case 'redefine':
      case 'override':
        by('Includes and imports').push({
          id: childId,
          label: attribute(document, childId, 'schemaLocation') ?? '(no location)',
          detail: attribute(document, childId, 'namespace') ?? child.name.localName,
        });
        break;
      default:
        break;
    }
  }

  return groups;
}

function appendLiteral(
  document: XmlDocument,
  parentId: NodeId,
  depth: number,
  expanded: ReadonlySet<NodeId>,
  rows: Row[],
): void {
  for (const childId of document.childrenOf(parentId)) {
    const child = document.node(childId);
    if (child === undefined || child.kind !== 'element') continue;

    const grandchildren = document
      .childrenOf(childId)
      .filter((id) => document.node(id)?.kind === 'element');
    const isExpanded = expanded.has(childId);

    rows.push({
      id: childId,
      depth,
      node: child,
      hasChildren: grandchildren.length > 0,
      expanded: isExpanded,
      ordinal: 1,
      siblingCount: 1,
    });

    if (isExpanded) appendLiteral(document, childId, depth + 1, expanded, rows);
  }
}

function attribute(document: XmlDocument, id: NodeId, name: string): string | null {
  const node = document.node(id);
  if (node === undefined || !isElement(node)) return null;
  for (const candidate of node.attributes) {
    if (candidate.name.prefix === '' && candidate.name.localName === name) return candidate.value;
  }
  return null;
}

function xsdChildren(document: XmlDocument, id: NodeId): string[] {
  const out: string[] = [];
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    if (child.name.namespaceUri === XSD_NS) out.push(child.name.localName);
  }
  return out;
}

function inlineTypeLabel(document: XmlDocument, id: NodeId): string {
  const children = xsdChildren(document, id);
  if (children.includes('complexType')) return 'inline complex type';
  if (children.includes('simpleType')) return 'inline simple type';
  return '';
}

/** A one-glance summary, so the list says what each type *is* rather than only its name. */
function contentSummary(document: XmlDocument, id: NodeId): string {
  const children = xsdChildren(document, id);
  if (children.includes('simpleContent')) return 'simple content';
  if (children.includes('complexContent')) return 'derived';
  if (children.includes('sequence')) return 'sequence';
  if (children.includes('choice')) return 'choice';
  if (children.includes('all')) return 'all';
  return 'empty';
}

function simpleSummary(document: XmlDocument, id: NodeId): string {
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    if (child.name.namespaceUri !== XSD_NS) continue;

    switch (child.name.localName) {
      case 'restriction':
        return `restricts ${attribute(document, childId, 'base') ?? '…'}`;
      case 'list':
        return `list of ${attribute(document, childId, 'itemType') ?? '…'}`;
      case 'union':
        return 'union';
      default:
        break;
    }
  }
  return '';
}

/** The label a component row shows, falling back to the literal element name. */
export function componentRowLabel(row: Row): string {
  if (row.componentLabel !== undefined) return row.componentLabel;
  return row.node.kind === 'element' ? qnameToString(row.node.name) : row.node.kind;
}
