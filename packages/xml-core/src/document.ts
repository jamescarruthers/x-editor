import { XMLNS_NS, buildTree } from './parse.js';
import { serializeNode } from './serialize.js';
import {
  ROOT_ID,
  isParentNode,
  qnameToString,
  type Attribute,
  type NamespaceDeclaration,
  type NodeId,
  type ParentNode,
  type ParseError,
  type QName,
  type XmlNode,
} from './types.js';

/**
 * A mutation, paired with its inverse.
 *
 * Every change goes through one of these. Two things fall out of that which matter to the product:
 * undo is exact rather than a re-parse of a stale snapshot, and every entry carries a human label,
 * which is what makes the visible History panel possible. Quick fixes produce commands too, so a
 * fix applied from a diagnostic undoes as one step rather than unwinding in pieces.
 */
export interface Command {
  readonly label: string;
  /** The node the user should be looking at after this command runs, or after it is undone. */
  readonly affected: NodeId;
  apply(doc: XmlDocument): void;
  invert(doc: XmlDocument): void;
}

export class XmlDocument {
  readonly source: string;
  readonly parseErrors: readonly ParseError[];

  private readonly nodeMap: Map<NodeId, XmlNode>;
  private readonly parentMap: Map<NodeId, NodeId>;
  private nextId: number;

  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  private constructor(
    source: string,
    nodes: Map<NodeId, XmlNode>,
    parents: Map<NodeId, NodeId>,
    errors: readonly ParseError[],
    nextId: number,
  ) {
    this.source = source;
    this.nodeMap = nodes;
    this.parentMap = parents;
    this.parseErrors = errors;
    this.nextId = nextId;
  }

  static parse(source: string): XmlDocument {
    const tree = buildTree(source);
    return new XmlDocument(source, tree.nodes, tree.parents, tree.errors, tree.nextId);
  }

  // --- reading ----------------------------------------------------------

  get root(): XmlNode {
    return this.nodeMap.get(ROOT_ID)!;
  }

  node(id: NodeId): XmlNode | undefined {
    return this.nodeMap.get(id);
  }

  /** Throws if the id is unknown — use where a missing node is a programming error. */
  expect(id: NodeId): XmlNode {
    const node = this.nodeMap.get(id);
    if (node === undefined) throw new Error(`No node with id ${id}`);
    return node;
  }

  parentOf(id: NodeId): NodeId | undefined {
    return this.parentMap.get(id);
  }

  childrenOf(id: NodeId): readonly NodeId[] {
    const node = this.nodeMap.get(id);
    return node !== undefined && isParentNode(node) ? node.children : [];
  }

  /** The document element, or undefined for a document with no root element. */
  documentElement(): NodeId | undefined {
    for (const child of this.childrenOf(ROOT_ID)) {
      if (this.nodeMap.get(child)?.kind === 'element') return child;
    }
    return undefined;
  }

  /** Ancestor chain from the node's parent up to the document, nearest first. */
  ancestorsOf(id: NodeId): NodeId[] {
    const out: NodeId[] = [];
    let cursor = this.parentMap.get(id);
    while (cursor !== undefined) {
      out.push(cursor);
      cursor = this.parentMap.get(cursor);
    }
    return out;
  }

  /**
   * Prefix → URI bindings in scope at a node, nearest declaration winning.
   *
   * Element and attribute *names* are resolved once at parse time, but QNames written inside
   * attribute *values* — `type="xs:string"`, `ref="tns:Address"`, a Schematron `@context` — can only
   * be resolved by whoever understands the vocabulary, and they resolve against the bindings in
   * scope where they are written. The empty-string key is the default namespace.
   */
  inScopeNamespaces(id: NodeId): Map<string, string> {
    const chain = [id, ...this.ancestorsOf(id)].reverse();
    const bindings = new Map<string, string>();
    for (const nodeId of chain) {
      const node = this.nodeMap.get(nodeId);
      if (node === undefined || node.kind !== 'element') continue;
      for (const declaration of node.namespaceDeclarations) {
        // An empty URI undeclares the prefix (XML Namespaces 1.0 allows this for the default).
        if (declaration.uri === '') bindings.delete(declaration.prefix);
        else bindings.set(declaration.prefix, declaration.uri);
      }
    }
    return bindings;
  }

  serialize(): string {
    return serializeNode({ source: this.source, nodes: this.nodeMap }, ROOT_ID);
  }

  // --- internals used by commands ---------------------------------------

  /** @internal */
  mintId(): NodeId {
    return this.nextId++ as NodeId;
  }

  /** @internal */
  register(node: XmlNode): void {
    this.nodeMap.set(node.id, node);
  }

  /**
   * Marks a node's own syntax as needing regeneration and propagates the subtree flag to ancestors,
   * which is what gates the serializer's fast slice path.
   *
   * Dirtiness is not cleared on undo. That costs a little serialization work on an undone subtree
   * but stays byte-exact, because regenerating a parent still slices each clean child verbatim.
   *
   * @internal
   */
  markDirty(id: NodeId, self = true): void {
    const node = this.nodeMap.get(id);
    if (node === undefined) return;
    if (self) node.selfDirty = true;
    let cursor: NodeId | undefined = id;
    while (cursor !== undefined) {
      const current = this.nodeMap.get(cursor);
      if (current === undefined) break;
      if (current.subtreeDirty && current !== node) break;
      current.subtreeDirty = true;
      cursor = this.parentMap.get(cursor);
    }
  }

  /** @internal */
  attachChild(parentId: NodeId, index: number, childId: NodeId): void {
    const parent = this.expect(parentId);
    if (!isParentNode(parent)) throw new Error(`Node ${parentId} cannot have children`);
    parent.children.splice(index, 0, childId);
    this.parentMap.set(childId, parentId);
    this.markDirty(parentId, false);
    this.markDirty(childId, false);
  }

  /** @internal Detaches without removing from the node map, so undo can re-attach the same ids. */
  detachChild(childId: NodeId): { parentId: NodeId; index: number } {
    const parentId = this.parentMap.get(childId);
    if (parentId === undefined) throw new Error(`Node ${childId} has no parent`);
    const parent = this.expect(parentId) as ParentNode;
    const index = parent.children.indexOf(childId);
    if (index === -1) throw new Error(`Node ${childId} is not a child of ${parentId}`);
    parent.children.splice(index, 1);
    this.parentMap.delete(childId);
    this.markDirty(parentId, false);
    return { parentId, index };
  }

  // --- history ----------------------------------------------------------

  /** Runs a command and pushes it onto the undo stack, discarding any redo tail. */
  run(command: Command): void {
    command.apply(this);
    this.undoStack.push(command);
    this.redoStack.length = 0;
  }

  undo(): Command | undefined {
    const command = this.undoStack.pop();
    if (command === undefined) return undefined;
    command.invert(this);
    this.redoStack.push(command);
    return command;
  }

  redo(): Command | undefined {
    const command = this.redoStack.pop();
    if (command === undefined) return undefined;
    command.apply(this);
    this.undoStack.push(command);
    return command;
  }

  get history(): readonly Command[] {
    return this.undoStack;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

// --- command constructors -----------------------------------------------

export interface NewElementSpec {
  readonly name: QName;
  readonly attributes?: readonly { name: QName; value: string }[];
  /**
   * Declarations to write on the new element. Needed when inserting into a namespace no prefix in
   * scope binds — the alternative is inventing a prefix on an ancestor, which rewrites a part of
   * the document the user did not touch.
   */
  readonly namespaceDeclarations?: readonly NamespaceDeclaration[];
}

/**
 * Inserts a newly created element. The node is minted once and reused across undo/redo so its id —
 * and therefore any selection or diagnostic keyed to it — stays stable across history navigation.
 */
export function insertElement(
  doc: XmlDocument,
  parentId: NodeId,
  index: number,
  spec: NewElementSpec,
): Command {
  const id = doc.mintId();
  doc.register({
    id,
    kind: 'element',
    name: spec.name,
    attributes: (spec.attributes ?? []).map(
      (a): Attribute => ({ name: a.name, value: a.value, raw: null, quote: '"' }),
    ),
    namespaceDeclarations: [...(spec.namespaceDeclarations ?? [])],
    children: [],
    openTagSpan: null,
    closeTagSpan: null,
    selfClosing: true,
    trailingWhitespace: '',
    span: null,
    selfDirty: true,
    subtreeDirty: true,
  });

  return {
    label: `Added <${qnameToString(spec.name)}>`,
    affected: id,
    apply: (d) => d.attachChild(parentId, index, id),
    invert: (d) => void d.detachChild(id),
  };
}

export function insertText(
  doc: XmlDocument,
  parentId: NodeId,
  index: number,
  value: string,
): Command {
  const id = doc.mintId();
  doc.register({ id, kind: 'text', value, span: null, selfDirty: true, subtreeDirty: true });
  return {
    label: 'Added text',
    affected: id,
    apply: (d) => d.attachChild(parentId, index, id),
    invert: (d) => void d.detachChild(id),
  };
}

export function removeNode(doc: XmlDocument, id: NodeId): Command {
  const node = doc.expect(id);
  const descendants = countDescendants(doc, id);
  const what = node.kind === 'element' ? `<${qnameToString(node.name)}>` : node.kind;
  const label =
    descendants > 0 ? `Deleted ${what} and ${descendants} children` : `Deleted ${what}`;

  let origin: { parentId: NodeId; index: number } | null = null;

  return {
    label,
    affected: doc.parentOf(id) ?? ROOT_ID,
    apply: (d) => {
      origin = d.detachChild(id);
    },
    invert: (d) => {
      if (origin === null) throw new Error('Cannot invert a command that has not been applied');
      d.attachChild(origin.parentId, origin.index, id);
    },
  };
}

export function moveNode(doc: XmlDocument, id: NodeId, newIndex: number): Command {
  const parentId = doc.parentOf(id);
  if (parentId === undefined) throw new Error(`Node ${id} has no parent`);
  const before = doc.childrenOf(parentId).indexOf(id);

  return {
    label: 'Moved node',
    affected: id,
    apply: (d) => {
      d.detachChild(id);
      d.attachChild(parentId, newIndex, id);
    },
    invert: (d) => {
      d.detachChild(id);
      d.attachChild(parentId, before, id);
    },
  };
}

export function setAttribute(
  doc: XmlDocument,
  elementId: NodeId,
  name: QName,
  value: string,
): Command {
  const element = doc.expect(elementId);
  if (element.kind !== 'element') throw new Error(`Node ${elementId} is not an element`);

  const existingIndex = element.attributes.findIndex(
    (a) => a.name.localName === name.localName && a.name.namespaceUri === name.namespaceUri,
  );
  const previous = existingIndex === -1 ? null : { ...element.attributes[existingIndex]! };

  return {
    label:
      previous === null
        ? `Added @${qnameToString(name)}`
        : `Changed @${qnameToString(name)} to ${value}`,
    affected: elementId,
    apply: (d) => {
      const node = d.expect(elementId);
      if (node.kind !== 'element') return;
      if (existingIndex === -1) {
        node.attributes.push({ name, value, raw: null, quote: '"' });
      } else {
        // Clearing `raw` is what stops the serializer re-emitting the stale source text.
        node.attributes[existingIndex] = { name, value, raw: null, quote: previous?.quote ?? '"' };
      }
      d.markDirty(elementId);
    },
    invert: (d) => {
      const node = d.expect(elementId);
      if (node.kind !== 'element') return;
      if (previous === null) node.attributes.pop();
      else node.attributes[existingIndex] = previous;
      d.markDirty(elementId);
    },
  };
}

export function removeAttribute(doc: XmlDocument, elementId: NodeId, name: QName): Command {
  const element = doc.expect(elementId);
  if (element.kind !== 'element') throw new Error(`Node ${elementId} is not an element`);
  const index = element.attributes.findIndex(
    (a) => a.name.localName === name.localName && a.name.namespaceUri === name.namespaceUri,
  );
  if (index === -1) throw new Error(`No attribute ${qnameToString(name)} on node ${elementId}`);
  const previous = { ...element.attributes[index]! };

  return {
    label: `Removed @${qnameToString(name)}`,
    affected: elementId,
    apply: (d) => {
      const node = d.expect(elementId);
      if (node.kind !== 'element') return;
      node.attributes.splice(index, 1);
      d.markDirty(elementId);
    },
    invert: (d) => {
      const node = d.expect(elementId);
      if (node.kind !== 'element') return;
      node.attributes.splice(index, 0, previous);
      d.markDirty(elementId);
    },
  };
}

export function setTextValue(doc: XmlDocument, id: NodeId, value: string): Command {
  const node = doc.expect(id);
  if (node.kind !== 'text' && node.kind !== 'cdata' && node.kind !== 'comment') {
    throw new Error(`Node ${id} has no text value`);
  }
  const previous = node.value;

  return {
    label: 'Changed text',
    affected: id,
    apply: (d) => {
      const target = d.expect(id);
      if ('value' in target) target.value = value;
      d.markDirty(id);
    },
    invert: (d) => {
      const target = d.expect(id);
      if ('value' in target) target.value = previous;
      d.markDirty(id);
    },
  };
}

/**
 * Add or change a namespace declaration on an element.
 *
 * Separate from `setAttribute` because the CST holds declarations apart from ordinary attributes —
 * they are not settings on the element, they change how every name beneath it resolves. Routing
 * them through the attribute list would produce a document that serialises correctly and resolves
 * wrongly.
 */
export function setNamespaceDeclaration(
  doc: XmlDocument,
  id: NodeId,
  prefix: string,
  uri: string,
): Command {
  const node = doc.expect(id);
  if (node.kind !== 'element') throw new Error('Only elements carry namespace declarations');
  const before = [...node.namespaceDeclarations];
  const existing = before.findIndex((declaration) => declaration.prefix === prefix);
  const after = [...before];
  if (existing >= 0) after[existing] = { prefix, uri };
  else after.push({ prefix, uri });

  const label =
    prefix === ''
      ? `Set the default namespace to ${uri}`
      : `Declared xmlns:${prefix}="${uri}"`;

  // A declaration lives in two places: this parallel list, which everything resolving a prefix
  // reads, and the element's ordinary attributes, which is what the serializer writes — `xmlns:p`
  // is syntactically an attribute and the parser stores it as one. Updating only the list left the
  // command a silent no-op: prefixes resolved in memory and nothing reached the file, so an
  // `xsi:type` added beside it produced a document that no longer parsed. Both are maintained here,
  // and the round trip is asserted in the tests, because the failure is invisible until reload.
  const attributeName: QName = prefix === ''
    ? { prefix: '', localName: 'xmlns', namespaceUri: XMLNS_NS }
    : { prefix: 'xmlns', localName: prefix, namespaceUri: XMLNS_NS };
  const attributeIndex = node.attributes.findIndex(
    (a) => qnameToString(a.name) === qnameToString(attributeName),
  );
  const previousAttribute = attributeIndex === -1 ? null : { ...node.attributes[attributeIndex]! };

  return {
    label,
    affected: id,
    apply: (d) => {
      const target = d.expect(id);
      if (target.kind !== 'element') return;
      target.namespaceDeclarations = [...after];
      const next = { name: attributeName, value: uri, raw: null, quote: '"' as const };
      if (attributeIndex === -1) target.attributes.push(next);
      else target.attributes[attributeIndex] = next;
      d.markDirty(id);
    },
    invert: (d) => {
      const target = d.expect(id);
      if (target.kind !== 'element') return;
      target.namespaceDeclarations = [...before];
      if (previousAttribute === null) target.attributes.pop();
      else target.attributes[attributeIndex] = previousAttribute;
      d.markDirty(id);
    },
  };
}

export function renameElement(doc: XmlDocument, id: NodeId, name: QName): Command {
  const node = doc.expect(id);
  if (node.kind !== 'element') throw new Error(`Node ${id} is not an element`);
  const previous = node.name;

  return {
    label: `Renamed <${qnameToString(previous)}> to <${qnameToString(name)}>`,
    affected: id,
    apply: (d) => {
      const target = d.expect(id);
      if (target.kind === 'element') target.name = name;
      d.markDirty(id);
    },
    invert: (d) => {
      const target = d.expect(id);
      if (target.kind === 'element') target.name = previous;
      d.markDirty(id);
    },
  };
}

function countDescendants(doc: XmlDocument, id: NodeId): number {
  let total = 0;
  for (const child of doc.childrenOf(id)) total += 1 + countDescendants(doc, child);
  return total;
}
