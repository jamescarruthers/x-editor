import { isElement, type NodeId, type XmlDocument } from '@x-editor/xml-core';

/**
 * Inferring a schema from a document.
 *
 * For the person who has an XML file and no `.xsd`, which is the majority of people who arrive here.
 * The result is a *starting point*, and the UI says so: inference cannot know that an element which
 * happens to appear twice in this file is unbounded, or that a value which happens to be a date is
 * one. What it can do is remove the hour of typing between having a file and having something the
 * guidance engine can work from.
 *
 * The generated schema is deliberately permissive where the evidence is thin, and exact where it is
 * not. Guessing `maxOccurs="unbounded"` from one repetition is safe — the worst case is a schema
 * that permits something the author would have forbidden. Guessing `xs:date` from one date-shaped
 * string is not: it rejects documents the author would have accepted, and a schema that rejects
 * valid data is worse than one that accepts invalid data at this stage.
 */

interface ElementFacts {
  /** Child element names in the order first seen, so the generated sequence matches the document. */
  readonly childOrder: string[];
  readonly childCounts: Map<string, { min: number; max: number }>;
  /** Attributes seen, and whether every occurrence carried them. */
  readonly attributes: Map<string, { count: number; values: Set<string> }>;
  occurrences: number;
  hasText: boolean;
  hasChildren: boolean;
  /** Every text value seen, capped — enough to spot an enumeration, not enough to grow unbounded. */
  readonly values: Set<string>;
}

export interface InferenceResult {
  readonly source: string;
  /** What the inference had to guess at, so the offer is honest about its own limits. */
  readonly caveats: readonly string[];
}

/** How many distinct values before a column stops looking like an enumeration. */
const ENUM_LIMIT = 8;
/** Cap on retained values, so a 50k-node document does not retain every string in it. */
const VALUE_CAP = 64;

export function inferSchema(document: XmlDocument): InferenceResult {
  const rootId = document.documentElement();
  if (rootId === undefined) {
    return { source: '', caveats: ['This document has no root element.'] };
  }

  const facts = new Map<string, ElementFacts>();
  const namespaces = new Set<string>();

  const visit = (id: NodeId): void => {
    const node = document.node(id);
    if (node === undefined || !isElement(node)) return;
    if (node.name.namespaceUri !== null) namespaces.add(node.name.namespaceUri);

    const entry = factsFor(facts, node.name.localName);
    entry.occurrences++;

    for (const attribute of node.attributes) {
      if (attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns') continue;
      const seen = entry.attributes.get(attribute.name.localName) ?? {
        count: 0,
        values: new Set<string>(),
      };
      seen.count++;
      if (seen.values.size < VALUE_CAP) seen.values.add(attribute.value);
      entry.attributes.set(attribute.name.localName, seen);
    }

    const counts = new Map<string, number>();
    let text = '';
    for (const childId of document.childrenOf(id)) {
      const child = document.node(childId);
      if (child === undefined) continue;
      if (child.kind === 'text' || child.kind === 'cdata') text += child.value;
      if (!isElement(child)) continue;

      entry.hasChildren = true;
      const name = child.name.localName;
      if (!entry.childOrder.includes(name)) entry.childOrder.push(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
      visit(childId);
    }

    if (text.trim() !== '') {
      entry.hasText = true;
      if (entry.values.size < VALUE_CAP) entry.values.add(text.trim());
    }

    // An element absent from this occurrence has a minimum of zero, which is only knowable by
    // looking at every occurrence — hence facts accumulated across the document rather than per node.
    for (const name of entry.childOrder) {
      const seen = counts.get(name) ?? 0;
      const bounds = entry.childCounts.get(name);
      if (bounds === undefined) entry.childCounts.set(name, { min: seen, max: seen });
      else {
        bounds.min = Math.min(bounds.min, seen);
        bounds.max = Math.max(bounds.max, seen);
      }
    }
  };

  visit(rootId);

  const rootName = elementName(document, rootId);
  const caveats = collectCaveats(facts, namespaces);
  return { source: render(facts, rootName, namespaces), caveats };
}

function factsFor(facts: Map<string, ElementFacts>, name: string): ElementFacts {
  const existing = facts.get(name);
  if (existing !== undefined) return existing;
  const created: ElementFacts = {
    childOrder: [],
    childCounts: new Map(),
    attributes: new Map(),
    occurrences: 0,
    hasText: false,
    hasChildren: false,
    values: new Set(),
  };
  facts.set(name, created);
  return created;
}

function elementName(document: XmlDocument, id: NodeId): string {
  const node = document.node(id);
  return node !== undefined && isElement(node) ? node.name.localName : 'root';
}

function collectCaveats(
  facts: Map<string, ElementFacts>,
  namespaces: ReadonlySet<string>,
): string[] {
  const caveats: string[] = [];

  if (namespaces.size > 0) {
    caveats.push(
      `This document uses ${namespaces.size === 1 ? 'a namespace' : `${namespaces.size} namespaces`}. The generated schema declares the first as its target namespace; check the rest by hand.`,
    );
  }

  const onceOnly = [...facts.entries()].filter(([, entry]) => entry.occurrences === 1).length;
  if (onceOnly > 0) {
    caveats.push(
      `${onceOnly} ${onceOnly === 1 ? 'element appears' : 'elements appear'} only once, so nothing here can tell whether they repeat. Everything is written as it appears in this file.`,
    );
  }

  const mixed = [...facts.entries()].filter(([, entry]) => entry.hasText && entry.hasChildren);
  if (mixed.length > 0) {
    caveats.push(
      `${mixed.map(([name]) => name).join(', ')} ${mixed.length === 1 ? 'holds' : 'hold'} text and elements together, written as mixed content.`,
    );
  }

  caveats.push(
    'Every value is typed as xs:string. Narrowing them — to xs:date, xs:decimal, an enumeration — is the first thing worth doing by hand, and the one thing inference cannot do safely from a single file.',
  );

  return caveats;
}

function render(
  facts: Map<string, ElementFacts>,
  rootName: string,
  namespaces: ReadonlySet<string>,
): string {
  const target = [...namespaces][0];
  const header =
    target === undefined
      ? '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">'
      : `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"\n           xmlns="${target}"\n           targetNamespace="${target}"\n           elementFormDefault="qualified">`;

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', header, ''];
  lines.push(`  <xs:element name="${rootName}" type="${typeName(rootName)}"/>`, '');

  // Ordered with the root first and the rest as they were met, so the schema reads in the same
  // direction as the document it came from.
  for (const [name, entry] of facts) {
    lines.push(...renderType(name, entry));
    lines.push('');
  }

  lines.push('</xs:schema>');
  return `${lines.join('\n')}\n`;
}

function renderType(name: string, entry: ElementFacts): string[] {
  const type = typeName(name);

  if (!entry.hasChildren && entry.attributes.size === 0) {
    return [
      `  <xs:simpleType name="${type}">`,
      ...enumerationOrString(entry),
      '  </xs:simpleType>',
    ];
  }

  const lines: string[] = [
    `  <xs:complexType name="${type}"${entry.hasText && entry.hasChildren ? ' mixed="true"' : ''}>`,
  ];

  if (!entry.hasChildren && entry.attributes.size > 0) {
    // Text plus attributes is simple content, and getting this wrong is the commonest mistake in a
    // hand-written schema — the element silently stops being allowed to hold text at all.
    lines.push('    <xs:simpleContent>', '      <xs:extension base="xs:string">');
    for (const [attribute, seen] of entry.attributes) {
      lines.push(`        ${attributeLine(attribute, seen, entry.occurrences)}`);
    }
    lines.push('      </xs:extension>', '    </xs:simpleContent>', '  </xs:complexType>');
    return lines;
  }

  if (entry.hasChildren) {
    lines.push('    <xs:sequence>');
    for (const child of entry.childOrder) {
      const bounds = entry.childCounts.get(child) ?? { min: 1, max: 1 };
      const min = bounds.min === 1 ? '' : ` minOccurs="${bounds.min}"`;
      // Anything seen more than once is written unbounded: a schema that permits one more of
      // something is a smaller mistake than one that rejects the second file it is shown.
      const max = bounds.max > 1 ? ' maxOccurs="unbounded"' : '';
      lines.push(`      <xs:element name="${child}" type="${typeName(child)}"${min}${max}/>`);
    }
    lines.push('    </xs:sequence>');
  }

  for (const [attribute, seen] of entry.attributes) {
    lines.push(`    ${attributeLine(attribute, seen, entry.occurrences)}`);
  }

  lines.push('  </xs:complexType>');
  return lines;
}

function attributeLine(
  name: string,
  seen: { count: number; values: Set<string> },
  occurrences: number,
): string {
  // Required only when every single occurrence carried it. One element without it is proof that it
  // is optional; nothing short of universal presence is proof that it is required.
  const use = seen.count === occurrences ? ' use="required"' : '';
  return `<xs:attribute name="${name}" type="xs:string"${use}/>`;
}

function enumerationOrString(entry: ElementFacts): string[] {
  const values = [...entry.values];
  // A small closed-looking set is offered as an enumeration because it is the highest-value thing a
  // schema can carry — but only where the evidence is more than one value repeated.
  if (values.length > 1 && values.length <= ENUM_LIMIT && entry.occurrences > values.length) {
    return [
      '    <xs:restriction base="xs:string">',
      ...values.map((value) => `      <xs:enumeration value="${escapeAttribute(value)}"/>`),
      '    </xs:restriction>',
    ];
  }
  return ['    <xs:restriction base="xs:string"/>'];
}

function typeName(local: string): string {
  return `${local.charAt(0).toUpperCase()}${local.slice(1)}Type`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
