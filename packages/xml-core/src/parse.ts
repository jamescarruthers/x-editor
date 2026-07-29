import { tokenize, type Token, type Span } from './tokenizer.js';
import { decodeText, normalizeAttributeValue } from './entities.js';
import {
  ROOT_ID,
  type Attribute,
  type DocumentNode,
  type ElementNode,
  type NamespaceDeclaration,
  type NodeId,
  type ParseError,
  type ParentNode,
  type QName,
  type XmlNode,
} from './types.js';

export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export interface Tree {
  readonly nodes: Map<NodeId, XmlNode>;
  readonly parents: Map<NodeId, NodeId>;
  readonly root: DocumentNode;
  readonly errors: ParseError[];
  readonly nextId: number;
}

interface Scope {
  readonly bindings: ReadonlyMap<string, string>;
  readonly element: ElementNode;
}

function splitQName(name: string): { prefix: string; localName: string } {
  const colon = name.indexOf(':');
  if (colon === -1) return { prefix: '', localName: name };
  return { prefix: name.slice(0, colon), localName: name.slice(colon + 1) };
}

export function buildTree(source: string): Tree {
  const { tokens, errors: tokenErrors } = tokenize(source);
  const nodes = new Map<NodeId, XmlNode>();
  const parents = new Map<NodeId, NodeId>();
  const errors: ParseError[] = tokenErrors.map((e) => ({
    message: e.message,
    offset: e.offset,
    code: 'tokenizer' as const,
  }));

  let nextId = 1;
  const mint = (): NodeId => nextId++ as NodeId;

  const root: DocumentNode = {
    id: ROOT_ID,
    kind: 'document',
    children: [],
    span: { start: 0, end: source.length },
    selfDirty: false,
    subtreeDirty: false,
  };
  nodes.set(ROOT_ID, root);

  const baseBindings = new Map<string, string>([
    ['xml', XML_NS],
    ['xmlns', XMLNS_NS],
  ]);

  const stack: Scope[] = [];
  let current: ParentNode = root;
  let currentBindings: ReadonlyMap<string, string> = baseBindings;
  let rootElementCount = 0;

  const append = (node: XmlNode): void => {
    nodes.set(node.id, node);
    parents.set(node.id, current.id);
    current.children.push(node.id);
  };

  for (const token of tokens) {
    switch (token.kind) {
      case 'text': {
        // Whitespace-only text at document level is legal; anything else there is not, but we keep
        // it as a node so no bytes are lost and the source still round-trips.
        append({
          id: mint(),
          kind: 'text',
          value: decodeText(source.slice(token.span.start, token.span.end)),
          span: token.span,
          selfDirty: false,
          subtreeDirty: false,
        });
        break;
      }

      case 'cdata': {
        append({
          id: mint(),
          kind: 'cdata',
          value: source.slice(token.contentSpan.start, token.contentSpan.end),
          span: token.span,
          selfDirty: false,
          subtreeDirty: false,
        });
        break;
      }

      case 'comment': {
        append({
          id: mint(),
          kind: 'comment',
          value: source.slice(token.contentSpan.start, token.contentSpan.end),
          span: token.span,
          selfDirty: false,
          subtreeDirty: false,
        });
        break;
      }

      case 'pi': {
        append({
          id: mint(),
          kind: 'pi',
          target: token.target,
          value: source.slice(token.contentSpan.start, token.contentSpan.end),
          span: token.span,
          selfDirty: false,
          subtreeDirty: false,
        });
        break;
      }

      case 'xmldecl': {
        append({
          id: mint(),
          kind: 'xmldecl',
          text: source.slice(token.span.start, token.span.end),
          span: token.span,
          selfDirty: false,
          subtreeDirty: false,
        });
        break;
      }

      case 'doctype': {
        append({
          id: mint(),
          kind: 'doctype',
          text: source.slice(token.span.start, token.span.end),
          span: token.span,
          selfDirty: false,
          subtreeDirty: false,
        });
        break;
      }

      case 'startTag': {
        if (current.kind === 'document') {
          rootElementCount++;
          if (rootElementCount > 1) {
            errors.push({
              message: `Only one root element is allowed; "${token.name}" is a second one`,
              offset: token.span.start,
              code: 'multiple-root-elements',
            });
          }
        }

        const element = buildElement(token, source, currentBindings, errors, mint);
        append(element);

        if (!token.selfClosing) {
          stack.push({ bindings: currentBindings, element });
          current = element;
          currentBindings = elementBindings(currentBindings, element.namespaceDeclarations);
        }
        break;
      }

      case 'endTag': {
        if (stack.length === 0) {
          errors.push({
            message: `End tag "</${token.name}>" has no matching start tag`,
            offset: token.span.start,
            code: 'unexpected-end-tag',
          });
          // Keep the bytes rather than dropping them.
          append({
            id: mint(),
            kind: 'text',
            value: source.slice(token.span.start, token.span.end),
            span: token.span,
            selfDirty: false,
            subtreeDirty: false,
          });
          break;
        }

        const openName = qnameSource(stack[stack.length - 1]!.element);
        if (openName !== token.name) {
          errors.push({
            message: `End tag "</${token.name}>" does not match start tag "<${openName}>"`,
            offset: token.span.start,
            code: 'mismatched-end-tag',
          });
        }

        const scope = stack.pop()!;
        scope.element.closeTagSpan = token.span;
        scope.element.span = {
          start: scope.element.openTagSpan!.start,
          end: token.span.end,
        };
        currentBindings = scope.bindings;
        current = stack.length === 0 ? root : stack[stack.length - 1]!.element;
        break;
      }
    }
  }

  // Anything left open at end of input. Give it a span up to where the content actually stopped, so
  // serialization still covers every byte.
  while (stack.length > 0) {
    const scope = stack.pop()!;
    errors.push({
      message: `Element "<${qnameSource(scope.element)}>" is never closed`,
      offset: scope.element.openTagSpan?.start ?? 0,
      code: 'unclosed-element',
    });
    const lastChild = scope.element.children[scope.element.children.length - 1];
    const end =
      lastChild !== undefined
        ? (nodes.get(lastChild)?.span?.end ?? scope.element.openTagSpan!.end)
        : scope.element.openTagSpan!.end;
    scope.element.span = { start: scope.element.openTagSpan!.start, end };
  }

  if (rootElementCount === 0) {
    errors.push({ message: 'Document has no root element', offset: 0, code: 'no-root-element' });
  }

  return { nodes, parents, root, errors, nextId };
}

function qnameSource(element: ElementNode): string {
  return element.name.prefix === ''
    ? element.name.localName
    : `${element.name.prefix}:${element.name.localName}`;
}

function elementBindings(
  inherited: ReadonlyMap<string, string>,
  declarations: readonly NamespaceDeclaration[],
): ReadonlyMap<string, string> {
  if (declarations.length === 0) return inherited;
  const next = new Map(inherited);
  for (const declaration of declarations) {
    if (declaration.uri === '') next.delete(declaration.prefix);
    else next.set(declaration.prefix, declaration.uri);
  }
  return next;
}

function buildElement(
  token: Extract<Token, { kind: 'startTag' }>,
  source: string,
  inherited: ReadonlyMap<string, string>,
  errors: ParseError[],
  mint: () => NodeId,
): ElementNode {
  const namespaceDeclarations: NamespaceDeclaration[] = [];
  const attributes: Attribute[] = [];
  const seen = new Set<string>();

  // Namespace declarations must be collected before any QName on this element is resolved, because
  // an element may use a prefix it declares on itself.
  for (const attr of token.attributes) {
    if (attr.name === 'xmlns') {
      namespaceDeclarations.push({
        prefix: '',
        uri: attr.rawValue === null ? '' : normalizeAttributeValue(attr.rawValue),
      });
    } else if (attr.name.startsWith('xmlns:')) {
      namespaceDeclarations.push({
        prefix: attr.name.slice(6),
        uri: attr.rawValue === null ? '' : normalizeAttributeValue(attr.rawValue),
      });
    }
  }

  const bindings = elementBindings(inherited, namespaceDeclarations);

  const resolve = (name: string, isAttribute: boolean, offset: number): QName => {
    const { prefix, localName } = splitQName(name);
    if (prefix === '') {
      // An unprefixed attribute is in no namespace; an unprefixed element takes the default.
      return {
        prefix: '',
        localName,
        namespaceUri: isAttribute ? null : (bindings.get('') ?? null),
      };
    }
    const uri = bindings.get(prefix);
    if (uri === undefined) {
      errors.push({
        message: `Namespace prefix "${prefix}" is not declared`,
        offset,
        code: 'undeclared-prefix',
      });
      return { prefix, localName, namespaceUri: null };
    }
    return { prefix, localName, namespaceUri: uri };
  };

  for (const attr of token.attributes) {
    const name = resolve(attr.name, true, attr.nameSpan.start);
    const key = `${name.namespaceUri ?? ''}|${name.localName}`;
    if (seen.has(key)) {
      errors.push({
        message: `Duplicate attribute "${attr.name}"`,
        offset: attr.nameSpan.start,
        code: 'duplicate-attribute',
      });
    }
    seen.add(key);

    attributes.push({
      name,
      value: attr.rawValue === null ? '' : normalizeAttributeValue(attr.rawValue),
      raw:
        attr.rawValue === null
          ? null
          : { span: attr.span, leadingWhitespace: attr.leadingWhitespace },
      quote: attr.quote ?? '"',
    });
  }

  const span: Span | null = token.selfClosing ? token.span : null;

  return {
    id: mint(),
    kind: 'element',
    name: resolve(token.name, false, token.nameSpan.start),
    attributes,
    namespaceDeclarations,
    children: [],
    openTagSpan: token.span,
    closeTagSpan: null,
    selfClosing: token.selfClosing,
    trailingWhitespace: token.trailingWhitespace,
    span,
    selfDirty: false,
    subtreeDirty: false,
  };
}
