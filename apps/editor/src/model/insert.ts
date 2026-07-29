import {
  insertElement,
  insertText,
  type Command,
  type NamespaceDeclaration,
  type NodeId,
  type QName,
  type XmlDocument,
} from '@x-editor/xml-core';
import {
  insertionPlan,
  requiredMissing,
  skeletonFor,
  type ElementContext,
  type PlannedInsert,
  type SchemaModel,
  type SkeletonNode,
} from '@x-editor/xsd';
import { store } from '../state/store.js';

/**
 * Turning a palette choice into an edit.
 *
 * Two things here exist to keep a promise the document layer makes elsewhere. Insertion matches the
 * surrounding whitespace, because a tool that reformats on save produces a four-thousand-line diff
 * and gets banned by the team. And a multi-part insertion — an element with its required children
 * and attributes — is one composed command, so it undoes in a single step rather than unwinding in
 * pieces.
 */

/** Runs a list of commands as one history entry. */
export function compose(label: string, commands: readonly Command[]): Command | null {
  if (commands.length === 0) return null;
  const first = commands[0]!;
  if (commands.length === 1) return { ...first, label };

  return {
    label,
    affected: first.affected,
    apply: (doc) => {
      for (const command of commands) command.apply(doc);
    },
    invert: (doc) => {
      for (let i = commands.length - 1; i >= 0; i--) commands[i]!.invert(doc);
    },
  };
}

function isWhitespaceText(doc: XmlDocument, id: NodeId): boolean {
  const node = doc.node(id);
  return node?.kind === 'text' && node.value.trim() === '';
}

/**
 * The indentation the parent already uses for its children, or null when it is written inline.
 *
 * Read from the document rather than configured: matching what is there is the only rule that
 * cannot annoy someone, and it means a two-space file and a tab file both stay themselves.
 */
function siblingWhitespace(doc: XmlDocument, parentId: NodeId): string | null {
  for (const id of doc.childrenOf(parentId)) {
    const node = doc.node(id);
    if (node?.kind === 'text' && node.value.trim() === '' && node.value.includes('\n')) {
      return node.value;
    }
  }
  return null;
}

/** Element-child index → index among all children, including text and comments. */
function childIndexFor(doc: XmlDocument, context: ElementContext, elementIndex: number): number {
  const children = doc.childrenOf(context.nodeId);
  const target = context.children[elementIndex];

  if (target !== undefined) {
    const found = children.indexOf(target.id);
    if (found >= 0) return found;
  }

  // Appending: go before the parent's closing indentation if it has any, so the new element does
  // not land between the last child's whitespace and the close tag.
  const last = children[children.length - 1];
  if (last !== undefined && isWhitespaceText(doc, last)) return children.length - 1;
  return children.length;
}

/**
 * A prefix in scope for a namespace, or a declaration to write when there is none.
 *
 * Inventing a prefix on an ancestor would rewrite part of the document the user did not touch, so
 * the declaration goes on the new element instead.
 */
function nameFor(
  doc: XmlDocument,
  parentId: NodeId,
  namespaceUri: string | null,
  localName: string,
): { name: QName; declarations: NamespaceDeclaration[] } {
  const bindings = doc.inScopeNamespaces(parentId);

  if (namespaceUri === null) {
    const declarations: NamespaceDeclaration[] =
      bindings.get('') === undefined ? [] : [{ prefix: '', uri: '' }];
    return { name: { prefix: '', localName, namespaceUri: null }, declarations };
  }

  for (const [prefix, uri] of bindings) {
    if (uri === namespaceUri) return { name: { prefix, localName, namespaceUri }, declarations: [] };
  }

  return {
    name: { prefix: '', localName, namespaceUri },
    declarations: [{ prefix: '', uri: namespaceUri }],
  };
}

/** Builds the commands for one skeleton subtree, without running them. */
function buildSkeleton(
  doc: XmlDocument,
  parentId: NodeId,
  index: number,
  skeleton: SkeletonNode,
  indent: string | null,
  depth: number,
): { commands: Command[]; elementId: NodeId } {
  const { name, declarations } = nameFor(
    doc,
    parentId,
    skeleton.name.namespaceUri,
    skeleton.name.localName,
  );

  const attributes = skeleton.attributes.map((attribute) => ({
    name: attributeName(doc, parentId, attribute.name),
    value: attribute.value,
  }));

  const command = insertElement(doc, parentId, index, {
    name,
    attributes,
    ...(declarations.length > 0 ? { namespaceDeclarations: declarations } : {}),
  });
  const elementId = command.affected;
  const commands: Command[] = [command];

  const childIndent = indent === null ? null : `${indent}  `;

  if (skeleton.children.length > 0) {
    let cursor = 0;
    for (const child of skeleton.children) {
      if (childIndent !== null) {
        commands.push(insertText(doc, elementId, cursor, childIndent));
        cursor++;
      }
      const built = buildSkeleton(doc, elementId, cursor, child, childIndent, depth + 1);
      commands.push(...built.commands);
      cursor++;
    }
    if (indent !== null) commands.push(insertText(doc, elementId, cursor, indent));
  } else if (skeleton.text !== null && skeleton.text !== '') {
    commands.push(insertText(doc, elementId, 0, skeleton.text));
  }

  return { commands, elementId };
}

/**
 * Insert one palette choice at the position its content model expects.
 *
 * `apply` is called during construction so nested indices are computed against the document as it
 * will actually be, then unwound before the composed command goes through the history — which is
 * what makes the whole insertion one undo step.
 */
export function insertPlanned(context: ElementContext, candidate: PlannedInsert): void {
  const model = store.schema.model;
  const doc = store.document;
  if (model === null) return;

  const parentIndent = siblingWhitespace(doc, context.nodeId);
  const target = childIndexFor(doc, context, candidate.index);

  const skeleton: SkeletonNode =
    candidate.declaration === null
      ? { name: candidate.name, attributes: [], children: [], text: null }
      : skeletonFor(model, candidate.declaration, { maxDepth: 3 });

  const commands: Command[] = [];
  const { commands: built } = buildSkeleton(doc, context.nodeId, target, skeleton, parentIndent, 0);
  commands.push(...built);

  const composed = compose(`Added <${candidate.name.localName}>`, [
    ...commands,
    ...separatorCommands(doc, context.nodeId, target, parentIndent),
  ]);
  if (composed !== null) store.run(composed);
}

/**
 * Whitespace so the inserted element does not end up welded to its neighbour.
 *
 * Only added on the side that needs it: mid-list there is already whitespace before the insertion
 * point and none after, and when appending it is the other way round.
 */
function separatorCommands(
  doc: XmlDocument,
  parentId: NodeId,
  target: number,
  indent: string | null,
): Command[] {
  if (indent === null) return [];
  const children = doc.childrenOf(parentId);

  const before = children[target - 1];
  const after = children[target];

  if (before === undefined || !isWhitespaceText(doc, before)) {
    return [insertText(doc, parentId, target, indent)];
  }
  if (after !== undefined && !isWhitespaceText(doc, after)) {
    return [insertText(doc, parentId, target + 1, indent)];
  }
  return [];
}

/**
 * Add every missing required child in one step.
 *
 * The most useful thing the palette does: it turns an invalid element into a valid one with one
 * click, and one undo puts it back. Each insertion is applied as it is built so the next one is
 * planned against the document that will actually exist, then the whole lot is unwound and replayed
 * as a single history entry.
 */
export function insertAllRequired(model: SchemaModel, context: ElementContext): number {
  const doc = store.document;
  const collected: Command[] = [];
  let inserted = 0;

  for (let round = 0; round < 64; round++) {
    const current = store.contextFor(context.nodeId);
    if (current === null) break;
    const missing = requiredMissing(model, current);
    if (missing.length === 0) break;

    // Re-planned every round: after each insertion the expected position of the next missing
    // element has moved, and the content model is the only thing that knows where to.
    const next = missing[0]!;
    const planned = insertionPlan(model, current).find(
      (candidate) =>
        candidate.name.localName === next.localName &&
        candidate.name.namespaceUri === next.namespaceUri,
    );
    if (planned === undefined) break;

    const indent = siblingWhitespace(doc, current.nodeId);
    const target = childIndexFor(doc, current, planned.index);
    const skeleton: SkeletonNode =
      planned.declaration === null
        ? { name: next, attributes: [], children: [], text: null }
        : skeletonFor(model, planned.declaration, { maxDepth: 3 });

    const { commands } = buildSkeleton(doc, current.nodeId, target, skeleton, indent, 0);
    for (const command of [...commands, ...separatorCommands(doc, current.nodeId, target, indent)]) {
      command.apply(doc);
      collected.push(command);
    }
    inserted++;
  }

  // Unwind, then replay through the history so the whole repair is one entry.
  for (let i = collected.length - 1; i >= 0; i--) collected[i]!.invert(doc);

  const composed = compose(
    `Added ${inserted} missing ${inserted === 1 ? 'element' : 'elements'}`,
    collected,
  );
  if (composed !== null) store.run(composed);
  return inserted;
}

function attributeName(
  doc: XmlDocument,
  parentId: NodeId,
  name: { namespaceUri: string | null; localName: string },
): QName {
  if (name.namespaceUri === null) {
    return { prefix: '', localName: name.localName, namespaceUri: null };
  }
  // An attribute cannot use the default namespace declaration, so an unprefixed binding is no use.
  for (const [prefix, uri] of doc.inScopeNamespaces(parentId)) {
    if (uri === name.namespaceUri && prefix !== '') {
      return { prefix, localName: name.localName, namespaceUri: name.namespaceUri };
    }
  }
  return { prefix: '', localName: name.localName, namespaceUri: null };
}
