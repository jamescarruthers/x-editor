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
 * Safety mostly falls out of the choice: fontoxpath does not implement `fn:doc()` and has no
 * filesystem or network access at all. This file *registers* a `doc()` — that is what supplying one
 * means — but its resolver looks up a map of documents the caller passed in and nothing else, so an
 * expression can reach exactly the files the user already opened. A hostile `xs:assert` — or a
 * hostile Schematron rule — still cannot exfiltrate the document it is inspecting (PLAN.md §8):
 * there is no code path from a rule to the disk or the network.
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
    registerDocFunction(module);
    engine = module;
    return module;
  });
  await loading;
}

/**
 * `doc()` and `document()`, scoped to documents the caller handed over.
 *
 * Registered into the *standard* function namespace — `registerCustomXPathFunction` accepts it —
 * so authors write plain `doc("codes.xml")` and the same `.sch` runs unchanged in another
 * processor. An editor-specific `x:doc()` would have made every rule using it unportable.
 *
 * Registration is global to fontoxpath, but the resolver reads the facade of the evaluation in
 * flight, so scope is per call: an evaluation given no documents map has a `doc()` that only
 * throws. Failing loudly is deliberate — an unresolvable `doc()` returning an empty sequence would
 * make `not(doc('codes.xml')/...)` quietly true, which is the worst possible reading of a typo.
 */
function registerDocFunction(module: FontoXPath): void {
  for (const localName of ['doc', 'document']) {
    module.registerCustomXPathFunction(
      { namespaceURI: 'http://www.w3.org/2005/xpath-functions', localName },
      ['xs:string?'],
      'node()?',
      (_context, uri: string | null): XPathNode | null => {
        if (uri === null) return null;
        if (activeFacade === null) {
          throw new Error(`${localName}() is not available here.`);
        }
        return activeFacade.resolveDocument(uri, localName);
      },
    );
  }
}

/**
 * The facade of the evaluation currently in flight, for `doc()` to resolve through.
 *
 * A module variable rather than a fontoxpath option because custom functions are registered once,
 * globally, and evaluation is synchronous: set on entry to `run`, restored on exit, so the resolver
 * always sees the workspace of the expression that invoked it and never anyone else's.
 */
let activeFacade: CstDomFacade | null = null;

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
  /**
   * @internal the document `__id` belongs to. Node ids are per document, so a node reached through
   * `doc()` is indistinguishable from a node with the same id in the instance without this tag —
   * and every facade method dispatches on it rather than on the facade's own document.
   */
  readonly __doc: XmlDocument;
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
  // Adapter caches are keyed per document: `doc()` brings other documents into the same
  // evaluation, node ids are only unique within one document, and XPath node identity has to hold
  // across all of them at once.
  private readonly elements = new Map<XmlDocument, Map<NodeId, XPathNode>>();
  private readonly attributes = new Map<XmlDocument, Map<string, XPathNode>>();

  /**
   * @param isolate when set, this node behaves as though it has no parent.
   *
   * XSD 1.1 assertions evaluate against the element as if it were the whole document: an assertion
   * may not look at its ancestors, because the element has to be checkable independently of where it
   * ends up. Without this, `..` would quietly reach the real parent and an assertion would pass or
   * fail depending on context it is not allowed to see.
   *
   * @param workspace what `doc()` may resolve, by file name. `null` — the default — means `doc()`
   * only throws: scoping is total, because the resolver reads this map and nothing else.
   */
  constructor(
    private readonly doc: XmlDocument,
    private readonly isolate: NodeId | null = null,
    private readonly workspace: ReadonlyMap<string, XmlDocument> | null = null,
  ) {}

  // Structurally an `IDomFacade`, but not nominally: fontoxpath's signatures are written against
  // its own `Element`/`Attr` types, and our adapters carry extra fields those do not know about.
  // The cast lives here rather than being spread across every call site.
  get dom(): IDomFacade {
    return this as unknown as IDomFacade;
  }

  /** The adapter for a CST node in the facade's own document. */
  nodeFor(id: NodeId): XPathNode | null {
    return this.nodeIn(this.doc, id);
  }

  /**
   * What `doc("uri")` resolves to: the document node of an open file, or a loud failure.
   *
   * Nothing here reads the disk or the network — an unresolvable name is an error, never a fetch
   * and never an empty sequence.
   */
  resolveDocument(uri: string, functionName: string): XPathNode {
    const target = this.workspace?.get(uri);
    if (target === undefined) {
      throw new Error(
        this.workspace === null
          ? `${functionName}("${uri}") is not available here.`
          : `${functionName}("${uri}") does not name an open file. A rule can only read documents that are open in the workspace.`,
      );
    }
    // A document always has a document node, so the assertion cannot fire.
    return this.nodeIn(target, ROOT_ID)!;
  }

  /**
   * Which workspace file a foreign node came from, or `undefined` for the facade's own document.
   *
   * The name rather than the `XmlDocument`, because callers hold findings and selections that must
   * not silently bind a foreign node id onto the instance — the misbinding fails loudly downstream
   * only if the ref says which document it meant.
   */
  documentNameOf(node: XPathNode): string | undefined {
    if (node.__doc === this.doc || this.workspace === null) return undefined;
    for (const [name, candidate] of this.workspace) {
      if (candidate === node.__doc) return name;
    }
    return undefined;
  }

  /** The adapter for a CST node, minted once per (document, node) so XPath node identity holds. */
  private nodeIn(doc: XmlDocument, id: NodeId): XPathNode | null {
    let cache = this.elements.get(doc);
    if (cache === undefined) {
      cache = new Map();
      this.elements.set(doc, cache);
    }
    const cached = cache.get(id);
    if (cached !== undefined) return cached;

    const node = doc.node(id);
    if (node === undefined) return null;

    let adapter: XPathNode;
    switch (node.kind) {
      case 'document':
        adapter = { nodeType: DOCUMENT_NODE, __id: id, __doc: doc };
        break;
      case 'element':
        adapter = {
          nodeType: ELEMENT_NODE,
          localName: node.name.localName,
          namespaceURI: node.name.namespaceUri,
          prefix: node.name.prefix === '' ? null : node.name.prefix,
          nodeName: qnameToString(node.name),
          __id: id,
          __doc: doc,
        };
        break;
      case 'text':
        adapter = { nodeType: TEXT_NODE, data: node.value, nodeName: '#text', __id: id, __doc: doc };
        break;
      case 'cdata':
        adapter = {
          nodeType: CDATA_SECTION_NODE,
          data: node.value,
          nodeName: '#cdata-section',
          __id: id,
          __doc: doc,
        };
        break;
      case 'comment':
        adapter = { nodeType: COMMENT_NODE, data: node.value, nodeName: '#comment', __id: id, __doc: doc };
        break;
      case 'pi':
        adapter = {
          nodeType: PROCESSING_INSTRUCTION_NODE,
          target: node.target,
          data: node.value,
          nodeName: node.target,
          localName: node.target,
          __id: id,
          __doc: doc,
        };
        break;
      default:
        // The XML declaration and DOCTYPE are not nodes in the XPath data model at all.
        return null;
    }

    cache.set(id, adapter);
    return adapter;
  }

  private attributeFor(owner: XPathNode, index: number): XPathNode | null {
    let cache = this.attributes.get(owner.__doc);
    if (cache === undefined) {
      cache = new Map();
      this.attributes.set(owner.__doc, cache);
    }
    const key = `${owner.__id}:${index}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const element = owner.__doc.node(owner.__id);
    if (element === undefined || !isElement(element)) return null;
    const attribute = element.attributes[index];
    if (attribute === undefined) return null;

    const adapter: XPathNode = {
      nodeType: ATTRIBUTE_NODE,
      localName: attribute.name.localName,
      name: qnameToString(attribute.name),
      nodeName: qnameToString(attribute.name),
      namespaceURI: attribute.name.namespaceUri,
      prefix: attribute.name.prefix === '' ? null : attribute.name.prefix,
      value: attribute.value,
      __id: owner.__id,
      __attribute: index,
      __doc: owner.__doc,
    };
    cache.set(key, adapter);
    return adapter;
  }

  // --- IDomFacade -------------------------------------------------------

  getAllAttributes(node: XPathNode): XPathNode[] {
    const owner = node.__doc.node(node.__id);
    if (owner === undefined || !isElement(owner)) return [];

    const out: XPathNode[] = [];
    for (let index = 0; index < owner.attributes.length; index++) {
      // Namespace declarations are not attributes in the XPath data model, and returning them makes
      // `@*` produce results no XPath author expects.
      const attribute = owner.attributes[index]!;
      if (attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns') continue;
      const adapter = this.attributeFor(node, index);
      if (adapter !== null) out.push(adapter);
    }
    return out;
  }

  getAttribute(node: XPathNode, attributeName: string): string | null {
    const owner = node.__doc.node(node.__id);
    if (owner === undefined || !isElement(owner)) return null;
    for (const attribute of owner.attributes) {
      if (qnameToString(attribute.name) === attributeName) return attribute.value;
    }
    return null;
  }

  getChildNodes(node: XPathNode): XPathNode[] {
    if (node.nodeType === ATTRIBUTE_NODE) return [];
    const out: XPathNode[] = [];
    for (const childId of node.__doc.childrenOf(node.__id)) {
      const adapter = this.nodeIn(node.__doc, childId);
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
    if (node.__attribute !== undefined) return this.nodeIn(node.__doc, node.__id);
    if (this.isolated(node)) return null;
    const parent = node.__doc.parentOf(node.__id);
    return parent === undefined ? null : this.nodeIn(node.__doc, parent);
  }

  // The isolate is a node of the facade's own document; a node with the same id reached through
  // `doc()` is a different node and must not inherit the isolation.
  private isolated(node: XPathNode): boolean {
    return this.isolate !== null && node.__doc === this.doc && node.__id === this.isolate;
  }

  private sibling(node: XPathNode, offset: number): XPathNode | null {
    if (node.__attribute !== undefined) return null;
    if (this.isolated(node)) return null;
    const parent = node.__doc.parentOf(node.__id);
    if (parent === undefined) return null;

    const siblings = node.__doc.childrenOf(parent);
    const index = siblings.indexOf(node.__id);
    if (index < 0) return null;

    // Skip anything with no place in the XPath data model rather than returning null at it.
    for (let cursor = index + offset; cursor >= 0 && cursor < siblings.length; cursor += offset) {
      const adapter = this.nodeIn(node.__doc, siblings[cursor]!);
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
  /**
   * What `doc()` / `document()` may reach, by file name — the open workspace, supplied by the one
   * caller entitled to grant it. Left unset, `doc()` fails loudly rather than resolving anything:
   * XSD 1.1 assertions and the syntax checker never pass this, so a schema's assertions cannot read
   * other files even though Schematron rules in the same session can. Explicit `undefined` is
   * allowed so a caller can thread an optional workspace through without spreading at every site.
   */
  readonly documents?: ReadonlyMap<string, XmlDocument> | undefined;
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
    engine!.evaluateXPathToBoolean(expression, context, facade.dom, variables, evaluationOptions),
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
  /**
   * Set when the node lives in another open document, reached through `doc()`. Node ids are per
   * document, so a ref carrying this name must never be looked up in the instance — callers that
   * can only address the instance skip these rather than misbinding silently.
   */
  readonly documentName?: string;
}

export function evaluateNodes(
  document: XmlDocument,
  contextId: NodeId,
  expression: string,
  options: XPathOptions = {},
): XPathOutcome<XPathNodeRef[]> {
  return run(document, contextId, options, (context, facade, variables, evaluationOptions) =>
    engine!
      .evaluateXPathToNodes<XPathNode>(expression, context, facade.dom, variables, evaluationOptions)
      .map((node): XPathNodeRef => {
        const documentName = facade.documentNameOf(node);
        return {
          node: node.__id,
          ...(node.__attribute === undefined ? {} : { attribute: node.__attribute }),
          ...(documentName === undefined ? {} : { documentName }),
        };
      }),
  );
}

export function evaluateString(
  document: XmlDocument,
  contextId: NodeId,
  expression: string,
  options: XPathOptions = {},
): XPathOutcome<string> {
  return run(document, contextId, options, (context, facade, variables, evaluationOptions) =>
    engine!.evaluateXPathToString(expression, context, facade.dom, variables, evaluationOptions),
  );
}

function run<T>(
  document: XmlDocument,
  contextId: NodeId,
  options: XPathOptions,
  body: (
    context: XPathNode,
    facade: CstDomFacade,
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

  const facade = new CstDomFacade(document, options.isolate ?? null, options.documents ?? null);
  const context = facade.nodeFor(contextId) ?? facade.nodeFor(ROOT_ID);
  if (context === null) {
    return { ok: false, error: { message: 'The context node no longer exists.' } };
  }

  // Saved and restored rather than set and cleared, so an evaluation started from inside another
  // one — however unlikely — resolves `doc()` against its own workspace, not its caller's.
  const previous = activeFacade;
  activeFacade = facade;
  try {
    return {
      ok: true,
      value: body(context, facade, { ...(options.variables ?? {}) }, {
        namespaceResolver: resolverFor(options),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    activeFacade = previous;
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
