import { beforeAll, describe, expect, it } from 'vitest';
import { XmlDocument } from '@x-editor/xml-core';
import { assembleSchema, catalogueFrom } from '../src/assemble.js';
import { SchemaModel } from '../src/model.js';
import { validateDocument } from '../src/diagnostics.js';
import { elementContext, requiredMissing } from '../src/query.js';
import { XSD_NS } from '../src/ast.js';
import { loadXPath } from '../src/xpath.js';

/**
 * XSD 1.1.
 *
 * The two headline features are XPath-shaped — `xs:assert` is an XPath 2.0 expression and
 * `xs:alternative` is an XPath predicate — which is why the plan judged 1.1 an extension of the
 * guidance engine rather than a second architecture. These tests are that claim, checked.
 */

function build(schema: string): SchemaModel {
  return new SchemaModel(assembleSchema('main.xsd', catalogueFrom({ 'main.xsd': schema })));
}

const messages = (model: SchemaModel, instance: string): string[] =>
  validateDocument(model, XmlDocument.parse(instance)).map((d) => d.message);

const codes = (model: SchemaModel, instance: string): string[] =>
  validateDocument(model, XmlDocument.parse(instance)).map((d) => d.code);

// The XPath engine is loaded on demand rather than imported, so the app never pays for it
// unless a schema actually needs it. Tests have to ask for it explicitly too.
beforeAll(async () => {
  await loadXPath();
});

describe('xs:assert', () => {
  const model = build(`<?xml version="1.0"?>
    <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t" xmlns:t="urn:t"
               elementFormDefault="qualified">
      <xs:element name="period" type="Period"/>
      <xs:complexType name="Period">
        <xs:sequence>
          <xs:element name="start" type="xs:date"/>
          <xs:element name="end" type="xs:date"/>
        </xs:sequence>
        <xs:assert test="t:end >= t:start">
          <xs:annotation>
            <xs:documentation>The end date cannot be before the start date.</xs:documentation>
          </xs:annotation>
        </xs:assert>
      </xs:complexType>
    </xs:schema>`);

  const period = (start: string, end: string): string =>
    `<period xmlns="urn:t"><start>${start}</start><end>${end}</end></period>`;

  it('accepts a document that satisfies the rule', () => {
    expect(messages(model, period('2026-01-01', '2026-12-31'))).toEqual([]);
  });

  it('reports one that does not, in the schema author\'s own words', () => {
    // Co-occurrence rules read far better in the author's language than in any message we could
    // synthesise, which is exactly why xs:documentation is preferred over the expression.
    expect(messages(model, period('2026-12-31', '2026-01-01'))).toEqual([
      'The end date cannot be before the start date.',
    ]);
  });

  it('falls back to showing the expression when the author wrote no documentation', () => {
    const bare = build(`<?xml version="1.0"?>
      <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t" xmlns:t="urn:t"
                 elementFormDefault="qualified">
        <xs:element name="a" type="A"/>
        <xs:complexType name="A">
          <xs:sequence><xs:element name="n" type="xs:int"/></xs:sequence>
          <xs:assert test="t:n > 0"/>
        </xs:complexType>
      </xs:schema>`);
    expect(messages(bare, '<a xmlns="urn:t"><n>-1</n></a>')[0]).toContain('t:n > 0');
  });

  it('marks the schema as 1.1 even without vc:minVersion', () => {
    // A schema using 1.1 constructs *is* 1.1. The differential harness dispatches on this, and
    // getting it wrong means running the 1.0 oracle against a 1.1 schema.
    expect(
      assembleSchema('main.xsd', catalogueFrom({
        'main.xsd': `<xs:schema xmlns:xs="${XSD_NS}"><xs:complexType name="T"><xs:sequence/><xs:assert test="true()"/></xs:complexType></xs:schema>`,
      })).declaredVersion,
    ).toBe('1.1');
  });

  it('reports a broken expression as the schema\'s problem, not the document\'s', () => {
    const broken = build(`<?xml version="1.0"?>
      <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t">
        <xs:element name="a" type="A"/>
        <xs:complexType name="A">
          <xs:sequence/>
          <xs:assert test="this is not (((xpath"/>
        </xs:complexType>
      </xs:schema>`);
    const diagnostics = validateDocument(broken, XmlDocument.parse('<a xmlns="urn:t"/>'));
    const assertion = diagnostics.find((d) => d.code === 'schema-assert-broken')!;
    // A warning, not an error: the user's document may well be fine, and telling them it is broken
    // sends them hunting for a mistake they did not make.
    expect(assertion.severity).toBe('warning');
    expect(assertion.message).toContain("the schema's own expression");
  });

  it('cannot see outside the element it is asserting on', () => {
    // The spec evaluates an assertion as though the element were the whole document, so that an
    // element is checkable wherever it ends up. Without isolation, `..` would reach the real parent.
    const isolated = build(`<?xml version="1.0"?>
      <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns:t="urn:t"
                 elementFormDefault="qualified">
        <xs:element name="outer" type="Outer"/>
        <xs:complexType name="Outer">
          <xs:sequence><xs:element name="inner" type="Inner"/></xs:sequence>
          <xs:attribute name="flag" type="xs:string"/>
        </xs:complexType>
        <xs:complexType name="Inner">
          <xs:sequence/>
          <xs:assert test="count(..) = 0"/>
        </xs:complexType>
      </xs:schema>`);
    expect(messages(isolated, '<outer xmlns="urn:t" flag="y"><inner/></outer>')).toEqual([]);
  });
});

describe('xs:alternative — conditional type assignment', () => {
  const model = build(`<?xml version="1.0"?>
    <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t"
               elementFormDefault="qualified">
      <xs:element name="payment">
        <xs:alternative test="@kind='card'" type="Card"/>
        <xs:alternative test="@kind='transfer'" type="Transfer"/>
        <xs:alternative type="Unknown"/>
      </xs:element>

      <xs:complexType name="Card">
        <xs:sequence><xs:element name="last4" type="xs:string"/></xs:sequence>
        <xs:attribute name="kind" type="xs:string"/>
      </xs:complexType>
      <xs:complexType name="Transfer">
        <xs:sequence><xs:element name="iban" type="xs:string"/></xs:sequence>
        <xs:attribute name="kind" type="xs:string"/>
      </xs:complexType>
      <xs:complexType name="Unknown">
        <xs:sequence/>
        <xs:attribute name="kind" type="xs:string"/>
      </xs:complexType>
    </xs:schema>`);

  const typeOf = (instance: string): string | undefined => {
    const document = XmlDocument.parse(instance);
    const context = elementContext(model, document, document.documentElement()!);
    return context?.type.name?.localName;
  };

  it('picks the type the element\'s own attributes select', () => {
    expect(typeOf('<payment xmlns="urn:t" kind="card"><last4>4242</last4></payment>')).toBe('Card');
    expect(typeOf('<payment xmlns="urn:t" kind="transfer"><iban>GB33</iban></payment>')).toBe(
      'Transfer',
    );
  });

  it('takes the first match, not the best one', () => {
    expect(typeOf('<payment xmlns="urn:t" kind="card"/>')).toBe('Card');
  });

  it('falls back to the alternative with no test', () => {
    expect(typeOf('<payment xmlns="urn:t" kind="cheque"/>')).toBe('Unknown');
  });

  it('validates against the type it selected, not the declared one', () => {
    expect(messages(model, '<payment xmlns="urn:t" kind="card"><last4>4242</last4></payment>')).toEqual(
      [],
    );
    // <iban> belongs to Transfer, so under kind="card" it is simply not allowed.
    expect(codes(model, '<payment xmlns="urn:t" kind="card"><iban>GB33</iban></payment>')).toContain(
      'cvc-complex-type.2.4.a',
    );
  });

  it('drives the palette from the selected type too', () => {
    const document = XmlDocument.parse('<payment xmlns="urn:t" kind="transfer"/>');
    const context = elementContext(model, document, document.documentElement()!)!;
    expect(requiredMissing(model, context).map((n) => n.localName)).toEqual(['iban']);
  });
});

describe('relaxed xs:all', () => {
  const model = build(`<?xml version="1.0"?>
    <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t"
               elementFormDefault="qualified">
      <xs:element name="bag" type="Bag"/>
      <xs:complexType name="Bag">
        <xs:all>
          <xs:element name="tag" type="xs:string" maxOccurs="3"/>
          <xs:element name="name" type="xs:string"/>
        </xs:all>
      </xs:complexType>
    </xs:schema>`);

  it('allows a member to repeat, which XSD 1.0 forbids', () => {
    expect(
      messages(model, '<bag xmlns="urn:t"><tag>a</tag><name>n</name><tag>b</tag></bag>'),
    ).toEqual([]);
  });

  it('still enforces the upper bound', () => {
    expect(
      codes(
        model,
        '<bag xmlns="urn:t"><tag>a</tag><tag>b</tag><tag>c</tag><tag>d</tag><name>n</name></bag>',
      ),
    ).toContain('cvc-complex-type.2.4.b');
  });
});

describe('xs:openContent', () => {
  const model = build(`<?xml version="1.0"?>
    <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t"
               elementFormDefault="qualified">
      <xs:element name="doc" type="Doc"/>
      <xs:complexType name="Doc">
        <xs:openContent mode="interleave">
          <xs:any namespace="##other" processContents="lax"/>
        </xs:openContent>
        <xs:sequence>
          <xs:element name="a" type="xs:string"/>
          <xs:element name="b" type="xs:string"/>
        </xs:sequence>
      </xs:complexType>
    </xs:schema>`);

  it('lets a foreign element appear anywhere among the declared content', () => {
    expect(
      messages(
        model,
        '<doc xmlns="urn:t"><a>1</a><x xmlns="urn:other"/><b>2</b></doc>',
      ),
    ).toEqual([]);
  });

  it('still requires the declared content itself', () => {
    expect(
      codes(model, '<doc xmlns="urn:t"><a>1</a><x xmlns="urn:other"/></doc>'),
    ).toContain('cvc-complex-type.2.4.b');
  });

  it('does not admit an element from the namespace the wildcard excludes', () => {
    expect(
      codes(model, '<doc xmlns="urn:t"><a>1</a><stray/><b>2</b></doc>').length,
    ).toBeGreaterThan(0);
  });

  it('suffix mode only opens the tail', () => {
    const suffix = build(`<?xml version="1.0"?>
      <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t"
                 elementFormDefault="qualified">
        <xs:element name="doc" type="Doc"/>
        <xs:complexType name="Doc">
          <xs:openContent mode="suffix">
            <xs:any namespace="##other" processContents="lax"/>
          </xs:openContent>
          <xs:sequence>
            <xs:element name="a" type="xs:string"/>
            <xs:element name="b" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>`);

    expect(
      messages(suffix, '<doc xmlns="urn:t"><a>1</a><b>2</b><x xmlns="urn:other"/></doc>'),
    ).toEqual([]);
    // The same foreign element in the middle is not in the suffix, so the model has to account for
    // it — and cannot.
    expect(
      codes(suffix, '<doc xmlns="urn:t"><a>1</a><x xmlns="urn:other"/><b>2</b></doc>').length,
    ).toBeGreaterThan(0);
  });
});
