import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadXPath } from '@x-editor/xsd';
import { store } from '../src/state/store.js';
import { EXAMPLE_RULES, EXAMPLE_RULES_NAME } from '../src/examples/purchaseOrder.js';
import { schematronRole } from '../src/state/schematron.js';
import { setAttribute, type NodeId } from '@x-editor/xml-core';

beforeAll(async () => {
  await loadXPath();
});

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
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
      <quantity>0</quantity>
      <price>148.95</price>
    </item>
    <item partNum="926-AA">
      <productName>Baby Monitor</productName>
      <quantity>2</quantity>
      <price>39.98</price>
    </item>
  </items>
</purchaseOrder>
`;

function open(): void {
  store.load(EXAMPLE_RULES, EXAMPLE_RULES_NAME);
  store.attachSample(SAMPLE, 'purchase-order.xml');
}

/** Every node with a given Schematron role, in document order. */
function nodesWithRole(role: string): NodeId[] {
  const out: NodeId[] = [];
  const visit = (id: NodeId): void => {
    if (schematronRole(store.document, id) === role) out.push(id);
    for (const child of store.document.childrenOf(id)) visit(child);
  };
  visit(store.document.documentElement()!);
  return out;
}

describe('Schematron mode', () => {
  beforeEach(open);

  it('recognises a Schematron document and parses it without errors', () => {
    expect(store.schematron.active).toBe(true);
    expect(store.schematron.problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('runs the rules against the sample and finds what is actually wrong', () => {
    const messages = store.schematron.result!.findings.map((f) => f.message);
    // The quantity of 0 is exactly what Schematron is for: XSD can say "a positive integer", but
    // the message here names the product and quotes the value.
    expect(messages.some((m) => m.includes('Lawnmower') && m.includes('quantity of 0'))).toBe(true);
  });

  it('attaches the author\'s diagnostic to the finding', () => {
    const finding = store.schematron.result!.findings.find((f) => f.diagnostics.length > 0)!;
    expect(finding.diagnostics[0]).toContain('Set the quantity to the number of units');
  });

  it('reports how many nodes each context matches', () => {
    const rules = nodesWithRole('rule');
    const stats = store.schematron.statisticsForRule(rules[0]!)!;
    expect(stats.context).toBe('item');
    expect(stats.matched).toBe(2);
    expect(stats.fired).toBe(2);
  });

  it('names the rule that shadows a dead one', () => {
    // The whole reason the harness exists. The example schema contains a deliberately shadowed
    // rule, and without this the author has no way to notice.
    const dead = store.schematron
      .result!.statistics.find((entry) => entry.ruleId === 'expensive-items')!;
    expect(dead.matched).toBeGreaterThan(0);
    expect(dead.fired).toBe(0);
    expect(dead.shadowedBy).toBe('all-items');
  });

  it('counts passes and failures per assertion', () => {
    const rules = nodesWithRole('rule');
    const quantities = store.schematron.statisticsForRule(rules[0]!)!;
    const [positive, large] = quantities.assertions;
    expect([positive?.passed, positive?.failed]).toEqual([1, 1]);
    expect([large?.passed, large?.failed]).toEqual([2, 0]);
  });

  it('re-runs as the schema is edited', () => {
    const before = store.schematron.result!.findings.length;

    // Loosen the rule the sample breaks, and the finding should disappear.
    const rules = nodesWithRole('rule');
    const assertions = store.document
      .childrenOf(rules[0]!)
      .filter((id) => schematronRole(store.document, id) === 'assert');

    store.run(
      setAttribute(
        store.document,
        assertions[0]!,
        { prefix: '', localName: 'test', namespaceUri: null },
        'quantity >= 0',
      ),
    );

    expect(store.schematron.result!.findings.length).toBeLessThan(before);
  });

  it('does not treat an ordinary XML document as Schematron', () => {
    store.load(SAMPLE, 'purchase-order.xml');
    expect(store.schematron.active).toBe(false);
  });
});
