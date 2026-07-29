import { describe, expect, it } from 'vitest';
import { sampleFor, translatePattern } from '../src/xsdRegex.js';

function accepts(pattern: string, value: string): boolean {
  const translated = translatePattern(pattern);
  if (translated.regex === null) throw new Error(translated.error ?? 'no regex');
  return translated.regex.test(value);
}

describe('anchoring', () => {
  it('requires the whole value to match, unlike JavaScript', () => {
    // The single most consequential difference: `new RegExp('a').test('xax')` is true.
    expect(accepts('a', 'a')).toBe(true);
    expect(accepts('a', 'xax')).toBe(false);
    expect(accepts('[0-9]{3}', '1234')).toBe(false);
  });

  it('treats ^ and $ as ordinary characters', () => {
    // XSD has no anchors at all, so both are literals; `\^` is a valid escape and `$` is bare.
    expect(accepts('\\^a$', '^a$')).toBe(true);
    expect(accepts('a$', 'a')).toBe(false);
  });
});

describe('character classes', () => {
  it('handles ranges and negation', () => {
    expect(accepts('[a-z]+', 'abc')).toBe(true);
    expect(accepts('[a-z]+', 'aBc')).toBe(false);
    expect(accepts('[^0-9]+', 'abc')).toBe(true);
    expect(accepts('[^0-9]+', 'ab1')).toBe(false);
  });

  it('subtracts one class from another — syntax JavaScript does not have', () => {
    expect(accepts('[a-z-[aeiou]]+', 'bcd')).toBe(true);
    expect(accepts('[a-z-[aeiou]]+', 'bad')).toBe(false);
  });

  it('handles nested subtraction', () => {
    expect(accepts('[a-z-[b-d-[c]]]+', 'ac')).toBe(true);
    expect(accepts('[a-z-[b-d-[c]]]+', 'ab')).toBe(false);
  });

  it('keeps a literal hyphen distinct from a subtraction', () => {
    expect(accepts('[a-]+', 'a-')).toBe(true);
  });
});

describe('the XSD-only escapes', () => {
  it('matches XML name characters with \\i and \\c', () => {
    expect(accepts('\\i\\c*', 'element-name')).toBe(true);
    expect(accepts('\\i\\c*', '1bad')).toBe(false); // a name cannot start with a digit
    expect(accepts('\\i\\c*', '_ok.2')).toBe(true);
  });

  it('uses XSD whitespace for \\s, not JavaScript s', () => {
    expect(accepts('\\s', ' ')).toBe(true);
    expect(accepts('\\s', '\t')).toBe(true);
    // U+00A0 no-break space is whitespace to JavaScript and not to XSD.
    expect(accepts('\\s', ' ')).toBe(false);
  });

  it('uses the Unicode definition of \\w, so accented letters pass', () => {
    // JavaScript's \w would reject this, silently making the schema stricter than it says.
    expect(accepts('\\w+', 'Ångström')).toBe(true);
    expect(accepts('\\w+', 'a b')).toBe(false);
  });

  it('matches Unicode digits with \\d', () => {
    expect(accepts('\\d+', '123')).toBe(true);
    expect(accepts('\\d+', '١٢٣')).toBe(true); // Arabic-Indic digits are \p{Nd}
  });
});

describe('quantifiers and groups', () => {
  it('supports the bounded forms', () => {
    expect(accepts('[A-Z]{2}\\d{6}', 'AB123456')).toBe(true);
    expect(accepts('[A-Z]{2}\\d{6}', 'AB12345')).toBe(false);
    expect(accepts('a{2,4}', 'aaa')).toBe(true);
    expect(accepts('a{2,4}', 'a')).toBe(false);
    expect(accepts('a{2,}', 'aaaaa')).toBe(true);
  });

  it('applies a quantifier to a group as a unit', () => {
    expect(accepts('(ab)+', 'abab')).toBe(true);
    expect(accepts('(ab)+', 'aba')).toBe(false);
  });

  it('supports alternation', () => {
    expect(accepts('cat|dog', 'dog')).toBe(true);
    expect(accepts('cat|dog', 'cog')).toBe(false);
  });
});

describe('the dot', () => {
  it('excludes only newline and carriage return', () => {
    expect(accepts('.', 'x')).toBe(true);
    expect(accepts('.', '\n')).toBe(false);
    // JavaScript's `.` also excludes U+2028; XSD's does not.
    expect(accepts('.', ' ')).toBe(true);
  });
});

describe('rejected input', () => {
  it('reports a syntax error rather than throwing', () => {
    const result = translatePattern('[a-z');
    expect(result.regex).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it('rejects JavaScript-only syntax that XSD does not have', () => {
    // Backreferences would silently mean something else if passed through.
    expect(translatePattern('(a)\\1').error).not.toBeNull();
  });
});

describe('sampleFor', () => {
  it('produces a concrete example of the pattern', () => {
    expect(sampleFor('[A-Z]{2}\\d{6}')).toBe('AA000000');
    expect(sampleFor('\\d{3}-\\d{4}')).toBe('000-0000');
  });

  it('picks a memorable representative rather than the first codepoint', () => {
    expect(sampleFor('[a-z]')).toBe('a');
    expect(sampleFor('[0-9]')).toBe('0');
  });

  it('honours a subtraction when choosing', () => {
    expect(sampleFor('[a-z-[ab]]')).toBe('c');
  });

  it('takes the first workable branch of an alternation', () => {
    expect(sampleFor('yes|no')).toBe('yes');
  });

  it('caps runaway repetition so the example stays readable', () => {
    expect(sampleFor('a{40}')?.length).toBeLessThanOrEqual(12);
  });

  it('returns null for a pattern it cannot parse', () => {
    expect(sampleFor('[unclosed')).toBeNull();
  });
});
