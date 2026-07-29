import { describe, expect, it } from 'vitest';
import { checkWellFormed } from '../src/wellformed.js';
import { XmlDocument } from '../src/document.js';

/**
 * Differential testing between our recovering tokenizer and saxes.
 *
 * The two have different jobs — ours owns byte spans and keeps going through malformed input, saxes
 * decides validity — so they are checked against each other rather than assumed to agree. The
 * dangerous direction is a document saxes rejects that we report as clean: that is a tokenizer bug
 * masquerading as a valid file.
 */

const WELL_FORMED = [
  '<a/>',
  '<?xml version="1.0"?><a/>',
  '<a><b/><c>text</c></a>',
  '<a xmlns:n="urn:n"><n:b/></a>',
  '<a><![CDATA[<not markup>]]></a>',
  '<!-- lead --><a/><!-- trail -->',
  '<a>&lt;&amp;&gt;</a>',
  '<a attr="v" other=\'w\'/>',
  '<p>mixed <b>content</b> here</p>',
];

const MALFORMED = [
  '<a><b></a>',
  '</a>',
  '<a>',
  '<a></b>',
  '<a attr=unquoted/>',
  '<a><a></a>',
  '',
  '<a/><b/>',
];

describe('well-formedness oracle', () => {
  for (const xml of WELL_FORMED) {
    it(`accepts ${JSON.stringify(xml)}`, () => {
      expect(checkWellFormed(xml)).toEqual([]);
    });
  }

  for (const xml of MALFORMED) {
    it(`rejects ${JSON.stringify(xml)}`, () => {
      expect(checkWellFormed(xml).length).toBeGreaterThan(0);
    });
  }
});

describe('tokenizer agrees with the oracle on validity', () => {
  it('reports no structural errors for well-formed input', () => {
    for (const xml of WELL_FORMED) {
      const doc = XmlDocument.parse(xml);
      expect(doc.parseErrors, `unexpected errors for ${xml}`).toEqual([]);
    }
  });

  it('reports at least one error wherever the oracle does', () => {
    // The direction that matters: never call a broken document clean.
    for (const xml of MALFORMED) {
      const doc = XmlDocument.parse(xml);
      expect(doc.parseErrors.length, `missed errors in ${JSON.stringify(xml)}`).toBeGreaterThan(0);
    }
  });

  it('round-trips every case regardless of validity', () => {
    for (const xml of [...WELL_FORMED, ...MALFORMED]) {
      expect(XmlDocument.parse(xml).serialize()).toBe(xml);
    }
  });
});
