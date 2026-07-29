import { describe as suite, expect, it } from 'vitest';
import { ROOT_ID, XmlDocument, type NodeId } from '@x-editor/xml-core';
import { buildRows, textPreview } from '../src/model/rows.js';
import { describe, humanise } from '../src/model/describe.js';

const SAMPLE = `<?xml version="1.0"?>
<order id="1">
  <line>A</line>
  <line>B</line>
  <note>plain</note>
</order>`;

function expandAll(doc: XmlDocument): Set<NodeId> {
  const open = new Set<NodeId>();
  const walk = (id: NodeId): void => {
    open.add(id);
    for (const child of doc.childrenOf(id)) walk(child);
  };
  walk(ROOT_ID);
  return open;
}

suite('row flattening', () => {
  it('skips whitespace-only text but keeps significant text', () => {
    const doc = XmlDocument.parse(SAMPLE);
    const rows = buildRows(doc, expandAll(doc));
    // Indentation between elements must not become rows, or the tree triples in length and teaches
    // a beginner nothing.
    expect(rows.some((r) => r.node.kind === 'text' && r.node.value.trim() === '')).toBe(false);
    expect(rows.some((r) => r.node.kind === 'text' && r.node.value === 'A')).toBe(true);
  });

  it('numbers repeated siblings for the cardinality chip', () => {
    const doc = XmlDocument.parse(SAMPLE);
    const rows = buildRows(doc, expandAll(doc));
    const lines = rows.filter((r) => r.node.kind === 'element' && r.node.name.localName === 'line');
    expect(lines.map((r) => [r.ordinal, r.siblingCount])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('does not number a lone element', () => {
    const doc = XmlDocument.parse(SAMPLE);
    const rows = buildRows(doc, expandAll(doc));
    const note = rows.find((r) => r.node.kind === 'element' && r.node.name.localName === 'note');
    expect(note?.siblingCount).toBe(1);
  });

  it('hides children of collapsed nodes', () => {
    const doc = XmlDocument.parse(SAMPLE);
    const rows = buildRows(doc, new Set([ROOT_ID]));
    expect(rows.some((r) => r.node.kind === 'element' && r.node.name.localName === 'line')).toBe(
      false,
    );
  });
});

suite('text preview', () => {
  it('previews simple content', () => {
    const doc = XmlDocument.parse('<a><b>hello</b></a>');
    const b = doc.childrenOf(doc.documentElement()!)[0]!;
    expect(textPreview(doc, b)).toBe('hello');
  });

  it('returns null when there are element children', () => {
    const doc = XmlDocument.parse('<a><b>x</b></a>');
    expect(textPreview(doc, doc.documentElement()!)).toBeNull();
  });

  it('truncates long values', () => {
    const doc = XmlDocument.parse(`<a>${'x'.repeat(80)}</a>`);
    const preview = textPreview(doc, doc.documentElement()!, 20);
    expect(preview).toHaveLength(20);
    expect(preview?.endsWith('…')).toBe(true);
  });
});

suite('descriptions', () => {
  it('always returns a non-empty sentence', () => {
    // The core promise is that the tool explains what you are looking at. A path that can come back
    // empty would silently gut it, so this is asserted for every node in the sample.
    const doc = XmlDocument.parse(SAMPLE);
    const all = [...expandAll(doc)];
    for (const id of all) {
      const description = describe(doc, id);
      expect(description.text.length, `empty description for ${id}`).toBeGreaterThan(0);
      expect(description.text.trim()).toBe(description.text);
    }
  });

  it('marks non-schema descriptions so a guess is never mistaken for a rule', () => {
    const doc = XmlDocument.parse(SAMPLE);
    expect(describe(doc, doc.documentElement()!).source).not.toBe('schema');
  });

  it('humanises element names', () => {
    expect(humanise('shipDate')).toBe('Ship date');
    expect(humanise('ship-date')).toBe('Ship date');
    expect(humanise('ship_date')).toBe('Ship date');
    expect(humanise('order')).toBe('Order');
  });
});
