import {
  ROOT_ID,
  insertElement,
  insertText,
  isElement,
  removeAttribute,
  removeNode,
  setAttribute,
  setTextValue,
  type Command,
  type NodeId,
  type QName,
  type XmlDocument,
} from '@x-editor/xml-core';
import {
  ANY_TYPE,
  ANY_SIMPLE_TYPE,
  XSD_NS,
  compileContentModel,
  isBuiltInName,
  qnameKey,
  type Particle,
  type SchemaModel,
  type XsdQName,
} from '@x-editor/xsd';
import { compose } from './insert.js';

/**
 * Authoring operations on a schema, expressed as edits to the same CST everything else edits.
 *
 * The distinguishing problem of an XSD editor is that a schema is a *graph written as a tree*:
 * `type="Address"` is an edge, and the tree editor cannot see it. Every operation here exists
 * because doing it by hand means finding those edges yourself, and missing one produces a schema
 * that still parses and no longer means what you wrote.
 *
 * Nothing here consults the compiled model to find references. Renaming has to work on a schema
 * that does not currently compile — which is the state a schema is in for most of the time anyone
 * is editing it — so references are found syntactically, by the attributes that can hold a QName.
 */

export type Space = 'element' | 'type' | 'group' | 'attributeGroup' | 'attribute';

interface ReferenceSite {
  /** The XSD element that carries the attribute. */
  readonly owner: string;
  readonly attribute: string;
  readonly space: Space;
  /** `substitutionGroup` (1.1) and `memberTypes` hold whitespace-separated lists. */
  readonly list: boolean;
}

/**
 * Every attribute in XSD whose value is a reference to a named component.
 *
 * Written out rather than derived, because the six symbol spaces are not inferable from the
 * attribute name: `ref` means three different things depending on the element it sits on, and
 * `base` and `type` and `itemType` all point at the same space under different names. A table you
 * can read against the spec is worth more here than a clever rule.
 */
const REFERENCE_SITES: readonly ReferenceSite[] = [
  { owner: 'element', attribute: 'ref', space: 'element', list: false },
  { owner: 'element', attribute: 'substitutionGroup', space: 'element', list: true },
  { owner: 'element', attribute: 'type', space: 'type', list: false },
  { owner: 'attribute', attribute: 'ref', space: 'attribute', list: false },
  { owner: 'attribute', attribute: 'type', space: 'type', list: false },
  { owner: 'restriction', attribute: 'base', space: 'type', list: false },
  { owner: 'extension', attribute: 'base', space: 'type', list: false },
  { owner: 'list', attribute: 'itemType', space: 'type', list: false },
  { owner: 'union', attribute: 'memberTypes', space: 'type', list: true },
  { owner: 'alternative', attribute: 'type', space: 'type', list: false },
  { owner: 'group', attribute: 'ref', space: 'group', list: false },
  { owner: 'attributeGroup', attribute: 'ref', space: 'attributeGroup', list: false },
];

/** The symbol space a named declaration lives in, or null when it does not declare a name. */
export function declarationSpace(localName: string): Space | null {
  switch (localName) {
    case 'element':
      return 'element';
    case 'attribute':
      return 'attribute';
    case 'simpleType':
    case 'complexType':
      return 'type';
    case 'group':
      return 'group';
    case 'attributeGroup':
      return 'attributeGroup';
    default:
      return null;
  }
}

export function attributeValue(document: XmlDocument, id: NodeId, name: string): string | null {
  const node = document.node(id);
  if (node === undefined || !isElement(node)) return null;
  for (const attribute of node.attributes) {
    if (attribute.name.prefix === '' && attribute.name.localName === name) return attribute.value;
  }
  return null;
}

/** The schema's own target namespace — where its global declarations land. */
export function targetNamespaceOf(document: XmlDocument): string | null {
  const rootId = document.documentElement();
  if (rootId === undefined) return null;
  return attributeValue(document, rootId, 'targetNamespace');
}

/**
 * Resolve a QName written in an attribute value, exactly as the schema parser does.
 *
 * The subtlety worth keeping is that an unprefixed name resolves against the *default namespace*,
 * not the target namespace. A schema with `targetNamespace="urn:x"` and no `xmlns="urn:x"` has
 * `type="Address"` pointing at no-namespace, which is a real and very common bug — so this must
 * report what was written rather than what was probably meant.
 */
export function resolveReference(
  document: XmlDocument,
  id: NodeId,
  text: string,
): XsdQName | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const colon = trimmed.indexOf(':');
  if (colon < 0) {
    return { namespaceUri: document.inScopeNamespaces(id).get('') ?? null, localName: trimmed };
  }
  const uri = document.inScopeNamespaces(id).get(trimmed.slice(0, colon));
  if (uri === undefined) return null;
  return { namespaceUri: uri, localName: trimmed.slice(colon + 1) };
}

export interface Reference {
  readonly node: NodeId;
  readonly attribute: string;
  readonly space: Space;
  /** The position of the matching token when the attribute holds a list. */
  readonly token: number;
  readonly text: string;
  readonly resolved: XsdQName | null;
}

/** Every QName-valued attribute in the document, resolved. */
export function allReferences(document: XmlDocument): Reference[] {
  const out: Reference[] = [];

  const walk = (id: NodeId): void => {
    const node = document.node(id);
    if (node !== undefined && isElement(node) && node.name.namespaceUri === XSD_NS) {
      for (const site of REFERENCE_SITES) {
        if (site.owner !== node.name.localName) continue;
        const raw = attributeValue(document, id, site.attribute);
        if (raw === null) continue;

        const tokens = site.list ? raw.split(/\s+/).filter((token) => token !== '') : [raw.trim()];
        tokens.forEach((text, token) => {
          out.push({
            node: id,
            attribute: site.attribute,
            space: site.space,
            token,
            text,
            resolved: resolveReference(document, id, text),
          });
        });
      }
    }
    for (const child of document.childrenOf(id)) walk(child);
  };

  const rootId = document.documentElement();
  if (rootId !== undefined) walk(rootId);
  return out;
}

export interface GlobalDeclaration {
  readonly node: NodeId;
  readonly space: Space;
  readonly name: XsdQName;
}

/** The named components declared at the top level, which are the only referenceable ones. */
export function globalDeclarations(document: XmlDocument): GlobalDeclaration[] {
  const rootId = document.documentElement();
  if (rootId === undefined) return [];

  const targetNamespace = targetNamespaceOf(document);
  const out: GlobalDeclaration[] = [];

  // `xs:redefine` and `xs:override` also hold global declarations, and a rename that ignored them
  // would silently miss half the components of a schema that uses them.
  const containers = [rootId];
  for (const childId of document.childrenOf(rootId)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    if (child.name.namespaceUri !== XSD_NS) continue;
    if (child.name.localName === 'redefine' || child.name.localName === 'override') {
      containers.push(childId);
    }
  }

  for (const containerId of containers) {
    for (const childId of document.childrenOf(containerId)) {
      const child = document.node(childId);
      if (child === undefined || !isElement(child)) continue;
      if (child.name.namespaceUri !== XSD_NS) continue;

      const space = declarationSpace(child.name.localName);
      if (space === null) continue;
      const name = attributeValue(document, childId, 'name');
      if (name === null) continue;

      out.push({ node: childId, space, name: { namespaceUri: targetNamespace, localName: name } });
    }
  }

  return out;
}

/** True when a declaration is global, and so renaming it has to chase references. */
export function isGlobalDeclaration(document: XmlDocument, id: NodeId): boolean {
  return globalDeclarations(document).some((declaration) => declaration.node === id);
}

/** The references pointing at one declaration. */
export function referencesTo(document: XmlDocument, id: NodeId): Reference[] {
  const declaration = globalDeclarations(document).find((entry) => entry.node === id);
  if (declaration === undefined) return [];

  const key = qnameKey(declaration.name);
  return allReferences(document).filter(
    (reference) =>
      reference.space === declaration.space &&
      reference.resolved !== null &&
      qnameKey(reference.resolved) === key,
  );
}

/**
 * Rename a global component and every reference to it, as one undoable step.
 *
 * The whole value is in the "and every reference". A rename that leaves the edges behind turns a
 * working schema into one that parses and dangles, and the failure surfaces somewhere else entirely
 * — usually in someone else's document, weeks later.
 *
 * Prefixes on references are left alone. `tns:Address` becomes `tns:Postal`, never a re-prefixed
 * form of our own choosing: the prefix is the author's, and rewriting it would put churn in the
 * diff that has nothing to do with the rename.
 */
export function renameComponent(
  document: XmlDocument,
  id: NodeId,
  newName: string,
): Command | null {
  const trimmed = newName.trim();
  if (trimmed === '') return null;

  const current = attributeValue(document, id, 'name');
  if (current === null || current === trimmed) return null;

  const nameAttribute: QName = { prefix: '', localName: 'name', namespaceUri: null };
  const references = referencesTo(document, id);

  // Group by node and attribute, so a list-valued attribute is written once with all of its tokens
  // updated rather than once per token — each write would otherwise clobber the last.
  const rewrites = new Map<string, { node: NodeId; attribute: string; tokens: Set<number> }>();
  for (const reference of references) {
    const key = `${reference.node} ${reference.attribute}`;
    const existing = rewrites.get(key);
    if (existing === undefined) {
      rewrites.set(key, {
        node: reference.node,
        attribute: reference.attribute,
        tokens: new Set([reference.token]),
      });
    } else {
      existing.tokens.add(reference.token);
    }
  }

  const commands: Command[] = [setAttribute(document, id, nameAttribute, trimmed)];

  for (const rewrite of rewrites.values()) {
    const raw = attributeValue(document, rewrite.node, rewrite.attribute);
    if (raw === null) continue;

    const separated = raw.split(/(\s+)/);
    let token = -1;
    const rebuilt = separated
      .map((piece) => {
        if (piece.trim() === '') return piece;
        token++;
        if (!rewrite.tokens.has(token)) return piece;
        const colon = piece.indexOf(':');
        return colon < 0 ? trimmed : `${piece.slice(0, colon + 1)}${trimmed}`;
      })
      .join('');

    commands.push(
      setAttribute(
        document,
        rewrite.node,
        { prefix: '', localName: rewrite.attribute, namespaceUri: null },
        rebuilt,
      ),
    );
  }

  const label =
    references.length === 0
      ? `Renamed ${current} to ${trimmed}`
      : `Renamed ${current} to ${trimmed} and updated ${references.length} ${
          references.length === 1 ? 'reference' : 'references'
        }`;

  return compose(label, commands);
}

// --- extract and inline -------------------------------------------------

/**
 * The text to write for a reference to a component of this schema, from a given point.
 *
 * Null when no correct form exists — a schema with no target namespace but a default `xmlns` in
 * scope cannot name its own components in an attribute value at all, because there is no way to
 * write "a name in no namespace" once a default binding is active. Refusing is the honest answer;
 * writing the bare name would produce a reference that silently points elsewhere.
 */
export function referenceTextFor(
  document: XmlDocument,
  at: NodeId,
  localName: string,
): string | null {
  const target = targetNamespaceOf(document);
  const bindings = document.inScopeNamespaces(at);

  if (target === null) return bindings.get('') === undefined ? localName : null;
  if (bindings.get('') === target) return localName;

  for (const [prefix, uri] of bindings) {
    if (prefix !== '' && uri === target) return `${prefix}:${localName}`;
  }
  return null;
}

/** Moves a node to a new parent. `moveNode` only reorders within one parent. */
function reparent(id: NodeId, parent: NodeId, index: number): Command {
  let origin: { parentId: NodeId; index: number } | null = null;

  return {
    label: 'Moved node',
    affected: id,
    apply: (document) => {
      origin = document.detachChild(id);
      document.attachChild(parent, index, id);
    },
    invert: (document) => {
      if (origin === null) throw new Error('Cannot invert a command that has not been applied');
      document.detachChild(id);
      document.attachChild(origin.parentId, origin.index, id);
    },
  };
}

/** True when a node is an anonymous type sitting inside a declaration. */
export function isInlineType(document: XmlDocument, id: NodeId): boolean {
  const node = document.node(id);
  if (node === undefined || !isElement(node) || node.name.namespaceUri !== XSD_NS) return false;
  if (node.name.localName !== 'simpleType' && node.name.localName !== 'complexType') return false;
  if (attributeValue(document, id, 'name') !== null) return false;

  const parentId = document.parentOf(id);
  if (parentId === undefined) return false;
  const parent = document.node(parentId);
  return (
    parent !== undefined &&
    isElement(parent) &&
    parent.name.namespaceUri === XSD_NS &&
    (parent.name.localName === 'element' || parent.name.localName === 'attribute')
  );
}

/**
 * Lift an anonymous inline type to the top level and point the declaration at it by name.
 *
 * This is the refactoring that turns a schema you can only read top-to-bottom into one you can
 * reuse. Anonymous types are the default shape of a hand-written schema and the reason the same
 * address structure gets written out four times; naming one is the first step to noticing that.
 */
export function extractType(
  document: XmlDocument,
  id: NodeId,
  newName: string,
): Command | null {
  const trimmed = newName.trim();
  if (trimmed === '' || !isInlineType(document, id)) return null;

  const rootId = document.documentElement();
  if (rootId === undefined) return null;

  const declarationId = document.parentOf(id);
  if (declarationId === undefined) return null;

  // A name that is already taken would produce two components in one symbol space, which is a
  // harder error to unpick than the one being avoided.
  const taken = globalDeclarations(document).some(
    (declaration) => declaration.space === 'type' && declaration.name.localName === trimmed,
  );
  if (taken) return null;

  const reference = referenceTextFor(document, declarationId, trimmed);
  if (reference === null) return null;

  // Place it after whichever top-level component contains the declaration, so related things stay
  // near each other rather than all extractions piling up at the end of the file.
  const topLevel = topLevelAncestor(document, id, rootId);
  if (topLevel === null) return null;

  const siblings = document.childrenOf(rootId);
  const at = siblings.indexOf(topLevel);
  if (at < 0) return null;

  const separator = whitespaceBefore(document, topLevel) ?? '\n  ';
  const unit = indentUnit(document);

  return compose(`Extracted ${trimmed}`, [
    setAttribute(document, id, { prefix: '', localName: 'name', namespaceUri: null }, trimmed),
    setAttribute(document, declarationId, { prefix: '', localName: 'type', namespaceUri: null }, reference),
    // The type is leaving; without this the declaration is left holding two whitespace text nodes
    // and serializes as an empty two-line element, which is diff noise nobody asked for.
    ...emptyingWhitespace(document, declarationId, id),
    ...reindent(document, id, 2 - elementDepth(document, id), unit),
    insertText(document, rootId, at + 1, separator),
    reparent(id, rootId, at + 2),
  ]);
}

/**
 * Fold a global type back into the single declaration that uses it.
 *
 * Offered only when exactly one reference exists. Inlining a type two declarations share would
 * silently break the other one, and the count is the thing the author cannot see for themselves.
 */
export function inlineType(document: XmlDocument, declarationId: NodeId): Command | null {
  const declaration = document.node(declarationId);
  if (declaration === undefined || !isElement(declaration)) return null;
  if (declaration.name.namespaceUri !== XSD_NS) return null;
  if (declaration.name.localName !== 'element' && declaration.name.localName !== 'attribute') {
    return null;
  }

  const typeText = attributeValue(document, declarationId, 'type');
  if (typeText === null) return null;
  const resolved = resolveReference(document, declarationId, typeText);
  if (resolved === null) return null;

  const target = globalDeclarations(document).find(
    (entry) => entry.space === 'type' && qnameKey(entry.name) === qnameKey(resolved),
  );
  if (target === undefined) return null;
  if (referencesTo(document, target.node).length !== 1) return null;

  // The type must land after any annotation: XSD fixes the child order, and getting it wrong
  // produces an error message about the schema for schemas that means nothing to anyone.
  const children = document.childrenOf(declarationId);
  let index = 0;
  children.forEach((childId, position) => {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) return;
    if (child.name.namespaceUri === XSD_NS && child.name.localName === 'annotation') {
      index = position + 1;
    }
  });

  const unit = indentUnit(document);
  const own = whitespaceBefore(document, declarationId) ?? '\n';
  const orphaned = whitespaceNodeBefore(document, target.node);

  return compose(`Inlined ${target.name.localName}`, [
    removeAttribute(document, declarationId, {
      prefix: '',
      localName: 'type',
      namespaceUri: null,
    }),
    removeAttribute(document, target.node, {
      prefix: '',
      localName: 'name',
      namespaceUri: null,
    }),
    ...reindent(
      document,
      target.node,
      elementDepth(document, declarationId) + 1 - elementDepth(document, target.node),
      unit,
    ),
    // The blank line the type used to sit on goes with it, or inlining leaves a gap behind at the
    // top level for every type folded in.
    ...(orphaned === null ? [] : [removeNode(document, orphaned)]),
    insertText(document, declarationId, index, `${own}${unit}`),
    reparent(target.node, declarationId, index + 1),
    // Only when nothing follows: a declaration that already has children has its own closing
    // whitespace, and a second one would open a blank line inside it.
    ...(index >= children.length ? [insertText(document, declarationId, index + 2, own)] : []),
  ]);
}

/**
 * The indentation one level costs in this document, read from the file rather than configured.
 *
 * Matching what is already there is the only rule that cannot annoy anyone — a two-space file and a
 * tab file both stay themselves, and a refactoring never produces a whole-file diff.
 */
function indentUnit(document: XmlDocument): string {
  const rootId = document.documentElement();
  if (rootId === undefined) return '  ';
  for (const childId of document.childrenOf(rootId)) {
    const child = document.node(childId);
    if (child === undefined || child.kind !== 'text') continue;
    if (child.value.trim() !== '' || !child.value.includes('\n')) continue;
    return child.value.slice(child.value.lastIndexOf('\n') + 1);
  }
  return '  ';
}

/** How deep an element sits, with the document element at 1. */
function elementDepth(document: XmlDocument, id: NodeId): number {
  let depth = 1;
  for (const ancestor of document.ancestorsOf(id)) {
    const node = document.node(ancestor);
    if (node !== undefined && isElement(node)) depth++;
  }
  return depth;
}

/**
 * Re-indent a subtree that is about to change depth.
 *
 * Only whitespace-only text nodes are touched, so nothing inside `xs:documentation` — which is real
 * content, and often deliberately formatted — is ever rewritten.
 */
function reindent(
  document: XmlDocument,
  id: NodeId,
  delta: number,
  unit: string,
): Command[] {
  if (delta === 0 || unit === '') return [];

  const out: Command[] = [];
  const visit = (nodeId: NodeId): void => {
    for (const childId of document.childrenOf(nodeId)) {
      const child = document.node(childId);
      if (child === undefined) continue;

      if (child.kind === 'text' && child.value.trim() === '' && child.value.includes('\n')) {
        const shifted = child.value
          .split('\n')
          .map((line, index) => {
            if (index === 0) return line;
            if (delta > 0) return `${unit.repeat(delta)}${line}`;
            let rest = line;
            for (let step = 0; step < -delta; step++) {
              if (rest.startsWith(unit)) rest = rest.slice(unit.length);
            }
            return rest;
          })
          .join('\n');
        if (shifted !== child.value) out.push(setTextValue(document, childId, shifted));
      }

      visit(childId);
    }
  };

  visit(id);
  return out;
}

/** Removes the whitespace a parent is left holding when its only element child moves away. */
function emptyingWhitespace(
  document: XmlDocument,
  parentId: NodeId,
  leaving: NodeId,
): Command[] {
  const children = document.childrenOf(parentId);
  const remaining = children.filter((childId) => {
    if (childId === leaving) return false;
    const node = document.node(childId);
    return node !== undefined && node.kind !== 'text';
  });
  if (remaining.length > 0) return [];

  return children
    .filter((childId) => {
      const node = document.node(childId);
      return node !== undefined && node.kind === 'text' && node.value.trim() === '';
    })
    .map((childId) => removeNode(document, childId));
}

function topLevelAncestor(document: XmlDocument, id: NodeId, rootId: NodeId): NodeId | null {
  let cursor = id;
  for (;;) {
    const parentId = document.parentOf(cursor);
    if (parentId === undefined) return null;
    if (parentId === rootId) return cursor;
    cursor = parentId;
  }
}

/** The indentation a sibling already sits behind, so an extraction matches the file it lands in. */
function whitespaceBefore(document: XmlDocument, id: NodeId): string | null {
  const node = whitespaceNodeBefore(document, id);
  if (node === null) return null;
  const previous = document.node(node);
  return previous !== undefined && previous.kind === 'text' ? previous.value : null;
}

function whitespaceNodeBefore(document: XmlDocument, id: NodeId): NodeId | null {
  const parentId = document.parentOf(id);
  if (parentId === undefined) return null;
  const siblings = document.childrenOf(parentId);
  const at = siblings.indexOf(id);
  if (at <= 0) return null;

  const previousId = siblings[at - 1]!;
  const previous = document.node(previousId);
  if (previous === undefined || previous.kind !== 'text') return null;
  return previous.value.trim() === '' ? previousId : null;
}

// --- documentation ------------------------------------------------------

/** The `xs:documentation` text on a declaration, collapsed. */
export function documentationOf(document: XmlDocument, id: NodeId): string | null {
  const target = documentationNode(document, id);
  if (target === null) return null;

  let text = '';
  const visit = (nodeId: NodeId): void => {
    const node = document.node(nodeId);
    if (node === undefined) return;
    if (node.kind === 'text' || node.kind === 'cdata') text += node.value;
    for (const inner of document.childrenOf(nodeId)) visit(inner);
  };
  visit(target);

  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? null : collapsed;
}

function documentationNode(document: XmlDocument, id: NodeId): NodeId | null {
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined || !isElement(child)) continue;
    if (child.name.namespaceUri !== XSD_NS || child.name.localName !== 'annotation') continue;

    for (const grandchildId of document.childrenOf(childId)) {
      const grandchild = document.node(grandchildId);
      if (grandchild === undefined || !isElement(grandchild)) continue;
      if (grandchild.name.namespaceUri !== XSD_NS) continue;
      if (grandchild.name.localName === 'documentation') return grandchildId;
    }
  }
  return null;
}

/**
 * Write documentation onto a declaration, creating `xs:annotation` and `xs:documentation` if needed.
 *
 * This is the highest-leverage edit an XSD author can make for anyone who later opens a document
 * against their schema: `describe()` shows authored text in preference to anything it can generate,
 * so a sentence written here is the difference between a palette that explains itself and one that
 * guesses from the element name. Making it a one-field edit rather than three nested insertions is
 * the entire point.
 *
 * `xs:annotation` must be the *first* child of a declaration, so it is inserted at the front rather
 * than appended — appending produces a schema that no longer validates against the schema for
 * schemas, which is a mistake with a genuinely baffling error message.
 */
export function setDocumentation(
  document: XmlDocument,
  id: NodeId,
  text: string,
): Command | null {
  const existing = documentationNode(document, id);

  if (existing !== null) {
    const children = document.childrenOf(existing);
    const textChild = children.find((child) => {
      const node = document.node(child);
      return node !== undefined && (node.kind === 'text' || node.kind === 'cdata');
    });
    if (textChild !== undefined) return setTextValue(document, textChild, text);
    return insertText(document, existing, 0, text);
  }

  if (text.trim() === '') return null;

  const node = document.node(id);
  if (node === undefined || !isElement(node)) return null;
  const prefix = node.name.namespaceUri === XSD_NS ? node.name.prefix : 'xs';

  const annotation = insertElement(document, id, 0, {
    name: { prefix, localName: 'annotation', namespaceUri: XSD_NS },
  });
  const documentationElement = insertElement(document, annotation.affected, 0, {
    name: { prefix, localName: 'documentation', namespaceUri: XSD_NS },
  });
  const body = insertText(document, documentationElement.affected, 0, text);

  return compose('Added documentation', [annotation, documentationElement, body]);
}

// --- self-validation ----------------------------------------------------

export interface SelfProblem {
  readonly node: NodeId;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly hint: string | null;
}

/**
 * What is wrong with the schema being edited, over and above what the parser already says.
 *
 * Two classes, both invisible in the tree. A dangling reference is a name that resolves to nothing
 * — usually because a prefix is missing or a default namespace was never declared, so the author is
 * looking at a name that reads correctly and points nowhere. An ambiguous content model is legal to
 * write and rejected by most validators, so finding out at authoring time rather than in someone
 * else's build is the difference between a two-minute fix and a bug report.
 */
export function selfProblems(document: XmlDocument, model: SchemaModel | null): SelfProblem[] {
  const out: SelfProblem[] = [];
  const declarations = globalDeclarations(document);
  const declared = new Set(
    declarations.map((declaration) => `${declaration.space} ${qnameKey(declaration.name)}`),
  );
  const hasImports = document
    .childrenOf(document.documentElement() ?? ROOT_ID)
    .some((childId) => {
      const child = document.node(childId);
      return (
        child !== undefined &&
        isElement(child) &&
        child.name.namespaceUri === XSD_NS &&
        (child.name.localName === 'import' ||
          child.name.localName === 'include' ||
          child.name.localName === 'redefine' ||
          child.name.localName === 'override')
      );
    });

  const targetNamespace = targetNamespaceOf(document);

  for (const reference of allReferences(document)) {
    if (reference.resolved === null) {
      out.push({
        node: reference.node,
        severity: 'error',
        message: `@${reference.attribute} uses the prefix "${reference.text.slice(
          0,
          reference.text.indexOf(':'),
        )}:", which is not declared here.`,
        hint: 'Declare it with an xmlns: attribute, or drop the prefix.',
      });
      continue;
    }

    if (reference.space === 'type' && isBuiltIn(reference.resolved)) continue;
    // A schema that pulls in other documents cannot be checked for dangling references on its own:
    // the missing component may well be in a file this editor has not been given.
    if (hasImports) continue;
    if (declared.has(`${reference.space} ${qnameKey(reference.resolved)}`)) continue;

    const wroteUnprefixed = !reference.text.includes(':');
    const wouldResolve =
      wroteUnprefixed &&
      declared.has(
        `${reference.space} ${qnameKey({
          namespaceUri: targetNamespace,
          localName: reference.resolved.localName,
        })}`,
      );

    out.push({
      node: reference.node,
      severity: 'error',
      message: `@${reference.attribute} refers to "${reference.text}", which is not declared in this schema.`,
      hint: wouldResolve
        ? `There is a component of that name in ${targetNamespace}, but "${reference.text}" has no prefix, so it means a name in no namespace. Add xmlns="${targetNamespace}" to the schema element, or write a prefix.`
        : null,
    });
  }

  if (model !== null) {
    for (const declaration of declarations) {
      if (declaration.space !== 'type') continue;
      const particle = particleOf(model, declaration.name);
      if (particle === null || particle.kind === 'all') continue;

      const compiled = compileContentModel(particle);
      if (!compiled.ambiguous) continue;

      out.push({
        node: declaration.node,
        severity: 'warning',
        message: `The content model of ${declaration.name.localName} is ambiguous: two branches accept the same element name from the same point.`,
        hint: 'This breaks Unique Particle Attribution, and most validators reject such a schema. Merging the branches, or giving them distinct element names, resolves it.',
      });
    }
  }

  return out;
}

function isBuiltIn(name: XsdQName): boolean {
  return (
    isBuiltInName(name) ||
    qnameKey(name) === qnameKey(ANY_TYPE) ||
    qnameKey(name) === qnameKey(ANY_SIMPLE_TYPE)
  );
}

function particleOf(model: SchemaModel, name: XsdQName): Particle | null {
  try {
    const type = model.typeByName(name, { documentUri: model.set.rootUri, node: ROOT_ID });
    return type.form === 'complex' ? type.particle : null;
  } catch {
    return null;
  }
}
