/**
 * XPath over our own CST — no second DOM.
 *
 * XSD 1.1's `xs:assert` is literally an XPath 2.0 expression and `xs:alternative` is an XPath
 * predicate, so 1.1 needs an XPath engine. So does the Schematron work in Phase 5, and so does the
 * live XPath editor that makes Schematron approachable at all. One engine, three uses.
 *
 * The important decision is what it evaluates *against*. The obvious route — build a `slimdom` tree
 * beside our CST — means two representations of the same document and a synchronisation problem on
 * every keystroke, which is exactly the class of bug this project has avoided everywhere else. So
 * instead the CST **is** the XPath data model: fontoxpath navigates through an `IDomFacade`, and
 * this file is that facade.
 *
 * Nodes are presented as small adapter objects. They are cached and reused, because XPath node
 * identity is semantic — `is`, `union`, deduplication and document order all depend on two
 * references to the same node being the same object.
 *
 * Safety falls out of the choice: fontoxpath has no `fn:doc()` unless a resolver is supplied, and no
 * filesystem or network access at all. A hostile `xs:assert` — or a hostile Schematron rule — cannot
 * exfiltrate the document it is inspecting (PLAN.md §8).
 */

import {
  ROOT_ID,
  XmlDocument,
  isElement,
  qnameToString,
  type NodeId,
} from '@x-editor/xml-core';
import type { IDomFacade } from 'fontoxpath';

/**
 * fontoxpath is loaded on demand, not imported.
 *
 * It is ~330KB, and most documents need no XPath at all: only XSD 1.1 assertions, Schematron and
 * the XPath editor do. A static import would put all of it in the main chunk for every user, which
 * is precisely the failure PLAN.md §11 risk 4 names — "a stray top-level import pulling a validator
 * into the main chunk".
 *
 * The consequence is that callers must `await loadXPath()` before evaluating. Making that explicit
 * rather than hiding it behind an async evaluator keeps the guidance engine synchronous, which it
 * has to be: it runs on every keystroke.
 */
type FontoXPath = typeof import('fontoxpath');

let engine: FontoXPath | null = null;
let loading: Promise<FontoXPath> | null = null;

export function xpathReady(): boolean {
  return engine !== null;
}

export async function loadXPath(): Promise<void> {
  if (engine !== null) return;
  loading ??= import('fontoxpath').then((module) => {
    engine = module;
    return module;
  });
  await loading;
}

const ELEMENT_NODE = 1;
const ATTRIBUTE_NODE = 2;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;

/** The shape fontoxpath reads. Deliberately minimal — it asks for very little. */
export interface XPathNode {
  readonly nodeType: number;
  readonly localName?: string;
  readonly namespaceURI?: string | null;
  readonly prefix?: string | null;
  readonly nodeName?: string;
  readonly name?: string;
  readonly value?: string;
  readonly data?: string;
  readonly target?: string;
  /** @internal the CST node this stands for. */
  readonly __id: NodeId;
  /** @internal set on attribute adapters. */
  readonly __attribute?: number;
}

/**
 * Presents an `XmlDocument` to fontoxpath.
 *
 * One facade per document *version*: adapters cache node identity, and an edit that changes a
 * node's children would otherwise be invisible to a cached answer. Constructing one is cheap — the
 * adapters are built lazily as the expression walks — so a fresh facade per evaluation batch is the
 * right granularity.
 */
export class CstDomFacade {
  // Structurally an `IDomFacade`, but not nominally: fontoxpath's signatures are written against
  // its own `Element`/`Attr` types, and our adapters carry an extra field those do not know about.
  // The cast lives at the one call site rather than being spread across every method.
  private readonly elements = new Map<NodeId, XPathNode>();
  private readonly attributes = new Map<string, XPathNode>();

  /**
   * @param isolate when set, this node behaves as though it has no parent.
   *
   * XSD 1.1 assertions evaluate against the element as if it were the whole document: an assertion
   * may not look at its ancestors, because the element has to be checkable independently of where it
   * ends up. Without this, `..` would quietly reach the real parent and an assertion would pass or
   * fail depending on context it is not allowed to see.
   */
  constructor(
    private readonly doc: XmlDocument,
    private readonly isolate: NodeId | null = null,
  ) {}

  /** The adapter for a CST node, minted once so XPath node identity holds. */
  nodeFor(id: NodeId): XPathNode | null {
    const cached = this.elements.get(id);
    if (cached !== undefined) return cached;

    const node = this.doc.node(id);
    if (node === undefined) return null;

    let adapter: XPathNode;
    switch (node.kind) {
      case 'document':
        adapter = { nodeType: DOCUMENT_NODE, __id: id };
        break;
      case 'element':
        adapter = {
          nodeType: ELEMENT_NODE,
          localName: node.name.localName,
          namespaceURI: node.name.namespaceUri,
          prefix: node.name.prefix === '' ? null : node.name.prefix,
          nodeName: qnameToString(node.name),
          __id: id,
        };
        break;
      case 'text':
        adapter = { nodeType: TEXT_NODE, data: node.value, nodeName: '#text', __id: id };
        break;
      case 'cdata':
        adapter = {
          nodeType: CDATA_SECTION_NODE,
          data: node.value,
          nodeName: '#cdata-section',
          __id: id,
        };
        break;
      case 'comment':
        adapter = { nodeType: COMMENT_NODE, data: node.value, nodeName: '#comment', __id: id };
        break;
      case 'pi':
        adapter = {
          nodeType: PROCESSING_INSTRUCTION_NODE,
          target: node.target,
          data: node.value,
          nodeName: node.target,
          localName: node.target,
          __id: id,
        };
        break;
      default:
        // The XML declaration and DOCTYPE are not nodes in the XPath data model at all.
        return null;
    }

    this.elements.set(id, adapter);
    return adapter;
  }

  private attributeFor(ownerId: NodeId, index: number): XPathNode | null {
    const key = `${ownerId}:${index}`;
    const cached = this.attributes.get(key);
    if (cached !== undefined) return cached;

    const owner = this.doc.node(ownerId);
    if (owner === undefined || !isElement(owner)) return null;
    const attribute = owner.attributes[index];
    if (attribute === undefined) return null;

    const adapter: XPathNode = {
      nodeType: ATTRIBUTE_NODE,
      localName: attribute.name.localName,
      name: qnameToString(attribute.name),
      nodeName: qnameToString(attribute.name),
      namespaceURI: attribute.name.namespaceUri,
      prefix: attribute.name.prefix === '' ? null : attribute.name.prefix,
      value: attribute.value,
      __id: ownerId,
      __attribute: index,
    };
    this.attributes.set(key, adapter);
    return adapter;
  }

  // --- IDomFacade -------------------------------------------------------

  getAllAttributes(node: XPathNode): XPathNode[] {
    const owner = this.doc.node(node.__id);
    if (owner === undefined || !isElement(owner)) return [];

    const out: XPathNode[] = [];
    for (let index = 0; index < owner.attributes.length; index++) {
      // Namespace declarations are not attributes in the XPath data model, and returning them makes
      // `@*` produce results no XPath author expects.
      const attribute = owner.attributes[index]!;
      if (attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns') continue;
      const adapter = this.attributeFor(node.__id, index);
      if (adapter !== null) out.push(adapter);
    }
    return out;
  }

  getAttribute(node: XPathNode, attributeName: string): string | null {
    const owner = this.doc.node(node.__id);
    if (owner === undefined || !isElement(owner)) return null;
    for (const attribute of owner.attributes) {
      if (qnameToString(attribute.name) === attributeName) return attribute.value;
    }
    return null;
  }

  getChildNodes(node: XPathNode): XPathNode[] {
    if (node.nodeType === ATTRIBUTE_NODE) return [];
    const out: XPathNode[] = [];
    for (const childId of this.doc.childrenOf(node.__id)) {
      const adapter = this.nodeFor(childId);
      if (adapter !== null) out.push(adapter);
    }
    return out;
  }

  getData(node: XPathNode): string {
    if (node.nodeType === ATTRIBUTE_NODE) return node.value ?? '';
    return node.data ?? '';
  }

  getFirstChild(node: XPathNode): XPathNode | null {
    return this.getChildNodes(node)[0] ?? null;
  }

  getLastChild(node: XPathNode): XPathNode | null {
    const children = this.getChildNodes(node);
    return children[children.length - 1] ?? null;
  }

  getNextSibling(node: XPathNode): XPathNode | null {
    return this.sibling(node, 1);
  }

  getPreviousSibling(node: XPathNode): XPathNode | null {
    return this.sibling(node, -1);
  }

  getParentNode(node: XPathNode): XPathNode | null {
    // An attribute's parent is its owning element, even though it is not among that element's
    // children — the one place the XPath data model is not a plain tree.
    if (node.__attribute !== undefined) return this.nodeFor(node.__id);
    if (this.isolate !== null && node.__id === this.isolate) return null;
    const parent = this.doc.parentOf(node.__id);
    return parent === undefined ? null : this.nodeFor(parent);
  }

  private sibling(node: XPathNode, offset: number): XPathNode | null {
    if (node.__attribute !== undefined) return null;
    if (this.isolate !== null && node.__id === this.isolate) return null;
    const parent = this.doc.parentOf(node.__id);
    if (parent === undefined) return null;

    const siblings = this.doc.childrenOf(parent);
    const index = siblings.indexOf(node.__id);
    if (index < 0) return null;

    // Skip anything with no place in the XPath data model rather than returning null at it.
    for (let cursor = index + offset; cursor >= 0 && cursor < siblings.length; cursor += offset) {
      const adapter = this.nodeFor(siblings[cursor]!);
      if (adapter !== null) return adapter;
    }
    return null;
  }
}

// --- evaluation ---------------------------------------------------------

export interface XPathOptions {
  /** Prefix → URI for names written in the expression. */
  readonly namespaces?: Readonly<Record<string, string>>;
  /** The namespace an unprefixed name in the expression means. XSD 1.1's `xpathDefaultNamespace`. */
  readonly defaultNamespace?: string | null;
  readonly variables?: Readonly<Record<string, unknown>>;
  /**
   * Treat this node as having no parent and no siblings. XSD 1.1 assertions are evaluated this way;
   * Schematron rules are not.
   */
  readonly isolate?: NodeId;
}

export interface XPathFailure {
  readonly message: string;
}

export interface XPathFailureDetail extends XPathFailure {
  /** True when the engine simply has not been loaded yet, which is not a schema problem. */
  readonly notLoaded?: boolean;
}

export type XPathOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: XPathFailureDetail };

function resolverFor(options: XPathOptions): (prefix: string) => string | null {
  const namespaces = options.namespaces ?? {};
  return (prefix: string) => {
    if (prefix === '') return options.defaultNamespace ?? null;
    return namespaces[prefix] ?? null;
  };
}

/**
 * Evaluate an expression, returning a failure rather than throwing.
 *
 * A broken XPath in a schema is a *schema* problem to report, not a crash: the document being
 * edited is fine, and the user needs to be told which assertion cannot be checked rather than
 * losing the whole validation pass.
 */
export function evaluateBoolean(
  document: XmlDocument,
  contextId: NodeId,
  expression: string,
  options: XPathOptions = {},
): XPathOutcome<boolean> {
  return run(document, contextId, options, (context, facade, variables, evaluationOptions) =>
    engine!.evaluateXPathToBoolean(expression, context, facade, variables, evaluationOptions),
  );
}

/**
 * A node an expression selected.
 *
 * Attributes carry their owner *and* their index, rather than collapsing to the owner: `@sku` and
 * the element it sits on are different answers, and Schematron's `@context` selects attributes
 * routinely. Flattening them would silently turn "this attribute is wrong" into "this element is
 * wrong".
 */
export interface XPathNodeRef {
  readonly node: NodeId;
  readonly attribute?: number;
}

export function evaluateNodes(
  document: XmlDocument,
  contextId: NodeId,
  expression: string,
  options: XPathOptions = {},
): XPathOutcome<XPathNodeRef[]> {
  return run(document, contextId, options, (context, facade, variables, evaluationOptions) =>
    engine!.evaluateXPathToNodes<XPathNode>(expression, context, facade, variables, evaluationOptions).map(
      (node): XPathNodeRef =>
        node.__attribute === undefined
          ? { node: node.__id }
          : { node: node.__id, attribute: node.__attribute },
    ),
  );
}

export function evaluateString(
  document: XmlDocument,
  contextId: NodeId,
  expression: string,
  options: XPathOptions = {},
): XPathOutcome<string> {
  return run(document, contextId, options, (context, facade, variables, evaluationOptions) =>
    engine!.evaluateXPathToString(expression, context, facade, variables, evaluationOptions),
  );
}

function run<T>(
  document: XmlDocument,
  contextId: NodeId,
  options: XPathOptions,
  body: (
    context: XPathNode,
    facade: IDomFacade,
    variables: Record<string, unknown>,
    evaluationOptions: { namespaceResolver: (prefix: string) => string | null },
  ) => T,
): XPathOutcome<T> {
  if (engine === null) {
    return {
      ok: false,
      error: { message: 'The XPath engine has not been loaded yet.', notLoaded: true },
    };
  }

  const facade = new CstDomFacade(document, options.isolate ?? null);
  const context = facade.nodeFor(contextId) ?? facade.nodeFor(ROOT_ID);
  if (context === null) {
    return { ok: false, error: { message: 'The context node no longer exists.' } };
  }

  try {
    return {
      ok: true,
      value: body(context, facade as unknown as IDomFacade, { ...(options.variables ?? {}) }, {
        namespaceResolver: resolverFor(options),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

/**
 * Whether an expression parses, for the XPath editor's live feedback.
 *
 * A syntax check needs a context node but not a real document, so one shared trivial document is
 * reused rather than reparsing on every keystroke.
 */
export function checkExpression(expression: string, options: XPathOptions = {}): XPathFailure | null {
  checkingDocument ??= XmlDocument.parse('<x/>');
  const outcome = evaluateBoolean(checkingDocument, ROOT_ID, `boolean(${expression})`, options);
  return outcome.ok ? null : outcome.error;
}

let checkingDocument: XmlDocument | null = null;
