import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { XmlDocument } from '../src/document.js';
import { tokenize } from '../src/tokenizer.js';

/**
 * The contract: parsing and re-serializing an untouched document returns the original bytes,
 * exactly. Not "semantically equivalent" — identical. Users keep these files in git.
 */
const CORPUS: Record<string, string> = {
  minimal: '<a/>',
  'xml declaration': '<?xml version="1.0" encoding="UTF-8"?>\n<a/>\n',
  'no trailing newline': '<a>text</a>',
  'crlf line endings': '<?xml version="1.0"?>\r\n<a>\r\n  <b/>\r\n</a>\r\n',
  'byte order mark': '﻿<?xml version="1.0"?><a/>',
  'single quoted attributes': `<a id='1' name='x y'/>`,
  'mixed quote styles': `<a id="1" name='x'/>`,
  'attribute whitespace': '<a   id = "1"\n   name="x"  />',
  'empty element expanded': '<a></a>',
  'self closing with space': '<a />',
  comments: '<!-- lead --><a><!-- inner --></a><!-- trail -->',
  'processing instructions': '<?xml-stylesheet href="x.xsl"?><a><?target data?></a>',
  cdata: '<a><![CDATA[raw <stuff> & things]]></a>',
  'predefined entities': '<a>&lt;&gt;&amp;&apos;&quot;</a>',
  'numeric character references': '<a>&#65;&#x42;</a>',
  'unknown entities preserved': '<a>&mydash;&nbsp;</a>',
  doctype: '<!DOCTYPE html><a/>',
  'doctype with internal subset':
    '<!DOCTYPE doc [\n  <!ENTITY mydash "&#8212;">\n  <!ELEMENT doc (#PCDATA)>\n]>\n<doc>&mydash;</doc>',
  'doctype with gt in subset': '<!DOCTYPE d [<!ENTITY e "a > b">]><d/>',
  namespaces: '<a:root xmlns:a="urn:a" xmlns="urn:d"><child/><a:kid/></a:root>',
  'deep nesting': '<a><b><c><d><e>x</e></d></c></b></a>',
  'mixed content': '<p>See <emph>this</emph> for <xref/> details.</p>',
  'whitespace preserved': '<a>\n\t<b>  spaced  </b>\n</a>',
  'xml space preserve': '<a xml:space="preserve">  keep   this  </a>',
  'attribute with newline': '<a title="line1&#10;line2"/>',
  'unicode content': '<a>日本語 · Ελληνικά · 🎉</a>',
  'repeated siblings': '<list><item>1</item><item>2</item><item>3</item></list>',
};

describe('lossless round-trip', () => {
  for (const [name, xml] of Object.entries(CORPUS)) {
    it(`preserves ${name} byte-for-byte`, () => {
      expect(XmlDocument.parse(xml).serialize()).toBe(xml);
    });
  }
});

describe('tokenizer coverage invariant', () => {
  /**
   * Every byte belongs to exactly one token, and tokens are contiguous. This is the invariant that
   * makes round-tripping structural rather than a matter of getting a hundred details right, so it
   * is asserted directly rather than only through its consequences.
   */
  for (const [name, xml] of Object.entries(CORPUS)) {
    it(`covers every byte of ${name}`, () => {
      const { tokens } = tokenize(xml);
      let cursor = 0;
      for (const token of tokens) {
        expect(token.span.start).toBe(cursor);
        expect(token.span.end).toBeGreaterThanOrEqual(token.span.start);
        cursor = token.span.end;
      }
      expect(cursor).toBe(xml.length);
    });
  }
});

describe('malformed input still round-trips', () => {
  // A beginner's document is malformed most of the time it is being edited. Refusing to open it, or
  // losing bytes while it is broken, is a product failure.
  const BROKEN: Record<string, string> = {
    'unclosed element': '<a><b>text',
    'mismatched end tag': '<a><b></c></a>',
    'stray end tag': '</orphan><a/>',
    'stray less-than': '<a>3 < 4</a>',
    'unquoted attribute': '<a id=1/>',
    'valueless attribute': '<a checked/>',
    'unterminated comment': '<a><!-- never ends',
    'no root element': '<!-- just a comment -->',
    'two root elements': '<a/><b/>',
    'unterminated attribute': '<a id="oops>',
    empty: '',
    'text only': 'not xml at all',
  };

  for (const [name, xml] of Object.entries(BROKEN)) {
    it(`preserves ${name}`, () => {
      expect(XmlDocument.parse(xml).serialize()).toBe(xml);
    });
  }

  it('reports errors rather than throwing', () => {
    const doc = XmlDocument.parse('<a><b></c></a>');
    expect(doc.parseErrors.length).toBeGreaterThan(0);
    expect(doc.parseErrors.some((e) => e.code === 'mismatched-end-tag')).toBe(true);
  });
});

describe('property: arbitrary documents round-trip', () => {
  const name = fc.constantFrom('a', 'b', 'item', 'p', 'ns:x');
  const text = fc.stringMatching(/^[a-zA-Z0-9 \n\t.,-]*$/);

  const xmlNode: fc.Arbitrary<string> = fc.letrec<{ node: string }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small' },
      text,
      fc.constant('<!-- c -->'),
      fc.constant('<![CDATA[x]]>'),
      fc
        .tuple(name, fc.array(tie('node'), { maxLength: 3 }))
        .map(([n, kids]) => (kids.length === 0 ? `<${n}/>` : `<${n}>${kids.join('')}</${n}>`)),
    ),
  })).node;

  it('holds for generated trees', () => {
    fc.assert(
      fc.property(xmlNode, (inner) => {
        const xml = `<root xmlns:ns="urn:ns">${inner}</root>`;
        expect(XmlDocument.parse(xml).serialize()).toBe(xml);
      }),
      { numRuns: 500 },
    );
  });
});
