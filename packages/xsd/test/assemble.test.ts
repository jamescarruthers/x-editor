import { describe, expect, it } from 'vitest';
import { assembleSchema, catalogueFrom, resolveUri, REDEFINE_NS } from '../src/assemble.js';
import { SymbolTable, declaredName } from '../src/symbols.js';
import type { RawComplexType, RawSimpleType } from '../src/ast.js';

const XS = 'http://www.w3.org/2001/XMLSchema';

const schema = (body: string, attributes = ''): string =>
  `<xs:schema xmlns:xs="${XS}" ${attributes}>${body}</xs:schema>`;

describe('resolveUri', () => {
  it('joins a relative location against the referring document', () => {
    expect(resolveUri('common.xsd', 'schemas/main.xsd')).toBe('schemas/common.xsd');
    expect(resolveUri('../shared/c.xsd', 'a/b/main.xsd')).toBe('a/shared/c.xsd');
  });

  it('leaves an absolute reference alone', () => {
    expect(resolveUri('http://example.com/a.xsd', 'main.xsd')).toBe('http://example.com/a.xsd');
  });

  it('resolves against a real URL base', () => {
    expect(resolveUri('b.xsd', 'http://example.com/x/a.xsd')).toBe('http://example.com/x/b.xsd');
  });
});

describe('assembly', () => {
  it('follows include and merges the components into one namespace', () => {
    const set = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema(
          '<xs:include schemaLocation="common.xsd"/><xs:element name="root" type="Code"/>',
          'targetNamespace="urn:t" xmlns="urn:t"',
        ),
        'common.xsd': schema(
          '<xs:simpleType name="Code"><xs:restriction base="xs:string"/></xs:simpleType>',
          'targetNamespace="urn:t"',
        ),
      }),
    );

    expect(set.documents.size).toBe(2);
    const symbols = new SymbolTable(set);
    const root = symbols.globalElements()[0]!;
    expect(symbols.lookupType(root.raw.type!, root.raw.origin)).not.toBeNull();
  });

  it('follows import across a namespace boundary', () => {
    const set = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema(
          '<xs:import namespace="urn:other" schemaLocation="other.xsd"/><xs:element name="root" type="o:Code"/>',
          'targetNamespace="urn:t" xmlns:o="urn:other"',
        ),
        'other.xsd': schema(
          '<xs:simpleType name="Code"><xs:restriction base="xs:string"/></xs:simpleType>',
          'targetNamespace="urn:other"',
        ),
      }),
    );

    const symbols = new SymbolTable(set);
    expect(symbols.globalTypes().map((t) => t.name)).toEqual([
      { namespaceUri: 'urn:other', localName: 'Code' },
    ]);
  });

  it('terminates on a circular include', () => {
    const set = assembleSchema(
      'a.xsd',
      catalogueFrom({
        'a.xsd': schema('<xs:include schemaLocation="b.xsd"/>', 'targetNamespace="urn:t"'),
        'b.xsd': schema('<xs:include schemaLocation="a.xsd"/>', 'targetNamespace="urn:t"'),
      }),
    );
    expect(set.documents.size).toBe(2);
  });

  it('reports a schema document that is referenced but not available', () => {
    const set = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema('<xs:include schemaLocation="missing.xsd"/>', 'targetNamespace="urn:t"'),
      }),
    );
    expect(set.diagnostics.map((d) => d.code)).toContain('schema-not-found');
    // The point of the diagnostic is that the rest of the set still assembles.
    expect(set.documents.has('main.xsd')).toBe(true);
  });

  it('reports 1.1 for the whole set when any document declares it', () => {
    const set = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema('<xs:include schemaLocation="b.xsd"/>', 'targetNamespace="urn:t"'),
        'b.xsd': schema(
          '',
          'targetNamespace="urn:t" xmlns:vc="http://www.w3.org/2007/XMLSchema-versioning" vc:minVersion="1.1"',
        ),
      }),
    );
    expect(set.declaredVersion).toBe('1.1');
  });
});

describe('chameleon include', () => {
  const set = assembleSchema(
    'main.xsd',
    catalogueFrom({
      'main.xsd': schema(
        '<xs:include schemaLocation="chameleon.xsd"/><xs:element name="root" type="t:Code"/>',
        'targetNamespace="urn:t" xmlns:t="urn:t"',
      ),
      // No targetNamespace of its own, and an internal reference written with no prefix.
      'chameleon.xsd': schema(`
        <xs:simpleType name="Code"><xs:restriction base="xs:string"/></xs:simpleType>
        <xs:element name="local" type="Code"/>`),
    }),
  );
  const symbols = new SymbolTable(set);

  it('pulls the included components into the including namespace', () => {
    expect(set.documents.get('chameleon.xsd')?.chameleon).toBe(true);
    expect(symbols.globalTypes().map((t) => t.name.namespaceUri)).toEqual(['urn:t']);
  });

  it('re-points references written inside the chameleon, which is the part that usually breaks', () => {
    // `type="Code"` was written with no namespace at all. It has to find `{urn:t}Code`.
    const local = symbols.globalElements().find((e) => e.name.localName === 'local')!;
    expect(symbols.lookupType(local.raw.type!, local.raw.origin)).not.toBeNull();
  });

  it('does not re-point references in a document that has its own namespace', () => {
    const other = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema('<xs:element name="a" type="Missing"/>', 'targetNamespace="urn:t"'),
      }),
    );
    const table = new SymbolTable(other);
    const element = table.globalElements()[0]!;
    expect(table.normalize(element.raw.type!, element.raw.origin).namespaceUri).toBeNull();
  });
});

describe('xs:redefine', () => {
  const set = assembleSchema(
    'main.xsd',
    catalogueFrom({
      'main.xsd': schema(
        `<xs:redefine schemaLocation="base.xsd">
           <xs:simpleType name="Code">
             <xs:restriction base="t:Code"><xs:maxLength value="3"/></xs:restriction>
           </xs:simpleType>
         </xs:redefine>`,
        'targetNamespace="urn:t" xmlns:t="urn:t"',
      ),
      'base.xsd': schema(
        '<xs:simpleType name="Code"><xs:restriction base="xs:string"><xs:maxLength value="10"/></xs:restriction></xs:simpleType>',
        'targetNamespace="urn:t"',
      ),
    }),
  );

  it('replaces the redefined component', () => {
    const symbols = new SymbolTable(set);
    const code = symbols.lookupType(
      { namespaceUri: 'urn:t', localName: 'Code' },
      { documentUri: 'main.xsd', node: 0 as never },
    ) as RawSimpleType;
    if (code.derivation?.kind !== 'restriction') throw new Error();
    expect(code.derivation.facets.map((f) => f.value)).toEqual(['3']);
  });

  it('re-points the self-reference at the original, so it is a plain lookup afterwards', () => {
    // Without this, `base="t:Code"` inside the redefinition would resolve to the redefinition
    // itself and the type would be defined in terms of itself.
    const symbols = new SymbolTable(set);
    const code = symbols.lookupType(
      { namespaceUri: 'urn:t', localName: 'Code' },
      { documentUri: 'main.xsd', node: 0 as never },
    ) as RawSimpleType;
    if (code.derivation?.kind !== 'restriction') throw new Error();
    expect(code.derivation.base?.namespaceUri).toBe(REDEFINE_NS);

    const original = symbols.lookupType(code.derivation.base!, code.origin) as RawSimpleType;
    if (original.derivation?.kind !== 'restriction') throw new Error();
    expect(original.derivation.facets.map((f) => f.value)).toEqual(['10']);
  });

  it('reports a redefinition of something the included schema does not define', () => {
    const broken = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema(
          `<xs:redefine schemaLocation="base.xsd">
             <xs:simpleType name="Nope"><xs:restriction base="xs:string"/></xs:simpleType>
           </xs:redefine>`,
          'targetNamespace="urn:t"',
        ),
        'base.xsd': schema('', 'targetNamespace="urn:t"'),
      }),
    );
    expect(broken.diagnostics.map((d) => d.code)).toContain('redefine-missing-target');
  });
});

describe('symbol spaces', () => {
  const set = assembleSchema(
    'main.xsd',
    catalogueFrom({
      'main.xsd': schema(
        `<xs:element name="Address" type="xs:string"/>
         <xs:complexType name="Address"><xs:sequence/></xs:complexType>
         <xs:group name="Address"><xs:sequence/></xs:group>`,
        'targetNamespace="urn:t"',
      ),
    }),
  );
  const symbols = new SymbolTable(set);
  const origin = { documentUri: 'main.xsd', node: 0 as never };
  const name = { namespaceUri: 'urn:t', localName: 'Address' };

  it('keeps the same name in three spaces apart', () => {
    expect(symbols.lookupElement(name, origin)).not.toBeNull();
    expect(symbols.lookupType(name, origin)).not.toBeNull();
    expect(symbols.lookupGroup(name, origin)).not.toBeNull();
    expect(symbols.lookupAttribute(name, origin)).toBeNull();
  });

  it('reports a duplicate within one space and keeps the first definition', () => {
    const duplicated = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema(
          `<xs:simpleType name="Code"><xs:restriction base="xs:string"><xs:maxLength value="1"/></xs:restriction></xs:simpleType>
           <xs:simpleType name="Code"><xs:restriction base="xs:string"><xs:maxLength value="2"/></xs:restriction></xs:simpleType>`,
          'targetNamespace="urn:t"',
        ),
      }),
    );
    const table = new SymbolTable(duplicated);
    expect(table.diagnostics.map((d) => d.code)).toContain('duplicate-definition');
    const code = table.lookupType({ namespaceUri: 'urn:t', localName: 'Code' }, origin) as RawSimpleType;
    if (code.derivation?.kind !== 'restriction') throw new Error();
    expect(code.derivation.facets[0]?.value).toBe('1');
  });
});

describe('declaredName', () => {
  const build = (attributes: string): { symbols: SymbolTable; set: ReturnType<typeof assembleSchema> } => {
    const set = assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': schema(
          `<xs:complexType name="T"><xs:sequence><xs:element name="child" type="xs:string"/></xs:sequence></xs:complexType>`,
          attributes,
        ),
      }),
    );
    return { symbols: new SymbolTable(set), set };
  };

  const localElement = (set: ReturnType<typeof assembleSchema>) => {
    const type = set.documents.get('main.xsd')!.schema.types[0] as RawComplexType;
    if (type.content.kind !== 'particle' || type.content.particle?.kind !== 'sequence') {
      throw new Error();
    }
    const item = type.content.particle.items[0];
    if (item?.kind !== 'element') throw new Error();
    return item.element;
  };

  it('leaves a local declaration out of the namespace under the unqualified default', () => {
    // The single most confusing default in XSD: the document that looks obviously right fails.
    const { set } = build('targetNamespace="urn:t"');
    const document = set.documents.get('main.xsd')!;
    expect(declaredName(localElement(set), document)).toEqual({
      namespaceUri: null,
      localName: 'child',
    });
  });

  it('puts it in the namespace under elementFormDefault="qualified"', () => {
    const { set } = build('targetNamespace="urn:t" elementFormDefault="qualified"');
    const document = set.documents.get('main.xsd')!;
    expect(declaredName(localElement(set), document)).toEqual({
      namespaceUri: 'urn:t',
      localName: 'child',
    });
  });
});
