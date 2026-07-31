import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  XmlDocument,
  setNamespaceDeclaration,
  insertElement,
  insertText,
  moveNode,
  removeAttribute,
  removeNode,
  renameElement,
  setAttribute,
  setTextValue,
} from '../src/document.js';
import type { NodeId, QName } from '../src/types.js';

const q = (localName: string, namespaceUri: string | null = null, prefix = ''): QName => ({
  prefix,
  localName,
  namespaceUri,
});

function firstElement(doc: XmlDocument, parent: NodeId): NodeId {
  for (const child of doc.childrenOf(parent)) {
    if (doc.node(child)?.kind === 'element') return child;
  }
  throw new Error('no element child');
}

describe('editing only rewrites what changed', () => {
  it('leaves untouched siblings byte-identical', () => {
    const xml = `<root>\n  <a   id = 'keep'   />\n  <b>text</b>\n</root>`;
    const doc = XmlDocument.parse(xml);
    const root = doc.documentElement()!;
    const b = doc.childrenOf(root).filter((c) => doc.node(c)?.kind === 'element')[1]!;

    doc.run(renameElement(doc, b, q('renamed')));

    const out = doc.serialize();
    // The oddly-formatted <a> keeps its exact source text; only <b> is regenerated.
    expect(out).toContain(`<a   id = 'keep'   />`);
    expect(out).toContain('<renamed>text</renamed>');
  });

  it('grows a close tag when a self-closing element gains children', () => {
    const doc = XmlDocument.parse('<root><empty/></root>');
    const empty = firstElement(doc, doc.documentElement()!);
    doc.run(insertText(doc, empty, 0, 'now has content'));
    expect(doc.serialize()).toBe('<root><empty>now has content</empty></root>');
  });

  it('keeps the expanded form when an element loses all children', () => {
    // Collapsing <a></a> to <a/> would be a gratuitous diff.
    const doc = XmlDocument.parse('<root><a>x</a></root>');
    const a = firstElement(doc, doc.documentElement()!);
    doc.run(removeNode(doc, doc.childrenOf(a)[0]!));
    expect(doc.serialize()).toBe('<root><a></a></root>');
  });

  it('escapes text written by the user', () => {
    const doc = XmlDocument.parse('<a>x</a>');
    const text = doc.childrenOf(doc.documentElement()!)[0]!;
    doc.run(setTextValue(doc, text, '3 < 4 & 5 > 2'));
    expect(doc.serialize()).toBe('<a>3 &lt; 4 &amp; 5 &gt; 2</a>');
  });

  it('does not double-escape an entity reference the user typed', () => {
    const doc = XmlDocument.parse('<a>x</a>');
    const text = doc.childrenOf(doc.documentElement()!)[0]!;
    doc.run(setTextValue(doc, text, 'em&mydash;dash'));
    expect(doc.serialize()).toBe('<a>em&mydash;dash</a>');
  });

  it('escapes newlines in attribute values so they survive re-reading', () => {
    const doc = XmlDocument.parse('<a/>');
    const a = doc.documentElement()!;
    doc.run(setAttribute(doc, a, q('title'), 'line1\nline2'));
    const out = doc.serialize();
    expect(out).toBe('<a title="line1&#10;line2"/>');
    // Round-trips back to the same value rather than to a space.
    const reparsed = XmlDocument.parse(out);
    const node = reparsed.node(reparsed.documentElement()!);
    expect(node?.kind === 'element' && node.attributes[0]?.value).toBe('line1\nline2');
  });

  it('preserves the original quote style when changing a value', () => {
    const doc = XmlDocument.parse(`<a id='1'/>`);
    const a = doc.documentElement()!;
    doc.run(setAttribute(doc, a, q('id'), '2'));
    expect(doc.serialize()).toBe(`<a id='2'/>`);
  });
});

describe('history', () => {
  it('undo restores the exact original bytes', () => {
    const xml = `<?xml version="1.0"?>\n<root>\n  <a id="1"/>\n  <b>text</b>\n</root>\n`;
    const doc = XmlDocument.parse(xml);
    const root = doc.documentElement()!;

    doc.run(insertElement(doc, root, 0, { name: q('inserted') }));
    doc.run(setAttribute(doc, firstElement(doc, root), q('extra'), 'v'));
    expect(doc.serialize()).not.toBe(xml);

    doc.undo();
    doc.undo();
    expect(doc.serialize()).toBe(xml);
  });

  it('redo reapplies', () => {
    const doc = XmlDocument.parse('<root/>');
    doc.run(insertElement(doc, doc.documentElement()!, 0, { name: q('child') }));
    const after = doc.serialize();
    doc.undo();
    // Back to the original bytes: the element was self-closing in the source and has no children
    // again, so it re-collapses rather than leaving `<root></root>` behind.
    expect(doc.serialize()).toBe('<root/>');
    doc.redo();
    expect(doc.serialize()).toBe(after);
  });

  it('keeps node identity stable across undo and redo', () => {
    // Selection and diagnostics are keyed by node id, so they must survive history navigation.
    const doc = XmlDocument.parse('<root/>');
    const command = insertElement(doc, doc.documentElement()!, 0, { name: q('child') });
    doc.run(command);
    const id = command.affected;
    doc.undo();
    doc.redo();
    expect(doc.childrenOf(doc.documentElement()!)).toContain(id);
  });

  it('carries a human-readable label', () => {
    const doc = XmlDocument.parse('<root><a currency="GBP"><b/><c/></a></root>');
    const a = firstElement(doc, doc.documentElement()!);
    expect(removeNode(doc, a).label).toBe('Deleted <a> and 2 children');
    expect(setAttribute(doc, a, q('currency'), 'EUR').label).toBe('Changed @currency to EUR');
    expect(setAttribute(doc, a, q('added'), 'x').label).toBe('Added @added');
  });

  it('discards the redo tail on a new command', () => {
    const doc = XmlDocument.parse('<root/>');
    doc.run(insertElement(doc, doc.documentElement()!, 0, { name: q('a') }));
    doc.undo();
    expect(doc.canRedo).toBe(true);
    doc.run(insertElement(doc, doc.documentElement()!, 0, { name: q('b') }));
    expect(doc.canRedo).toBe(false);
  });

  it('removes and restores a subtree with attributes intact', () => {
    const xml = '<root><keep/><doomed a="1"><deep>x</deep></doomed></root>';
    const doc = XmlDocument.parse(xml);
    const doomed = doc.childrenOf(doc.documentElement()!)[1]!;
    doc.run(removeNode(doc, doomed));
    expect(doc.serialize()).toBe('<root><keep/></root>');
    doc.undo();
    expect(doc.serialize()).toBe(xml);
  });

  it('moves a node and puts it back', () => {
    const xml = '<root><a/><b/><c/></root>';
    const doc = XmlDocument.parse(xml);
    const c = doc.childrenOf(doc.documentElement()!)[2]!;
    doc.run(moveNode(doc, c, 0));
    expect(doc.serialize()).toBe('<root><c/><a/><b/></root>');
    doc.undo();
    expect(doc.serialize()).toBe(xml);
  });

  it('removes an attribute and puts it back verbatim', () => {
    const xml = `<a id='1' keep="2"/>`;
    const doc = XmlDocument.parse(xml);
    const a = doc.documentElement()!;
    doc.run(removeAttribute(doc, a, q('id')));
    expect(doc.serialize()).toBe('<a keep="2"/>');
    doc.undo();
    expect(doc.serialize()).toBe(xml);
  });
});

describe('property: apply then invert is the identity', () => {
  /**
   * The highest-value test in the document layer. An undo model that is subtly non-inverting
   * corrupts documents in ways users only notice much later.
   */
  it('holds for random command sequences', () => {
    const commandKind = fc.constantFrom(
      'insertElement',
      'insertText',
      'setAttribute',
      'rename',
      'removeFirst',
    );

    fc.assert(
      fc.property(fc.array(commandKind, { maxLength: 12 }), (kinds) => {
        const xml = `<?xml version="1.0"?>\n<root a="1">\n  <x/>\n  <y>text</y>\n</root>\n`;
        const doc = XmlDocument.parse(xml);
        const root = doc.documentElement()!;
        let applied = 0;

        for (const [i, kind] of kinds.entries()) {
          const children = doc.childrenOf(root).filter((c) => doc.node(c)?.kind === 'element');
          switch (kind) {
            case 'insertElement':
              doc.run(insertElement(doc, root, 0, { name: q(`e${i}`) }));
              applied++;
              break;
            case 'insertText':
              doc.run(insertText(doc, root, 0, `t${i}`));
              applied++;
              break;
            case 'setAttribute':
              doc.run(setAttribute(doc, root, q(`a${i}`), String(i)));
              applied++;
              break;
            case 'rename':
              if (children[0] !== undefined) {
                doc.run(renameElement(doc, children[0], q(`r${i}`)));
                applied++;
              }
              break;
            case 'removeFirst':
              if (children[0] !== undefined) {
                doc.run(removeNode(doc, children[0]));
                applied++;
              }
              break;
          }
        }

        for (let i = 0; i < applied; i++) doc.undo();
        expect(doc.serialize()).toBe(xml);
      }),
      { numRuns: 300 },
    );
  });
});

describe('setNamespaceDeclaration', () => {
  it('reaches the serialized document, not just the in-memory prefix table', () => {
    // The bug this pins: a declaration lives both in `namespaceDeclarations` and in the element's
    // ordinary attributes, and the command used to update only the first. Prefixes resolved in
    // memory while nothing reached the file, so anything written beside it — an `xsi:type`, say —
    // produced a document that no longer parsed. Invisible until reload, which is why it is here.
    const doc = XmlDocument.parse('<order><payment/></order>');
    const root = doc.documentElement()!;
    doc.run(setNamespaceDeclaration(doc, root, 'xsi', 'http://www.w3.org/2001/XMLSchema-instance'));

    const text = doc.serialize();
    expect(text).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    expect(XmlDocument.parse(text).parseErrors).toEqual([]);
  });

  it('undoes cleanly, leaving the original bytes', () => {
    const source = '<order><payment/></order>';
    const doc = XmlDocument.parse(source);
    doc.run(setNamespaceDeclaration(doc, doc.documentElement()!, 'xsi', 'urn:x'));
    doc.undo();
    expect(doc.serialize()).toBe(source);
  });

  it('rebinds an existing prefix rather than declaring it twice', () => {
    const doc = XmlDocument.parse('<order xmlns:p="urn:old"/>');
    doc.run(setNamespaceDeclaration(doc, doc.documentElement()!, 'p', 'urn:new'));
    const text = doc.serialize();
    expect(text).toContain('urn:new');
    expect(text).not.toContain('urn:old');
    expect(text.match(/xmlns:p=/g)).toHaveLength(1);
  });
});
