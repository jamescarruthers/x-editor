export { tokenize, isValidName } from './tokenizer.js';
export type { Token, RawAttribute, TokenizeResult, TokenizerError, Span } from './tokenizer.js';

export { buildTree, XML_NS, XMLNS_NS } from './parse.js';
export type { Tree } from './parse.js';

export { serializeNode } from './serialize.js';
export type { SerializeContext } from './serialize.js';

export { decodeText, encodeText, encodeAttributeValue, normalizeAttributeValue } from './entities.js';

export { checkWellFormed, isWellFormed } from './wellformed.js';
export type { WellFormednessError } from './wellformed.js';

export {
  XmlDocument,
  insertElement,
  insertText,
  removeNode,
  moveNode,
  setAttribute,
  removeAttribute,
  setTextValue,
  renameElement,
  setNamespaceDeclaration,
} from './document.js';
export type { Command, NewElementSpec } from './document.js';

export { ROOT_ID, qnameToString, qnameEquals, isElement, isParentNode } from './types.js';
export type {
  NodeId,
  QName,
  Attribute,
  NamespaceDeclaration,
  XmlNode,
  DocumentNode,
  ElementNode,
  TextNode,
  CDataNode,
  CommentNode,
  PiNode,
  XmlDeclNode,
  DoctypeNode,
  ParentNode,
  ParseError,
} from './types.js';
