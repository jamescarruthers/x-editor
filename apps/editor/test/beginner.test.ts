import { describe as suite, expect, it } from 'vitest';
import { XmlDocument, type NodeId } from '@x-editor/xml-core';
import {
  SchemaModel,
  assembleSchema,
  catalogueFrom,
  validateDocument,
} from '@x-editor/xsd';
import { analysePaste, applyPaste, stripNamespaces } from '../src/model/paste.js';
import { inferSchema } from '../src/model/infer.js';
import { explainDocument } from '../src/model/explain.js';

const SCHEMA = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="line" type="Line" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="Line">
    <xs:sequence>
      <xs:element name="sku" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

const DOCUMENT = `<?xml version="1.0"?>
<order>
  <line><sku>A-1</sku></line>
</order>`;

function model(): SchemaModel {
  return new SchemaModel(assembleSchema('s.xsd', catalogueFrom({ 's.xsd': SCHEMA })));
}

/** The node of the first `line` element. */
function firstLine(document: XmlDocument): NodeId {
  const root = document.documentElement()!;
  return document.childrenOf(root).find((id) => document.node(id)?.kind === 'element')!;
}

suite('smart paste', () => {
  it('ranks the valid destination above the invalid one', () => {
    const document = XmlDocument.parse(DOCUMENT);
    // Pasting a <line> while standing on a <line>: inside is wrong, after is right.
    const analysis = analysePaste(
      document,
      model(),
      firstLine(document),
      '<line><sku>B-2</sku></line>',
    );

    expect(analysis.options[0]!.id).toBe('sibling');
    expect(analysis.options[0]!.errors).toBe(0);
    expect(analysis.options.find((option) => option.id === 'inside')!.errors).toBeGreaterThan(0);
  });

  it('measures the cost of each option rather than only ordering them', () => {
    const document = XmlDocument.parse(DOCUMENT);
    const analysis = analysePaste(
      document,
      model(),
      document.documentElement()!,
      '<nonsense/>',
    );
    const inside = analysis.options.find((option) => option.id === 'inside')!;
    expect(inside.errors).toBe(1);
  });

  it('produces a document the engine calls valid when the valid option is taken', () => {
    const document = XmlDocument.parse(DOCUMENT);
    const compiled = model();
    const analysis = analysePaste(
      document,
      compiled,
      firstLine(document),
      '<line><sku>B-2</sku></line>',
    );

    const command = applyPaste(document, analysis.options[0]!, analysis.fragment, '');
    expect(command).not.toBeNull();
    document.run(command!);

    expect(document.serialize()).toContain('<line>');
    expect(validateDocument(compiled, document).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('offers the strip-namespaces option only when there are prefixes to strip', () => {
    const document = XmlDocument.parse(DOCUMENT);
    const plain = analysePaste(document, model(), document.documentElement()!, '<line/>');
    expect(plain.options.some((option) => option.id === 'strip')).toBe(false);

    const prefixed = analysePaste(
      document,
      model(),
      document.documentElement()!,
      '<n:line xmlns:n="urn:x"/>',
    );
    // Without stripping, the prefixed element does not fit the no-namespace model; with it, it does.
    const strip = prefixed.options.find((option) => option.id === 'strip')!;
    expect(strip.errors).toBe(0);
    expect(prefixed.options.find((option) => option.id === 'inside')!.errors).toBeGreaterThan(0);
  });

  it('falls back to text rather than failing when the clipboard is not XML', () => {
    const document = XmlDocument.parse(DOCUMENT);
    const analysis = analysePaste(document, model(), firstLine(document), 'just some words');
    expect(analysis.options).toHaveLength(1);
    expect(analysis.options[0]!.transform).toBe('as-text');
  });

  it('reports broken XML instead of silently pasting a mangled fragment', () => {
    const document = XmlDocument.parse(DOCUMENT);
    const analysis = analysePaste(document, model(), firstLine(document), '<line><sku>oops</line>');
    expect(analysis.parseError).not.toBeNull();
    expect(analysis.options.every((option) => option.transform === 'as-text')).toBe(true);
  });

  it('strips prefixes and declarations without touching the content', () => {
    expect(stripNamespaces('<n:a xmlns:n="urn:x" n:b="1">text</n:a>')).toBe('<a b="1">text</a>');
  });
});

suite('inferring a schema', () => {
  const infer = (source: string) => inferSchema(XmlDocument.parse(source));

  it('produces a schema the document actually validates against', () => {
    const source = `<?xml version="1.0"?>
<catalogue>
  <product id="1"><name>Hammer</name><status>active</status></product>
  <product id="2"><name>Nail</name><status>retired</status></product>
  <product id="3"><name>Saw</name><status>active</status></product>
</catalogue>`;

    const result = infer(source);
    const compiled = new SchemaModel(
      assembleSchema('i.xsd', catalogueFrom({ 'i.xsd': result.source })),
    );
    expect(compiled.allDiagnostics().filter((d) => d.severity === 'error')).toEqual([]);

    const errors = validateDocument(compiled, XmlDocument.parse(source)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors.map((error) => error.message)).toEqual([]);
  });

  it('writes anything seen twice as unbounded', () => {
    // Permitting one more than the file showed is a smaller mistake than rejecting the next file.
    const result = infer('<a><b/><b/></a>');
    expect(result.source).toContain('maxOccurs="unbounded"');
  });

  it('marks an attribute required only when every occurrence carried it', () => {
    const result = infer('<a><b id="1"/><b id="2"/></a>');
    expect(result.source).toContain('use="required"');

    const partial = infer('<a><b id="1"/><b/></a>');
    expect(partial.source).not.toContain('use="required"');
  });

  it('offers an enumeration only where the evidence is a repeated closed set', () => {
    const enumerated = infer(
      '<a><s>on</s><s>off</s><s>on</s><s>off</s><s>on</s></a>',
    );
    expect(enumerated.source).toContain('<xs:enumeration value="on"/>');

    // Five distinct values across five occurrences is a free-text column, not an enumeration.
    const free = infer('<a><s>p</s><s>q</s><s>r</s><s>t</s><s>u</s></a>');
    expect(free.source).not.toContain('xs:enumeration');
  });

  it('says what it had to guess at', () => {
    const result = infer('<a><b>x</b></a>');
    expect(result.caveats.some((caveat) => caveat.includes('xs:string'))).toBe(true);
    expect(result.caveats.some((caveat) => caveat.includes('only once'))).toBe(true);
  });

  it('handles text with attributes as simple content', () => {
    // The commonest mistake in a hand-written schema: get this wrong and the element silently
    // stops being allowed to hold text at all.
    const source = '<a><b unit="kg">5</b></a>';
    const result = infer(source);
    expect(result.source).toContain('<xs:simpleContent>');

    const compiled = new SchemaModel(
      assembleSchema('i.xsd', catalogueFrom({ 'i.xsd': result.source })),
    );
    expect(
      validateDocument(compiled, XmlDocument.parse(source)).filter((d) => d.severity === 'error'),
    ).toEqual([]);
  });

  it('handles mixed content without producing a schema that rejects the document', () => {
    const source = '<a><p>text with <em>markup</em> inside</p></a>';
    const result = infer(source);
    expect(result.source).toContain('mixed="true"');

    const compiled = new SchemaModel(
      assembleSchema('i.xsd', catalogueFrom({ 'i.xsd': result.source })),
    );
    expect(
      validateDocument(compiled, XmlDocument.parse(source)).filter((d) => d.severity === 'error'),
    ).toEqual([]);
  });
});

suite('explaining a document', () => {
  it('leads with what the document is mostly made of', () => {
    const document = XmlDocument.parse(`<invoice>
      <line/><line/><line/>
    </invoice>`);
    const explanation = explainDocument(document, null);
    expect(explanation.summary).toContain('3 line');
    expect(explanation.summary).toContain('4 elements');
  });

  it('collapses repeated siblings, because the twelfth teaches nothing the first did not', () => {
    const document = XmlDocument.parse('<a><b/><b/><b/><b/></a>');
    const explanation = explainDocument(document, null);
    expect(explanation.steps).toHaveLength(2);
  });

  it('prefers the schema author\'s words and marks the difference', () => {
    const schema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="order" type="Order">
        <xs:annotation><xs:documentation>An order placed with a supplier.</xs:documentation></xs:annotation>
      </xs:element>
      <xs:complexType name="Order"><xs:sequence>
        <xs:element name="line" type="xs:string"/>
      </xs:sequence></xs:complexType>
    </xs:schema>`;
    const compiled = new SchemaModel(assembleSchema('s.xsd', catalogueFrom({ 's.xsd': schema })));
    const document = XmlDocument.parse('<order><line>x</line></order>');

    const explanation = explainDocument(document, compiled);
    expect(explanation.steps[0]!.text).toBe('An order placed with a supplier.');
    expect(explanation.steps[0]!.fromSchema).toBe(true);
    // The child has no documentation, so its sentence is read from the document — and says so.
    expect(explanation.steps[1]!.fromSchema).toBe(false);
  });

  it('says something useful about a document with no root', () => {
    const explanation = explainDocument(XmlDocument.parse('<!-- nothing -->'), null);
    expect(explanation.summary).toContain('no root element');
    expect(explanation.steps).toEqual([]);
  });
});
