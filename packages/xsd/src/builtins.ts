/**
 * The built-in simple types, their value spaces, and their plain-English descriptions.
 *
 * Three jobs in one table, because they are the same knowledge:
 *
 * 1. **The derivation hierarchy.** `xs:int` restricts `xs:long` restricts `xs:integer` restricts
 *    `xs:decimal` — facets inherit down that chain, so it has to be modelled rather than assumed.
 * 2. **Lexical and value spaces.** Facets like `minInclusive` compare *values*, not strings: on
 *    `xs:decimal`, `"1.0"` and `"1.00"` are the same value, and `"10"` is not less than `"9"`.
 *    Comparing decimals as JavaScript numbers loses precision on the long identifiers that
 *    financial and healthcare schemas are full of, so they are compared as scaled integers.
 * 3. **The descriptions.** `docs/schema-engine.md` §3.6 requires that `describe()` *always* return a
 *    sentence, because most schemas a beginner meets carry no `xs:documentation` at all. These are
 *    the fallback's raw material, hand-written once here rather than generated from the type name.
 */

import { XSD_NS, type XsdQName } from './ast.js';

export type Variety = 'atomic' | 'list' | 'union';

export type PrimitiveKind =
  | 'string'
  | 'boolean'
  | 'decimal'
  | 'float'
  | 'double'
  | 'duration'
  | 'dateTime'
  | 'time'
  | 'date'
  | 'gYearMonth'
  | 'gYear'
  | 'gMonthDay'
  | 'gDay'
  | 'gMonth'
  | 'hexBinary'
  | 'base64Binary'
  | 'anyURI'
  | 'QName'
  | 'NOTATION';

export type WhiteSpace = 'preserve' | 'replace' | 'collapse';

/** Facets a built-in fixes on itself — the bounds that make `xs:byte` a byte. */
export interface BuiltInFacets {
  readonly minInclusive?: string;
  readonly maxInclusive?: string;
  readonly fractionDigits?: number;
  readonly pattern?: string;
}

export interface BuiltInType {
  readonly localName: string;
  /** Local name of the base type. Null only for `anySimpleType`. */
  readonly base: string | null;
  readonly variety: Variety;
  readonly primitive: PrimitiveKind | null;
  readonly whiteSpace: WhiteSpace;
  /** For the three built-in list types. */
  readonly itemType?: string;
  readonly facets?: BuiltInFacets;
  /** A noun phrase completing "This holds …". */
  readonly description: string;
  /** True for types added in XSD 1.1. */
  readonly since11?: boolean;
}

const T = (
  localName: string,
  base: string | null,
  primitive: PrimitiveKind | null,
  whiteSpace: WhiteSpace,
  description: string,
  extra: Partial<BuiltInType> = {},
): BuiltInType => ({
  localName,
  base,
  variety: 'atomic',
  primitive,
  whiteSpace,
  description,
  ...extra,
});

const LIST = (localName: string, itemType: string, description: string): BuiltInType => ({
  localName,
  base: 'anySimpleType',
  variety: 'list',
  primitive: null,
  whiteSpace: 'collapse',
  itemType,
  description,
});

export const BUILT_IN_TYPES: readonly BuiltInType[] = [
  T('anySimpleType', null, null, 'preserve', 'any value'),
  T('anyAtomicType', 'anySimpleType', null, 'preserve', 'any single value', { since11: true }),

  // --- the 19 primitives ---
  T('string', 'anyAtomicType', 'string', 'preserve', 'text'),
  T('boolean', 'anyAtomicType', 'boolean', 'collapse', 'true or false'),
  T('decimal', 'anyAtomicType', 'decimal', 'collapse', 'a number, which may have decimal places'),
  T('float', 'anyAtomicType', 'float', 'collapse', 'a number (single precision)'),
  T('double', 'anyAtomicType', 'double', 'collapse', 'a number (double precision)'),
  T('duration', 'anyAtomicType', 'duration', 'collapse', 'a length of time, like P1Y2M or PT30M'),
  T('dateTime', 'anyAtomicType', 'dateTime', 'collapse', 'a date and a time'),
  T('time', 'anyAtomicType', 'time', 'collapse', 'a time of day'),
  T('date', 'anyAtomicType', 'date', 'collapse', 'a date'),
  T('gYearMonth', 'anyAtomicType', 'gYearMonth', 'collapse', 'a year and month, like 2026-07'),
  T('gYear', 'anyAtomicType', 'gYear', 'collapse', 'a year'),
  T('gMonthDay', 'anyAtomicType', 'gMonthDay', 'collapse', 'a day of a month, like --07-29'),
  T('gDay', 'anyAtomicType', 'gDay', 'collapse', 'a day of the month, like ---29'),
  T('gMonth', 'anyAtomicType', 'gMonth', 'collapse', 'a month, like --07'),
  T('hexBinary', 'anyAtomicType', 'hexBinary', 'collapse', 'binary data written as hex digits'),
  T('base64Binary', 'anyAtomicType', 'base64Binary', 'collapse', 'binary data written as base64'),
  T('anyURI', 'anyAtomicType', 'anyURI', 'collapse', 'a URL or other identifier'),
  T('QName', 'anyAtomicType', 'QName', 'collapse', 'an XML name, optionally with a namespace prefix'),
  T('NOTATION', 'anyAtomicType', 'NOTATION', 'collapse', 'the name of a declared notation'),

  // --- string family ---
  T('normalizedString', 'string', 'string', 'replace', 'text on a single line'),
  T('token', 'normalizedString', 'string', 'collapse', 'text with no leading, trailing or repeated spaces'),
  T('language', 'token', 'string', 'collapse', 'a language code, like en-GB', {
    facets: { pattern: '[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*' },
  }),
  T('Name', 'token', 'string', 'collapse', 'an XML name', { facets: { pattern: '\\i\\c*' } }),
  T('NCName', 'Name', 'string', 'collapse', 'an XML name with no colon in it', {
    facets: { pattern: '[\\i-[:]][\\c-[:]]*' },
  }),
  T('ID', 'NCName', 'string', 'collapse', 'an identifier, unique within the document'),
  T('IDREF', 'NCName', 'string', 'collapse', 'a reference to an identifier elsewhere in the document'),
  T('ENTITY', 'NCName', 'string', 'collapse', 'the name of a declared entity'),
  T('NMTOKEN', 'token', 'string', 'collapse', 'a name token', { facets: { pattern: '\\c+' } }),
  LIST('IDREFS', 'IDREF', 'a space-separated list of references to identifiers'),
  LIST('ENTITIES', 'ENTITY', 'a space-separated list of entity names'),
  LIST('NMTOKENS', 'NMTOKEN', 'a space-separated list of name tokens'),

  // --- numeric family ---
  T('integer', 'decimal', 'decimal', 'collapse', 'a whole number', { facets: { fractionDigits: 0 } }),
  T('nonPositiveInteger', 'integer', 'decimal', 'collapse', 'a whole number, zero or below', {
    facets: { maxInclusive: '0' },
  }),
  T('negativeInteger', 'nonPositiveInteger', 'decimal', 'collapse', 'a whole number below zero', {
    facets: { maxInclusive: '-1' },
  }),
  T('long', 'integer', 'decimal', 'collapse', 'a whole number, up to about 9 quintillion', {
    facets: { minInclusive: '-9223372036854775808', maxInclusive: '9223372036854775807' },
  }),
  T('int', 'long', 'decimal', 'collapse', 'a whole number, up to about 2 billion', {
    facets: { minInclusive: '-2147483648', maxInclusive: '2147483647' },
  }),
  T('short', 'int', 'decimal', 'collapse', 'a whole number between -32768 and 32767', {
    facets: { minInclusive: '-32768', maxInclusive: '32767' },
  }),
  T('byte', 'short', 'decimal', 'collapse', 'a whole number between -128 and 127', {
    facets: { minInclusive: '-128', maxInclusive: '127' },
  }),
  T('nonNegativeInteger', 'integer', 'decimal', 'collapse', 'a whole number, zero or above', {
    facets: { minInclusive: '0' },
  }),
  T('unsignedLong', 'nonNegativeInteger', 'decimal', 'collapse', 'a whole number, zero or above', {
    facets: { maxInclusive: '18446744073709551615' },
  }),
  T('unsignedInt', 'unsignedLong', 'decimal', 'collapse', 'a whole number between 0 and 4294967295', {
    facets: { maxInclusive: '4294967295' },
  }),
  T('unsignedShort', 'unsignedInt', 'decimal', 'collapse', 'a whole number between 0 and 65535', {
    facets: { maxInclusive: '65535' },
  }),
  T('unsignedByte', 'unsignedShort', 'decimal', 'collapse', 'a whole number between 0 and 255', {
    facets: { maxInclusive: '255' },
  }),
  T('positiveInteger', 'nonNegativeInteger', 'decimal', 'collapse', 'a whole number above zero', {
    facets: { minInclusive: '1' },
  }),

  // --- XSD 1.1 additions ---
  T('dateTimeStamp', 'dateTime', 'dateTime', 'collapse', 'a date and time, with a required timezone', {
    since11: true,
  }),
  T('yearMonthDuration', 'duration', 'duration', 'collapse', 'a length of time in years and months', {
    since11: true,
  }),
  T('dayTimeDuration', 'duration', 'duration', 'collapse', 'a length of time in days and hours', {
    since11: true,
  }),
];

const BY_NAME = new Map(BUILT_IN_TYPES.map((type) => [type.localName, type]));

export function builtInType(name: XsdQName): BuiltInType | null {
  if (name.namespaceUri !== XSD_NS) return null;
  return BY_NAME.get(name.localName) ?? null;
}

export function isBuiltInName(name: XsdQName): boolean {
  return builtInType(name) !== null;
}

/** `xs:anyType` is a complex type, so it is not in the table above but is still referenced. */
export const ANY_TYPE: XsdQName = { namespaceUri: XSD_NS, localName: 'anyType' };
export const ANY_SIMPLE_TYPE: XsdQName = { namespaceUri: XSD_NS, localName: 'anySimpleType' };

export function builtInName(localName: string): XsdQName {
  return { namespaceUri: XSD_NS, localName };
}

/** The chain from a built-in up to `anySimpleType`, nearest first. */
export function builtInAncestry(type: BuiltInType): BuiltInType[] {
  const chain: BuiltInType[] = [];
  let cursor: BuiltInType | undefined = type;
  while (cursor !== undefined) {
    chain.push(cursor);
    cursor = cursor.base === null ? undefined : BY_NAME.get(cursor.base);
  }
  return chain;
}

// --- whitespace ---------------------------------------------------------

/**
 * The `whiteSpace` facet, applied before anything else looks at the value.
 *
 * This is not cosmetic: `xs:token` collapsing is why `" 42 "` is a valid `xs:int`, and skipping it
 * makes the engine reject documents every validator accepts.
 */
export function applyWhiteSpace(value: string, whiteSpace: WhiteSpace): string {
  if (whiteSpace === 'preserve') return value;
  const replaced = value.replace(/[\t\n\r]/g, ' ');
  if (whiteSpace === 'replace') return replaced;
  return replaced.trim().replace(/ {2,}/g, ' ');
}

// --- lexical spaces -----------------------------------------------------

const TIMEZONE = '(Z|[+-](0\\d|1[0-3]):[0-5]\\d|[+-]14:00)?';
const YEAR = '-?([1-9]\\d{3,}|0\\d{3})';
const MONTH = '(0[1-9]|1[0-2])';
const DAY = '(0[1-9]|[12]\\d|3[01])';
const TIME = '([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d+)?';

const LEXICAL: Readonly<Record<PrimitiveKind, RegExp>> = {
  string: /^[\s\S]*$/,
  boolean: /^(true|false|0|1)$/,
  decimal: /^[+-]?(\d+(\.\d*)?|\.\d+)$/,
  float: /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|INF|-INF|NaN)$/,
  double: /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|INF|-INF|NaN)$/,
  // At least one component, and T must be followed by at least one time component.
  duration: /^-?P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/,
  dateTime: new RegExp(`^${YEAR}-${MONTH}-${DAY}T(${TIME}|24:00:00(\\.0+)?)${TIMEZONE}$`),
  time: new RegExp(`^(${TIME}|24:00:00(\\.0+)?)${TIMEZONE}$`),
  date: new RegExp(`^${YEAR}-${MONTH}-${DAY}${TIMEZONE}$`),
  gYearMonth: new RegExp(`^${YEAR}-${MONTH}${TIMEZONE}$`),
  gYear: new RegExp(`^${YEAR}${TIMEZONE}$`),
  gMonthDay: new RegExp(`^--${MONTH}-${DAY}${TIMEZONE}$`),
  gDay: new RegExp(`^---${DAY}${TIMEZONE}$`),
  gMonth: new RegExp(`^--${MONTH}${TIMEZONE}$`),
  hexBinary: /^([0-9a-fA-F]{2})*$/,
  base64Binary: /^((([A-Za-z0-9+/] ?){4})*(([A-Za-z0-9+/] ?){3}[A-Za-z0-9+/]|([A-Za-z0-9+/] ?){2}[AEIMQUYcgkosw048] ?=|[A-Za-z0-9+/] ?[AQgw] ?= ?=))?$/,
  anyURI: /^[\s\S]*$/,
  QName: /^([^\s:]+:)?[^\s:]+$/,
  NOTATION: /^([^\s:]+:)?[^\s:]+$/,
};

export function matchesLexicalSpace(primitive: PrimitiveKind, value: string): boolean {
  const pattern = LEXICAL[primitive];
  if (!pattern.test(value)) return false;
  // Calendar validity is not expressible as a regex: 2026-02-30 matches the shape and is not a day.
  if (primitive === 'date' || primitive === 'dateTime' || primitive === 'gMonthDay') {
    return isRealDate(value, primitive);
  }
  return true;
}

function isRealDate(value: string, primitive: PrimitiveKind): boolean {
  const match =
    primitive === 'gMonthDay'
      ? /^--(\d{2})-(\d{2})/.exec(value)
      : /^(-?\d{4,})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return false;

  if (primitive === 'gMonthDay') {
    const month = Number(match[1]);
    const day = Number(match[2]);
    // No year, so February gets the benefit of the doubt at 29 days.
    return day <= daysInMonth(month, 2024);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return day <= daysInMonth(month, year);
}

function daysInMonth(month: number, year: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// --- value spaces -------------------------------------------------------

export type XsdValue =
  /** Exact decimal: `unscaled / 10^scale`. Compared without ever becoming a float. */
  | { readonly kind: 'decimal'; readonly unscaled: bigint; readonly scale: number }
  | { readonly kind: 'double'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  /** Durations are a partial order — one year is not comparable with 365 days. */
  | { readonly kind: 'duration'; readonly months: number; readonly seconds: number }
  | { readonly kind: 'instant'; readonly millis: number; readonly hasTimezone: boolean }
  | { readonly kind: 'binary'; readonly octets: number }
  | { readonly kind: 'opaque'; readonly value: string };

export function parseValue(primitive: PrimitiveKind, lexical: string): XsdValue | null {
  switch (primitive) {
    case 'decimal':
      return parseDecimal(lexical);
    case 'float':
    case 'double': {
      if (lexical === 'INF') return { kind: 'double', value: Infinity };
      if (lexical === '-INF') return { kind: 'double', value: -Infinity };
      if (lexical === 'NaN') return { kind: 'double', value: NaN };
      const value = Number(lexical);
      return Number.isNaN(value) ? null : { kind: 'double', value };
    }
    case 'boolean':
      return { kind: 'boolean', value: lexical === 'true' || lexical === '1' };
    case 'string':
    case 'anyURI':
      return { kind: 'string', value: lexical };
    case 'duration':
      return parseDuration(lexical);
    case 'dateTime':
    case 'date':
    case 'time':
    case 'gYear':
    case 'gYearMonth':
    case 'gMonth':
    case 'gMonthDay':
    case 'gDay':
      return parseInstant(primitive, lexical);
    case 'hexBinary':
      return { kind: 'binary', octets: lexical.length / 2 };
    case 'base64Binary':
      return { kind: 'binary', octets: base64Octets(lexical) };
    case 'QName':
    case 'NOTATION':
      return { kind: 'opaque', value: lexical };
  }
}

function parseDecimal(lexical: string): XsdValue | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(lexical);
  if (match === null) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '';
  const fraction = match[3] ?? '';
  if (whole === '' && fraction === '') return null;
  const digits = `${whole}${fraction}`;
  return { kind: 'decimal', unscaled: sign * BigInt(digits === '' ? '0' : digits), scale: fraction.length };
}

function parseDuration(lexical: string): XsdValue | null {
  const match = /^(-?)P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    lexical,
  );
  if (match === null) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const months = Number(match[2] ?? 0) * 12 + Number(match[3] ?? 0);
  const seconds =
    Number(match[4] ?? 0) * 86400 +
    Number(match[5] ?? 0) * 3600 +
    Number(match[6] ?? 0) * 60 +
    Number(match[7] ?? 0);
  return { kind: 'duration', months: sign * months, seconds: sign * seconds };
}

function parseInstant(primitive: PrimitiveKind, lexical: string): XsdValue | null {
  const timezoneMatch = /(Z|[+-]\d{2}:\d{2})$/.exec(lexical);
  const hasTimezone = timezoneMatch !== null;
  const body = hasTimezone ? lexical.slice(0, -timezoneMatch[0].length) : lexical;

  let offsetMinutes = 0;
  if (hasTimezone && timezoneMatch[0] !== 'Z') {
    const sign = timezoneMatch[0].startsWith('-') ? -1 : 1;
    const [hours, minutes] = timezoneMatch[0].slice(1).split(':').map(Number);
    offsetMinutes = sign * ((hours ?? 0) * 60 + (minutes ?? 0));
  }

  const parts = extractDateParts(primitive, body);
  if (parts === null) return null;
  const millis = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return {
    kind: 'instant',
    millis: millis + parts.seconds * 1000 - offsetMinutes * 60_000,
    hasTimezone,
  };
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  seconds: number;
}

function extractDateParts(primitive: PrimitiveKind, body: string): DateParts | null {
  // A reference point for the partial types, so `--07` and `--08` still order sensibly.
  const parts: DateParts = { year: 1972, month: 1, day: 1, hour: 0, minute: 0, seconds: 0 };

  const time = (text: string): void => {
    const match = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text);
    if (match === null) return;
    parts.hour = Number(match[1]);
    parts.minute = Number(match[2]);
    parts.seconds = Number(match[3]);
  };

  switch (primitive) {
    case 'dateTime': {
      const [date, clock] = body.split('T');
      if (date === undefined || clock === undefined) return null;
      const dateMatch = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(date);
      if (dateMatch === null) return null;
      parts.year = Number(dateMatch[1]);
      parts.month = Number(dateMatch[2]);
      parts.day = Number(dateMatch[3]);
      time(clock);
      return parts;
    }
    case 'date': {
      const match = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(body);
      if (match === null) return null;
      parts.year = Number(match[1]);
      parts.month = Number(match[2]);
      parts.day = Number(match[3]);
      return parts;
    }
    case 'time':
      time(body);
      return parts;
    case 'gYear':
      parts.year = Number(body);
      return Number.isNaN(parts.year) ? null : parts;
    case 'gYearMonth': {
      const match = /^(-?\d{4,})-(\d{2})$/.exec(body);
      if (match === null) return null;
      parts.year = Number(match[1]);
      parts.month = Number(match[2]);
      return parts;
    }
    case 'gMonth': {
      const match = /^--(\d{2})$/.exec(body);
      if (match === null) return null;
      parts.month = Number(match[1]);
      return parts;
    }
    case 'gMonthDay': {
      const match = /^--(\d{2})-(\d{2})$/.exec(body);
      if (match === null) return null;
      parts.month = Number(match[1]);
      parts.day = Number(match[2]);
      return parts;
    }
    case 'gDay': {
      const match = /^---(\d{2})$/.exec(body);
      if (match === null) return null;
      parts.day = Number(match[1]);
      return parts;
    }
    default:
      return null;
  }
}

function base64Octets(lexical: string): number {
  const compact = lexical.replace(/\s/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return (compact.length / 4) * 3 - padding;
}

/**
 * Ordering, or null when the two values are not comparable.
 *
 * Incomparability is real rather than an evasion: `P1M` and `P30D` have no defined order in XSD,
 * because the number of days in a month is not fixed.
 */
export function compareValues(a: XsdValue, b: XsdValue): number | null {
  if (a.kind !== b.kind) return null;

  switch (a.kind) {
    case 'decimal': {
      const other = b as Extract<XsdValue, { kind: 'decimal' }>;
      const scale = Math.max(a.scale, other.scale);
      const left = a.unscaled * 10n ** BigInt(scale - a.scale);
      const right = other.unscaled * 10n ** BigInt(scale - other.scale);
      return left < right ? -1 : left > right ? 1 : 0;
    }
    case 'double': {
      const other = b as Extract<XsdValue, { kind: 'double' }>;
      if (Number.isNaN(a.value) || Number.isNaN(other.value)) return null;
      return a.value < other.value ? -1 : a.value > other.value ? 1 : 0;
    }
    case 'instant': {
      const other = b as Extract<XsdValue, { kind: 'instant' }>;
      return a.millis < other.millis ? -1 : a.millis > other.millis ? 1 : 0;
    }
    case 'duration': {
      const other = b as Extract<XsdValue, { kind: 'duration' }>;
      const monthsDiff = a.months - other.months;
      const secondsDiff = a.seconds - other.seconds;
      if (monthsDiff === 0) return secondsDiff < 0 ? -1 : secondsDiff > 0 ? 1 : 0;
      if (secondsDiff === 0) return monthsDiff < 0 ? -1 : 1;
      // Mixed months and seconds: comparable only when both parts agree on direction.
      if (monthsDiff < 0 && secondsDiff < 0) return -1;
      if (monthsDiff > 0 && secondsDiff > 0) return 1;
      return null;
    }
    case 'binary': {
      const other = b as Extract<XsdValue, { kind: 'binary' }>;
      return a.octets < other.octets ? -1 : a.octets > other.octets ? 1 : 0;
    }
    case 'string':
    case 'opaque': {
      const other = b as Extract<XsdValue, { kind: 'string' | 'opaque' }>;
      return a.value === other.value ? 0 : null; // equality only; no order on strings in XSD
    }
    case 'boolean': {
      const other = b as Extract<XsdValue, { kind: 'boolean' }>;
      return a.value === other.value ? 0 : null;
    }
  }
}

/** Whether a primitive has a defined ordering, which is what makes the bound facets meaningful. */
export function isOrdered(primitive: PrimitiveKind): boolean {
  return (
    primitive === 'decimal' ||
    primitive === 'float' ||
    primitive === 'double' ||
    primitive === 'duration' ||
    primitive === 'dateTime' ||
    primitive === 'time' ||
    primitive === 'date' ||
    primitive === 'gYear' ||
    primitive === 'gYearMonth' ||
    primitive === 'gMonth' ||
    primitive === 'gMonthDay' ||
    primitive === 'gDay'
  );
}

/** The unit `length`, `minLength` and `maxLength` count in, which differs by primitive. */
export function lengthOf(primitive: PrimitiveKind | null, lexical: string): number {
  if (primitive === 'hexBinary') return lexical.length / 2;
  if (primitive === 'base64Binary') return base64Octets(lexical);
  return [...lexical].length; // codepoints, not UTF-16 units
}
