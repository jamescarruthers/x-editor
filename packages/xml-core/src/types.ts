import type { Span } from './tokenizer.js';

export type { Span };

/**
 * Stable node identity. Selection, expansion state, validation results and diagnostics are all
 * keyed by this, so they survive edits to unrelated parts of the document.
 */
export type NodeId = number & { readonly __brand: unique symbol };

export const ROOT_ID = 0 as NodeId;

export interface QName {
  /** Prefix as written, or '' for no prefix. */
  readonly prefix: string;
  readonly localName: string;
  /** Resolved namespace URI, or null if the prefix is undeclared / there is no default namespace. */
  readonly namespaceUri: string | null;
}

export function qnameToString(q: QName): string {
  return q.prefix === '' ? q.localName : `${q.prefix}:${q.localName}`;
}

export function qnameEquals(a: QName, b: QName): boolean {
  return a.localName === b.localName && a.namespaceUri === b.namespaceUri;
}

export interface Attribute {
  readonly name: QName;
  /** Decoded value — entity references resolved, per-spec whitespace normalisation applied. */
  value: string;
  /**
   * The exact source text of `name="value"`, including quote style and the whitespace that preceded
   * it. Non-null means it can be re-emitted verbatim; mutation clears it.
   */
  raw: { readonly span: Span; readonly leadingWhitespace: string } | null;
  /** Quote character to use when re-emitting. Preserved from the source where possible. */
  quote: '"' | "'";
}

export interface NamespaceDeclaration {
  /** '' for a default-namespace declaration (`xmlns="..."`). */
  readonly prefix: string;
  readonly uri: string;
}

interface NodeBase {
  readonly id: NodeId;
  /** Span in the original source, or null once this node has been created or rewritten. */
  span: Span | null;
  /** This node's own syntax needs regenerating (name, attributes, or value changed). */
  selfDirty: boolean;
  /** This node or something beneath it is dirty; gates the fast slice path in the serializer. */
  subtreeDirty: boolean;
}

export interface DocumentNode extends NodeBase {
  readonly kind: 'document';
  children: NodeId[];
}

export interface ElementNode extends NodeBase {
  readonly kind: 'element';
  name: QName;
  attributes: Attribute[];
  namespaceDeclarations: NamespaceDeclaration[];
  children: NodeId[];
  /** Span of `<name ...>` or `<name/>`. */
  openTagSpan: Span | null;
  /** Span of `</name>`. Null when self-closing, or when the document is malformed and unclosed. */
  closeTagSpan: Span | null;
  selfClosing: boolean;
  /** Whitespace between the last attribute and the closing `>`; preserved for round-tripping. */
  trailingWhitespace: string;
}

export interface TextNode extends NodeBase {
  readonly kind: 'text';
  /** Decoded text — entity references resolved. */
  value: string;
}

export interface CDataNode extends NodeBase {
  readonly kind: 'cdata';
  value: string;
}

export interface CommentNode extends NodeBase {
  readonly kind: 'comment';
  value: string;
}

export interface PiNode extends NodeBase {
  readonly kind: 'pi';
  target: string;
  value: string;
}

/** The XML declaration. Kept as verbatim text; it is not a processing instruction. */
export interface XmlDeclNode extends NodeBase {
  readonly kind: 'xmldecl';
  text: string;
}

/** DOCTYPE including any internal subset, kept verbatim. See `tokenizer.ts` for why. */
export interface DoctypeNode extends NodeBase {
  readonly kind: 'doctype';
  text: string;
}

export type XmlNode =
  | DocumentNode
  | ElementNode
  | TextNode
  | CDataNode
  | CommentNode
  | PiNode
  | XmlDeclNode
  | DoctypeNode;

export type ParentNode = DocumentNode | ElementNode;

export function isParentNode(node: XmlNode): node is ParentNode {
  return node.kind === 'document' || node.kind === 'element';
}

export function isElement(node: XmlNode): node is ElementNode {
  return node.kind === 'element';
}

/** A structural problem found while building the tree (as distinct from a tokenizer problem). */
export interface ParseError {
  readonly message: string;
  readonly offset: number;
  readonly code:
    | 'mismatched-end-tag'
    | 'unexpected-end-tag'
    | 'unclosed-element'
    | 'no-root-element'
    | 'multiple-root-elements'
    | 'undeclared-prefix'
    | 'duplicate-attribute'
    | 'tokenizer';
}
