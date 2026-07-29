import { describe as suite, expect, it } from 'vitest';
import { ROOT_ID, XmlDocument, type NodeId } from '@x-editor/xml-core';
import { SchemaModel, assembleSchema, catalogueFrom, validateDocument } from '@x-editor/xsd';
import {
  flowPreview,
  flowSource,
  inlineNames,
  isFlowElement,
  setFlow,
  wrapRange,
} from '../src/model/mixed.js';
import { tableFor } from '../src/model/table.js';
import { buildRows } from '../src/model/rows.js';

const MIXED_SCHEMA = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="body" type="Body"/>
  <xs:complexType name="Body">
    <xs:sequence><xs:element name="p" type="Para" maxOccurs="unbounded"/></xs:sequence>
  </xs:complexType>
  <xs:complexType name="Para" mixed="true">
    <xs:choice minOccurs="0" maxOccurs="unbounded">
      <xs:element name="emph" type="xs:string"/>
      <xs:element name="code" type="xs:string"/>
    </xs:choice>
  </xs:complexType>
</xs:schema>`;

const MIXED = `<?xml version="1.0"?>
<body><p>See <emph>this</emph> for details.</p></body>`;

function model(source = MIXED_SCHEMA): SchemaModel {
  return new SchemaModel(assembleSchema('s.xsd', catalogueFrom({ 's.xsd': source })));
}

/** The single `<p>`. */
function para(document: XmlDocument): NodeId {
  const body = document.documentElement()!;
  return document.childrenOf(body).find((id) => document.node(id)?.kind === 'element')!;
}

function expandAll(document: XmlDocument): Set<NodeId> {
  const open = new Set<NodeId>();
  const walk = (id: NodeId): void => {
    open.add(id);
    for (const child of document.childrenOf(id)) walk(child);
  };
  walk(ROOT_ID);
  return open;
}

suite('mixed content', () => {
  it('is a fact about the type, not about this instance', () => {
    // An empty <p> is still a flow. Deciding from the instance would make the row change shape as
    // someone types, which is the sort of thing that reads as a bug.
    const document = XmlDocument.parse('<body><p/></body>');
    expect(isFlowElement(document, model(), para(document))).toBe(true);
  });

  it('falls back to the document when there is no schema', () => {
    const document = XmlDocument.parse(MIXED);
    expect(isFlowElement(document, null, para(document))).toBe(true);

    // Elements alone are not a flow, and neither is text alone.
    const plain = XmlDocument.parse('<a><b>x</b><c>y</c></a>');
    expect(isFlowElement(plain, null, plain.documentElement()!)).toBe(false);
  });

  it('collapses a paragraph to one tree row rather than five', () => {
    // The plan's third-biggest risk, stated exactly: a row per node turns this paragraph into five
    // rows, which is unreadable, and it is the shape of every DocBook, DITA, TEI and JATS document.
    const document = XmlDocument.parse(MIXED);
    const compiled = model();

    const naive = buildRows(document, expandAll(document));
    const rows = buildRows(document, new Set([ROOT_ID, document.documentElement()!]), (id) =>
      isFlowElement(document, compiled, id),
    );

    expect(naive.length).toBeGreaterThan(rows.length);
    const paragraph = rows.find((row) => row.id === para(document))!;
    expect(paragraph.flow).toBe('See ⟨this⟩ for details.');
    // Still expandable: nothing is hidden, it is only no longer forced on the reader.
    expect(paragraph.hasChildren).toBe(true);
  });

  it('marks up runs in the preview rather than stripping them', () => {
    const document = XmlDocument.parse(MIXED);
    // "See this for details" would read as plain prose and hide that half of it is tagged.
    expect(flowPreview(document, para(document))).toContain('⟨this⟩');
  });

  it('round-trips a flow through source and back', () => {
    const document = XmlDocument.parse(MIXED);
    const before = document.serialize();
    const source = flowSource(document, para(document));
    expect(source).toBe('See <emph>this</emph> for details.');

    const edit = setFlow(document, para(document), source);
    expect(edit.error).toBeNull();
    document.run(edit.command!);
    expect(document.serialize()).toBe(before);
  });

  it('edits a flow as one undoable step', () => {
    const document = XmlDocument.parse(MIXED);
    const before = document.serialize();

    const edit = setFlow(
      document,
      para(document),
      'See <code>this</code> and <emph>that</emph> instead.',
    );
    expect(edit.error).toBeNull();
    document.run(edit.command!);

    const after = document.serialize();
    expect(after).toContain('<code>this</code>');
    expect(after).toContain('<emph>that</emph>');
    expect(
      validateDocument(model(), XmlDocument.parse(after)).filter((d) => d.severity === 'error'),
    ).toEqual([]);

    document.undo();
    expect(document.serialize()).toBe(before);
  });

  it('refuses rather than half-applying when the source does not parse', () => {
    // Discarding a paragraph someone was midway through typing because a bracket was unbalanced for
    // a moment would make the editor unusable for exactly the documents it is meant to serve.
    const document = XmlDocument.parse(MIXED);
    const before = document.serialize();

    const edit = setFlow(document, para(document), 'See <emph>this for details.');
    expect(edit.error).not.toBeNull();
    expect(edit.command).toBeNull();
    expect(document.serialize()).toBe(before);
  });

  it('offers the inline elements the schema allows', () => {
    const document = XmlDocument.parse(MIXED);
    const names = inlineNames(document, model(), para(document)).map((name) => name.localName);
    expect(names).toEqual(expect.arrayContaining(['emph', 'code']));
  });

  it('wraps a selected range', () => {
    expect(wrapRange('See this for details.', 4, 8, 'emph')).toBe(
      'See <emph>this</emph> for details.',
    );
    // An empty selection is a no-op rather than an empty element nobody asked for.
    expect(wrapRange('abc', 1, 1, 'emph')).toBe('abc');
  });
});

suite('table view', () => {
  const LIST = `<order>
    <line partNum="A"><sku>A-1</sku><qty>2</qty></line>
    <line partNum="B"><sku>B-2</sku><qty>1</qty></line>
    <line partNum="C"><sku>C-3</sku></line>
  </order>`;

  it('finds the repeated group and builds a column per leaf and attribute', () => {
    const document = XmlDocument.parse(LIST);
    const table = tableFor(document, null, document.documentElement()!)!;

    expect(table.name).toBe('line');
    expect(table.columns.map((column) => column.key)).toEqual(['@partNum', 'sku', 'qty']);
    expect(table.rows).toHaveLength(3);
  });

  it('keeps a column that only some rows have, so the grid is not ragged', () => {
    const document = XmlDocument.parse(LIST);
    const table = tableFor(document, null, document.documentElement()!)!;

    const qty = table.columns.findIndex((column) => column.key === 'qty');
    expect(table.rows[0]!.cells[qty]!.value).toBe('2');
    // The third line has no <qty>. Null rather than an empty node, so the table can offer to create
    // it rather than silently editing something that does not exist.
    expect(table.rows[2]!.cells[qty]!.node).toBeNull();
    expect(table.rows[2]!.cells[qty]!.value).toBe('');
  });

  it('picks the largest repeated group when a parent holds more than one', () => {
    const document = XmlDocument.parse(`<order>
      <note>a</note><note>b</note>
      <line><sku>1</sku></line><line><sku>2</sku></line><line><sku>3</sku></line>
    </order>`);
    expect(tableFor(document, null, document.documentElement()!)!.name).toBe('line');
  });

  it('is null where there is no list, rather than an empty grid', () => {
    const document = XmlDocument.parse('<order><line><sku>1</sku></line></order>');
    expect(tableFor(document, null, document.documentElement()!)).toBeNull();
  });

  it('is null when the repeated element has no simple values to column', () => {
    // Flattening nested children would produce columns meaning different things at different
    // depths, which is worse than no table at all.
    const document = XmlDocument.parse('<a><b><c><d>1</d></c></b><b><c><d>2</d></c></b></a>');
    expect(tableFor(document, null, document.documentElement()!)).toBeNull();
  });

  it('takes the widget from the schema, so a cell edits like the Inspector does', () => {
    const schema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="order" type="Order"/>
      <xs:complexType name="Order">
        <xs:sequence><xs:element name="line" type="Line" maxOccurs="unbounded"/></xs:sequence>
      </xs:complexType>
      <xs:complexType name="Line">
        <xs:sequence><xs:element name="status" type="Status"/></xs:sequence>
      </xs:complexType>
      <xs:simpleType name="Status">
        <xs:restriction base="xs:string">
          <xs:enumeration value="open"/><xs:enumeration value="shut"/>
        </xs:restriction>
      </xs:simpleType>
    </xs:schema>`;

    const document = XmlDocument.parse(
      '<order><line><status>open</status></line><line><status>shut</status></line></order>',
    );
    const table = tableFor(document, model(schema), document.documentElement()!)!;
    expect(table.columns[0]!.widget).toEqual({ kind: 'radio', options: ['open', 'shut'] });
  });
});
