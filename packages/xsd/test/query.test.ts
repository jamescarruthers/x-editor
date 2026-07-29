import { describe, expect, it } from 'vitest';
import { XmlDocument } from '@x-editor/xml-core';
import { assembleSchema, catalogueFrom } from '../src/assemble.js';
import { SchemaModel } from '../src/model.js';
import { XSD_NS } from '../src/ast.js';
import {
  attributeStatuses,
  elementContext,
  firstProblemIndex,
  groupCandidates,
  insertCandidates,
  missingRequiredAttributes,
  requiredMissing,
  serializeSkeleton,
  skeletonFor,
  validateText,
  type ElementContext,
} from '../src/query.js';
import { humaniseName, describeElement, cardinalityChip } from '../src/describe.js';
import { widgetFor } from '../src/widgets.js';

const TNS = 'urn:t';

const ORDER_SCHEMA = `
  <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="${TNS}" xmlns="${TNS}"
             elementFormDefault="qualified">
    <xs:element name="order" type="Order"/>
    <xs:complexType name="Order">
      <xs:sequence>
        <xs:element name="orderId" type="xs:string"/>
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
        <xs:element name="qty" type="xs:positiveInteger"/>
      </xs:sequence>
    </xs:complexType>
    <xs:simpleType name="Currency">
      <xs:restriction base="xs:string">
        <xs:enumeration value="GBP"/><xs:enumeration value="EUR"/><xs:enumeration value="USD"/>
      </xs:restriction>
    </xs:simpleType>
    <xs:simpleType name="Sku">
      <xs:restriction base="xs:string"><xs:pattern value="[A-Z]{2}\\d{6}"/></xs:restriction>
    </xs:simpleType>
  </xs:schema>`;

function build(instance: string): { model: SchemaModel; document: XmlDocument } {
  return {
    model: new SchemaModel(assembleSchema('main.xsd', catalogueFrom({ 'main.xsd': ORDER_SCHEMA }))),
    document: XmlDocument.parse(instance),
  };
}

function contextOf(instance: string, path: number[] = []): {
  model: SchemaModel;
  document: XmlDocument;
  context: ElementContext;
} {
  const { model, document } = build(instance);
  let id = document.documentElement()!;
  for (const index of path) {
    id = document
      .childrenOf(id)
      .filter((child) => document.node(child)?.kind === 'element')[index]!;
  }
  const context = elementContext(model, document, id);
  if (context === null) throw new Error('no context');
  return { model, document, context };
}

const names = (list: readonly { name: { localName: string } }[]): string[] =>
  list.map((item) => item.name.localName);

describe('elementContext', () => {
  it('resolves the root element against the global declarations', () => {
    const { context } = contextOf(`<order xmlns="${TNS}"/>`);
    expect(context.declaration?.name.localName).toBe('order');
    expect(context.type.name?.localName).toBe('Order');
  });

  it('resolves a local declaration inside its parent type, not globally', () => {
    const { context } = contextOf(
      `<order xmlns="${TNS}"><line><sku/></line></order>`,
      [0, 0],
    );
    expect(context.name.localName).toBe('sku');
    expect(context.type.name?.localName).toBe('Sku');
  });

  it('falls back to anyType for an element the schema does not declare', () => {
    const { context } = contextOf(`<order xmlns="${TNS}"><mystery/></order>`, [0]);
    expect(context.declaration).toBeNull();
    expect(context.type.name?.localName).toBe('anyType');
  });
});

describe('insertCandidates', () => {
  it('offers only what fits at the position, not everything the type allows', () => {
    const { model, context } = contextOf(`<order xmlns="${TNS}"><orderId/></order>`);
    // After <orderId>, the sequence allows shipDate or line — but never orderId again.
    expect(names(insertCandidates(model, context, 1)).sort()).toEqual(['line', 'shipDate']);
    // And nothing at all can go in front of it: a second <orderId> would exceed maxOccurs, and
    // anything else would leave the existing <orderId> unconsumable. A model that only asked
    // "what does this type allow?" would offer three elements here.
    expect(insertCandidates(model, context, 0)).toEqual([]);
  });

  it('marks what is required and missing', () => {
    const { model, context } = contextOf(`<order xmlns="${TNS}"><orderId/></order>`);
    const candidates = insertCandidates(model, context, 1);
    const line = candidates.find((c) => c.name.localName === 'line');
    const shipDate = candidates.find((c) => c.name.localName === 'shipDate');
    expect(line?.group).toBe('required-missing');
    expect(shipDate?.group).toBe('optional');
  });

  it('marks a repeatable element already present as a repeat', () => {
    const { model, context } = contextOf(
      `<order xmlns="${TNS}"><orderId/><line/></order>`,
    );
    const candidates = insertCandidates(model, context, 2);
    expect(candidates.find((c) => c.name.localName === 'line')?.group).toBe('repeat');
  });

  it('promotes one optional candidate to "suggested" only when nothing is required', () => {
    const withRequired = contextOf(`<order xmlns="${TNS}"><orderId/></order>`);
    expect(
      insertCandidates(withRequired.model, withRequired.context, 1).some(
        (c) => c.group === 'suggested',
      ),
    ).toBe(false);

    const complete = contextOf(`<order xmlns="${TNS}"><orderId/><line/></order>`);
    const candidates = insertCandidates(complete.model, complete.context, 2);
    expect(candidates.filter((c) => c.group === 'suggested')).toHaveLength(1);
  });

  it('carries a cardinality chip that reads literally', () => {
    const { model, context } = contextOf(
      `<order xmlns="${TNS}"><orderId/><line/><note/></order>`,
    );
    const note = insertCandidates(model, context, 3).find((c) => c.name.localName === 'note');
    expect(note?.cardinality).toBe('1 of 0–3');
  });

  it('groups in a fixed order so the palette does not rearrange itself', () => {
    const { model, context } = contextOf(`<order xmlns="${TNS}"><orderId/></order>`);
    const groups = groupCandidates(insertCandidates(model, context, 1));
    expect(groups.map((g) => g.group)).toEqual(['required-missing', 'optional']);
  });

  it('offers nothing inside an element whose content is empty', () => {
    const { model, context } = contextOf(`<order xmlns="${TNS}"><orderId/></order>`, [0]);
    expect(insertCandidates(model, context, 0)).toEqual([]);
  });
});

describe('requiredMissing', () => {
  it('names what still has to be added, in schema order', () => {
    const { model, context } = contextOf(`<order xmlns="${TNS}"/>`);
    expect(requiredMissing(model, context).map((n) => n.localName)).toEqual(['orderId', 'line']);
  });

  it('is empty once the element is complete', () => {
    const { model, context } = contextOf(`<order xmlns="${TNS}"><orderId/><line/></order>`);
    expect(requiredMissing(model, context)).toEqual([]);
  });

  it('points at the first child that cannot be there', () => {
    const { model, context } = contextOf(
      `<order xmlns="${TNS}"><line/><orderId/></order>`,
    );
    // Index 0, not 1: <line> cannot come first, so that is where the child list stops working.
    expect(firstProblemIndex(model, context)).toBe(0);
  });
});

describe('attributes', () => {
  it('orders them required first, then set, then unset', () => {
    const { document, context } = contextOf(`<order xmlns="${TNS}" ref="R1"/>`);
    expect(attributeStatuses(document, context).map((s) => s.use.name.localName)).toEqual([
      'currency',
      'ref',
    ]);
  });

  it('reports a required attribute that is absent', () => {
    const { document, context } = contextOf(`<order xmlns="${TNS}"/>`);
    expect(missingRequiredAttributes(document, context).map((a) => a.name.localName)).toEqual([
      'currency',
    ]);
  });

  it('validates the written value against the attribute type', () => {
    const { document, context } = contextOf(`<order xmlns="${TNS}" currency="XYZ"/>`);
    const currency = attributeStatuses(document, context)[0];
    expect(currency?.problems.map((p) => p.code)).toEqual(['cvc-enumeration-valid']);
  });
});

describe('text content', () => {
  it('validates against the element simple type', () => {
    const { context } = contextOf(
      `<order xmlns="${TNS}"><line><sku/></line></order>`,
      [0, 0],
    );
    expect(validateText(context, 'AB123456')).toEqual([]);
    expect(validateText(context, 'nope').map((p) => p.code)).toEqual(['cvc-pattern-valid']);
  });
});

describe('skeletons', () => {
  it('generates only what is required by default', () => {
    const { model } = build('<x/>');
    const order = model.globalElement({ namespaceUri: TNS, localName: 'order' })!;
    expect(serializeSkeleton(skeletonFor(model, order))).toBe(
      [
        '<order currency="GBP">',
        '  <orderId/>',
        '  <line>',
        '    <sku>AA000000</sku>',
        '    <qty>1</qty>',
        '  </line>',
        '</order>',
      ].join('\n'),
    );
  });

  it('fills in optional children when asked for everything', () => {
    const { model } = build('<x/>');
    const order = model.globalElement({ namespaceUri: TNS, localName: 'order' })!;
    const xml = serializeSkeleton(skeletonFor(model, order, { include: 'all' }));
    expect(xml).toContain('<shipDate>');
    expect(xml).toContain('ref=');
  });

  it('uses the pattern to produce a value that actually validates', () => {
    // A skeleton that fails validation the moment it is inserted is worse than none.
    const { model } = build('<x/>');
    const order = model.globalElement({ namespaceUri: TNS, localName: 'order' })!;
    expect(serializeSkeleton(skeletonFor(model, order))).toContain('<sku>AA000000</sku>');
  });

  it('stops rather than expanding a recursive type forever', () => {
    const recursive = new SchemaModel(
      assembleSchema(
        'main.xsd',
        catalogueFrom({
          'main.xsd': `<xs:schema xmlns:xs="${XSD_NS}" targetNamespace="${TNS}" xmlns="${TNS}"
                          elementFormDefault="qualified">
             <xs:element name="section" type="Section"/>
             <xs:complexType name="Section">
               <xs:sequence>
                 <xs:element name="title" type="xs:string"/>
                 <xs:element name="section" type="Section" maxOccurs="unbounded"/>
               </xs:sequence>
             </xs:complexType>
           </xs:schema>`,
        }),
      ),
    );
    const section = recursive.globalElement({ namespaceUri: TNS, localName: 'section' })!;
    const xml = serializeSkeleton(skeletonFor(recursive, section));
    expect(xml.split('\n').length).toBeLessThan(12);
  });
});

describe('describe', () => {
  it('prefers the schema author documentation', () => {
    const documented = new SchemaModel(
      assembleSchema(
        'main.xsd',
        catalogueFrom({
          'main.xsd': `<xs:schema xmlns:xs="${XSD_NS}" targetNamespace="${TNS}">
             <xs:element name="a" type="xs:string">
               <xs:annotation><xs:documentation>The customer reference.</xs:documentation></xs:annotation>
             </xs:element>
           </xs:schema>`,
        }),
      ),
    );
    const element = documented.globalElement({ namespaceUri: TNS, localName: 'a' })!;
    const description = describeElement(element, documented.typeOf(element));
    expect(description).toEqual({ text: 'The customer reference.', authored: true });
  });

  it('always produces a sentence when the schema has no documentation at all', () => {
    // The teaching promise cannot depend on schema authors having written annotations.
    const { model } = build('<x/>');
    const order = model.globalElement({ namespaceUri: TNS, localName: 'order' })!;
    const description = describeElement(order, model.typeOf(order));
    expect(description.authored).toBe(false);
    expect(description.text).toContain('*Order*');
    expect(description.text).toContain('Exactly one is required here.');
  });

  it('humanises names of every common shape', () => {
    expect(humaniseName('shipDate')).toBe('Ship date');
    expect(humaniseName('ShipDate')).toBe('Ship date');
    expect(humaniseName('ship_date')).toBe('Ship date');
    expect(humaniseName('ship-date')).toBe('Ship date');
    expect(humaniseName('AMOUNT')).toBe('Amount');
    expect(humaniseName('XMLDocument')).toBe('XML document');
  });

  it('renders the cardinality chip literally', () => {
    expect(cardinalityChip({ min: 1, max: 3 }, 2)).toBe('2 of 1–3');
    expect(cardinalityChip({ min: 1, max: Infinity }, 0)).toBe('0 of 1+');
    expect(cardinalityChip({ min: 1, max: 1 }, 1)).toBe('1 of 1');
  });
});

describe('widgetFor', () => {
  const { model } = build('<x/>');
  const simple = (localName: string) =>
    model.simpleTypes.compileByName(
      { namespaceUri: TNS, localName },
      { documentUri: 'main.xsd', node: 0 as never },
    );
  const builtIn = (localName: string) =>
    model.simpleTypes.compileByName(
      { namespaceUri: XSD_NS, localName },
      { documentUri: 'main.xsd', node: 0 as never },
    );

  it('shows a small enumeration as radio buttons and a large one as a select', () => {
    expect(widgetFor(simple('Currency'))).toEqual({
      kind: 'radio',
      options: ['GBP', 'EUR', 'USD'],
    });
  });

  it('picks a date control for a date, ahead of any pattern rule', () => {
    expect(widgetFor(builtIn('date')).kind).toBe('date');
  });

  it('carries numeric bounds into the control', () => {
    expect(widgetFor(builtIn('unsignedByte'))).toEqual({
      kind: 'number',
      min: '0',
      max: '255',
      integer: true,
    });
  });

  it('turns a pattern into a worked example rather than showing the pattern', () => {
    expect(widgetFor(simple('Sku'))).toEqual({
      kind: 'text',
      placeholder: 'AA000000',
      maxLength: null,
    });
  });

  it('uses a checkbox for booleans', () => {
    expect(widgetFor(builtIn('boolean')).kind).toBe('checkbox');
  });
});

describe('xsi:type', () => {
  const POLYMORPHIC = `
    <xs:schema xmlns:xs="${XSD_NS}" targetNamespace="${TNS}" xmlns="${TNS}"
               elementFormDefault="qualified">
      <xs:element name="payment" type="Payment"/>
      <xs:complexType name="Payment" abstract="true">
        <xs:sequence><xs:element name="amount" type="xs:decimal"/></xs:sequence>
      </xs:complexType>
      <xs:complexType name="CardPayment">
        <xs:complexContent>
          <xs:extension base="Payment">
            <xs:sequence><xs:element name="last4" type="xs:string"/></xs:sequence>
          </xs:extension>
        </xs:complexContent>
      </xs:complexType>
    </xs:schema>`;

  it('uses the runtime type, so the palette offers the subtype children', () => {
    const model = new SchemaModel(
      assembleSchema('main.xsd', catalogueFrom({ 'main.xsd': POLYMORPHIC })),
    );
    const document = XmlDocument.parse(
      `<payment xmlns="${TNS}" xmlns:t="${TNS}"
                xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                xsi:type="t:CardPayment"><amount/></payment>`,
    );
    const context = elementContext(model, document, document.documentElement()!)!;
    expect(context.typeOverridden).toBe(true);
    expect(names(insertCandidates(model, context, 1))).toEqual(['last4']);
  });
});
