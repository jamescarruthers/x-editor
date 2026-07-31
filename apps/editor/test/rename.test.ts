import { beforeEach, describe, expect, it } from 'vitest';
import {
  renameElement,
  setAttribute,
  setNamespaceDeclaration,
  type NodeId,
} from '@x-editor/xml-core';
import { XSI_NS } from '@x-editor/xsd';
import { store } from '../src/state/store.js';
import { nameProblem } from '../src/components/Inspector.js';
import { attributeValue, globalDeclarations, referenceTextFor } from '../src/model/xsdAuthoring.js';

const NAMESPACED = `<?xml version="1.0"?>
<order xmlns="urn:shop" xmlns:m="urn:meta">
  <ref m:kind="internal">A-1</ref>
</order>`;

function at(kind: 'xml' | 'xsd', path: number[]): NodeId {
  const doc = store.documentFor(kind)!;
  let id = doc.documentElement()!;
  for (const index of path) {
    id = doc.childrenOf(id).filter((child) => doc.node(child)?.kind === 'element')[index]!;
  }
  return id;
}

describe('renaming an element', () => {
  beforeEach(() => {
    store.openWorkspace([{ name: 'order.xml', source: NAMESPACED }], 'xml');
  });

  it('keeps the children, which is what delete-and-reinsert cost', () => {
    // The reason this exists. Renaming used to be reachable only through a quick fix when the
    // schema recognised a near-miss name, so changing your mind meant deleting and rebuilding.
    const ref = at('xml', [0]);
    const before = store.documentFor('xml')!.childrenOf(ref).length;

    store.run(
      renameElement(store.document, ref, {
        prefix: '',
        localName: 'reference',
        namespaceUri: 'urn:shop',
      }),
    );

    expect(store.documentFor('xml')!.childrenOf(ref).length).toBe(before);
    expect(store.document.serialize()).toContain('<reference m:kind="internal">A-1</reference>');
  });

  it('is one undo step', () => {
    const ref = at('xml', [0]);
    const before = store.document.serialize();
    store.run(
      renameElement(store.document, ref, { prefix: '', localName: 'x', namespaceUri: 'urn:shop' }),
    );
    store.undo();
    expect(store.document.serialize()).toBe(before);
  });

  it('produces a document that still parses as what it says', () => {
    // A rename writes straight into the tree, so nothing downstream would catch a name that does
    // not round-trip. This is the assertion that would fail if the validity check were dropped.
    const ref = at('xml', [0]);
    store.run(
      renameElement(store.document, ref, {
        prefix: 'm',
        localName: 'note',
        namespaceUri: 'urn:meta',
      }),
    );
    const reparsed = store.document.serialize();
    store.openFile('again.xml', reparsed);
    expect(store.document.parseErrors).toEqual([]);
  });
});

describe('the names a rename will accept', () => {
  const scope = new Map([
    ['', 'urn:shop'],
    ['m', 'urn:meta'],
  ]);

  it('accepts a plain name and a bound prefix', () => {
    expect(nameProblem('reference', scope)).toBeNull();
    expect(nameProblem('m:note', scope)).toBeNull();
  });

  it('refuses what would not parse, and says which of the two problems it is', () => {
    // Well-formedness and namespaces are separate questions with separate answers, and a user who
    // typed a bound-looking prefix needs to be told which one they got wrong.
    expect(nameProblem('a b', scope)).toContain('not a valid XML name');
    expect(nameProblem('1a', scope)).toContain('not a valid XML name');
    expect(nameProblem('', scope)).toContain('cannot be empty');
    expect(nameProblem('a:b:c', scope)).toContain('at most one colon');
    expect(nameProblem('m:', scope)).toContain('after the colon');

    // The case that would silently corrupt the document: valid as a Name, meaningless as a QName.
    expect(nameProblem('nope:thing', scope)).toContain('not declared here');
  });
});

const SCHEMA = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="ref" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
  <xs:simpleType name="Code">
    <xs:restriction base="xs:string"/>
  </xs:simpleType>
</xs:schema>`;

describe('changing a declaration type in a schema', () => {
  beforeEach(() => {
    store.openWorkspace([{ name: 'order.xsd', source: SCHEMA }], 'xsd');
  });

  it('offers the schema own named types, written the way this element can refer to them', () => {
    const document = store.documentFor('xsd')!;
    const declaration = at('xsd', [0]);

    const offered = globalDeclarations(document)
      .filter((entry) => entry.space === 'type')
      .map((entry) => referenceTextFor(document, declaration, entry.name.localName));

    // No target namespace and no default binding, so a bare name is the correct reference text.
    expect(offered).toContain('Order');
    expect(offered).toContain('Code');
  });

  it('changes the type through the ordinary attribute command, so undo works', () => {
    const document = store.documentFor('xsd')!;
    const declaration = at('xsd', [0]);

    store.run(
      setAttribute(document, declaration, { prefix: '', localName: 'type', namespaceUri: null }, 'Code'),
    );
    expect(attributeValue(store.documentFor('xsd')!, declaration, 'type')).toBe('Code');

    store.undo();
    expect(attributeValue(store.documentFor('xsd')!, declaration, 'type')).toBe('Order');
  });
});

const HIERARCHY = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence><xs:element name="payment" type="Payment"/></xs:sequence>
  </xs:complexType>
  <xs:complexType name="Payment">
    <xs:sequence><xs:element name="amount" type="xs:decimal"/></xs:sequence>
  </xs:complexType>
  <xs:complexType name="CardPayment">
    <xs:complexContent>
      <xs:extension base="Payment">
        <xs:sequence><xs:element name="last4" type="xs:string"/></xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:complexType name="BankTransfer">
    <xs:complexContent>
      <xs:extension base="Payment">
        <xs:sequence><xs:element name="iban" type="xs:string"/></xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
</xs:schema>`;

const ORDER = `<?xml version="1.0"?>
<order><payment><amount>10.00</amount></payment></order>`;

describe('choosing between derived types (xsi:type)', () => {
  beforeEach(() => {
    store.openWorkspace(
      [
        { name: 'order.xml', source: ORDER },
        { name: 'order.xsd', source: HIERARCHY },
      ],
      'xml',
    );
  });

  it('enumerates the types an element may claim, which the tree cannot show', () => {
    // The derivation edge runs from the derived type to the base, so a declaration cannot list its
    // own substitutes. Enumerating them is the only way to turn that into a choice.
    const model = store.schema.model!;
    const declaration = model.globalElement({ namespaceUri: null, localName: 'order' })!;
    const names = model
      .typesSubstitutableFor({ namespaceUri: null, localName: 'Payment' }, declaration.origin)
      .map((n) => n.localName)
      .sort();
    expect(names).toEqual(['BankTransfer', 'CardPayment', 'Payment']);
  });

  it('does not offer a choice where the schema allows none', () => {
    const model = store.schema.model!;
    const declaration = model.globalElement({ namespaceUri: null, localName: 'order' })!;
    // Nothing derives from Order, so the only candidate is Order itself — one entry, no decision.
    expect(
      model.typesSubstitutableFor({ namespaceUri: null, localName: 'Order' }, declaration.origin),
    ).toHaveLength(1);
  });

  it('a document claiming a derived type stays valid and reports the override', () => {
    const doc = store.documentFor('xml')!;
    const payment = doc
      .childrenOf(doc.documentElement()!)
      .filter((c) => doc.node(c)?.kind === 'element')[0]!;

    const root = doc.documentElement()!;
    store.run(setNamespaceDeclaration(doc, root, 'xsi', XSI_NS));
    store.run(
      setAttribute(
        store.documentFor('xml')!,
        payment,
        { prefix: 'xsi', localName: 'type', namespaceUri: XSI_NS },
        'CardPayment',
      ),
    );

    // Round-trips, and the engine now resolves the element through the derived type.
    store.openFile('again.xml', store.document.serialize());
    expect(store.document.parseErrors).toEqual([]);
    store.openWorkspace(
      [
        { name: 'order.xml', source: store.documentFor('xml')!.serialize() },
        { name: 'order.xsd', source: HIERARCHY },
      ],
      'xml',
    );
    const again = store.documentFor('xml')!;
    const p2 = again.childrenOf(again.documentElement()!).filter((c) => again.node(c)?.kind === 'element')[0]!;
    const context = store.schema.contextFor(again, p2)!;
    expect(context.typeOverridden).toBe(true);
    expect(context.type.name?.localName).toBe('CardPayment');
  });
});

describe('renaming inside a rules file', () => {
  it('allows sch:assert to become sch:report, which is ordinary authoring', () => {
    store.openWorkspace([{ name: 'r.sch', source: SCH_RULES }], 'sch');
    expect(store.active).toBe('sch');

    const doc = store.documentFor('sch')!;
    const scope = doc.inScopeNamespaces(doc.documentElement()!);
    // The prefix is bound by the rules file itself, so the rename is well-formed.
    expect(nameProblem('sch:report', scope)).toBeNull();
    // And a prefix the file never declares is still refused.
    expect(nameProblem('zz:report', scope)).toContain('not declared here');
  });
});

const SCH_RULES = `<?xml version="1.0"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt2">
  <sch:pattern id="p"><sch:rule context="order">
    <sch:assert test="true()">ok</sch:assert>
  </sch:rule></sch:pattern>
</sch:schema>`;
