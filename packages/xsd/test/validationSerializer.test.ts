import { describe, expect, it } from 'vitest';
import { XmlDocument, isElement } from '@x-editor/xml-core';
import { nodeForLine, serializeForValidation } from '../src/validationSerializer.js';

function serialize(source: string) {
  const document = XmlDocument.parse(source);
  return { document, payload: serializeForValidation(document) };
}

/** The name of the element a given 1-based line maps to. */
function nameAtLine(source: string, line: number): string | undefined {
  const { document, payload } = serialize(source);
  const id = nodeForLine(payload, line);
  if (id === undefined) return undefined;
  const node = document.node(id);
  return node !== undefined && isElement(node) ? node.name.localName : undefined;
}

describe('one start-tag per line', () => {
  it('puts every element on a line of its own', () => {
    const { payload } = serialize(`<a><b/><c><d/></c></a>`);
    expect(payload.text.split('\n')).toEqual([
      '<a>',
      '  <b/>',
      '  <c>',
      '    <d/>',
      '  </c>',
      '</a>',
    ]);
  });

  it('maps each line back to the element whose start-tag is on it', () => {
    const source = `<a><b/><c><d/></c></a>`;
    expect(nameAtLine(source, 1)).toBe('a');
    expect(nameAtLine(source, 2)).toBe('b');
    expect(nameAtLine(source, 3)).toBe('c');
    expect(nameAtLine(source, 4)).toBe('d');
  });

  it('resolves a close-tag line to the element that opened the block', () => {
    // libxml2 reports "missing child element(s)" against the element's own line, but an error on a
    // close tag has to land somewhere sensible rather than nowhere.
    expect(nameAtLine(`<a><b/><c><d/></c></a>`, 5)).toBe('d');
  });

  it('collapses the source formatting, since only the mapping matters', () => {
    const { payload } = serialize(`<a>\n\n\n   <b/>\n\n</a>`);
    expect(payload.text).toBe('<a>\n  <b/>\n</a>');
  });
});

describe('content is preserved exactly', () => {
  it('keeps an element with text on one line, so its value is unchanged', () => {
    // Adding newlines around the text would validate something the user never wrote — for
    // xs:string with whiteSpace="preserve" the added whitespace is part of the value.
    const { payload } = serialize(`<a><note>  spaces matter  </note></a>`);
    expect(payload.text).toBe('<a>\n  <note>  spaces matter  </note>\n</a>');
  });

  it('keeps mixed content intact rather than breaking it across lines', () => {
    const { payload } = serialize(`<p>See <em>this</em> here.</p>`);
    expect(payload.text).toBe('<p>See <em>this</em> here.</p>');
  });

  it('escapes text and attribute values', () => {
    const { payload } = serialize(`<a t="&lt;x&gt;">3 &lt; 5 &amp;&amp; 6 &gt; 4</a>`);
    expect(payload.text).toBe('<a t="&lt;x>">3 &lt; 5 &amp;&amp; 6 &gt; 4</a>');
  });

  it('keeps CDATA as CDATA', () => {
    const { payload } = serialize(`<a><![CDATA[<not markup>]]></a>`);
    expect(payload.text).toContain('<![CDATA[<not markup>]]>');
  });

  it('carries namespace declarations and attributes through', () => {
    const { payload } = serialize(`<a xmlns="urn:t" xmlns:x="urn:x" x:id="1" b='2'/>`);
    expect(payload.text).toBe('<a xmlns="urn:t" xmlns:x="urn:x" x:id="1" b="2"/>');
  });

  it('does not emit namespace declarations twice', () => {
    // The CST holds declarations apart from ordinary attributes; re-emitting from both lists would
    // produce a duplicate-attribute error before validation even began.
    const { payload } = serialize(`<a xmlns="urn:t"/>`);
    expect(payload.text.match(/xmlns=/g)).toHaveLength(1);
  });
});

describe('what the payload leaves out', () => {
  it('drops comments and processing instructions, which carry no validity weight', () => {
    const { payload } = serialize(`<a><!-- note --><?pi go?><b/></a>`);
    expect(payload.text).toBe('<a>\n  <b/>\n</a>');
  });

  it('produces nothing for a document with no root element', () => {
    const { payload } = serialize(`<!-- just a comment -->`);
    expect(payload.text).toBe('');
  });
});
