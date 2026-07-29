import { describe, expect, it } from 'vitest';
import { assembleSchema, catalogueFrom } from '../src/assemble.js';
import { SymbolTable } from '../src/symbols.js';
import { SimpleTypeCompiler, validateSimpleValue, type CompiledSimpleType } from '../src/simpleTypes.js';
import { XSD_NS, type Origin } from '../src/ast.js';
import { applyWhiteSpace, compareValues, parseValue } from '../src/builtins.js';

const ORIGIN: Origin = { documentUri: 'main.xsd', node: 0 as never };

function compiler(body = ''): SimpleTypeCompiler {
  const set = assembleSchema(
    'main.xsd',
    catalogueFrom({
      'main.xsd': `<xs:schema xmlns:xs="${XSD_NS}" targetNamespace="urn:t" xmlns="urn:t">${body}</xs:schema>`,
    }),
  );
  return new SimpleTypeCompiler(new SymbolTable(set));
}

function builtIn(localName: string): CompiledSimpleType {
  return compiler().compileByName({ namespaceUri: XSD_NS, localName }, ORIGIN);
}

function userType(body: string, localName: string): CompiledSimpleType {
  return compiler(body).compileByName({ namespaceUri: 'urn:t', localName }, ORIGIN);
}

const problems = (type: CompiledSimpleType, value: string): string[] =>
  validateSimpleValue(type, value).map((p) => p.code);

describe('built-in types', () => {
  it('accepts and rejects by lexical space', () => {
    expect(problems(builtIn('int'), '42')).toEqual([]);
    expect(problems(builtIn('int'), 'forty-two')).toHaveLength(1);
    expect(problems(builtIn('boolean'), 'true')).toEqual([]);
    expect(problems(builtIn('boolean'), 'yes')).toHaveLength(1);
    expect(problems(builtIn('date'), '2026-07-29')).toEqual([]);
  });

  it('rejects a date that has the right shape but does not exist', () => {
    // Not expressible as a regex, and the kind of thing a beginner types.
    expect(problems(builtIn('date'), '2026-02-30')).toHaveLength(1);
    expect(problems(builtIn('date'), '2024-02-29')).toEqual([]); // 2024 is a leap year
    expect(problems(builtIn('date'), '2026-02-29')).toHaveLength(1);
  });

  it('inherits bounds down the numeric chain', () => {
    // xs:byte gets its bounds from itself, fractionDigits from xs:integer, and its lexical space
    // from xs:decimal. All three have to be in force at once.
    expect(problems(builtIn('byte'), '127')).toEqual([]);
    expect(problems(builtIn('byte'), '128')).toEqual(['cvc-range-valid']);
    expect(problems(builtIn('byte'), '-129')).toEqual(['cvc-range-valid']);
    expect(problems(builtIn('byte'), '1.5')).toEqual(['cvc-fractionDigits-valid']);
  });

  it('enforces the unsigned bounds', () => {
    expect(problems(builtIn('unsignedByte'), '255')).toEqual([]);
    expect(problems(builtIn('unsignedByte'), '256')).toEqual(['cvc-range-valid']);
    expect(problems(builtIn('unsignedByte'), '-1')).toEqual(['cvc-range-valid']);
  });

  it('compares large integers exactly rather than as floats', () => {
    // 9223372036854775807 and ...806 are the same IEEE double. Comparing as numbers would let the
    // out-of-range value through, which is exactly the sort of silent drift the plan warns about.
    expect(problems(builtIn('long'), '9223372036854775807')).toEqual([]);
    expect(problems(builtIn('long'), '9223372036854775808')).toEqual(['cvc-range-valid']);
  });

  it('applies the whiteSpace facet before checking, so a padded int is still an int', () => {
    expect(problems(builtIn('int'), '  42  ')).toEqual([]);
    expect(problems(builtIn('string'), '  spaces kept  ')).toEqual([]);
  });

  it('checks the built-in patterns for the name types', () => {
    expect(problems(builtIn('NCName'), 'shipDate')).toEqual([]);
    expect(problems(builtIn('NCName'), 'ns:shipDate')).toEqual(['cvc-pattern-valid']);
    expect(problems(builtIn('Name'), 'ns:shipDate')).toEqual([]);
    expect(problems(builtIn('language'), 'en-GB')).toEqual([]);
    expect(problems(builtIn('language'), 'english!')).toEqual(['cvc-pattern-valid']);
  });

  it('counts binary length in octets, not characters', () => {
    const type = userType(
      `<xs:simpleType name="Hash">
         <xs:restriction base="xs:hexBinary"><xs:length value="4"/></xs:restriction>
       </xs:simpleType>`,
      'Hash',
    );
    expect(problems(type, 'deadbeef')).toEqual([]); // 8 hex digits = 4 octets
    expect(problems(type, 'dead')).toEqual(['cvc-length-valid']);
  });
});

describe('facet inheritance', () => {
  it('keeps the base type\'s constraints when a restriction adds its own', () => {
    const type = userType(
      `<xs:simpleType name="Percent">
         <xs:restriction base="xs:int"><xs:maxInclusive value="100"/></xs:restriction>
       </xs:simpleType>`,
      'Percent',
    );
    expect(problems(type, '50')).toEqual([]);
    expect(problems(type, '101')).toEqual(['cvc-range-valid']);
    // The inherited fractionDigits=0 still applies, two derivation steps up.
    expect(problems(type, '1.5')).toEqual(['cvc-fractionDigits-valid']);
  });

  it('takes the stricter of two length facets down a chain', () => {
    const type = userType(
      `<xs:simpleType name="Outer">
         <xs:restriction base="Inner"><xs:maxLength value="3"/></xs:restriction>
       </xs:simpleType>
       <xs:simpleType name="Inner">
         <xs:restriction base="xs:string"><xs:maxLength value="10"/></xs:restriction>
       </xs:simpleType>`,
      'Outer',
    );
    expect(problems(type, 'abc')).toEqual([]);
    expect(problems(type, 'abcd')).toEqual(['cvc-maxLength-valid']);
  });

  it('ANDs patterns across derivation steps and ORs them within one', () => {
    const type = userType(
      `<xs:simpleType name="Outer">
         <xs:restriction base="Inner">
           <xs:pattern value="[A-Z]+"/>
           <xs:pattern value="[0-9]+"/>
         </xs:restriction>
       </xs:simpleType>
       <xs:simpleType name="Inner">
         <xs:restriction base="xs:string"><xs:pattern value=".{3}"/></xs:restriction>
       </xs:simpleType>`,
      'Outer',
    );
    expect(problems(type, 'ABC')).toEqual([]); // matches [A-Z]+ and .{3}
    expect(problems(type, '123')).toEqual([]); // matches [0-9]+ and .{3}
    expect(problems(type, 'ABCD')).toEqual(['cvc-pattern-valid']); // fails .{3}
    expect(problems(type, 'Ab1')).toEqual(['cvc-pattern-valid']); // fails both alternatives
  });

  it('reports a facet that tries to loosen a fixed one', () => {
    const c = compiler(
      `<xs:simpleType name="Inner">
         <xs:restriction base="xs:string"><xs:maxLength value="3" fixed="true"/></xs:restriction>
       </xs:simpleType>
       <xs:simpleType name="Outer">
         <xs:restriction base="Inner"><xs:maxLength value="10"/></xs:restriction>
       </xs:simpleType>`,
    );
    c.compileByName({ namespaceUri: 'urn:t', localName: 'Outer' }, ORIGIN);
    expect(c.diagnostics.map((d) => d.code)).toContain('fixed-facet-overridden');
  });

  it('survives a type defined in terms of itself', () => {
    const c = compiler(
      `<xs:simpleType name="Loop"><xs:restriction base="Loop"/></xs:simpleType>`,
    );
    const type = c.compileByName({ namespaceUri: 'urn:t', localName: 'Loop' }, ORIGIN);
    expect(c.diagnostics.map((d) => d.code)).toContain('circular-type');
    expect(problems(type, 'anything')).toEqual([]);
  });
});

describe('enumerations', () => {
  const type = userType(
    `<xs:simpleType name="Status">
       <xs:restriction base="xs:string">
         <xs:enumeration value="draft"/>
         <xs:enumeration value="sent"/>
       </xs:restriction>
     </xs:simpleType>`,
    'Status',
  );

  it('accepts a listed value and names the alternatives when it does not', () => {
    expect(problems(type, 'draft')).toEqual([]);
    const [problem] = validateSimpleValue(type, 'posted');
    expect(problem?.message).toContain('draft, sent');
  });
});

describe('lists', () => {
  const type = userType(
    `<xs:simpleType name="Sizes">
       <xs:list itemType="xs:int"/>
     </xs:simpleType>`,
    'Sizes',
  );

  it('validates every item', () => {
    expect(problems(type, '1 2 3')).toEqual([]);
    expect(validateSimpleValue(type, '1 two 3')[0]?.message).toContain('In "two"');
  });

  it('counts length facets in items rather than characters', () => {
    const bounded = userType(
      `<xs:simpleType name="Pair">
         <xs:restriction base="Sizes"><xs:length value="2"/></xs:restriction>
       </xs:simpleType>
       <xs:simpleType name="Sizes"><xs:list itemType="xs:int"/></xs:simpleType>`,
      'Pair',
    );
    expect(problems(bounded, '10 20')).toEqual([]);
    expect(problems(bounded, '10 20 30')).toEqual(['cvc-length-valid']);
  });

  it('handles the built-in list types', () => {
    expect(problems(builtIn('NMTOKENS'), 'a b c')).toEqual([]);
  });
});

describe('unions', () => {
  const type = userType(
    `<xs:simpleType name="IntOrBlank">
       <xs:union memberTypes="xs:int">
         <xs:simpleType>
           <xs:restriction base="xs:string"><xs:enumeration value="n/a"/></xs:restriction>
         </xs:simpleType>
       </xs:union>
     </xs:simpleType>`,
    'IntOrBlank',
  );

  it('accepts a value matching any member', () => {
    expect(problems(type, '42')).toEqual([]);
    expect(problems(type, 'n/a')).toEqual([]);
  });

  it('rejects a value matching none, with one message rather than one per member', () => {
    expect(problems(type, 'maybe')).toEqual(['cvc-datatype-valid.1.2.3']);
  });
});

describe('value comparison', () => {
  it('treats trailing zeros as the same decimal value', () => {
    const a = parseValue('decimal', '1.0')!;
    const b = parseValue('decimal', '1.00')!;
    expect(compareValues(a, b)).toBe(0);
  });

  it('orders decimals by value, not by string', () => {
    expect(compareValues(parseValue('decimal', '10')!, parseValue('decimal', '9')!)).toBe(1);
  });

  it('reports durations with no defined order as incomparable', () => {
    // One month is not 30 days, and XSD does not pretend otherwise.
    const month = parseValue('duration', 'P1M')!;
    const days = parseValue('duration', 'P30D')!;
    expect(compareValues(month, days)).toBeNull();
  });

  it('orders dates', () => {
    expect(compareValues(parseValue('date', '2026-01-01')!, parseValue('date', '2026-07-29')!)).toBe(
      -1,
    );
  });
});

describe('applyWhiteSpace', () => {
  it('implements the three modes', () => {
    expect(applyWhiteSpace(' a\tb ', 'preserve')).toBe(' a\tb ');
    expect(applyWhiteSpace(' a\tb ', 'replace')).toBe(' a b ');
    expect(applyWhiteSpace(' a\t\t b ', 'collapse')).toBe('a b');
  });
});
