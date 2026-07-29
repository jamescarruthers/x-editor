import {
  removeAttribute,
  removeNode,
  renameElement,
  setAttribute,
  setNamespaceDeclaration,
  setTextValue,
  insertText,
  isElement,
  type Command,
  type NodeId,
  type QName,
  type XmlDocument,
} from '@x-editor/xml-core';
import type { EditOperation, FixEdit, XsdQName } from '@x-editor/xsd';
import { store } from '../state/store.js';
import { buildInsertCommands, compose, elementChildIds, nameForNamespace } from './insert.js';

/**
 * Turning a quick fix into an edit.
 *
 * Fixes arrive as data rather than closures — they have to survive the worker boundary and be
 * testable without a document — so this is where the data becomes commands. Every fix produces
 * exactly one history entry, however many operations it contains: a fix that undoes in three steps
 * is a fix the user cannot confidently try.
 */
export function applyFix(edit: FixEdit): void {
  const doc = store.document;
  const command = commandFor(doc, edit);
  if (command !== null) store.run(command);
}

function commandFor(doc: XmlDocument, edit: FixEdit): Command | null {
  switch (edit.kind) {
    case 'insert-element':
      return compose(
        `Added <${edit.name.localName}>`,
        buildInsertCommands(doc, edit.parent, edit.index, edit.name),
      );

    case 'delete-node':
      return doc.node(edit.node) === undefined ? null : removeNode(doc, edit.node);

    case 'rename-element': {
      const node = doc.node(edit.node);
      if (node === undefined || !isElement(node)) return null;
      const parent = doc.parentOf(edit.node) ?? edit.node;
      const { name, declarations } = nameForNamespace(
        doc,
        parent,
        edit.name.namespaceUri,
        edit.name.localName,
      );
      const rename = renameElement(doc, edit.node, name);
      if (declarations.length === 0) return rename;
      return compose(rename.label, [
        rename,
        ...declarations.map((declaration) =>
          setNamespaceDeclaration(doc, edit.node, declaration.prefix, declaration.uri),
        ),
      ]);
    }

    case 'set-attribute': {
      // `xmlns` is not an attribute: it changes how every name beneath this element resolves, so it
      // goes through the declaration list rather than the attribute list.
      if (edit.name.localName === 'xmlns' && edit.name.namespaceUri === null) {
        return setNamespaceDeclaration(doc, edit.node, '', edit.value);
      }
      return setAttribute(doc, edit.node, attributeQName(doc, edit.node, edit.name), edit.value);
    }

    case 'remove-attribute':
      return removeAttribute(doc, edit.node, attributeQName(doc, edit.node, edit.name));

    case 'rename-attribute': {
      const node = doc.node(edit.node);
      if (node === undefined || !isElement(node)) return null;
      const from = attributeQName(doc, edit.node, edit.from);
      const current = node.attributes.find(
        (attribute) => attribute.name.localName === from.localName,
      );
      return compose(`Renamed ${edit.from.localName} to ${edit.to.localName}`, [
        setAttribute(doc, edit.node, attributeQName(doc, edit.node, edit.to), current?.value ?? ''),
        removeAttribute(doc, edit.node, from),
      ]);
    }

    case 'set-text':
      return setTextCommand(doc, edit.node, edit.value);

    case 'clear-children': {
      const children = [...doc.childrenOf(edit.node)];
      if (children.length === 0) return null;
      // Removed last-first so each removal's recorded index stays correct as the list shrinks.
      return compose(
        'Removed the contents',
        [...children].reverse().map((child) => removeNode(doc, child)),
      );
    }

    case 'apply-alignment':
      return alignmentCommand(doc, edit.parent, edit.operations);
  }
}

/**
 * An attribute name using a prefix that is actually in scope.
 *
 * An attribute cannot use the default namespace declaration, so an unprefixed binding is no help —
 * a namespaced attribute needs a real prefix or it means something else entirely.
 */
function attributeQName(doc: XmlDocument, id: NodeId, name: XsdQName): QName {
  if (name.namespaceUri === null) {
    return { prefix: '', localName: name.localName, namespaceUri: null };
  }
  for (const [prefix, uri] of doc.inScopeNamespaces(id)) {
    if (uri === name.namespaceUri && prefix !== '') {
      return { prefix, localName: name.localName, namespaceUri: name.namespaceUri };
    }
  }
  return { prefix: '', localName: name.localName, namespaceUri: null };
}

/** Replace an element's text content, whether or not it currently has any. */
function setTextCommand(doc: XmlDocument, id: NodeId, value: string): Command | null {
  const textNodes = doc
    .childrenOf(id)
    .map((child) => doc.node(child))
    .filter((child) => child !== undefined)
    .filter((child) => child.kind === 'text' || child.kind === 'cdata');

  if (textNodes.length === 0) {
    if (value === '') return null;
    return insertText(doc, id, 0, value);
  }

  const first = textNodes[0]!;
  const rest = textNodes.slice(1);
  const commands: Command[] = [setTextValue(doc, first.id, value)];
  // Extra text nodes would otherwise survive and silently append themselves to the value.
  for (const extra of [...rest].reverse()) commands.push(removeNode(doc, extra.id));
  return compose(commands[0]!.label, commands);
}

/**
 * A whole alignment as one command.
 *
 * Operations are applied left to right with a running offset, matching `applyOperations` in the
 * engine — the property test checks that definition against the reference matcher, so following it
 * here is what makes "this fix produces a valid document" a guarantee rather than a hope.
 *
 * Each command is applied as it is built, so the next one is planned against the document that will
 * actually exist, then the whole lot is unwound and replayed through the history as one entry.
 */
function alignmentCommand(
  doc: XmlDocument,
  parent: NodeId,
  operations: readonly EditOperation[],
): Command | null {
  const collected: Command[] = [];
  let offset = 0;

  for (const operation of operations) {
    const elementIndex = operation.index + offset;
    const built = commandsForOperation(doc, parent, elementIndex, operation);
    for (const command of built) {
      command.apply(doc);
      collected.push(command);
    }
    if (operation.kind === 'insert') offset++;
    else if (operation.kind === 'delete') offset--;
  }

  for (let i = collected.length - 1; i >= 0; i--) collected[i]!.invert(doc);

  return compose(
    operations.length === 1 ? 'Fixed the contents' : `Fixed ${operations.length} problems`,
    collected,
  );
}

function commandsForOperation(
  doc: XmlDocument,
  parent: NodeId,
  elementIndex: number,
  operation: EditOperation,
): Command[] {
  const children = elementChildIds(doc, parent);

  switch (operation.kind) {
    case 'insert':
      return buildInsertCommands(doc, parent, elementIndex, operation.name!);

    case 'delete': {
      const target = children[elementIndex];
      return target === undefined ? [] : [removeNode(doc, target)];
    }

    case 'replace': {
      const target = children[elementIndex];
      if (target === undefined) return [];
      const { name, declarations } = nameForNamespace(
        doc,
        parent,
        operation.name!.namespaceUri,
        operation.name!.localName,
      );
      return [
        renameElement(doc, target, name),
        ...declarations.map((declaration) =>
          setNamespaceDeclaration(doc, target, declaration.prefix, declaration.uri),
        ),
      ];
    }

    case 'transpose': {
      const first = children[elementIndex];
      const second = children[elementIndex + 1];
      if (first === undefined || second === undefined) return [];
      // Moving the second one in front of the first is a single move, and unlike a delete-and-
      // reinsert it keeps both nodes' ids — so selection and diagnostics survive the fix.
      return [moveBefore(doc, second, first)];
    }
  }
}

/** Move `node` so it sits immediately before `target` among their shared parent's children. */
function moveBefore(doc: XmlDocument, node: NodeId, target: NodeId): Command {
  const parent = doc.parentOf(node)!;
  const from = doc.childrenOf(parent).indexOf(node);
  const to = doc.childrenOf(parent).indexOf(target);

  return {
    label: 'Swapped two elements',
    affected: node,
    apply: (d) => {
      const { index } = d.detachChild(node);
      d.attachChild(parent, index < to ? to - 1 : to, node);
    },
    invert: (d) => {
      d.detachChild(node);
      d.attachChild(parent, from, node);
    },
  };
}
