import { encodeAttributeValue, encodeText } from './entities.js';
import { qnameToString, type ElementNode, type NodeId, type XmlNode } from './types.js';

export interface SerializeContext {
  readonly source: string;
  readonly nodes: ReadonlyMap<NodeId, XmlNode>;
}

/**
 * The splice serializer.
 *
 * A subtree with no dirty node anywhere beneath it is re-emitted by slicing the original bytes, so
 * an untouched document round-trips byte-for-byte — encoding quirks, attribute quote style,
 * whitespace inside tags, entity references, the DOCTYPE internal subset and all. Only dirty nodes
 * are regenerated, which also makes serialization O(changed) rather than O(document).
 *
 * This is the single highest-value decision in the document layer. Users keep these files in git; a
 * tool that reformats on save produces a four-thousand-line diff on every commit and gets banned.
 */
export function serializeNode(ctx: SerializeContext, id: NodeId): string {
  const node = ctx.nodes.get(id);
  if (node === undefined) return '';

  // Fast path: nothing beneath this node changed, so the original bytes are still correct.
  if (!node.subtreeDirty && node.span !== null) {
    return ctx.source.slice(node.span.start, node.span.end);
  }

  switch (node.kind) {
    case 'document':
      return node.children.map((child) => serializeNode(ctx, child)).join('');

    case 'element':
      return serializeElement(ctx, node);

    case 'text':
      return node.selfDirty || node.span === null
        ? encodeText(node.value)
        : ctx.source.slice(node.span.start, node.span.end);

    case 'cdata':
      return `<![CDATA[${node.value}]]>`;

    case 'comment':
      return `<!--${node.value}-->`;

    case 'pi':
      return node.value === '' ? `<?${node.target}?>` : `<?${node.target} ${node.value}?>`;

    case 'xmldecl':
    case 'doctype':
      return node.text;
  }
}

function serializeElement(ctx: SerializeContext, node: ElementNode): string {
  const hasChildren = node.children.length > 0;
  const name = qnameToString(node.name);

  // An element that was self-closing in the source but has since gained children must grow a real
  // close tag; one that lost all its children keeps its expanded form, because collapsing
  // `<a></a>` to `<a/>` is a gratuitous diff.
  const emitSelfClosing = node.selfClosing && !hasChildren;

  let out: string;
  if (!node.selfDirty && node.openTagSpan !== null && node.selfClosing === emitSelfClosing) {
    out = ctx.source.slice(node.openTagSpan.start, node.openTagSpan.end);
  } else {
    out = `<${name}`;
    for (const attribute of node.attributes) {
      if (attribute.raw !== null && !node.selfDirty) {
        out +=
          attribute.raw.leadingWhitespace === ''
            ? ` ${ctx.source.slice(attribute.raw.span.start, attribute.raw.span.end)}`
            : attribute.raw.leadingWhitespace +
              ctx.source.slice(attribute.raw.span.start, attribute.raw.span.end);
      } else {
        const q = attribute.quote;
        out += ` ${qnameToString(attribute.name)}=${q}${encodeAttributeValue(attribute.value, q)}${q}`;
      }
    }
    out += node.trailingWhitespace;
    out += emitSelfClosing ? '/>' : '>';
  }

  if (emitSelfClosing) return out;

  for (const child of node.children) out += serializeNode(ctx, child);

  // A close tag is only reusable verbatim if the name did not change.
  if (node.closeTagSpan !== null && !node.selfDirty) {
    out += ctx.source.slice(node.closeTagSpan.start, node.closeTagSpan.end);
  } else if (node.closeTagSpan !== null || !node.selfClosing || hasChildren) {
    out += `</${name}>`;
  }

  return out;
}
