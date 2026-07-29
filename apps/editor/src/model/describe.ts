import { qnameToString, type NodeId, type XmlDocument, type XmlNode } from '@x-editor/xml-core';

export type DescriptionSource = 'schema' | 'inferred' | 'generated';

export interface Description {
  readonly text: string;
  readonly source: DescriptionSource;
}

/**
 * Always returns a sentence. Never returns null, never returns an empty string.
 *
 * The product's core promise is that it explains what you are looking at, and most schemas a
 * beginner meets carry no `xs:documentation` at all — so a description path that can come back empty
 * would silently gut the whole thing. Priority order is: authored schema documentation, then
 * something inferred from the document, then a sentence generated from structure alone.
 *
 * Only the last two are implemented here. The schema branch arrives with the guidance engine in
 * Phase 3; this signature is the seam it plugs into, and every caller already goes through it so no
 * new code paths are needed then.
 */
export function describe(doc: XmlDocument, id: NodeId): Description {
  const node = doc.node(id);
  if (node === undefined) return { text: 'This node no longer exists.', source: 'generated' };

  switch (node.kind) {
    case 'document':
      return {
        text: 'The whole document. Everything below sits inside a single root element.',
        source: 'generated',
      };

    case 'element':
      return { text: describeElement(doc, id, node), source: 'inferred' };

    case 'text':
      return {
        text: `Text content — ${countWords(node.value)} inside its parent element.`,
        source: 'generated',
      };

    case 'cdata':
      return {
        text: 'A CDATA section. Everything inside is treated as plain text, so angle brackets and ampersands do not need escaping.',
        source: 'generated',
      };

    case 'comment':
      return {
        text: 'A comment. It is ignored by anything reading this document, and is only here for people.',
        source: 'generated',
      };

    case 'pi':
      return {
        text: `A processing instruction addressed to "${node.target}". It carries instructions for a specific program rather than content.`,
        source: 'generated',
      };

    case 'xmldecl':
      return {
        text: 'The XML declaration. It states the XML version and the character encoding of this file.',
        source: 'generated',
      };

    case 'doctype':
      return {
        text: 'The document type declaration. It can name the expected root element and declare entities used later in the document.',
        source: 'generated',
      };
  }
}

function describeElement(doc: XmlDocument, id: NodeId, node: Extract<XmlNode, { kind: 'element' }>): string {
  const name = humanise(node.name.localName);
  const children = doc.childrenOf(id).map((c) => doc.node(c)).filter((n) => n !== undefined);
  const elementChildren = children.filter((n) => n.kind === 'element');
  const hasText = children.some((n) => (n.kind === 'text' || n.kind === 'cdata') && n.value.trim() !== '');

  const parts: string[] = [];

  if (elementChildren.length === 0 && hasText) {
    parts.push(`${name} holds a value.`);
  } else if (elementChildren.length > 0 && hasText) {
    parts.push(`${name} mixes text with other elements.`);
  } else if (elementChildren.length > 0) {
    const names = [...new Set(elementChildren.map((c) => qnameToString(c.name)))];
    parts.push(`${name} groups ${listOf(names)}.`);
  } else {
    parts.push(`${name} is empty — it carries its information in attributes, or acts as a marker.`);
  }

  if (node.attributes.length > 0) {
    const shown = node.attributes.filter((a) => !a.name.localName.startsWith('xmlns') && a.name.prefix !== 'xmlns');
    if (shown.length > 0) {
      parts.push(
        `It has ${shown.length === 1 ? 'the setting' : 'the settings'} ${listOf(shown.map((a) => qnameToString(a.name)))}.`,
      );
    }
  }

  if (node.name.namespaceUri !== null) {
    parts.push(`It belongs to the namespace ${node.name.namespaceUri}.`);
  }

  return parts.join(' ');
}

/** `shipDate` → `Ship date`, `ship-date` → `Ship date`, `SHIPDATE` → `Shipdate`. */
export function humanise(localName: string): string {
  const spaced = localName
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (spaced === '') return localName;
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function listOf(items: readonly string[]): string {
  if (items.length === 0) return 'nothing';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(', ');
  return `${head} and ${items[items.length - 1]}`;
}

function countWords(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  return words === 1 ? '1 word' : `${words} words`;
}
