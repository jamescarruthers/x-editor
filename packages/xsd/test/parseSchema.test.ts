import { describe, expect, it } from 'vitest';
import { parseSchemaSource } from '../src/parseSchema.js';
import { UNBOUNDED, type RawComplexType, type RawSimpleType } from '../src/ast.js';

const XS = 'http://www.w3.org/2001/XMLSchema';

function parse(body: string, attributes = ''): ReturnType<typeof parseSchemaSource> {
  return parseSchemaSource(
    `<xs:schema xmlns:xs="${XS}" ${attributes}>${body}</xs:schema>`,
    'test.xsd',
  );
}

describe('the schema element', () => {
  it('reads the target namespace and form defaults', () => {
    const { schema } = parse('', 'targetNamespace="urn:t" elementFormDefault="qualified"');
    expect(schema.targetNamespace).toBe('urn:t');
    expect(schema.elementFormDefault).toBe('qualified');
    expect(schema.attributeFormDefault).toBe('unqualified');
  });

  it('rejects an empty target namespace rather than treating it as absent', () => {
    // A frequent paste error, and one that silently changes every name in the schema.
    const { diagnostics } = parse('', 'targetNamespace=""');
    expect(diagnostics.map((d) => d.code)).toContain('empty-target-namespace');
  });

  it('notices vc:minVersion, which is how the differential harness picks its oracle', () => {
    const { schema } = parse(
      '',
      'xmlns:vc="http://www.w3.org/2007/XMLSchema-versioning" vc:minVersion="1.1"',
    );
    expect(schema.declaredVersion).toBe('1.1');
  });

  it('produces an empty schema, not an exception, for a file that is not a schema at all', () => {
    const { schema, diagnostics } = parseSchemaSource('<html><body/></html>', 'test.xsd');
    expect(schema.elements).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toContain('not-a-schema');
  });
});

describe('QName resolution', () => {
  it('resolves a prefixed reference through the bindings in scope where it is written', () => {
    const { schema } = parse(
      '<xs:element name="a" type="t:Thing"/>',
      'xmlns:t="urn:other" targetNamespace="urn:t"',
    );
    expect(schema.elements[0]?.type).toEqual({ namespaceUri: 'urn:other', localName: 'Thing' });
  });

  it('resolves an unprefixed reference through the default namespace', () => {
    const { schema } = parse(
      '<xs:element name="a" type="Thing"/>',
      'xmlns="urn:t" targetNamespace="urn:t"',
    );
    expect(schema.elements[0]?.type).toEqual({ namespaceUri: 'urn:t', localName: 'Thing' });
  });

  it('leaves an unprefixed reference in no namespace when there is no default binding', () => {
    const { schema } = parse('<xs:element name="a" type="Thing"/>');
    expect(schema.elements[0]?.type).toEqual({ namespaceUri: null, localName: 'Thing' });
  });

  it('reports an undeclared prefix and keeps going', () => {
    const { schema, diagnostics } = parse(
      '<xs:element name="a" type="nope:Thing"/><xs:element name="b"/>',
      '',
    );
    expect(diagnostics.map((d) => d.code)).toContain('undeclared-prefix');
    expect(schema.elements).toHaveLength(2);
  });
});

describe('element declarations', () => {
  it('reads occurrence bounds, including unbounded', () => {
    const { schema } = parse(`
      <xs:complexType name="T">
        <xs:sequence>
          <xs:element name="item" minOccurs="0" maxOccurs="unbounded"/>
        </xs:sequence>
      </xs:complexType>`);
    const type = schema.types[0] as RawComplexType;
    const content = type.content;
    expect(content.kind).toBe('particle');
    if (content.kind !== 'particle' || content.particle?.kind !== 'sequence') throw new Error();
    const item = content.particle.items[0];
    if (item?.kind !== 'element') throw new Error();
    expect(item.element.occurs).toEqual({ min: 0, max: UNBOUNDED });
  });

  it('defaults occurrence to exactly one', () => {
    const { schema } = parse(`
      <xs:complexType name="T"><xs:sequence><xs:element name="a"/></xs:sequence></xs:complexType>`);
    const content = (schema.types[0] as RawComplexType).content;
    if (content.kind !== 'particle' || content.particle?.kind !== 'sequence') throw new Error();
    const item = content.particle.items[0];
    if (item?.kind !== 'element') throw new Error();
    expect(item.element.occurs).toEqual({ min: 1, max: 1 });
  });

  it('reports maxOccurs below minOccurs', () => {
    const { diagnostics } = parse(`
      <xs:complexType name="T">
        <xs:sequence><xs:element name="a" minOccurs="3" maxOccurs="1"/></xs:sequence>
      </xs:complexType>`);
    expect(diagnostics.map((d) => d.code)).toContain('bad-occurs');
  });

  it('marks a global declaration qualified and a local one by the form default', () => {
    const { schema } = parse(
      `<xs:element name="root"/>
       <xs:complexType name="T"><xs:sequence><xs:element name="child"/></xs:sequence></xs:complexType>`,
      'targetNamespace="urn:t"',
    );
    expect(schema.elements[0]?.qualified).toBe(true);
    const content = (schema.types[0] as RawComplexType).content;
    if (content.kind !== 'particle' || content.particle?.kind !== 'sequence') throw new Error();
    const item = content.particle.items[0];
    if (item?.kind !== 'element') throw new Error();
    expect(item.element.qualified).toBe(false);
  });

  it('rejects having both @name and @ref', () => {
    const { diagnostics } = parse('<xs:element name="a" ref="b"/>');
    expect(diagnostics.map((d) => d.code)).toContain('name-and-ref');
  });
});

describe('type definitions', () => {
  it('reads a simple type restriction with its facets', () => {
    const { schema } = parse(`
      <xs:simpleType name="Code">
        <xs:restriction base="xs:string">
          <xs:minLength value="2"/>
          <xs:pattern value="[A-Z]+"/>
          <xs:enumeration value="AB"/>
          <xs:enumeration value="CD"/>
        </xs:restriction>
      </xs:simpleType>`);
    const type = schema.types[0] as RawSimpleType;
    expect(type.form).toBe('simple');
    if (type.derivation?.kind !== 'restriction') throw new Error();
    expect(type.derivation.base).toEqual({ namespaceUri: XS, localName: 'string' });
    expect(type.derivation.facets.map((f) => f.name)).toEqual([
      'minLength',
      'pattern',
      'enumeration',
      'enumeration',
    ]);
  });

  it('reads list and union derivations', () => {
    const { schema } = parse(`
      <xs:simpleType name="L"><xs:list itemType="xs:string"/></xs:simpleType>
      <xs:simpleType name="U"><xs:union memberTypes="xs:int xs:string"/></xs:simpleType>`);
    const list = schema.types[0] as RawSimpleType;
    const union = schema.types[1] as RawSimpleType;
    expect(list.derivation?.kind).toBe('list');
    if (union.derivation?.kind !== 'union') throw new Error();
    expect(union.derivation.memberTypes.map((m) => m.localName)).toEqual(['int', 'string']);
  });

  it('reads simple content extension, with attributes from the extension element', () => {
    const { schema } = parse(`
      <xs:complexType name="Money">
        <xs:simpleContent>
          <xs:extension base="xs:decimal">
            <xs:attribute name="currency" type="xs:string" use="required"/>
          </xs:extension>
        </xs:simpleContent>
      </xs:complexType>`);
    const type = schema.types[0] as RawComplexType;
    expect(type.content.kind).toBe('simple-content');
    expect(type.attributes.map((a) => [a.name, a.use])).toEqual([['currency', 'required']]);
  });

  it('reads complex content extension with its particle', () => {
    const { schema } = parse(`
      <xs:complexType name="Derived">
        <xs:complexContent>
          <xs:extension base="Base">
            <xs:sequence><xs:element name="extra"/></xs:sequence>
          </xs:extension>
        </xs:complexContent>
      </xs:complexType>`);
    const content = (schema.types[0] as RawComplexType).content;
    if (content.kind !== 'complex-content') throw new Error();
    expect(content.derivationKind).toBe('extension');
    expect(content.particle?.kind).toBe('sequence');
  });

  it('keeps XSD 1.1 assertions rather than discarding them', () => {
    const { schema } = parse(`
      <xs:complexType name="T">
        <xs:sequence><xs:element name="a" type="xs:int"/></xs:sequence>
        <xs:assert test="a > 0"/>
      </xs:complexType>`);
    expect((schema.types[0] as RawComplexType).assertions.map((a) => a.test)).toEqual(['a > 0']);
  });
});

describe('annotations', () => {
  it('collapses documentation whitespace', () => {
    const { schema } = parse(`
      <xs:element name="shipDate">
        <xs:annotation>
          <xs:documentation>
            The date the order
            left the warehouse.
          </xs:documentation>
        </xs:annotation>
      </xs:element>`);
    expect(schema.elements[0]?.annotation?.documentation).toBe(
      'The date the order left the warehouse.',
    );
  });

  it('keeps appinfo nodes for the embedded-Schematron path rather than reading them', () => {
    const { schema } = parse(`
      <xs:element name="a">
        <xs:annotation><xs:appinfo><foo/></xs:appinfo></xs:annotation>
      </xs:element>`);
    expect(schema.elements[0]?.annotation?.appinfo).toHaveLength(1);
  });
});

describe('composition', () => {
  it('records include, import and redefine with their locations', () => {
    const { schema } = parse(`
      <xs:include schemaLocation="common.xsd"/>
      <xs:import namespace="urn:other" schemaLocation="other.xsd"/>
      <xs:redefine schemaLocation="base.xsd">
        <xs:simpleType name="Code"><xs:restriction base="Code"/></xs:simpleType>
      </xs:redefine>`);
    expect(schema.compositions.map((c) => [c.kind, c.schemaLocation])).toEqual([
      ['include', 'common.xsd'],
      ['import', 'other.xsd'],
      ['redefine', 'base.xsd'],
    ]);
    expect(schema.compositions[2]?.components?.types).toHaveLength(1);
  });

  it('allows xs:import with no schemaLocation', () => {
    const { schema, diagnostics } = parse('<xs:import namespace="urn:other"/>');
    expect(schema.compositions[0]?.schemaLocation).toBeNull();
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
