import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadXPath } from '@x-editor/xsd';
import { setAttribute, setTextValue } from '@x-editor/xml-core';
import { store } from '../src/state/store.js';
import { workspaceProblems, countsByFile } from '../src/model/workspaceProblems.js';
import { NEW_SCH, NEW_XML, NEW_XSD } from '../src/state/templates.js';
import { EXAMPLES } from '../src/examples/index.js';

beforeAll(async () => {
  await loadXPath();
});

const XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order" type="Order"/>
  <xs:complexType name="Order">
    <xs:sequence>
      <xs:element name="ref" type="xs:string"/>
      <xs:element name="qty" type="xs:positiveInteger"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

const XML = `<?xml version="1.0"?>
<order>
  <ref>A-1</ref>
  <qty>2</qty>
</order>`;

const SCH = `<?xml version="1.0"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt2">
  <sch:pattern id="p">
    <sch:rule context="order">
      <sch:assert test="qty &lt; 10">Orders of ten or more need approval.</sch:assert>
    </sch:rule>
  </sch:pattern>
</sch:schema>`;

function workspace(): void {
  store.openWorkspace(
    [
      { name: 'order.xml', source: XML },
      { name: 'order.xsd', source: XSD },
      { name: 'order.sch', source: SCH },
    ],
    'xml',
  );
}

/** The nth element child, by path from the document element of a given file. */
function at(kind: 'xml' | 'xsd' | 'sch', path: number[]) {
  const doc = store.documentFor(kind)!;
  let id = doc.documentElement()!;
  for (const index of path) {
    id = doc.childrenOf(id).filter((child) => doc.node(child)?.kind === 'element')[index]!;
  }
  return id;
}

describe('the workspace', () => {
  beforeEach(workspace);

  it('files each source by its root element, not its extension', () => {
    // A `.txt` full of xs:schema is still a schema, and someone handed `rules.xml` should not have
    // to rename it before the editor will run it.
    store.openWorkspace(
      [
        { name: 'a.txt', source: XSD },
        { name: 'b.dat', source: SCH },
      ],
      'xsd',
    );
    expect(store.nameFor('xsd')).toBe('a.txt');
    expect(store.nameFor('sch')).toBe('b.dat');
  });

  it('holds three files at once, each with its own selection', () => {
    expect(store.openFiles.map((file) => file.kind)).toEqual(['xml', 'xsd', 'sch']);

    store.activate('xsd');
    store.select(at('xsd', [1]));
    const inSchema = store.selected;

    store.activate('xml');
    store.select(at('xml', [0]));
    const inDocument = store.selected;

    // Switching back returns you to where you were. A workspace that forgets is one you stop
    // switching in.
    store.activate('xsd');
    expect(store.selected).toBe(inSchema);
    store.activate('xml');
    expect(store.selected).toBe(inDocument);
  });

  it('never leaves the workspace empty', () => {
    store.closeFile('xsd');
    store.closeFile('sch');
    store.closeFile('xml');
    expect(store.openFiles.length).toBe(1);
  });

  it('makes a file of each kind from a template, and each one compiles', () => {
    store.openWorkspace([{ name: 'x.xml', source: NEW_XML }], 'xml');
    store.newFile('xsd');
    store.newFile('sch');

    expect(store.nameFor('xsd')).toBe('untitled.xsd');
    expect(store.nameFor('sch')).toBe('untitled.sch');
    // A template that does not compile is a worse starting point than a blank file, because the
    // editor has nothing to say about it until enough of one exists.
    expect(store.schema.model).not.toBeNull();
    expect(store.schematron.active).toBe(true);
    expect(store.schemaProblems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(store.schematron.problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('the templates parse and are what they claim to be', () => {
    for (const [source, kind] of [
      [NEW_XML, 'xml'],
      [NEW_XSD, 'xsd'],
      [NEW_SCH, 'sch'],
    ] as const) {
      store.openWorkspace([{ name: `t.${kind}`, source }], kind);
      expect(store.active).toBe(kind);
      expect(store.document.parseErrors).toEqual([]);
    }
  });
});

describe('errors that cross files', () => {
  beforeEach(workspace);

  it('starts clean', () => {
    const counts = countsByFile(workspaceProblems());
    expect(counts.xml.errors).toBe(0);
    expect(counts.xsd.errors).toBe(0);
    expect(counts.sch.errors).toBe(0);
  });

  it('an edit to the schema invalidates the document, and says so against the XML', () => {
    // The whole reason for holding three files at once. Nothing about the XML changed; it is now
    // wrong because of something typed two tabs away.
    store.activate('xsd');
    store.run(
      setAttribute(
        store.documentFor('xsd')!,
        at('xsd', [1, 0, 1]),
        { prefix: '', localName: 'type', namespaceUri: null },
        'xs:date',
      ),
    );

    const problems = workspaceProblems();
    expect(problems.some((problem) => problem.file === 'xml' && problem.severity === 'error')).toBe(
      true,
    );
  });

  it('an edit to the document is checked against the rules in the other file', () => {
    // The capability that was missing entirely: rules used to be parsed from whichever document was
    // being edited, so an XML author with rules open alongside got no findings at all.
    store.activate('xml');
    const qty = at('xml', [1]);
    const text = store.documentFor('xml')!.childrenOf(qty)[0]!;
    store.run(setTextValue(store.documentFor('xml')!, text, '25'));

    const problems = workspaceProblems();
    const fromRules = problems.filter(
      (problem) => problem.source === 'rules' && problem.file === 'xml',
    );
    expect(fromRules.map((problem) => problem.message)).toContain(
      'Orders of ten or more need approval.',
    );
  });

  it('attributes a broken rule to the rules file, not to the document', () => {
    store.activate('sch');
    store.run(
      setAttribute(
        store.documentFor('sch')!,
        at('sch', [0, 0, 0]),
        { prefix: '', localName: 'test', namespaceUri: null },
        'qty <<< 10',
      ),
    );

    const problems = workspaceProblems();
    // A rule the author wrote wrongly is the author's problem and belongs in their file. Filing it
    // against the XML would send someone editing a document they have not broken.
    expect(problems.some((problem) => problem.file === 'sch')).toBe(true);
  });

  it('reports a dangling reference against the schema that has it', () => {
    store.activate('xsd');
    store.run(
      setAttribute(
        store.documentFor('xsd')!,
        at('xsd', [0]),
        { prefix: '', localName: 'type', namespaceUri: null },
        'Missing',
      ),
    );

    const problems = workspaceProblems();
    expect(
      problems.some((problem) => problem.file === 'xsd' && problem.message.includes('Missing')),
    ).toBe(true);
  });

  it('clears the schema when its file is closed', () => {
    store.closeFile('xsd');
    expect(store.schema.model).toBeNull();
    expect(workspaceProblems().filter((problem) => problem.source === 'schema')).toEqual([]);
  });

  it('stops running the rules when their file is closed', () => {
    store.closeFile('sch');
    expect(store.schematron.active).toBe(false);
    expect(store.schematron.result).toBeNull();
  });
});

describe('the bundled examples', () => {
  it('the invoice opens with its rule already failing', () => {
    // This is the claim the example exists to support, and it used to be false in the app while
    // true in the engine: the rules were never loaded, so the document opened green.
    const invoice = EXAMPLES.find((example) => example.id === 'invoice')!;
    store.openWorkspace(
      [
        { name: invoice.documentName, source: invoice.document },
        { name: invoice.schemaName!, source: invoice.schema! },
        { name: invoice.rulesName!, source: invoice.rules! },
      ],
      'xml',
    );

    const problems = workspaceProblems();
    const failures = problems.filter(
      (problem) => problem.source === 'rules' && problem.severity === 'error',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]!.message).toContain('140');
    expect(failures[0]!.file).toBe('xml');

    // And schema-valid at the same time, which is the point: XSD cannot catch this.
    expect(
      problems.filter((problem) => problem.file === 'xml' && problem.source === 'schema'),
    ).toEqual([]);
  });
});
