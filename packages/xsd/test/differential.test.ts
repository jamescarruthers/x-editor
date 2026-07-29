import { describe, expect, it } from 'vitest';
import { XmlDocument } from '@x-editor/xml-core';
import { assembleSchema, catalogueFrom } from '../src/assemble.js';
import { SchemaModel } from '../src/model.js';
import { validateDocument } from '../src/validate.js';
import { validateWithLibxml2 } from './oracles/libxml2.js';

/**
 * Guidance versus verdict.
 *
 * The plan's top risk is that these two independent implementations of XSD semantics drift apart:
 * the palette offers an element libxml2 then rejects, or calls a document valid that it does not.
 * That does not merely produce a bug — it means the product actively teaches beginners wrong
 * things, which destroys the whole value proposition.
 *
 * So every case below is checked against both engines, and a disagreement fails the build. The
 * corpus here is small and deliberately adversarial rather than broad; PLAN.md §9 has the plan for
 * the real one (the W3C Schema Test Collection, UBL 2.1, GML 3.2, HL7 CDA, DocBook, SEPA).
 *
 * The harness dispatches on the schema's declared version. libxml2 is XSD 1.0 only, so pointing it
 * at a 1.1 schema produces a flood of false failures rather than one honest one.
 */

const XS = 'http://www.w3.org/2001/XMLSchema';

interface Case {
  readonly name: string;
  readonly schema: string;
  readonly instance: string;
  /** What both engines are expected to say. Stated so a silent mutual regression still fails. */
  readonly valid: boolean;
}

const SCHEMA = `<?xml version="1.0"?>
<xs:schema xmlns:xs="${XS}" targetNamespace="urn:t" xmlns="urn:t"
           elementFormDefault="qualified">
  <xs:element name="order" type="Order"/>

  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="id" type="xs:string"/>
      <xs:element name="shipDate" type="xs:date" minOccurs="0"/>
      <xs:element name="line" type="Line" maxOccurs="unbounded"/>
      <xs:element name="note" type="xs:string" minOccurs="0" maxOccurs="3"/>
    </xs:sequence>
    <xs:attribute name="currency" type="Currency" use="required"/>
    <xs:attribute name="ref" type="xs:string"/>
  </xs:complexType>

  <xs:complexType name="Line">
    <xs:sequence>
      <xs:element name="sku" type="Sku"/>
      <xs:element name="qty" type="Qty"/>
    </xs:sequence>
  </xs:complexType>

  <xs:simpleType name="Currency">
    <xs:restriction base="xs:string">
      <xs:enumeration value="GBP"/><xs:enumeration value="EUR"/>
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="Sku">
    <xs:restriction base="xs:string"><xs:pattern value="[A-Z]{2}\\d{6}"/></xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="Qty">
    <xs:restriction base="xs:positiveInteger"><xs:maxInclusive value="99"/></xs:restriction>
  </xs:simpleType>
</xs:schema>`;

const order = (body: string, attributes = 'currency="GBP"'): string =>
  `<order xmlns="urn:t" ${attributes}>${body}</order>`;

const LINE = '<line><sku>AB123456</sku><qty>1</qty></line>';

const CASES: Case[] = [
  { name: 'a complete document', schema: SCHEMA, instance: order(`<id>X</id>${LINE}`), valid: true },
  {
    name: 'optional children present',
    schema: SCHEMA,
    instance: order(`<id>X</id><shipDate>2026-07-29</shipDate>${LINE}<note>n</note>`),
    valid: true,
  },
  {
    name: 'a repeated unbounded child',
    schema: SCHEMA,
    instance: order(`<id>X</id>${LINE}${LINE}${LINE}`),
    valid: true,
  },
  { name: 'a missing required child', schema: SCHEMA, instance: order('<id>X</id>'), valid: false },
  {
    name: 'children in the wrong order',
    schema: SCHEMA,
    instance: order(`${LINE}<id>X</id>`),
    valid: false,
  },
  {
    name: 'a missing required attribute',
    schema: SCHEMA,
    instance: order(`<id>X</id>${LINE}`, ''),
    valid: false,
  },
  {
    name: 'an attribute value outside its enumeration',
    schema: SCHEMA,
    instance: order(`<id>X</id>${LINE}`, 'currency="XYZ"'),
    valid: false,
  },
  {
    name: 'a value that breaks its pattern',
    schema: SCHEMA,
    instance: order('<id>X</id><line><sku>nope</sku><qty>1</qty></line>'),
    valid: false,
  },
  {
    name: 'a number above its maxInclusive',
    schema: SCHEMA,
    instance: order('<id>X</id><line><sku>AB123456</sku><qty>500</qty></line>'),
    valid: false,
  },
  {
    name: 'a number below its inherited minimum',
    schema: SCHEMA,
    instance: order('<id>X</id><line><sku>AB123456</sku><qty>0</qty></line>'),
    valid: false,
  },
  {
    name: 'a decimal where a whole number is required',
    schema: SCHEMA,
    instance: order('<id>X</id><line><sku>AB123456</sku><qty>1.5</qty></line>'),
    valid: false,
  },
  {
    name: 'an element the schema does not declare',
    schema: SCHEMA,
    instance: order(`<id>X</id>${LINE}<mystery/>`),
    valid: false,
  },
  {
    name: 'more repeats than maxOccurs allows',
    schema: SCHEMA,
    instance: order(`<id>X</id>${LINE}<note>a</note><note>b</note><note>c</note><note>d</note>`),
    valid: false,
  },
  {
    name: 'a date that has the right shape but does not exist',
    schema: SCHEMA,
    instance: order(`<id>X</id><shipDate>2026-02-30</shipDate>${LINE}`),
    valid: false,
  },
  {
    name: 'an undeclared root element',
    schema: SCHEMA,
    instance: '<invoice xmlns="urn:t"/>',
    valid: false,
  },
  {
    name: 'a local element written in the wrong namespace',
    schema: SCHEMA,
    // elementFormDefault="qualified", so an unqualified <id> is not the declared one.
    instance: `<order xmlns="urn:t" currency="GBP"><id xmlns="">X</id>${LINE}</order>`,
    valid: false,
  },
];

describe('our engine and libxml2 agree', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const files = { 'main.xsd': testCase.schema };
      const set = assembleSchema('main.xsd', catalogueFrom(files));

      // libxml2 is XSD 1.0 only. A 1.1 schema needs the xmlschema oracle instead (PLAN.md §5.1),
      // and running the 1.0 one against it would produce noise rather than a finding.
      expect(set.declaredVersion).toBe('1.0');

      const model = new SchemaModel(set);
      expect(model.allDiagnostics().filter((d) => d.severity === 'error')).toEqual([]);

      const ours = validateDocument(model, XmlDocument.parse(testCase.instance));
      const oursValid = ours.every((problem) => problem.severity !== 'error');
      const theirs = validateWithLibxml2(files, 'main.xsd', testCase.instance);

      // Reported together so a failure names both verdicts rather than only one.
      expect({
        engine: oursValid,
        libxml2: theirs.valid,
        engineSaid: ours.filter((p) => p.severity === 'error').map((p) => p.message),
        libxml2Said: theirs.errors.map((e) => e.message),
      }).toMatchObject({ engine: testCase.valid, libxml2: testCase.valid });
    });
  }
});

/**
 * The awkward corners — substitution groups, `xs:all`, derivation, wildcards, nillability, mixed
 * content, and the unqualified-local-element default. These are where two independent
 * implementations of XSD actually part company, so they get their own schema.
 */
const CORNERS = `<?xml version="1.0"?>
<xs:schema xmlns:xs="${XS}" targetNamespace="urn:c" xmlns="urn:c"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           elementFormDefault="qualified">
  <xs:element name="doc" type="Doc"/>

  <xs:complexType name="Doc">
    <xs:sequence>
      <xs:element ref="vehicle" minOccurs="0" maxOccurs="unbounded"/>
      <xs:element name="address" type="Address" minOccurs="0"/>
      <xs:element name="payment" type="Payment" minOccurs="0"/>
      <xs:element name="prose" type="Prose" minOccurs="0"/>
      <xs:element name="tag" type="xs:string" nillable="true" minOccurs="0"/>
      <xs:element name="extras" type="Extras" minOccurs="0"/>
      <xs:element name="legacy" type="Legacy" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>

  <xs:element name="vehicle" type="xs:string" abstract="true"/>
  <xs:element name="car" type="xs:string" substitutionGroup="vehicle"/>
  <xs:element name="van" type="xs:string" substitutionGroup="car"/>

  <xs:complexType name="Address">
    <xs:all>
      <xs:element name="street" type="xs:string"/>
      <xs:element name="city" type="xs:string"/>
      <xs:element name="county" type="xs:string" minOccurs="0"/>
    </xs:all>
  </xs:complexType>

  <xs:complexType name="Payment" abstract="true">
    <xs:sequence><xs:element name="amount" type="xs:decimal"/></xs:sequence>
  </xs:complexType>
  <xs:complexType name="CardPayment">
    <xs:complexContent>
      <xs:extension base="Payment">
        <xs:sequence><xs:element name="last4" type="xs:string"/></xs:sequence>
        <xs:attribute name="scheme" type="xs:string" use="required"/>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>

  <xs:complexType name="Prose" mixed="true">
    <xs:sequence>
      <xs:element name="emphasis" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="Extras">
    <xs:sequence>
      <xs:any namespace="##other" processContents="skip" minOccurs="0" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="Legacy">
    <xs:simpleContent>
      <xs:extension base="xs:int">
        <xs:attribute name="unit" type="xs:string" default="mm"/>
      </xs:extension>
    </xs:simpleContent>
  </xs:complexType>
</xs:schema>`;

const doc = (body: string): string => `<doc xmlns="urn:c">${body}</doc>`;

const CORNER_CASES: Case[] = [
  { name: 'a substitution-group member in place of its head', schema: CORNERS, instance: doc('<car>c</car>'), valid: true },
  { name: 'a transitive substitution-group member', schema: CORNERS, instance: doc('<van>v</van>'), valid: true },
  { name: 'the abstract head itself, which cannot appear', schema: CORNERS, instance: doc('<vehicle>v</vehicle>'), valid: false },
  { name: 'xs:all members out of order', schema: CORNERS, instance: doc('<address><city>C</city><street>S</street></address>'), valid: true },
  { name: 'an xs:all member repeated', schema: CORNERS, instance: doc('<address><street>S</street><street>T</street><city>C</city></address>'), valid: false },
  { name: 'a required xs:all member missing', schema: CORNERS, instance: doc('<address><street>S</street></address>'), valid: false },
  {
    name: 'xsi:type selecting a derived complex type',
    schema: CORNERS,
    instance: `<doc xmlns="urn:c" xmlns:c="urn:c" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><payment xsi:type="c:CardPayment" scheme="visa"><amount>1.00</amount><last4>4242</last4></payment></doc>`,
    valid: true,
  },
  {
    name: 'xsi:type without the attribute the derived type requires',
    schema: CORNERS,
    instance: `<doc xmlns="urn:c" xmlns:c="urn:c" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><payment xsi:type="c:CardPayment"><amount>1.00</amount><last4>4242</last4></payment></doc>`,
    valid: false,
  },
  { name: 'mixed content with text between elements', schema: CORNERS, instance: doc('<prose>see <emphasis>this</emphasis> here</prose>'), valid: true },
  { name: 'a wildcard admitting a foreign element', schema: CORNERS, instance: doc('<extras><other xmlns="urn:elsewhere"/></extras>'), valid: true },
  { name: 'simple content with its inherited value space', schema: CORNERS, instance: doc('<legacy unit="cm">42</legacy>'), valid: true },
  { name: 'simple content whose text breaks the base type', schema: CORNERS, instance: doc('<legacy>4.2</legacy>'), valid: false },
  { name: 'whitespace around a value the type collapses', schema: CORNERS, instance: doc('<legacy>  42  </legacy>'), valid: true },
];

describe('our engine and libxml2 agree in the awkward corners', () => {
  for (const testCase of CORNER_CASES) {
    it(testCase.name, () => {
      const files = { 'main.xsd': testCase.schema };
      const model = new SchemaModel(assembleSchema('main.xsd', catalogueFrom(files)));
      expect(model.allDiagnostics().filter((d) => d.severity === 'error')).toEqual([]);

      const ours = validateDocument(model, XmlDocument.parse(testCase.instance));
      const oursValid = ours.every((problem) => problem.severity !== 'error');
      const theirs = validateWithLibxml2(files, 'main.xsd', testCase.instance);

      expect({
        engine: oursValid,
        libxml2: theirs.valid,
        engineSaid: ours.filter((p) => p.severity === 'error').map((p) => p.message),
        libxml2Said: theirs.errors.map((e) => e.message),
      }).toMatchObject({ engine: testCase.valid, libxml2: testCase.valid });
    });
  }
});

describe('multi-file schema sets', () => {
  // SPIKE-2: import and include resolve through a catalogue of buffers, so libxml2 never fetches.
  const files = {
    'main.xsd': `<?xml version="1.0"?>
      <xs:schema xmlns:xs="${XS}" xmlns:c="urn:common" targetNamespace="urn:main"
                 xmlns="urn:main" elementFormDefault="qualified">
        <xs:import namespace="urn:common" schemaLocation="common.xsd"/>
        <xs:include schemaLocation="local.xsd"/>
        <xs:element name="root">
          <xs:complexType><xs:sequence>
            <xs:element name="code" type="c:Code"/>
            <xs:element name="note" type="Note"/>
          </xs:sequence></xs:complexType>
        </xs:element>
      </xs:schema>`,
    'common.xsd': `<?xml version="1.0"?>
      <xs:schema xmlns:xs="${XS}" targetNamespace="urn:common">
        <xs:simpleType name="Code">
          <xs:restriction base="xs:string"><xs:maxLength value="3"/></xs:restriction>
        </xs:simpleType>
      </xs:schema>`,
    'local.xsd': `<?xml version="1.0"?>
      <xs:schema xmlns:xs="${XS}" targetNamespace="urn:main">
        <xs:simpleType name="Note">
          <xs:restriction base="xs:string"><xs:maxLength value="5"/></xs:restriction>
        </xs:simpleType>
      </xs:schema>`,
  };

  const model = new SchemaModel(assembleSchema('main.xsd', catalogueFrom(files)));

  const check = (instance: string): { ours: boolean; theirs: boolean } => ({
    ours: validateDocument(model, XmlDocument.parse(instance)).every((p) => p.severity !== 'error'),
    theirs: validateWithLibxml2(files, 'main.xsd', instance).valid,
  });

  it('agrees on a document that satisfies both imported and included types', () => {
    expect(check('<root xmlns="urn:main"><code>AB</code><note>hi</note></root>')).toEqual({
      ours: true,
      theirs: true,
    });
  });

  it('agrees when the imported type is violated', () => {
    expect(check('<root xmlns="urn:main"><code>ABCD</code><note>hi</note></root>')).toEqual({
      ours: false,
      theirs: false,
    });
  });

  it('agrees when the included type is violated', () => {
    expect(check('<root xmlns="urn:main"><code>AB</code><note>far too long</note></root>')).toEqual({
      ours: false,
      theirs: false,
    });
  });
});

describe('what libxml2 reports', () => {
  // SPIKE-1, recorded as a test so a libxml2 upgrade that changes the answer is not silent.
  const schema = `<?xml version="1.0"?>
    <xs:schema xmlns:xs="${XS}">
      <xs:element name="root">
        <xs:complexType><xs:sequence>
          <xs:element name="item" maxOccurs="unbounded">
            <xs:complexType>
              <xs:sequence><xs:element name="n" type="xs:int"/></xs:sequence>
              <xs:attribute name="id" type="xs:string" use="required"/>
            </xs:complexType>
          </xs:element>
        </xs:sequence></xs:complexType>
      </xs:element>
    </xs:schema>`;

  const instance = `<?xml version="1.0"?>
<root>
  <item><n>1</n></item>
  <item id="b"><n>oops</n></item>
  <item id="c"><n>3</n><extra/></item>
  <item id="d"></item>
  <item id="e"><n>5</n><n>6</n></item>
</root>`;

  const result = validateWithLibxml2({ 'main.xsd': schema }, 'main.xsd', instance);

  it('reports every error rather than throwing on the first', () => {
    // Five distinct faults in five sibling subtrees, so none masks another.
    expect(result.errors).toHaveLength(5);
  });

  it('gives a usable line number for each', () => {
    expect(result.errors.map((error) => error.line)).toEqual([3, 4, 5, 6, 7]);
  });

  it('gives no usable column, which is why error mapping uses a line map', () => {
    // Every column is 0. Guessing a node from line/column would therefore be guessing from the line
    // alone — hence the plan's decision to own the serializer and emit one start-tag per line.
    expect(result.errors.every((error) => error.col === 0)).toBe(true);
  });
});
