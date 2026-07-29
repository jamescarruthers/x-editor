import { ROOT_ID, isElement, type NodeId, type XmlDocument } from '@x-editor/xml-core';
import {
  skeletonFor,
  type CompiledElement,
  type SchemaModel,
  type SkeletonNode,
} from '@x-editor/xsd';

/**
 * Building a whole document from a schema.
 *
 * This is what the new-document wizard produces, and what makes the difference between arriving at a
 * blank tree and arriving at something already shaped like the thing you came to write. The engine
 * already knows how to generate a valid subtree; what is added here is the part that only matters at
 * the root — namespace declarations — and the part that only matters to a beginner: knowing which of
 * the values in front of them were invented.
 *
 * A generated document is *valid and meaningless*. Marking every invented value turns that into a
 * reviewable to-do list, which is the whole reason a wizard is safe to offer. Without it a wizard
 * hands someone a document full of `2026-01-01` that validates green, and the first person to notice
 * is whoever receives the file.
 */

/**
 * Where a generated value sits, as a path of element-child indices from the document element.
 *
 * A path rather than a `NodeId`, because the document does not exist yet — it is produced as text
 * and parsed, so the ids are minted afterwards. Resolving paths against the parsed document is the
 * only join available, and it is exact for a document we generated ourselves.
 */
export interface PlaceholderPath {
  readonly path: readonly number[];
  /** The attribute the value sits in, or null when it is the element's text. */
  readonly attribute: string | null;
  /**
   * The value that was generated.
   *
   * Kept so "has this been reviewed?" can be answered by comparing against what is in the document
   * now, rather than by trying to intercept the edit that changed it. That comparison is exact, it
   * costs one pass over the placeholder list, and — the reason it is worth the field — it gets undo
   * right for free, where an intercept-the-edit scheme silently loses entries.
   */
  readonly value: string;
}

export interface Scaffold {
  readonly source: string;
  readonly placeholders: readonly PlaceholderPath[];
  /** How many elements the document will have, for the "this will be large" warning. */
  readonly elementCount: number;
}

export interface ScaffoldOptions {
  readonly include: 'required' | 'all';
  readonly maxDepth?: number;
}

export function scaffoldDocument(
  model: SchemaModel,
  element: CompiledElement,
  options: ScaffoldOptions,
): Scaffold {
  const skeleton = skeletonFor(model, element, {
    include: options.include,
    maxDepth: options.maxDepth ?? (options.include === 'all' ? 4 : 8),
  });

  const prefixes = assignPrefixes(skeleton);
  const placeholders: PlaceholderPath[] = [];
  let elementCount = 0;

  const declarations: string[] = [];
  for (const [uri, prefix] of prefixes) {
    declarations.push(prefix === '' ? ` xmlns="${escapeAttribute(uri)}"` : ` xmlns:${prefix}="${escapeAttribute(uri)}"`);
  }

  // True when the root took the default binding, which is what makes `xmlns=""` necessary below.
  const hasDefault = skeleton.name.namespaceUri !== null;

  const write = (node: SkeletonNode, indent: string, path: number[], extra: string): string => {
    elementCount++;
    const prefix = node.name.namespaceUri === null ? '' : prefixes.get(node.name.namespaceUri) ?? '';
    const name = prefix === '' ? node.name.localName : `${prefix}:${node.name.localName}`;

    // An element in no namespace under a default declaration has to undeclare it, or the name it
    // ends up with is not the one the schema asked for. This is the `elementFormDefault="unqualified"`
    // case, which is the majority of hand-written schemas rather than an edge case.
    const undeclare =
      node.name.namespaceUri === null && hasDefault && path.length > 0 ? ' xmlns=""' : '';

    const attributes = node.attributes
      .map((attribute) => {
        if (attribute.placeholder) {
          placeholders.push({
            path: [...path],
            attribute: attribute.name.localName,
            value: attribute.value,
          });
        }
        const attributePrefix =
          attribute.name.namespaceUri === null
            ? ''
            : `${prefixes.get(attribute.name.namespaceUri) ?? ''}:`;
        return ` ${attributePrefix}${attribute.name.localName}="${escapeAttribute(attribute.value)}"`;
      })
      .join('');

    const open = `${indent}<${name}${extra}${undeclare}${attributes}`;

    if (node.children.length === 0) {
      // Recorded even when the generated value is empty. An `xs:string` with no facets has nothing
      // sensible to invent, so the element comes out empty — and "this needs a value" is exactly
      // what the author needs told about it.
      if (node.textPlaceholder && node.text !== null) {
        placeholders.push({ path: [...path], attribute: null, value: node.text });
      }
      if (node.text === null || node.text === '') return `${open}/>`;
      return `${open}>${escapeText(node.text)}</${name}>`;
    }

    const inner = node.children
      .map((child, index) => write(child, `${indent}  `, [...path, index], ''))
      .join('\n');
    return `${open}>\n${inner}\n${indent}</${name}>`;
  };

  const body = write(skeleton, '', [], declarations.join(''));
  return {
    source: `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`,
    placeholders,
    elementCount,
  };
}

/**
 * Give every namespace in the skeleton a prefix, with the root's as the default.
 *
 * The default binding goes to the root's own namespace because that is the one that appears on
 * nearly every element, and a document where every tag carries `ns1:` is one a beginner cannot read.
 */
function assignPrefixes(root: SkeletonNode): Map<string, string> {
  const namespaces: string[] = [];
  const seen = new Set<string>();

  const visit = (node: SkeletonNode): void => {
    if (node.name.namespaceUri !== null && !seen.has(node.name.namespaceUri)) {
      seen.add(node.name.namespaceUri);
      namespaces.push(node.name.namespaceUri);
    }
    for (const attribute of node.attributes) {
      const uri = attribute.name.namespaceUri;
      if (uri !== null && !seen.has(uri)) {
        seen.add(uri);
        namespaces.push(uri);
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);

  const prefixes = new Map<string, string>();
  let counter = 0;
  for (const uri of namespaces) {
    prefixes.set(uri, uri === root.name.namespaceUri ? '' : `ns${++counter}`);
  }
  return prefixes;
}

/** A generated value bound to the node it landed on. */
export interface Placeholder {
  readonly node: NodeId;
  readonly attribute: string | null;
  readonly value: string;
}

/**
 * Resolve generated-value paths against the parsed document.
 *
 * Only run once, immediately after loading the text this module produced — the paths mean nothing
 * against a document anyone has edited.
 */
export function resolvePlaceholders(
  document: XmlDocument,
  paths: readonly PlaceholderPath[],
): Placeholder[] {
  const rootId = document.documentElement();
  if (rootId === undefined) return [];

  const out: Placeholder[] = [];
  for (const entry of paths) {
    let cursor: NodeId | undefined = rootId;
    for (const step of entry.path) {
      if (cursor === undefined) break;
      cursor = elementChildren(document, cursor)[step];
    }
    if (cursor !== undefined) {
      out.push({ node: cursor, attribute: entry.attribute, value: entry.value });
    }
  }
  return out;
}

/**
 * The generated values nobody has touched yet, in document order.
 *
 * Derived by comparison rather than tracked through edits. A value that has been changed and then
 * changed back to exactly what was generated counts as unreviewed again, which is the right answer:
 * the point is not "did an edit happen here" but "has a human decided this is correct".
 */
export function pendingPlaceholders(
  document: XmlDocument,
  placeholders: readonly Placeholder[],
): Placeholder[] {
  return placeholders.filter((placeholder) => {
    const node = document.node(placeholder.node);
    if (node === undefined || !isElement(node)) return false;

    if (placeholder.attribute !== null) {
      return node.attributes.some(
        (attribute) =>
          attribute.name.prefix === '' &&
          attribute.name.localName === placeholder.attribute &&
          attribute.value === placeholder.value,
      );
    }

    return textOf(document, placeholder.node) === placeholder.value;
  });
}

function textOf(document: XmlDocument, id: NodeId): string {
  let text = '';
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child !== undefined && (child.kind === 'text' || child.kind === 'cdata')) text += child.value;
  }
  return text;
}

function elementChildren(document: XmlDocument, id: NodeId): NodeId[] {
  return document.childrenOf(id).filter((childId) => {
    const node = document.node(childId);
    return node !== undefined && isElement(node);
  });
}

/** The next unreviewed value after the selected node, wrapping — what F7 steps through. */
export function nextPlaceholder(
  document: XmlDocument,
  placeholders: readonly Placeholder[],
  from: NodeId,
  direction: 1 | -1,
): NodeId | null {
  const pending = pendingPlaceholders(document, placeholders);
  if (pending.length === 0) return null;

  // Document order, not the order they were generated in: the tree is what the user is looking at,
  // and stepping that jumps around reads as a bug.
  const position = new Map<NodeId, number>();
  let counter = 0;
  const walk = (id: NodeId): void => {
    position.set(id, counter++);
    for (const child of document.childrenOf(id)) walk(child);
  };
  walk(ROOT_ID);

  const order: NodeId[] = [];
  for (const placeholder of pending) {
    if (!order.includes(placeholder.node)) order.push(placeholder.node);
  }
  order.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));

  const at = order.indexOf(from);
  if (at < 0) {
    // Not standing on one: step to the first that comes after the selection, so F7 continues from
    // where the user is rather than restarting at the top of the document.
    const here = position.get(from) ?? -1;
    const forward = order.find((id) => (position.get(id) ?? 0) > here);
    if (direction === 1) return forward ?? order[0]!;
    const backward = [...order].reverse().find((id) => (position.get(id) ?? 0) < here);
    return backward ?? order[order.length - 1]!;
  }
  return order[(at + direction + order.length) % order.length]!;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
