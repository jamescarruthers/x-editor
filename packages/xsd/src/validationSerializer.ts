/**
 * Serialisation for validation — a second serializer, with a different job.
 *
 * The lossless splice serializer (`xml-core`) exists to give the user their bytes back unchanged.
 * This one exists to make an external validator's line numbers useful, and the two goals are
 * incompatible, so they are separate functions rather than one with a flag.
 *
 * The problem it solves: libxml2 reports "error at line 42" and, for schema errors, column 0
 * (measured — see `docs/spikes.md`, SPIKE-1). Parsing line *and* column to find a node is therefore
 * impossible, and searching the tree by line alone is fragile. So instead of decoding the validator's
 * coordinates, we **choose** them: emit exactly one element start-tag per line and hand back a
 * parallel array. "Line 42" becomes `lineMap[42]`, an O(1) exact lookup.
 *
 * The rejected alternative is worth recording, because it looks right in a prototype: injecting
 * tracking attributes (`data-node-id`) into the document before validating. It fails against any
 * strict schema, because the injected attributes are themselves invalid and produce
 * `cvc-complex-type.3.2.2` errors of their own.
 *
 * This text is never written to disk.
 */

import {
  ROOT_ID,
  encodeAttributeValue,
  encodeText,
  isElement,
  qnameToString,
  type ElementNode,
  type NodeId,
  type XmlDocument,
} from '@x-editor/xml-core';

export interface ValidationPayload {
  readonly text: string;
  /**
   * `lineMap[line]` is the element whose start-tag sits on that 1-based line, or undefined for a
   * line that carries no start-tag. Index 0 is unused so the array indexes the way libxml2 counts.
   */
  readonly lineMap: readonly (NodeId | undefined)[];
}

export function serializeForValidation(document: XmlDocument): ValidationPayload {
  const lines: string[] = [];
  const lineMap: (NodeId | undefined)[] = [undefined];

  const push = (text: string, owner: NodeId | undefined): void => {
    lines.push(text);
    lineMap.push(owner);
  };

  const rootId = document.documentElement();
  if (rootId === undefined) return { text: '', lineMap };

  const visit = (id: NodeId, indent: string): void => {
    const node = document.node(id);
    if (node === undefined || !isElement(node)) return;

    const name = qnameToString(node.name);
    const open = `${indent}<${name}${attributesOf(node)}`;

    // An element carrying real text is emitted whole, on one line. Adding newlines around its
    // content would change that content — which for `xs:string` with whiteSpace="preserve" means
    // validating something the user never wrote.
    if (hasSignificantText(document, id)) {
      push(`${open}>${inlineContent(document, id)}</${name}>`, id);
      return;
    }

    const children = elementChildren(document, id);
    if (children.length === 0) {
      push(`${open}/>`, id);
      return;
    }

    push(`${open}>`, id);
    for (const child of children) visit(child, `${indent}  `);
    push(`${indent}</${name}>`, undefined);
  };

  visit(rootId, '');
  return { text: lines.join('\n'), lineMap };
}

function attributesOf(node: ElementNode): string {
  const parts: string[] = [];
  for (const declaration of node.namespaceDeclarations) {
    const name = declaration.prefix === '' ? 'xmlns' : `xmlns:${declaration.prefix}`;
    parts.push(` ${name}="${encodeAttributeValue(declaration.uri, '"')}"`);
  }
  for (const attribute of node.attributes) {
    // Namespace declarations are held separately by the CST; re-emitting them from the attribute
    // list too would duplicate them and make the document ill-formed.
    if (attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns') continue;
    parts.push(` ${qnameToString(attribute.name)}="${encodeAttributeValue(attribute.value, '"')}"`);
  }
  return parts.join('');
}

/** Text that is not merely the indentation of a pretty-printed document. */
function hasSignificantText(document: XmlDocument, id: NodeId): boolean {
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined) continue;
    if (child.kind === 'cdata') return true;
    if (child.kind === 'text' && child.value.trim() !== '') return true;
  }
  return false;
}

/**
 * The whole subtree on one line, verbatim.
 *
 * Used for elements with real text content, which includes every mixed-content element. The cost is
 * that errors inside mixed content anchor to the nearest enclosing block element rather than to the
 * inline element itself — an acceptable trade, since editing mixed content is Phase 8 and the
 * alternative silently corrupts the value being validated.
 */
function inlineContent(document: XmlDocument, id: NodeId): string {
  let out = '';
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined) continue;
    switch (child.kind) {
      case 'text':
        out += encodeText(child.value);
        break;
      case 'cdata':
        out += `<![CDATA[${child.value}]]>`;
        break;
      case 'element': {
        const name = qnameToString(child.name);
        const inner = inlineContent(document, childId);
        out +=
          inner === '' && document.childrenOf(childId).length === 0
            ? `<${name}${attributesOf(child)}/>`
            : `<${name}${attributesOf(child)}>${inner}</${name}>`;
        break;
      }
      default:
        // Comments and PIs carry no validity weight and would only add lines to account for.
        break;
    }
  }
  return out;
}

function elementChildren(document: XmlDocument, id: NodeId): NodeId[] {
  return document.childrenOf(id).filter((childId) => document.node(childId)?.kind === 'element');
}

/**
 * Which node an external validator's line number refers to.
 *
 * Falls back to the document element rather than nothing: an error we cannot place is still worth
 * showing, and anchoring it to the root is honest about the uncertainty.
 */
export function nodeForLine(payload: ValidationPayload, line: number): NodeId | undefined {
  const exact = payload.lineMap[line];
  if (exact !== undefined) return exact;

  // A close tag's line has no owner; walk back to the start-tag that opened the block.
  for (let cursor = line - 1; cursor > 0; cursor--) {
    const owner = payload.lineMap[cursor];
    if (owner !== undefined) return owner;
  }
  return payload.lineMap.find((id) => id !== undefined) ?? ROOT_ID;
}
