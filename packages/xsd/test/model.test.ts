import { describe, expect, it } from 'vitest';
import { assembleSchema, catalogueFrom } from '../src/assemble.js';
import { SchemaModel, type CompiledComplexType } from '../src/model.js';
import { XSD_NS, type Origin } from '../src/ast.js';
import { isValidSequence, whatCanGoHere } from '../src/automaton.js';
import { allIsValid, allRequiredMissing } from '../src/allModel.js';
import type { ElementName } from '../src/particles.js';

const ORIGIN: Origin = { documentUri: 'main.xsd', node: 0 as never };
const TNS = 'urn:t';

// Qualified by default, matching how most real schemas are written; the "form defaults" block
// below covers the unqualified case, which is where the surprises live.
function model(
  body: string,
  attributes = `targetNamespace="${TNS}" xmlns="${TNS}" elementFormDefault="qualified"`,
): SchemaModel {
  return new SchemaModel(
    assembleSchema(
      'main.xsd',
      catalogueFrom({
        'main.xsd': `<xs:schema xmlns:xs="${XSD_NS}" ${attributes}>${body}</xs:schema>`,
      }),
    ),
  );
}

const q = (localName: string, namespaceUri: string | null = TNS): ElementName => ({
  namespaceUri,
  localName,
});

function complexType(m: SchemaModel, localName: string): CompiledComplexType {
  const type = m.typeByName(q(localName), ORIGIN);
  if (type.form !== 'complex') throw new Error(`${localName} is not a complex type`);
  return type;
}

/** The names offered at a position, which is what the Insert palette will show. */
function candidates(m: SchemaModel, type: CompiledComplexType, children: string[], index: number): string[] {
  const content = m.contentModel(type);
  if (content.kind !== 'automaton') throw new Error(`expected an automaton, got ${content.kind}`);
  return whatCanGoHere(content.model, children.map((name) => q(name)), index)
    .filter((c) => c.name !== undefined)
    .map((c) => c.name!.localName)
    .sort();
}

describe('content models', () => {
  const m = model(`
    <xs:complexType name="Order">
      <xs:sequence>
        <xs:element name="id" type="xs:string"/>
        <xs:element name="line" type="xs:string" maxOccurs="unbounded"/>
        <xs:element name="note" type="xs:string" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>`);

  it('runs a sequence through the automaton', () => {
    const content = m.contentModel(complexType(m, 'Order'));
    if (content.kind !== 'automaton') throw new Error();
    expect(isValidSequence(content.model, [q('id'), q('line')])).toBe(true);
    expect(isValidSequence(content.model, [q('line'), q('id')])).toBe(false);
  });

  it('answers what may go at a position', () => {
    expect(candidates(m, complexType(m, 'Order'), ['id'], 1)).toEqual(['line']);
    expect(candidates(m, complexType(m, 'Order'), ['id', 'line'], 2)).toEqual(['line', 'note']);
  });

  it('treats a type with no particle as empty content', () => {
    const empty = model('<xs:complexType name="E"><xs:attribute name="a"/></xs:complexType>');
    expect(empty.contentModel(complexType(empty, 'E')).kind).toBe('empty');
    expect(complexType(empty, 'E').contentKind).toBe('empty');
  });
});

describe('groups', () => {
  const m = model(`
    <xs:group name="NameParts">
      <xs:sequence>
        <xs:element name="first" type="xs:string"/>
        <xs:element name="last" type="xs:string"/>
      </xs:sequence>
    </xs:group>
    <xs:complexType name="Person">
      <xs:sequence>
        <xs:group ref="NameParts"/>
        <xs:element name="age" type="xs:int" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>`);

  it('inlines a referenced group', () => {
    expect(candidates(m, complexType(m, 'Person'), [], 0)).toEqual(['first']);
    expect(candidates(m, complexType(m, 'Person'), ['first', 'last'], 2)).toEqual(['age']);
  });

  it('applies the reference own occurrence bounds to the group content', () => {
    const repeated = model(`
      <xs:group name="Pair">
        <xs:sequence><xs:element name="a"/><xs:element name="b"/></xs:sequence>
      </xs:group>
      <xs:complexType name="T"><xs:sequence><xs:group ref="Pair" maxOccurs="unbounded"/></xs:sequence></xs:complexType>`);
    const content = repeated.contentModel(complexType(repeated, 'T'));
    if (content.kind !== 'automaton') throw new Error();
    expect(isValidSequence(content.model, [q('a'), q('b'), q('a'), q('b')])).toBe(true);
    expect(isValidSequence(content.model, [q('a'), q('b'), q('a')])).toBe(false);
  });

  it('reports a group that refers to itself instead of hanging', () => {
    const looped = model(`
      <xs:group name="Loop"><xs:sequence><xs:group ref="Loop"/></xs:sequence></xs:group>
      <xs:complexType name="T"><xs:sequence><xs:group ref="Loop"/></xs:sequence></xs:complexType>`);
    looped.contentModel(complexType(looped, 'T'));
    expect(looped.allDiagnostics().map((d) => d.code)).toContain('circular-group');
  });
});

describe('derivation', () => {
  const m = model(`
    <xs:complexType name="Base">
      <xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
    <xs:complexType name="Derived">
      <xs:complexContent>
        <xs:extension base="Base">
          <xs:sequence><xs:element name="b" type="xs:string"/></xs:sequence>
          <xs:attribute name="extra" type="xs:string"/>
        </xs:extension>
      </xs:complexContent>
    </xs:complexType>`);

  it('concatenates the base content before the extension content', () => {
    const content = m.contentModel(complexType(m, 'Derived'));
    if (content.kind !== 'automaton') throw new Error();
    expect(isValidSequence(content.model, [q('a'), q('b')])).toBe(true);
    expect(isValidSequence(content.model, [q('b'), q('a')])).toBe(false);
  });

  it('merges attributes from the base', () => {
    expect(complexType(m, 'Derived').attributes.map((a) => a.name.localName).sort()).toEqual([
      'extra',
      'id',
    ]);
  });

  it('lets a restriction prohibit an inherited attribute', () => {
    const restricted = model(`
      <xs:complexType name="Base">
        <xs:sequence><xs:element name="a"/></xs:sequence>
        <xs:attribute name="id"/><xs:attribute name="old"/>
      </xs:complexType>
      <xs:complexType name="Tight">
        <xs:complexContent>
          <xs:restriction base="Base">
            <xs:sequence><xs:element name="a"/></xs:sequence>
            <xs:attribute name="old" use="prohibited"/>
          </xs:restriction>
        </xs:complexContent>
      </xs:complexType>`);
    expect(complexType(restricted, 'Tight').attributes.map((a) => a.name.localName)).toEqual(['id']);
  });

  it('follows a derivation chain', () => {
    expect(m.isDerivedFrom(complexType(m, 'Derived'), q('Base'), ORIGIN)).toBe(true);
    expect(m.isDerivedFrom(complexType(m, 'Base'), q('Derived'), ORIGIN)).toBe(false);
  });
});

describe('simple content', () => {
  const m = model(`
    <xs:complexType name="Money">
      <xs:simpleContent>
        <xs:extension base="xs:decimal">
          <xs:attribute name="currency" type="xs:string" use="required"/>
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>`);

  it('keeps the text type and the attributes together', () => {
    const type = complexType(m, 'Money');
    expect(type.contentKind).toBe('simple');
    expect(type.simpleType?.primitive).toBe('decimal');
    expect(type.attributes.map((a) => [a.name.localName, a.use])).toEqual([['currency', 'required']]);
  });

  it('applies facets written in a simpleContent restriction', () => {
    const restricted = model(`
      <xs:complexType name="Code">
        <xs:simpleContent>
          <xs:restriction base="xs:string"><xs:maxLength value="3"/></xs:restriction>
        </xs:simpleContent>
      </xs:complexType>`);
    expect(complexType(restricted, 'Code').simpleType?.facets.maxLength).toBe(3);
  });
});

describe('substitution groups', () => {
  const m = model(`
    <xs:element name="vehicle" type="xs:string" abstract="true"/>
    <xs:element name="car" type="xs:string" substitutionGroup="vehicle"/>
    <xs:element name="van" type="xs:string" substitutionGroup="car"/>
    <xs:complexType name="Fleet">
      <xs:sequence><xs:element ref="vehicle" maxOccurs="unbounded"/></xs:sequence>
    </xs:complexType>`);

  it('collects members transitively', () => {
    expect(m.substitutionMembers(q('vehicle')).map((n) => n.localName).sort()).toEqual([
      'car',
      'van',
    ]);
  });

  it('excludes the abstract head itself, which cannot appear', () => {
    expect(m.substitutionMembers(q('vehicle')).map((n) => n.localName)).not.toContain('vehicle');
  });

  it('offers every member where the head is referenced, but never the abstract head itself', () => {
    // The differential harness caught this: the head is what the content model *references*, and
    // it is exactly the one name that may not appear in a document.
    expect(candidates(m, complexType(m, 'Fleet'), [], 0)).toEqual(['car', 'van']);
    const content = m.contentModel(complexType(m, 'Fleet'));
    if (content.kind !== 'automaton') throw new Error();
    expect(isValidSequence(content.model, [q('car'), q('van')])).toBe(true);
    expect(isValidSequence(content.model, [q('vehicle')])).toBe(false);
  });

  it('refuses substitution when the head blocks it', () => {
    const blocked = model(`
      <xs:element name="head" type="xs:string" block="substitution"/>
      <xs:element name="member" type="xs:string" substitutionGroup="head"/>`);
    const head = blocked.globalElement(q('head'))!;
    expect(blocked.canSubstitute(head, q('member'))).toBe(false);
  });
});

describe('xs:all', () => {
  const m = model(`
    <xs:complexType name="Address">
      <xs:all>
        <xs:element name="street" type="xs:string"/>
        <xs:element name="city" type="xs:string"/>
        <xs:element name="county" type="xs:string" minOccurs="0"/>
      </xs:all>
    </xs:complexType>`);

  it('does not go near the automaton', () => {
    expect(m.contentModel(complexType(m, 'Address')).kind).toBe('all');
  });

  it('accepts the members in any order', () => {
    const content = m.contentModel(complexType(m, 'Address'));
    if (content.kind !== 'all') throw new Error();
    expect(allIsValid(content.model, [q('city'), q('street')])).toBe(true);
    expect(allIsValid(content.model, [q('street'), q('city'), q('county')])).toBe(true);
  });

  it('rejects a missing required member and a repeat', () => {
    const content = m.contentModel(complexType(m, 'Address'));
    if (content.kind !== 'all') throw new Error();
    expect(allIsValid(content.model, [q('street')])).toBe(false);
    expect(allIsValid(content.model, [q('street'), q('street'), q('city')])).toBe(false);
  });

  it('names what is still missing, in declaration order', () => {
    const content = m.contentModel(complexType(m, 'Address'));
    if (content.kind !== 'all') throw new Error();
    expect(allRequiredMissing(content.model, [q('city')]).map((n) => n.localName)).toEqual([
      'street',
    ]);
  });
});

describe('elements with no type', () => {
  it('gets xs:anyType, so an unconstrained document still edits', () => {
    const m = model('<xs:element name="loose"/>');
    const element = m.globalElement(q('loose'))!;
    const type = m.typeOf(element);
    expect(type.form).toBe('complex');
    if (type.form !== 'complex') throw new Error();
    expect(m.contentModel(type).kind).toBe('any');
  });
});

describe('form defaults', () => {
  it('puts local elements outside the namespace unless the schema says otherwise', () => {
    // The commonest reason a document that "looks right" fails to validate.
    const unqualified = model(
      `<xs:element name="root" type="R"/>
       <xs:complexType name="R"><xs:sequence><xs:element name="child"/></xs:sequence></xs:complexType>`,
      `targetNamespace="${TNS}" xmlns="${TNS}"`,
    );
    expect(candidates(unqualified, complexType(unqualified, 'R'), [], 0)).toEqual(['child']);
    const content = unqualified.contentModel(complexType(unqualified, 'R'));
    if (content.kind !== 'automaton') throw new Error();
    expect(isValidSequence(content.model, [q('child', null)])).toBe(true);
    expect(isValidSequence(content.model, [q('child')])).toBe(false);
  });

  it('puts them inside it under elementFormDefault="qualified"', () => {
    const qualified = model(
      `<xs:complexType name="R"><xs:sequence><xs:element name="child"/></xs:sequence></xs:complexType>`,
      `targetNamespace="${TNS}" xmlns="${TNS}" elementFormDefault="qualified"`,
    );
    const content = qualified.contentModel(complexType(qualified, 'R'));
    if (content.kind !== 'automaton') throw new Error();
    expect(isValidSequence(content.model, [q('child')])).toBe(true);
    expect(isValidSequence(content.model, [q('child', null)])).toBe(false);
  });
});

describe('attribute groups', () => {
  it('flattens nested attribute groups', () => {
    const m = model(`
      <xs:attributeGroup name="Audit">
        <xs:attribute name="createdBy" type="xs:string"/>
        <xs:attributeGroup ref="Timestamps"/>
      </xs:attributeGroup>
      <xs:attributeGroup name="Timestamps">
        <xs:attribute name="createdAt" type="xs:dateTime"/>
      </xs:attributeGroup>
      <xs:complexType name="Doc">
        <xs:sequence/>
        <xs:attributeGroup ref="Audit"/>
      </xs:complexType>`);
    expect(complexType(m, 'Doc').attributes.map((a) => a.name.localName).sort()).toEqual([
      'createdAt',
      'createdBy',
    ]);
  });

  it('takes use and default from the reference, and the type from the declaration', () => {
    const m = model(`
      <xs:attribute name="lang" type="xs:language"/>
      <xs:complexType name="Doc">
        <xs:sequence/>
        <xs:attribute ref="lang" use="required"/>
      </xs:complexType>`);
    const [attribute] = complexType(m, 'Doc').attributes;
    expect(attribute?.use).toBe('required');
    expect(attribute?.type.name?.localName).toBe('language');
  });
});

describe('recursive schemas', () => {
  it('compiles a type that contains itself', () => {
    const m = model(`
      <xs:complexType name="Section">
        <xs:sequence>
          <xs:element name="title" type="xs:string"/>
          <xs:element name="section" type="Section" minOccurs="0" maxOccurs="unbounded"/>
        </xs:sequence>
      </xs:complexType>`);
    expect(candidates(m, complexType(m, 'Section'), ['title'], 1)).toEqual(['section']);
    expect(m.allDiagnostics().filter((d) => d.severity === 'error')).toEqual([]);
  });
});
