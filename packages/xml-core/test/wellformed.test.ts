import { describe, expect, it } from 'vitest';
import { checkWellFormed } from '../src/wellformed.js';
import { isValidName } from '../src/tokenizer.js';
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

describe('isValidName', () => {
  it('accepts the names XML accepts', () => {
    for (const name of ['a', 'A', '_x', 'ns:local', 'x-1', 'a.b', 'é', '_', 'a1', ':leading']) {
      expect(isValidName(name), name).toBe(true);
    }
  });

  it('rejects the names that would not round-trip', () => {
    // Each of these, written into a start tag, produces something the tokenizer reads as a
    // different document — which is why anything letting a user type a name has to ask first.
    for (const name of ['', ' ', 'a b', '1a', '-a', '.a', 'a>b', 'a<b', 'a/b', 'a"b', "a'b"]) {
      expect(isValidName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it('agrees with the parser about every name it accepts', () => {
    // The property that matters: a name this predicate allows must survive a parse/serialize round
    // trip as one element with that exact name. A disagreement here is a corrupted document.
    for (const name of ['a', '_x', 'x-1', 'a.b', 'é', 'a1']) {
      const document = XmlDocument.parse(`<${name}/>`);
      expect(document.parseErrors, name).toEqual([]);
      expect(document.serialize(), name).toBe(`<${name}/>`);
    }
  });

  it('is about names, not namespaces — a colon is legal and binding it is a separate question', () => {
    // `isValidName` answers the well-formedness question only. Whether `ns` means anything is a
    // namespace question with a different answer, and callers that let a user type a prefixed name
    // have to ask both — writing an unbound prefix produces a document that no longer parses.
    expect(isValidName('ns:local')).toBe(true);

    const undeclared = XmlDocument.parse('<ns:local/>');
    expect(undeclared.parseErrors.map((error) => error.code)).toContain('undeclared-prefix');

    const declared = XmlDocument.parse('<ns:local xmlns:ns="urn:x"/>');
    expect(declared.parseErrors).toEqual([]);
    expect(declared.serialize()).toBe('<ns:local xmlns:ns="urn:x"/>');
  });
});
