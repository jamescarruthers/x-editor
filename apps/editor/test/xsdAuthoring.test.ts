import { describe as suite, expect, it } from 'vitest';
import { ROOT_ID, XmlDocument, isElement, type NodeId } from '@x-editor/xml-core';
import { SchemaModel, assembleSchema, catalogueFrom } from '@x-editor/xsd';
import {
  allReferences,
  documentationOf,
  extractType,
  globalDeclarations,
  inlineType,
  isGlobalDeclaration,
  isInlineType,
  referencesTo,
  renameComponent,
  selfProblems,
  setDocumentation,
} from '../src/model/xsdAuthoring.js';
import { buildComponentRows, headingKey, isSchemaDocument } from '../src/model/componentTree.js';

const NO_NAMESPACE = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="line" type="Line" maxOccurs="unbounded"/>
      <xs:group ref="Trailer"/>
    </xs:sequence>
    <xs:attributeGroup ref="Audit"/>
  </xs:complexType>
  <xs:complexType name="Line">
    <xs:simpleContent>
      <xs:extension base="Code">
        <xs:attribute name="qty" type="xs:int"/>
      </xs:extension>
    </xs:simpleContent>
  </xs:complexType>
  <xs:simpleType name="Code">
    <xs:restriction base="xs:string">
      <xs:pattern value="[A-Z]{2}\\d{3}"/>
    </xs:restriction>
  </xs:simpleType>
  <xs:simpleType name="Codes">
    <xs:list itemType="Code"/>
  </xs:simpleType>
  <xs:simpleType name="Either">
    <xs:union memberTypes="Code xs:int"/>
  </xs:simpleType>
  <xs:group name="Trailer">
    <xs:sequence>
      <xs:element name="total" type="xs:decimal"/>
    </xs:sequence>
  </xs:group>
  <xs:attributeGroup name="Audit">
    <xs:attribute name="by" type="xs:string"/>
  </xs:attributeGroup>
</xs:schema>`;

function parse(source: string): XmlDocument {
  return XmlDocument.parse(source);
}

/** The node of a top-level declaration, by name. */
function componentNamed(document: XmlDocument, name: string): NodeId {
  const found = globalDeclarations(document).find(
    (declaration) => declaration.name.localName === name,
  );
  if (found === undefined) throw new Error(`no global component named ${name}`);
  return found.node;
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

suite('finding references', () => {
  it('reads every QName-valued attribute in its own symbol space', () => {
    const document = parse(NO_NAMESPACE);
    const references = allReferences(document);

    const spaces = new Map<string, string[]>();
    for (const reference of references) {
      const list = spaces.get(reference.space) ?? [];
      list.push(reference.text);
      spaces.set(reference.space, list);
    }

    expect(spaces.get('type')).toEqual([
      'Order',
      'Line',
      // `base` on the extension, then `type` on the attribute inside it: document order, so the
      // reference list reads the same way the schema does.
      'Code',
      'xs:int',
      'xs:string',
      'Code',
      'Code',
      'xs:int',
      'xs:decimal',
      'xs:string',
    ]);
    expect(spaces.get('group')).toEqual(['Trailer']);
    expect(spaces.get('attributeGroup')).toEqual(['Audit']);
  });

  it('separates the symbol spaces, so a type and a group of the same name never collide', () => {
    // The six symbol spaces are the reason `ref` cannot be handled generically: this schema has a
    // group and a complex type both called Thing, and each is referenced by its own attribute.
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:complexType name="Thing"><xs:sequence><xs:group ref="Thing"/></xs:sequence></xs:complexType>
      <xs:group name="Thing"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:group>
      <xs:element name="root" type="Thing"/>
    </xs:schema>`);

    const type = globalDeclarations(document).find(
      (d) => d.space === 'type' && d.name.localName === 'Thing',
    )!;
    const group = globalDeclarations(document).find(
      (d) => d.space === 'group' && d.name.localName === 'Thing',
    )!;

    expect(referencesTo(document, type.node).map((r) => r.attribute)).toEqual(['type']);
    expect(referencesTo(document, group.node).map((r) => r.attribute)).toEqual(['ref']);
  });

  it('resolves an unprefixed name against the default namespace, not the target namespace', () => {
    // The single most common XSD authoring bug: `targetNamespace` without a matching default
    // `xmlns`, so every unprefixed reference silently means a name in no namespace.
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
        targetNamespace="urn:x" xmlns:t="urn:x">
      <xs:element name="a" type="Code"/>
      <xs:element name="b" type="t:Code"/>
      <xs:simpleType name="Code"><xs:restriction base="xs:string"/></xs:simpleType>
    </xs:schema>`);

    const references = allReferences(document).filter((r) => r.attribute === 'type');
    expect(references[0]!.resolved).toEqual({ namespaceUri: null, localName: 'Code' });
    expect(references[1]!.resolved).toEqual({ namespaceUri: 'urn:x', localName: 'Code' });

    // Only the prefixed one actually points at the declaration.
    expect(referencesTo(document, componentNamed(document, 'Code'))).toHaveLength(1);
  });

  it('does not treat a local declaration as referenceable', () => {
    const document = parse(NO_NAMESPACE);
    const order = componentNamed(document, 'Order');
    const line = document
      .childrenOf(document.childrenOf(order)[1] ?? ROOT_ID)
      .find((id) => {
        const node = document.node(id);
        return node !== undefined && isElement(node) && node.name.localName === 'element';
      });

    expect(line).toBeDefined();
    expect(isGlobalDeclaration(document, line!)).toBe(false);
    expect(referencesTo(document, line!)).toEqual([]);
  });
});

suite('rename', () => {
  it('updates every reference in one undoable step', () => {
    const document = parse(NO_NAMESPACE);
    const command = renameComponent(document, componentNamed(document, 'Code'), 'ProductCode');
    expect(command).not.toBeNull();

    document.run(command!);
    const after = document.serialize();
    expect(after).toContain('name="ProductCode"');
    expect(after).toContain('base="ProductCode"');
    expect(after).toContain('itemType="ProductCode"');
    expect(after).toContain('memberTypes="ProductCode xs:int"');
    expect(after).not.toContain('"Code"');

    // One step, not five: a rename that half-undoes is worse than one that does not undo at all.
    document.undo();
    expect(document.serialize()).toBe(parse(NO_NAMESPACE).serialize());
  });

  it('rewrites only the matching token of a list-valued attribute', () => {
    const document = parse(NO_NAMESPACE);
    document.run(renameComponent(document, componentNamed(document, 'Code'), 'C2')!);
    expect(document.serialize()).toContain('memberTypes="C2 xs:int"');
  });

  it('keeps the prefix the author wrote', () => {
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
        targetNamespace="urn:x" xmlns:t="urn:x" xmlns:other="urn:x">
      <xs:element name="a" type="t:Code"/>
      <xs:element name="b" type="other:Code"/>
      <xs:simpleType name="Code"><xs:restriction base="xs:string"/></xs:simpleType>
    </xs:schema>`);

    document.run(renameComponent(document, componentNamed(document, 'Code'), 'Ref')!);
    const after = document.serialize();
    // Both prefixes bind the same namespace, so both references match — and each keeps its own
    // prefix, because rewriting them to one form would put churn in the diff that is not the rename.
    expect(after).toContain('type="t:Ref"');
    expect(after).toContain('type="other:Ref"');
  });

  it('leaves a same-named component in another symbol space alone', () => {
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:complexType name="Thing"><xs:sequence><xs:group ref="Thing"/></xs:sequence></xs:complexType>
      <xs:group name="Thing"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:group>
    </xs:schema>`);

    const type = globalDeclarations(document).find(
      (d) => d.space === 'type' && d.name.localName === 'Thing',
    )!;
    document.run(renameComponent(document, type.node, 'Renamed')!);

    const after = document.serialize();
    expect(after).toContain('complexType name="Renamed"');
    expect(after).toContain('group ref="Thing"');
    expect(after).toContain('group name="Thing"');
  });

  it('refuses an empty or unchanged name rather than producing an empty history entry', () => {
    const document = parse(NO_NAMESPACE);
    const code = componentNamed(document, 'Code');
    expect(renameComponent(document, code, '   ')).toBeNull();
    expect(renameComponent(document, code, 'Code')).toBeNull();
  });
});

suite('extract and inline', () => {
  const INLINE = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="total" type="xs:decimal"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  /** The anonymous type inside the `order` declaration. */
  function anonymous(document: XmlDocument): NodeId {
    const order = componentNamed(document, 'order');
    const found = document.childrenOf(order).find((id) => isInlineType(document, id));
    if (found === undefined) throw new Error('no inline type');
    return found;
  }

  it('lifts an anonymous type to the top level and points the declaration at it', () => {
    const document = parse(INLINE);
    const command = extractType(document, anonymous(document), 'Order');
    expect(command).not.toBeNull();
    document.run(command!);

    const after = document.serialize();
    // The declaration keeps its written form — the serializer never turns `<a></a>` into `<a/>`,
    // because a reformat is a diff the author did not ask for.
    expect(after).toContain('<xs:element name="order" type="Order"></xs:element>');
    // The lifted type is re-indented to the depth it landed at, not the one it came from.
    expect(after).toContain('\n  <xs:complexType name="Order">\n    <xs:sequence>');

    // The result must be a schema that still compiles, not merely one that still parses.
    const set = assembleSchema('self.xsd', catalogueFrom({ 'self.xsd': after }));
    expect(set.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(selfProblems(document, new SchemaModel(set))).toEqual([]);
  });

  it('undoes in one step', () => {
    const document = parse(INLINE);
    document.run(extractType(document, anonymous(document), 'Order')!);
    document.undo();
    expect(document.serialize()).toBe(INLINE);
  });

  it('refuses a name that is already taken', () => {
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="order"><xs:complexType><xs:sequence/></xs:complexType></xs:element>
      <xs:complexType name="Order"><xs:sequence/></xs:complexType>
    </xs:schema>`);
    expect(extractType(document, anonymous(document), 'Order')).toBeNull();
  });

  it('writes the prefix that binds the target namespace', () => {
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
        targetNamespace="urn:x" xmlns:t="urn:x">
      <xs:element name="order"><xs:complexType><xs:sequence/></xs:complexType></xs:element>
    </xs:schema>`);
    document.run(extractType(document, anonymous(document), 'Order')!);
    expect(document.serialize()).toContain('type="t:Order"');
  });

  it('refuses when no correct reference could be written', () => {
    // No target namespace, but a default xmlns is in scope — so there is no way to write "a name in
    // no namespace" in an attribute value. Refusing beats writing a reference that points elsewhere.
    const document = parse(`<schema xmlns="http://www.w3.org/2001/XMLSchema">
      <element name="order"><complexType><sequence/></complexType></element>
    </schema>`);
    expect(extractType(document, anonymous(document), 'Order')).toBeNull();
  });

  it('folds a singly-referenced type back into its declaration', () => {
    const document = parse(`<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="total" type="xs:decimal"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`);

    const command = inlineType(document, componentNamed(document, 'order'));
    expect(command).not.toBeNull();
    document.run(command!);

    const after = document.serialize();
    expect(after).not.toContain('type="Order"');
    expect(after).not.toContain('name="Order"');

    const set = assembleSchema('self.xsd', catalogueFrom({ 'self.xsd': after }));
    expect(set.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('round-trips: extract then inline gives the file back', () => {
    // The strongest statement either refactoring can make. Both rewrite indentation and both move a
    // subtree between depths, so a round trip that lands anywhere other than the original text means
    // one of them is quietly reformatting.
    const document = parse(INLINE);
    document.run(extractType(document, anonymous(document), 'Order')!);
    document.run(inlineType(document, componentNamed(document, 'order'))!);
    expect(document.serialize()).toBe(INLINE);
  });

  it('will not inline a type two declarations share', () => {
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="shipTo" type="Address"/>
      <xs:element name="billTo" type="Address"/>
      <xs:complexType name="Address"><xs:sequence/></xs:complexType>
    </xs:schema>`);
    expect(inlineType(document, componentNamed(document, 'shipTo'))).toBeNull();
  });

  it('places the inlined type after an annotation, where XSD requires it', () => {
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="order" type="Order">
        <xs:annotation><xs:documentation>An order.</xs:documentation></xs:annotation>
      </xs:element>
      <xs:complexType name="Order"><xs:sequence/></xs:complexType>
    </xs:schema>`);

    const order = componentNamed(document, 'order');
    document.run(inlineType(document, order)!);

    const children = document
      .childrenOf(order)
      .map((id) => document.node(id))
      .filter((node) => node !== undefined && isElement(node))
      .map((node) => node.name.localName);
    expect(children).toEqual(['annotation', 'complexType']);
  });
});

suite('documentation', () => {
  it('creates annotation and documentation as the first child', () => {
    const document = parse(NO_NAMESPACE);
    const command = setDocumentation(document, componentNamed(document, 'Code'), 'A product code.');
    expect(command).not.toBeNull();
    document.run(command!);

    expect(documentationOf(document, componentNamed(document, 'Code'))).toBe('A product code.');

    // xs:annotation must come first, or the schema stops validating against the schema for schemas
    // with a message nobody can act on.
    const children = document.childrenOf(componentNamed(document, 'Code')).map((id) => {
      const node = document.node(id);
      return node !== undefined && isElement(node) ? node.name.localName : null;
    });
    expect(children.filter((name) => name !== null)).toEqual(['annotation', 'restriction']);
  });

  it('replaces existing text rather than adding a second documentation element', () => {
    const document = parse(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:simpleType name="Code">
        <xs:annotation><xs:documentation>Old.</xs:documentation></xs:annotation>
        <xs:restriction base="xs:string"/>
      </xs:simpleType>
    </xs:schema>`);

    document.run(setDocumentation(document, componentNamed(document, 'Code'), 'New.')!);
    expect(documentationOf(document, componentNamed(document, 'Code'))).toBe('New.');
    expect(document.serialize().match(/<xs:documentation>/g)).toHaveLength(1);
  });

  it('does not create an empty annotation for empty text', () => {
    const document = parse(NO_NAMESPACE);
    expect(setDocumentation(document, componentNamed(document, 'Code'), '  ')).toBeNull();
  });
});

suite('schema self-check', () => {
  const model = (source: string): SchemaModel =>
    new SchemaModel(assembleSchema('self.xsd', catalogueFrom({ 'self.xsd': source })));

  it('finds nothing wrong with a schema that is fine', () => {
    const document = parse(NO_NAMESPACE);
    expect(selfProblems(document, model(NO_NAMESPACE))).toEqual([]);
  });

  it('reports a reference to a component that does not exist', () => {
    const source = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="a" type="Missing"/>
    </xs:schema>`;
    const problems = selfProblems(parse(source), model(source));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('"Missing"');
  });

  it('explains the missing-default-namespace case rather than only reporting it', () => {
    // Reporting "Code is not declared" next to a visible `<xs:simpleType name="Code">` reads as a
    // bug in the tool. The hint is the whole value of the diagnostic.
    const source = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:x">
      <xs:element name="a" type="Code"/>
      <xs:simpleType name="Code"><xs:restriction base="xs:string"/></xs:simpleType>
    </xs:schema>`;
    const problems = selfProblems(parse(source), model(source));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.hint).toContain('xmlns="urn:x"');
  });

  it('accepts built-in types without a declaration', () => {
    const source = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="a" type="xs:anyType"/>
      <xs:element name="b" type="xs:gYearMonth"/>
    </xs:schema>`;
    expect(selfProblems(parse(source), model(source))).toEqual([]);
  });

  it('stays quiet about dangling references when the schema pulls in other files', () => {
    // The missing component may well be in a document this editor was never given, so claiming it
    // is missing would be a confident wrong answer.
    const source = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:import namespace="urn:other" schemaLocation="other.xsd"/>
      <xs:element name="a" type="Missing"/>
    </xs:schema>`;
    expect(selfProblems(parse(source), null)).toEqual([]);
  });

  it('warns about an ambiguous content model', () => {
    // Two branches accept <a> from the same point — a UPA violation. Legal to write, rejected by
    // most validators, and completely invisible in a tree view.
    const source = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:complexType name="T">
        <xs:choice>
          <xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence>
          <xs:sequence><xs:element name="a" type="xs:string"/><xs:element name="b" type="xs:string"/></xs:sequence>
        </xs:choice>
      </xs:complexType>
    </xs:schema>`;
    const problems = selfProblems(parse(source), model(source));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.severity).toBe('warning');
    expect(problems[0]!.message).toContain('ambiguous');
  });

  it('reports an undeclared prefix on the node that uses it', () => {
    const source = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="a" type="nope:Thing"/>
    </xs:schema>`;
    const problems = selfProblems(parse(source), null);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('"nope:"');
  });
});

suite('component view', () => {
  it('recognises a schema document and nothing else', () => {
    expect(isSchemaDocument(parse(NO_NAMESPACE))).toBe(true);
    expect(isSchemaDocument(parse('<order/>'))).toBe(false);
    expect(
      isSchemaDocument(parse('<schema xmlns="http://purl.oclc.org/dsdl/schematron"/>')),
    ).toBe(false);
  });

  it('groups components by kind, in a fixed order, with counts', () => {
    const document = parse(NO_NAMESPACE);
    const rows = buildComponentRows(document, new Set());
    const headings = rows.filter((row) => row.heading !== undefined).map((row) => row.heading);

    expect(headings).toEqual([
      'Global elements (1)',
      'Complex types (2)',
      'Simple types (3)',
      'Groups (1)',
      'Attribute groups (1)',
    ]);
  });

  it('labels components by name with a one-glance summary of what they are', () => {
    const document = parse(NO_NAMESPACE);
    const rows = buildComponentRows(document, new Set());
    const labelled = rows
      .filter((row) => row.componentLabel !== undefined)
      .map((row) => [row.componentLabel, row.componentDetail]);

    expect(labelled).toContainEqual(['Order', 'sequence']);
    expect(labelled).toContainEqual(['Line', 'simple content']);
    expect(labelled).toContainEqual(['Codes', 'list of Code']);
    expect(labelled).toContainEqual(['Either', 'union']);
    expect(labelled).toContainEqual(['Code', 'restricts xs:string']);
  });

  it('addresses the same nodes as the literal tree, so selection survives the toggle', () => {
    const document = parse(NO_NAMESPACE);
    const rows = buildComponentRows(document, expandAll(document));
    const code = componentNamed(document, 'Code');
    expect(rows.some((row) => row.id === code)).toBe(true);
  });

  it('gives every row its own id, headings included', () => {
    // The bug this pins: every heading row used to be addressed by the schema element, so all eight
    // shared one id. The virtualizer keys rows by id and positions them absolutely, so React reused
    // the same DOM node for several headings and they stacked on top of each other; the document
    // carried eight copies of one element id; and selecting the root painted every heading at once.
    const document = parse(NO_NAMESPACE);
    const rows = buildComponentRows(document, expandAll(document));

    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);

    // And a heading is never confusable with the element it groups.
    const rootId = document.documentElement()!;
    expect(rows.filter((row) => row.heading !== undefined).length).toBeGreaterThan(1);
    expect(rows.some((row) => row.heading !== undefined && row.id === rootId)).toBe(false);
  });

  it('collapses one heading without disturbing the others', () => {
    const document = parse(NO_NAMESPACE);
    const rootId = document.documentElement()!;
    const headings = (open: Set<NodeId>): string[] =>
      buildComponentRows(document, open)
        .filter((row) => row.heading !== undefined)
        .map((row) => row.heading!);

    const before = headings(new Set());
    const after = headings(new Set([headingKey(rootId, 'Simple types')]));
    // Collapsing a group hides its members, never its own heading or anyone else's.
    expect(after).toEqual(before);
  });

  it('collapses a heading without collapsing the element it addresses', () => {
    // The heading rows are synthetic, so their expansion state is encoded outside the real NodeId
    // range — otherwise collapsing "Simple types" would collapse the schema element itself.
    const document = parse(NO_NAMESPACE);
    const rootId = document.documentElement()!;
    const collapsed = new Set<NodeId>([headingKey(rootId, 'Simple types')]);

    const rows = buildComponentRows(document, collapsed);
    expect(rows.some((row) => row.componentLabel === 'Code')).toBe(false);
    expect(rows.some((row) => row.componentLabel === 'Order')).toBe(true);
    expect(headingKey(rootId, 'Simple types')).toBeLessThan(0);
  });
});
