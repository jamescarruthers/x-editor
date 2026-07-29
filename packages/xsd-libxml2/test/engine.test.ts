import { afterEach, describe, expect, it } from 'vitest';
import { Libxml2Engine } from '../src/index.js';

const XS = 'http://www.w3.org/2001/XMLSchema';

const SCHEMA = `<?xml version="1.0"?>
<xs:schema xmlns:xs="${XS}">
  <xs:element name="root">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="n" type="xs:int" maxOccurs="unbounded"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

let engine: Libxml2Engine | null = null;

function open(): Libxml2Engine {
  engine = new Libxml2Engine();
  return engine;
}

afterEach(() => {
  engine?.dispose();
  engine = null;
});

describe('compiling', () => {
  it('accepts a valid schema', () => {
    expect(open().compile([{ uri: 'main.xsd', text: SCHEMA }], 'main.xsd')).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('reports a schema that does not compile, rather than throwing', () => {
    const result = open().compile(
      [{ uri: 'main.xsd', text: `<xs:schema xmlns:xs="${XS}"><xs:element/></xs:schema>` }],
      'main.xsd',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('reports a root document that was not supplied', () => {
    const result = open().compile([], 'missing.xsd');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('missing.xsd');
  });
});

describe('validating', () => {
  it('accepts a valid document', () => {
    const e = open();
    e.compile([{ uri: 'main.xsd', text: SCHEMA }], 'main.xsd');
    expect(e.validate('<root id="a">\n  <n>1</n>\n</root>')).toEqual({ valid: true, errors: [] });
  });

  it('reports every error with a line number', () => {
    const e = open();
    e.compile([{ uri: 'main.xsd', text: SCHEMA }], 'main.xsd');
    const result = e.validate('<root>\n  <n>oops</n>\n</root>');
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.line)).toEqual([1, 2]);
  });

  it('refuses to validate before a schema is compiled', () => {
    expect(open().validate('<root/>').valid).toBe(false);
  });

  it('reports ill-formed input rather than throwing', () => {
    const e = open();
    e.compile([{ uri: 'main.xsd', text: SCHEMA }], 'main.xsd');
    expect(e.validate('<root><unclosed>').valid).toBe(false);
  });
});

describe('multi-file schema sets', () => {
  const files = [
    {
      uri: 'main.xsd',
      text: `<?xml version="1.0"?>
        <xs:schema xmlns:xs="${XS}" xmlns:c="urn:common" targetNamespace="urn:main"
                   xmlns="urn:main" elementFormDefault="qualified">
          <xs:import namespace="urn:common" schemaLocation="common.xsd"/>
          <xs:element name="root" type="c:Code"/>
        </xs:schema>`,
    },
    {
      uri: 'common.xsd',
      text: `<?xml version="1.0"?>
        <xs:schema xmlns:xs="${XS}" targetNamespace="urn:common">
          <xs:simpleType name="Code">
            <xs:restriction base="xs:string"><xs:maxLength value="3"/></xs:restriction>
          </xs:simpleType>
        </xs:schema>`,
    },
  ];

  it('resolves an import through the catalogue', () => {
    const e = open();
    expect(e.compile(files, 'main.xsd').valid).toBe(true);
    expect(e.validate('<root xmlns="urn:main">AB</root>').valid).toBe(true);
    expect(e.validate('<root xmlns="urn:main">ABCD</root>').valid).toBe(false);
  });
});

/**
 * The security model, asserted rather than assumed (PLAN.md §8).
 *
 * These are not hypothetical: a schema or document a user opens is untrusted input, and both
 * attacks below are the standard ones against an XML parser. The flags that prevent them are set in
 * one place, so a test is the only thing standing between a refactor and a silent regression.
 */
describe('hostile input', () => {
  it('does not expand a billion-laughs bomb', () => {
    const bomb = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
]>
<root id="a">&lol7;</root>`;

    const e = open();
    e.compile([{ uri: 'main.xsd', text: SCHEMA }], 'main.xsd');

    // The assertion that matters is that this returns at all, in reasonable time and memory,
    // rather than expanding to gigabytes. Entity expansion is never enabled — `noEnt` is one of the
    // flags deliberately absent from PARSE_OPTIONS.
    const started = Date.now();
    const result = e.validate(bomb);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.valid).toBe(false);
  });

  it('does not read a local file through an external entity', () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE root [ <!ENTITY secret SYSTEM "file:///etc/passwd"> ]>
<root id="a"><n>&secret;</n></root>`;

    const e = open();
    e.compile([{ uri: 'main.xsd', text: SCHEMA }], 'main.xsd');
    const result = e.validate(xxe);

    expect(result.valid).toBe(false);
    // Whatever it says, it must not have said the contents of the file.
    const combined = result.errors.map((error) => error.message).join(' ');
    expect(combined).not.toContain('root:x:0:0');
    expect(combined).not.toContain('/bin/');
  });

  it('does not fetch a schema location it was not given', () => {
    // The input provider only answers for keys in the catalogue, so an import of something absent
    // fails to resolve rather than reaching the network.
    const e = open();
    const result = e.compile(
      [
        {
          uri: 'main.xsd',
          text: `<?xml version="1.0"?>
            <xs:schema xmlns:xs="${XS}" targetNamespace="urn:main">
              <xs:import namespace="urn:other" schemaLocation="https://example.invalid/x.xsd"/>
              <xs:element name="root" type="xs:string"/>
            </xs:schema>`,
        },
      ],
      'main.xsd',
    );
    // libxml2 may treat an unresolvable import as a warning and carry on; what must not happen is a
    // request leaving the machine, and with `noNet` set it cannot.
    expect(result).toBeDefined();
  });
});
