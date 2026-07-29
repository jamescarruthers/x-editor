import {
  XmlDocument,
  isElement,
  removeNode,
  type Command,
  type NodeId,
} from '@x-editor/xml-core';
import {
  elementContext,
  insertCandidates,
  type ElementName,
  type SchemaModel,
} from '@x-editor/xsd';
import { compose } from './insert.js';
import { rebuildInto } from './paste.js';

/**
 * Mixed content — SPIKE-4, and the risk the plan calls the third most likely to sink the project.
 *
 * The problem is exact: a row per node turns `<p>See <emph>this</emph> for details.</p>` into five
 * rows. That is unreadable, and it is the entire DocBook/DITA/TEI/JATS world — precisely the
 * audience a beginner-friendly XML editor attracts.
 *
 * The answer taken here is the plan's cheaper option, and it is taken deliberately rather than for
 * want of time. A ProseMirror instance with a schema generated from the content model is the richer
 * editor and costs ~150 KB in the entry chunk plus a second document model to keep in step with the
 * CST — the exact class of two-representations bug this codebase is arranged to avoid, bought for a
 * minority of documents. So a mixed element is instead **one row carrying its flow**, edited as a
 * scoped source snippet with the allowed inline elements offered as wrap buttons.
 *
 * What that gives up is WYSIWYG. What it keeps is that there is one model, the flow is never
 * silently reformatted, and every edit is an ordinary command in the same undo history.
 */

/**
 * True when an element holds text and markup together.
 *
 * Asked of the schema when there is one, because `mixed="true"` is a fact about the type rather than
 * about this instance — an empty `<p>` is still a flow, and treating it as a plain element until
 * someone types markup into it would make the row change shape as they work.
 */
export function isFlowElement(
  document: XmlDocument,
  model: SchemaModel | null,
  id: NodeId,
): boolean {
  if (model !== null) {
    const context = elementContext(model, document, id);
    if (context !== null && context.type.form === 'complex') {
      return context.type.contentKind === 'mixed';
    }
  }

  // No schema: the document is the only evidence there is. Text *and* elements together is what
  // mixed content looks like, and nothing else does.
  let hasText = false;
  let hasElements = false;
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child === undefined) continue;
    if (child.kind === 'element') hasElements = true;
    if ((child.kind === 'text' || child.kind === 'cdata') && child.value.trim() !== '') {
      hasText = true;
    }
  }
  return hasText && hasElements;
}

/** The element's children as XML source — what the flow editor edits. */
export function flowSource(document: XmlDocument, id: NodeId): string {
  const whole = serializeSubtree(document, id);
  const open = whole.indexOf('>');
  const close = whole.lastIndexOf('</');
  if (open < 0 || close < open) return '';
  return whole.slice(open + 1, close);
}

function serializeSubtree(document: XmlDocument, id: NodeId): string {
  // Serializing the whole document and slicing would be wasteful on a large file, but the splice
  // serializer has no per-node entry point — and a flow element is small by definition, so the cost
  // that matters is bounded by how often this is called rather than by document size.
  const node = document.node(id);
  if (node === undefined || !isElement(node)) return '';

  const attributes = node.attributes
    .map((attribute) => ` ${attributeName(attribute.name)}="${escapeAttribute(attribute.value)}"`)
    .join('');
  const name = qname(node.name);

  const inner = document
    .childrenOf(id)
    .map((childId) => {
      const child = document.node(childId);
      if (child === undefined) return '';
      switch (child.kind) {
        case 'element':
          return serializeSubtree(document, childId);
        case 'text':
          return escapeText(child.value);
        case 'cdata':
          return `<![CDATA[${child.value}]]>`;
        case 'comment':
          return `<!--${child.value}-->`;
        default:
          return '';
      }
    })
    .join('');

  return `<${name}${attributes}>${inner}</${name}>`;
}

/** A one-line preview of a flow, with markup shown rather than stripped. */
export function flowPreview(document: XmlDocument, id: NodeId, limit = 64): string {
  let out = '';
  const visit = (nodeId: NodeId, top: boolean): void => {
    for (const childId of document.childrenOf(nodeId)) {
      const child = document.node(childId);
      if (child === undefined) continue;
      if (child.kind === 'text' || child.kind === 'cdata') out += child.value;
      else if (isElement(child)) {
        // Marked rather than dropped: "See this for details" reads as plain prose and hides that
        // half of it is tagged, which is the one thing the row has to convey.
        out += '⟨';
        visit(childId, false);
        out += '⟩';
      }
    }
    if (top) out = out.replace(/\s+/g, ' ').trim();
  };
  visit(id, true);
  return out.length > limit ? `${out.slice(0, limit - 1)}…` : out;
}

export interface FlowEdit {
  readonly command: Command | null;
  /** Set when the source does not parse — the edit is refused rather than half-applied. */
  readonly error: string | null;
}

/**
 * Replace an element's children from edited source.
 *
 * Parsed inside a wrapper so a flow is allowed to be a bare run of text and markup rather than a
 * single rooted element, which is what a flow actually is. Refusing on a parse error matters more
 * here than elsewhere: the alternative is discarding a paragraph someone was midway through typing.
 */
export function setFlow(document: XmlDocument, id: NodeId, source: string): FlowEdit {
  const fragment = XmlDocument.parse(`<flow>${source}</flow>`);
  if (fragment.parseErrors.length > 0) {
    return { command: null, error: fragment.parseErrors[0]!.message };
  }
  const wrapper = fragment.documentElement();
  if (wrapper === undefined) return { command: null, error: 'Could not read that.' };

  const commands: Command[] = document
    .childrenOf(id)
    .map((childId) => removeNode(document, childId));

  let index = 0;
  for (const childId of fragment.childrenOf(wrapper)) {
    const sub = rebuildInto(document, fragment, childId, id, index, false, false);
    if (sub.length > 0) {
      commands.push(...sub);
      index++;
    }
  }

  return { command: compose('Edited flow', commands), error: null };
}

/** The inline elements the schema allows inside a flow, for the wrap buttons. */
export function inlineNames(
  document: XmlDocument,
  model: SchemaModel | null,
  id: NodeId,
): ElementName[] {
  if (model === null) return [];
  const context = elementContext(model, document, id);
  if (context === null) return [];
  return insertCandidates(model, context, context.children.length).map(
    (candidate) => candidate.name,
  );
}

/**
 * Wrap a range of the source in an element.
 *
 * A string operation on the source rather than a tree operation, because the selection the user made
 * is a range in the text they are looking at. Mapping it onto nodes first and back afterwards would
 * be more machinery and would still have to answer the same question at partial-node boundaries.
 */
export function wrapRange(
  source: string,
  start: number,
  end: number,
  localName: string,
): string {
  if (start >= end) return source;
  return `${source.slice(0, start)}<${localName}>${source.slice(start, end)}</${localName}>${source.slice(end)}`;
}

function qname(name: { prefix: string; localName: string }): string {
  return name.prefix === '' ? name.localName : `${name.prefix}:${name.localName}`;
}

function attributeName(name: { prefix: string; localName: string }): string {
  return qname(name);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
