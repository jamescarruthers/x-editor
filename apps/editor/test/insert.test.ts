import { beforeEach, describe, expect, it } from 'vitest';
import { insertionPlan, requiredMissing } from '@x-editor/xsd';
import type { NodeId } from '@x-editor/xml-core';
import { store } from '../src/state/store.js';
import { insertAllRequired, insertPlanned } from '../src/model/insert.js';
import { applyFix } from '../src/model/fixes.js';
import { documentProblems } from '../src/model/problems.js';
import { EXAMPLE_SCHEMA, EXAMPLE_SCHEMA_NAME } from '../src/examples/purchaseOrder.js';

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<purchaseOrder orderDate="2026-07-29">
  <shipTo country="GB">
    <name>Alice Smith</name>
    <street>123 Maple Street</street>
    <city>Cambridge</city>
    <postcode>CB1 2AB</postcode>
  </shipTo>
  <items>
    <item partNum="872-AA">
      <productName>Lawnmower</productName>
      <quantity>1</quantity>
      <price>148.95</price>
    </item>
  </items>
</purchaseOrder>
`;

function load(source = DOCUMENT): void {
  store.openFile('test.xml', source);
  store.attachSchema(EXAMPLE_SCHEMA_NAME, EXAMPLE_SCHEMA);
}

/** The nth element child of a node, by path from the document element. */
function at(path: number[]): NodeId {
  const doc = store.document;
  let id = doc.documentElement()!;
  for (const index of path) {
    id = doc
      .childrenOf(id)
      .filter((child) => doc.node(child)?.kind === 'element')[index]!;
  }
  return id;
}

describe('the example schema', () => {
  beforeEach(() => load());

  it('compiles without errors', () => {
    expect(store.schemaProblems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('sees the document as valid apart from what is genuinely missing', () => {
    const problems = documentProblems(store.schema.model!, store.document);
    expect(problems.map((p) => p.message)).toEqual([]);
  });
});

describe('inserting from the palette', () => {
  beforeEach(() => load());

  it('places an element where the content model expects it, not where the caret is', () => {
    // <billTo> belongs between <shipTo> and <items>, and the user should not have to know that.
    const context = store.contextFor(store.document.documentElement()!)!;
    const billTo = insertionPlan(store.schema.model!, context).find(
      (candidate) => candidate.name.localName === 'billTo',
    )!;
    expect(billTo.index).toBe(1);

    insertPlanned(context, billTo);
    const source = store.document.serialize();
    expect(source.indexOf('<billTo')).toBeGreaterThan(source.indexOf('</shipTo>'));
    expect(source.indexOf('<billTo')).toBeLessThan(source.indexOf('<items>'));
  });

  it('matches the surrounding indentation rather than reformatting', () => {
    const context = store.contextFor(store.document.documentElement()!)!;
    const comment = insertionPlan(store.schema.model!, context).find(
      (candidate) => candidate.name.localName === 'comment',
    )!;
    insertPlanned(context, comment);

    // Every line that was there before is still there, byte for byte.
    const before = DOCUMENT.split('\n').filter((line) => !line.includes('comment'));
    const after = store.document.serialize().split('\n');
    for (const line of before) expect(after).toContain(line);
    expect(store.document.serialize()).toContain('\n  <comment');
  });

  it('inserts the required attributes and children with the element', () => {
    const items = store.contextFor(at([1]))!;
    const item = insertionPlan(store.schema.model!, items).find(
      (candidate) => candidate.name.localName === 'item',
    )!;
    insertPlanned(items, item);

    const source = store.document.serialize();
    // partNum is required and patterned, so the skeleton has to satisfy the pattern too.
    expect(source).toContain('partNum="000-AA"');
    expect(source.match(/<productName/g)).toHaveLength(2);
  });

  it('undoes the whole insertion as one step', () => {
    const context = store.contextFor(at([1]))!;
    const item = insertionPlan(store.schema.model!, context).find(
      (candidate) => candidate.name.localName === 'item',
    )!;
    const historyBefore = store.document.history.length;

    insertPlanned(context, item);
    expect(store.document.history.length).toBe(historyBefore + 1);

    store.undo();
    expect(store.document.serialize()).toBe(DOCUMENT);
  });
});

describe('add all required', () => {
  const MISSING = `<?xml version="1.0" encoding="UTF-8"?>
<purchaseOrder orderDate="2026-07-29">
</purchaseOrder>
`;

  beforeEach(() => load(MISSING));

  it('starts out knowing exactly what is absent', () => {
    const context = store.contextFor(store.document.documentElement()!)!;
    expect(requiredMissing(store.schema.model!, context).map((n) => n.localName)).toEqual([
      'shipTo',
      'items',
    ]);
  });

  it('adds everything missing and leaves the element valid', () => {
    const context = store.contextFor(store.document.documentElement()!)!;
    const count = insertAllRequired(store.schema.model!, context);
    expect(count).toBe(2);

    const after = store.contextFor(store.document.documentElement()!)!;
    expect(requiredMissing(store.schema.model!, after)).toEqual([]);
    expect(documentProblems(store.schema.model!, store.document).map((p) => p.message)).toEqual([]);
  });

  it('is a single undo step', () => {
    const context = store.contextFor(store.document.documentElement()!)!;
    const historyBefore = store.document.history.length;
    insertAllRequired(store.schema.model!, context);
    expect(store.document.history.length).toBe(historyBefore + 1);

    store.undo();
    expect(store.document.serialize()).toBe(MISSING);
  });
});

describe('diagnostics and their fixes', () => {
  const diagnose = () => documentProblems(store.schema.model!, store.document);
  const messages = () => diagnose().map((d) => d.message);

  it('describes a swapped pair as a swap, not as two unrelated errors', () => {
    load(`<purchaseOrder orderDate="2026-07-29">
  <items/>
  <shipTo country="GB"/>
</purchaseOrder>
`);
    // The alignment finds one transposition rather than a delete plus an insert, so the user is
    // told the thing that is actually true.
    expect(messages()).toContain('<items> and <shipTo> are the wrong way round.');
  });

  it('reports a missing required attribute and can add it', () => {
    load(`<purchaseOrder>
  <shipTo country="GB">
    <name>A</name><street>B</street><city>C</city><postcode>CB1 2AB</postcode>
  </shipTo>
  <items><item partNum="872-AA">
    <productName>X</productName><quantity>1</quantity><price>1.00</price>
  </item></items>
</purchaseOrder>
`);
    const missing = diagnose().find((d) => d.code === 'cvc-complex-type.4')!;
    expect(missing.message).toBe('<purchaseOrder> must have orderDate.');

    applyFix(missing.fixes[0]!.edit);
    expect(store.document.serialize()).toContain('orderDate=');
  });

  it('reports a value that breaks its type, and offers a coercion that actually works', () => {
    load(`<purchaseOrder orderDate="2026-07-29">
  <shipTo country="GB">
    <name>A</name><street>B</street><city>C</city><postcode>cb1 2ab</postcode>
  </shipTo>
  <items><item partNum="872-AA">
    <productName>X</productName><quantity>1</quantity><price>1.00</price>
  </item></items>
</purchaseOrder>
`);
    const broken = diagnose().find((d) => d.code === 'cvc-pattern-valid')!;
    expect(broken.message).toContain('Postcode');

    // Uppercasing is the fix here, and the offer is only made because it was re-validated first.
    const fix = broken.fixes.find((f) => f.preview === 'CB1 2AB')!;
    applyFix(fix.edit);
    expect(diagnose().filter((d) => d.code === 'cvc-pattern-valid')).toEqual([]);
  });

  it('never offers a fix that leaves the value still invalid', () => {
    load(`<purchaseOrder orderDate="2026-07-29">
  <shipTo country="GB">
    <name>A</name><street>B</street><city>C</city><postcode>nonsense</postcode>
  </shipTo>
  <items><item partNum="872-AA">
    <productName>X</productName><quantity>1</quantity><price>1.00</price>
  </item></items>
</purchaseOrder>
`);
    const broken = diagnose().find((d) => d.code === 'cvc-pattern-valid')!;
    for (const fix of broken.fixes) {
      applyFix(fix.edit);
      expect(diagnose().filter((d) => d.code === 'cvc-pattern-valid')).toEqual([]);
      store.undo();
    }
  });

  it('reports a quantity outside its bounds and offers the bound', () => {
    load(`<purchaseOrder orderDate="2026-07-29">
  <shipTo country="GB">
    <name>A</name><street>B</street><city>C</city><postcode>CB1 2AB</postcode>
  </shipTo>
  <items><item partNum="872-AA">
    <productName>X</productName><quantity>500</quantity><price>1.00</price>
  </item></items>
</purchaseOrder>
`);
    const broken = diagnose().find((d) => d.code === 'cvc-range-valid')!;
    expect(broken.message).toContain('at most 99');
    applyFix(broken.fixes.find((f) => f.preview === '99')!.edit);
    expect(store.document.serialize()).toContain('<quantity>99</quantity>');
  });

  it('reports an element the schema does not allow, and can remove it', () => {
    load(`<purchaseOrder orderDate="2026-07-29">
  <shipTo country="GB">
    <name>A</name><street>B</street><city>C</city><postcode>CB1 2AB</postcode>
  </shipTo>
  <mystery/>
  <items><item partNum="872-AA">
    <productName>X</productName><quantity>1</quantity><price>1.00</price>
  </item></items>
</purchaseOrder>
`);
    const stray = diagnose().find((d) => d.code === 'cvc-complex-type.2.4.d')!;
    expect(stray.message).toBe('<mystery> is not allowed inside <purchaseOrder>.');
    applyFix(stray.fixes[0]!.edit);
    expect(diagnose().map((d) => d.message)).toEqual([]);
  });

  it('offers a rename when the name is nearly right', () => {
    load(`<purchaseOrder orderDate="2026-07-29">
  <shipTo country="GB">
    <name>A</name><street>B</street><city>C</city><postcode>CB1 2AB</postcode>
  </shipTo>
  <itemss/>
</purchaseOrder>
`);
    const wrong = diagnose().find((d) => d.fixes.some((f) => f.title.startsWith('Change')))!;
    applyFix(wrong.fixes.find((f) => f.title.startsWith('Change'))!.edit);
    const source = store.document.serialize();
    expect(source).not.toContain('itemss');
    expect(source).toContain('<items/>');
  });

  it('fixes every problem in one element as a single undoable step', () => {
    const source = `<purchaseOrder orderDate="2026-07-29">
  <items/>
  <shipTo country="GB"><name>A</name><street>B</street><city>C</city><postcode>CB1 2AB</postcode></shipTo>
</purchaseOrder>
`;
    load(source);
    const swap = diagnose().find((d) => d.fixes.length > 0)!;
    const historyBefore = store.document.history.length;

    applyFix(swap.fixes[0]!.edit);
    expect(store.document.history.length).toBe(historyBefore + 1);
    // The swap keeps both nodes, so what was there is still there — just in the right order.
    expect(store.document.serialize()).toContain('<shipTo');
    expect(store.document.serialize()).toContain('<items/>');

    store.undo();
    expect(store.document.serialize()).toBe(source);
  });
});
