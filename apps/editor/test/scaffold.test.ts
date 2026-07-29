import { beforeAll, describe as suite, expect, it } from 'vitest';
import { XmlDocument, setAttribute, setTextValue, type NodeId } from '@x-editor/xml-core';
import {
  SchemaModel,
  assembleSchema,
  catalogueFrom,
  loadXPath,
  validateDocument,
} from '@x-editor/xsd';
import { parseSchematron, runSchematron } from '@x-editor/schematron';
import {
  nextPlaceholder,
  pendingPlaceholders,
  resolvePlaceholders,
  scaffoldDocument,
} from '../src/model/scaffold.js';
import { EXAMPLES } from '../src/examples/index.js';
import { TOPIC_METADATA_SCHEMA } from '../src/examples/topic.js';
import { INVOICE_DOCUMENT, INVOICE_RULES, INVOICE_SCHEMA } from '../src/examples/invoice.js';

function modelOf(source: string, extra: Record<string, string> = {}): SchemaModel {
  return new SchemaModel(
    assembleSchema('s.xsd', catalogueFrom({ ...extra, 's.xsd': source })),
  );
}

const NO_NAMESPACE = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="placed" type="xs:date"/>
      <xs:element name="status" type="Status"/>
      <xs:element name="note" type="xs:string" minOccurs="0"/>
    </xs:sequence>
    <xs:attribute name="ref" type="xs:string" use="required"/>
    <xs:attribute name="channel" type="xs:string" fixed="web"/>
  </xs:complexType>
  <xs:simpleType name="Status">
    <xs:restriction base="xs:string">
      <xs:enumeration value="draft"/>
      <xs:enumeration value="placed"/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`;

const NAMESPACED = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns="urn:x" targetNamespace="urn:x" elementFormDefault="qualified">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="ref" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

const UNQUALIFIED_LOCALS = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns="urn:x" targetNamespace="urn:x">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="ref" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

function root(model: SchemaModel) {
  const element = model.globalElements()[0];
  if (element === undefined) throw new Error('no global element');
  return element;
}

suite('scaffolding a document', () => {
  it('produces a document the engine itself calls valid', () => {
    const model = modelOf(NO_NAMESPACE);
    const scaffold = scaffoldDocument(model, root(model), { include: 'required' });
    const document = XmlDocument.parse(scaffold.source);

    expect(document.parseErrors).toEqual([]);
    const errors = validateDocument(model, document).filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('fills optional children when asked for everything', () => {
    const model = modelOf(NO_NAMESPACE);
    const required = scaffoldDocument(model, root(model), { include: 'required' });
    const all = scaffoldDocument(model, root(model), { include: 'all' });

    expect(required.source).not.toContain('<note');
    // An unfaceted xs:string has nothing sensible to invent, so it arrives empty — and still counts
    // as a value to review, which is the whole reason it is worth generating at all.
    expect(all.source).toContain('<note/>');
    expect(all.elementCount).toBeGreaterThan(required.elementCount);

    const document = XmlDocument.parse(all.source);
    expect(validateDocument(model, document).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('declares the root namespace as the default, so tags stay readable', () => {
    const model = modelOf(NAMESPACED);
    const scaffold = scaffoldDocument(model, root(model), { include: 'required' });

    expect(scaffold.source).toContain('<order xmlns="urn:x">');
    expect(scaffold.source).not.toContain('ns1:');
    expect(
      validateDocument(model, XmlDocument.parse(scaffold.source)).filter(
        (d) => d.severity === 'error',
      ),
    ).toEqual([]);
  });

  it('undeclares the default namespace for unqualified locals', () => {
    // elementFormDefault is unqualified here, so <ref> is in no namespace while <order> is in
    // urn:x. Without the xmlns="" the child inherits the default and the document is invalid — and
    // this is the majority shape of hand-written schemas, not an edge case.
    const model = modelOf(UNQUALIFIED_LOCALS);
    const scaffold = scaffoldDocument(model, root(model), { include: 'required' });

    expect(scaffold.source).toContain('xmlns=""');
    expect(
      validateDocument(model, XmlDocument.parse(scaffold.source)).filter(
        (d) => d.severity === 'error',
      ),
    ).toEqual([]);
  });

  it('marks generated values and not authored ones', () => {
    const model = modelOf(NO_NAMESPACE);
    const scaffold = scaffoldDocument(model, root(model), { include: 'all' });

    const attributes = scaffold.placeholders
      .filter((placeholder) => placeholder.attribute !== null)
      .map((placeholder) => placeholder.attribute);

    // `ref` had to be invented. `channel` is fixed="web" — a value the schema author decided, so
    // there is nothing for the document author to review, and listing it would pad the to-do list
    // with an item nobody can act on.
    expect(scaffold.source).toContain('channel="web"');
    expect(attributes).toEqual(['ref']);
  });

  it('picks a value that satisfies the type, so the to-do list is not also an error list', () => {
    const model = modelOf(NO_NAMESPACE);
    const scaffold = scaffoldDocument(model, root(model), { include: 'required' });
    expect(scaffold.source).toContain('<status>draft</status>');
  });
});

suite('reviewing generated values', () => {
  const scaffoldOf = () => {
    const model = modelOf(NO_NAMESPACE);
    const scaffold = scaffoldDocument(model, root(model), { include: 'required' });
    const document = XmlDocument.parse(scaffold.source);
    return { document, placeholders: resolvePlaceholders(document, scaffold.placeholders) };
  };

  it('resolves every path to a node in the parsed document', () => {
    const { document, placeholders } = scaffoldOf();
    expect(placeholders.length).toBeGreaterThan(0);
    for (const placeholder of placeholders) {
      expect(document.node(placeholder.node)).toBeDefined();
    }
  });

  it('drops a value once it has been changed', () => {
    const { document, placeholders } = scaffoldOf();
    const before = pendingPlaceholders(document, placeholders).length;

    const text = placeholders.find((placeholder) => placeholder.attribute === null)!;
    const textChild = document.childrenOf(text.node)[0]!;
    document.run(setTextValue(document, textChild, 'something a person chose'));

    expect(pendingPlaceholders(document, placeholders)).toHaveLength(before - 1);
  });

  it('brings it back on undo, because the value is back to what was generated', () => {
    // The reason liveness is derived by comparison rather than tracked through edits: an
    // intercept-the-edit scheme would have dropped this entry for good.
    const { document, placeholders } = scaffoldOf();
    const before = pendingPlaceholders(document, placeholders).length;

    const attribute = placeholders.find((placeholder) => placeholder.attribute !== null)!;
    document.run(
      setAttribute(
        document,
        attribute.node,
        { prefix: '', localName: attribute.attribute!, namespaceUri: null },
        'PO-1',
      ),
    );
    expect(pendingPlaceholders(document, placeholders)).toHaveLength(before - 1);

    document.undo();
    expect(pendingPlaceholders(document, placeholders)).toHaveLength(before);
  });

  it('steps through them in document order and wraps', () => {
    const { document, placeholders } = scaffoldOf();
    const pending = pendingPlaceholders(document, placeholders);
    const distinct = [...new Set(pending.map((placeholder) => placeholder.node))];

    let cursor: NodeId = distinct[0]!;
    const visited: NodeId[] = [cursor];
    for (let step = 1; step < distinct.length; step++) {
      cursor = nextPlaceholder(document, placeholders, cursor, 1)!;
      visited.push(cursor);
    }
    expect(new Set(visited)).toEqual(new Set(distinct));

    // Wraps rather than stopping: a stepper that dead-ends at the last item makes people think
    // they have seen everything when they started in the middle.
    expect(nextPlaceholder(document, placeholders, cursor, 1)).toBe(distinct[0]);
  });

  it('returns null when there is nothing left to review', () => {
    const { document } = scaffoldOf();
    expect(nextPlaceholder(document, [], document.documentElement()!, 1)).toBeNull();
  });
});

suite('the bundled examples', () => {
  beforeAll(async () => {
    await loadXPath();
  });

  it('all parse, and each carries what it claims to', () => {
    expect(EXAMPLES).toHaveLength(3);
    for (const example of EXAMPLES) {
      expect(XmlDocument.parse(example.document).parseErrors).toEqual([]);
      expect(example.teaches).not.toBe('');
    }
  });

  it('the purchase order and topic examples open valid', () => {
    for (const example of EXAMPLES.filter((entry) => entry.id !== 'invoice')) {
      const extra = example.id === 'topic' ? { 'metadata.xsd': TOPIC_METADATA_SCHEMA } : {};
      const model = new SchemaModel(
        assembleSchema(
          example.schemaName!,
          catalogueFrom({ ...extra, [example.schemaName!]: example.schema! }),
        ),
      );
      const errors = validateDocument(model, XmlDocument.parse(example.document)).filter(
        (d) => d.severity === 'error',
      );
      expect(errors.map((error) => error.message)).toEqual([]);
    }
  });

  it('the invoice is schema-valid and fails exactly one business rule', () => {
    // The whole point of this example. If it ever passes, the first-minute demo of
    // error → explanation → fix → green has silently stopped happening.
    const model = new SchemaModel(
      assembleSchema('invoice.xsd', catalogueFrom({ 'invoice.xsd': INVOICE_SCHEMA })),
    );
    const document = XmlDocument.parse(INVOICE_DOCUMENT);
    expect(validateDocument(model, document).filter((d) => d.severity === 'error')).toEqual([]);

    const rules = parseSchematron(XmlDocument.parse(INVOICE_RULES));
    expect(rules.problems.filter((problem) => problem.severity === 'error')).toEqual([]);

    const result = runSchematron(rules.schema, document);
    const failures = result.findings.filter((finding) => finding.role !== 'warning');
    expect(failures).toHaveLength(1);
    expect(failures[0]!.message).toContain('140');
  });

  it('the invoice goes green once the total is corrected', () => {
    const document = XmlDocument.parse(INVOICE_DOCUMENT.replace('<total>120.00', '<total>140.00'));
    const rules = parseSchematron(XmlDocument.parse(INVOICE_RULES));
    const result = runSchematron(rules.schema, document);
    expect(result.findings.filter((finding) => finding.role !== 'warning')).toEqual([]);
  });
});
