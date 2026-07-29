import { isElement, type NodeId, type XmlDocument } from '@x-editor/xml-core';
import {
  describeElement,
  elementContext,
  humaniseName,
  type SchemaModel,
} from '@x-editor/xsd';

/**
 * "Explain my document" — a read-only walkthrough for someone opening an unfamiliar XML.
 *
 * The situation this is for: a file arrives, it is 400 lines, and the question is not "is it valid"
 * but "what am I looking at". A tree answers that badly, because a tree shows structure at a uniform
 * level of detail and the answer is a summary.
 *
 * Everything here is derived, never authored, so there is nothing to keep up to date and no way for
 * it to be wrong about a document it just read. Where a schema is attached its documentation is used
 * verbatim; where one is not, the shape of the document is described instead — and the difference is
 * marked, because a user must always be able to tell a rule from a guess.
 */

export interface ExplanationStep {
  readonly node: NodeId;
  readonly title: string;
  readonly text: string;
  /** True when the sentence came from the schema rather than from reading the document. */
  readonly fromSchema: boolean;
}

export interface Explanation {
  readonly summary: string;
  readonly steps: readonly ExplanationStep[];
}

export function explainDocument(
  document: XmlDocument,
  model: SchemaModel | null,
): Explanation {
  const rootId = document.documentElement();
  if (rootId === undefined) {
    return { summary: 'This document has no root element, so there is nothing to describe.', steps: [] };
  }

  const counts = new Map<string, number>();
  let elements = 0;
  let depth = 0;
  const namespaces = new Set<string>();

  const measure = (id: NodeId, level: number): void => {
    const node = document.node(id);
    if (node === undefined || !isElement(node)) return;
    elements++;
    depth = Math.max(depth, level);
    if (node.name.namespaceUri !== null) namespaces.add(node.name.namespaceUri);
    counts.set(node.name.localName, (counts.get(node.name.localName) ?? 0) + 1);
    for (const child of document.childrenOf(id)) measure(child, level + 1);
  };
  measure(rootId, 1);

  const root = document.node(rootId);
  const rootName = root !== undefined && isElement(root) ? root.name.localName : 'the root';

  // The repeated elements are what a document is *about* — an invoice is its lines, a catalogue its
  // products. Naming the most repeated one first is usually the whole answer to "what is this".
  const repeated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const summary = [
    `This is a ${humaniseName(rootName).toLowerCase()} — ${elements} elements, ${depth} levels deep.`,
    repeated.length === 0
      ? 'Nothing in it repeats, so it is a single record rather than a list.'
      : `Most of it is ${repeated.map(([name, count]) => `${count} ${humaniseName(name).toLowerCase()}`).join(', ')}.`,
    namespaces.size === 0
      ? 'It uses no namespaces, so element names mean exactly what they say.'
      : `It uses ${namespaces.size === 1 ? 'one namespace' : `${namespaces.size} namespaces`}: ${[...namespaces].join(', ')}.`,
    model === null
      ? 'No schema is attached, so everything below is read from the document itself rather than from a set of rules.'
      : 'A schema is attached, so the descriptions below are what its author wrote.',
  ].join(' ');

  return { summary, steps: walk(document, model, rootId, 0) };
}

/**
 * One step per element worth stopping at, depth-first.
 *
 * Repeated siblings collapse to their first: a walkthrough with twelve identical `<line>` entries is
 * a list, not an explanation, and the twelfth teaches nothing the first did not.
 */
function walk(
  document: XmlDocument,
  model: SchemaModel | null,
  id: NodeId,
  depth: number,
): ExplanationStep[] {
  if (depth > 3) return [];

  const node = document.node(id);
  if (node === undefined || !isElement(node)) return [];

  const steps: ExplanationStep[] = [describe(document, model, id)];

  const seen = new Set<string>();
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    if (seen.has(child.name.localName)) continue;
    seen.add(child.name.localName);
    steps.push(...walk(document, model, childId, depth + 1));
  }

  return steps;
}

function describe(
  document: XmlDocument,
  model: SchemaModel | null,
  id: NodeId,
): ExplanationStep {
  const node = document.node(id)!;
  const name = isElement(node) ? node.name.localName : 'node';
  const title = humaniseName(name);

  const context = model === null ? null : elementContext(model, document, id);
  if (context?.declaration != null) {
    const description = describeElement(context.declaration, model!.typeOf(context.declaration));
    if (description.authored) {
      return { node: id, title, text: description.text, fromSchema: true };
    }
  }

  return { node: id, title, text: shapeOf(document, id), fromSchema: false };
}

/** What an element looks like, said in a sentence, when no schema says what it means. */
function shapeOf(document: XmlDocument, id: NodeId): string {
  const node = document.node(id);
  if (node === undefined || !isElement(node)) return '';

  const children = new Map<string, number>();
  let text = '';
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined) continue;
    if (child.kind === 'text' || child.kind === 'cdata') text += child.value;
    if (isElement(child)) {
      children.set(child.name.localName, (children.get(child.name.localName) ?? 0) + 1);
    }
  }

  const parts: string[] = [];

  if (children.size > 0) {
    const listed = [...children.entries()]
      .slice(0, 4)
      .map(([name, count]) => (count === 1 ? name : `${count} ${name}`));
    const more = children.size > 4 ? `, and ${children.size - 4} more` : '';
    parts.push(`Holds ${listed.join(', ')}${more}.`);
  }

  const trimmed = text.trim();
  if (trimmed !== '') {
    const shown = trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
    parts.push(children.size > 0 ? `It also carries the text "${shown}".` : `Its value is "${shown}".`);
  }

  const attributes = node.attributes.filter(
    (attribute) => attribute.name.prefix !== 'xmlns' && attribute.name.localName !== 'xmlns',
  );
  if (attributes.length > 0) {
    parts.push(
      `Settings on it: ${attributes.map((attribute) => attribute.name.localName).join(', ')}.`,
    );
  }

  return parts.length === 0 ? 'It is empty.' : parts.join(' ');
}
