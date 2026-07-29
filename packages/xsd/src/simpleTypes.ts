/**
 * The simple-type compiler (P4) — the sleeper in the estimate, and the part beginners actually
 * spend their time in. Almost every value a user types is checked here.
 *
 * The work is facet inheritance done properly. A facet on a derived type does not replace the
 * base's, it *narrows* it: `xs:int` inherits `fractionDigits = 0` from `xs:integer` and its own
 * bounds from nothing, and a user type restricting `xs:int` to `maxInclusive="100"` still cannot
 * hold `1.5`. Getting this wrong produces an engine that accepts values the validator rejects,
 * which is precisely the guidance/verdict drift the plan calls the top project risk.
 *
 * Compilation never fails. An unresolvable base yields `anySimpleType` plus a diagnostic, so the
 * rest of the schema still gives guidance.
 */

import {
  formatQName,
  qnameKey,
  XSD_NS,
  type FacetName,
  type Origin,
  type RawFacet,
  type RawSimpleType,
  type SchemaDiagnostic,
  type XsdQName,
} from './ast.js';
import {
  applyWhiteSpace,
  builtInAncestry,
  builtInName,
  builtInType,
  compareValues,
  isOrdered,
  lengthOf,
  matchesLexicalSpace,
  parseValue,
  type BuiltInType,
  type PrimitiveKind,
  type Variety,
  type WhiteSpace,
  type XsdValue,
} from './builtins.js';
import type { SymbolTable } from './symbols.js';
import { translatePattern, type TranslatedPattern } from './xsdRegex.js';

export interface Bound {
  readonly lexical: string;
  readonly value: XsdValue | null;
}

/**
 * Patterns from one derivation step. Within a step the alternatives are OR'd; across steps they are
 * AND'd — a distinction that is easy to miss and changes what validates.
 */
export interface PatternGroup {
  readonly alternatives: readonly TranslatedPattern[];
}

export interface CompiledFacets {
  readonly whiteSpace: WhiteSpace;
  readonly length: number | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly patterns: readonly PatternGroup[];
  /** Null means unconstrained; an empty array means nothing at all is permitted. */
  readonly enumeration: readonly string[] | null;
  readonly minInclusive: Bound | null;
  readonly maxInclusive: Bound | null;
  readonly minExclusive: Bound | null;
  readonly maxExclusive: Bound | null;
  readonly totalDigits: number | null;
  readonly fractionDigits: number | null;
  readonly explicitTimezone: 'required' | 'optional' | 'prohibited' | null;
  readonly fixed: ReadonlySet<FacetName>;
}

export interface CompiledSimpleType {
  /** Discriminates against `CompiledComplexType` wherever a type reference could be either. */
  readonly form: 'simple';
  readonly name: XsdQName | null;
  readonly variety: Variety;
  /** Null for a union whose members disagree, and for `anySimpleType`. */
  readonly primitive: PrimitiveKind | null;
  readonly facets: CompiledFacets;
  readonly itemType: CompiledSimpleType | null;
  readonly memberTypes: readonly CompiledSimpleType[];
  readonly builtIn: BuiltInType | null;
  readonly baseName: XsdQName | null;
  readonly documentation: string;
}

const EMPTY_FACETS: CompiledFacets = {
  whiteSpace: 'preserve',
  length: null,
  minLength: null,
  maxLength: null,
  patterns: [],
  enumeration: null,
  minInclusive: null,
  maxInclusive: null,
  minExclusive: null,
  maxExclusive: null,
  totalDigits: null,
  fractionDigits: null,
  explicitTimezone: null,
  fixed: new Set(),
};

/** For built-ins, which resolve without consulting any document. */
const INTERNAL_ORIGIN: Origin = { documentUri: '', node: 0 as never };

export const ANY_SIMPLE_TYPE_DEF: CompiledSimpleType = {
  form: 'simple',
  name: { namespaceUri: XSD_NS, localName: 'anySimpleType' },
  variety: 'atomic',
  primitive: null,
  facets: EMPTY_FACETS,
  itemType: null,
  memberTypes: [],
  builtIn: builtInType(builtInName('anySimpleType')),
  baseName: null,
  documentation: 'any value',
};

export class SimpleTypeCompiler {
  readonly diagnostics: SchemaDiagnostic[] = [];

  private readonly byRaw = new Map<RawSimpleType, CompiledSimpleType>();
  private readonly byName = new Map<string, CompiledSimpleType>();
  private readonly inProgress = new Set<unknown>();

  constructor(private readonly symbols: SymbolTable) {}

  /** Compile a named type, built-in or user-defined. Falls back to `anySimpleType`. */
  compileByName(name: XsdQName, origin: Origin): CompiledSimpleType {
    const normalized = this.symbols.normalize(name, origin);
    const key = qnameKey(normalized);
    const cached = this.byName.get(key);
    if (cached !== undefined) return cached;

    const builtIn = builtInType(normalized);
    if (builtIn !== null) {
      const compiled = this.compileBuiltIn(builtIn);
      this.byName.set(key, compiled);
      return compiled;
    }

    const raw = this.symbols.lookupType(normalized, origin);
    if (raw === null) {
      this.symbols.reportUnresolved('type', normalized, origin);
      return ANY_SIMPLE_TYPE_DEF;
    }
    if (raw.form !== 'simple') {
      this.diagnostics.push({
        severity: 'error',
        code: 'complex-type-used-as-simple',
        message: `${formatQName(normalized)} is a complex type, so it cannot be used where a simple type is required.`,
        origin,
      });
      return ANY_SIMPLE_TYPE_DEF;
    }

    const compiled = this.compile(raw);
    this.byName.set(key, compiled);
    return compiled;
  }

  compile(raw: RawSimpleType): CompiledSimpleType {
    const cached = this.byRaw.get(raw);
    if (cached !== undefined) return cached;

    if (this.inProgress.has(raw)) {
      // A type defined in terms of itself. Reported once, then treated as unconstrained so the
      // rest of the schema still compiles.
      this.diagnostics.push({
        severity: 'error',
        code: 'circular-type',
        message: `The type "${raw.name ?? 'this anonymous type'}" is defined in terms of itself.`,
        origin: raw.origin,
      });
      return ANY_SIMPLE_TYPE_DEF;
    }
    this.inProgress.add(raw);

    const compiled = this.compileUncached(raw);
    this.inProgress.delete(raw);
    this.byRaw.set(raw, compiled);
    return compiled;
  }

  private compileUncached(raw: RawSimpleType): CompiledSimpleType {
    const documentation = raw.annotation?.documentation ?? '';
    const name =
      raw.name === null
        ? null
        : {
            namespaceUri: this.symbols.documentOf(raw.origin.documentUri)?.targetNamespace ?? null,
            localName: raw.name,
          };

    const derivation = raw.derivation;
    if (derivation === null) return { ...ANY_SIMPLE_TYPE_DEF, name, documentation };

    switch (derivation.kind) {
      case 'restriction': {
        const base =
          derivation.baseInline !== null
            ? this.compile(derivation.baseInline)
            : derivation.base !== null
              ? this.compileByName(derivation.base, raw.origin)
              : ANY_SIMPLE_TYPE_DEF;

        return {
          form: 'simple',
          name,
          variety: base.variety,
          primitive: base.primitive,
          facets: this.mergeFacets(base, derivation.facets, raw.origin),
          itemType: base.itemType,
          memberTypes: base.memberTypes,
          builtIn: base.builtIn,
          baseName: base.name,
          documentation: documentation === '' ? base.documentation : documentation,
        };
      }

      case 'list': {
        const itemType =
          derivation.itemInline !== null
            ? this.compile(derivation.itemInline)
            : derivation.itemType !== null
              ? this.compileByName(derivation.itemType, raw.origin)
              : ANY_SIMPLE_TYPE_DEF;

        return {
          form: 'simple',
          name,
          variety: 'list',
          primitive: null,
          // A list always collapses: the whitespace *is* the item separator.
          facets: { ...EMPTY_FACETS, whiteSpace: 'collapse' },
          itemType,
          memberTypes: [],
          builtIn: null,
          baseName: null,
          documentation:
            documentation === ''
              ? `a space-separated list of ${itemType.documentation}`
              : documentation,
        };
      }

      case 'union': {
        const members = [
          ...derivation.memberTypes.map((member) => this.compileByName(member, raw.origin)),
          ...derivation.memberInline.map((member) => this.compile(member)),
        ];
        const primitives = new Set(members.map((member) => member.primitive));
        return {
          form: 'simple',
          name,
          variety: 'union',
          primitive: primitives.size === 1 ? (members[0]?.primitive ?? null) : null,
          facets: { ...EMPTY_FACETS, whiteSpace: 'collapse' },
          itemType: null,
          memberTypes: members,
          builtIn: null,
          baseName: null,
          documentation:
            documentation === ''
              ? `one of: ${members.map((member) => member.documentation).join('; or ')}`
              : documentation,
        };
      }
    }
  }

  /** Built-ins are compiled by walking their own ancestry and merging the facets they fix. */
  private compileBuiltIn(builtIn: BuiltInType): CompiledSimpleType {
    if (builtIn.variety === 'list') {
      const itemType = this.compileByName(builtInName(builtIn.itemType!), INTERNAL_ORIGIN);
      return {
        form: 'simple',
        name: builtInName(builtIn.localName),
        variety: 'list',
        primitive: null,
        facets: { ...EMPTY_FACETS, whiteSpace: 'collapse' },
        itemType,
        memberTypes: [],
        builtIn,
        baseName: builtInName('anySimpleType'),
        documentation: builtIn.description,
      };
    }

    let facets: CompiledFacets = { ...EMPTY_FACETS, whiteSpace: builtIn.whiteSpace };
    // Nearest-last, so a subtype's bound wins over its base's.
    for (const ancestor of builtInAncestry(builtIn).reverse()) {
      const fixed = ancestor.facets;
      if (fixed === undefined) continue;
      facets = {
        ...facets,
        minInclusive:
          fixed.minInclusive === undefined
            ? facets.minInclusive
            : this.bound(fixed.minInclusive, builtIn.primitive),
        maxInclusive:
          fixed.maxInclusive === undefined
            ? facets.maxInclusive
            : this.bound(fixed.maxInclusive, builtIn.primitive),
        fractionDigits: fixed.fractionDigits ?? facets.fractionDigits,
        patterns:
          fixed.pattern === undefined
            ? facets.patterns
            : [...facets.patterns, { alternatives: [translatePattern(fixed.pattern)] }],
      };
    }
    facets = { ...facets, whiteSpace: builtIn.whiteSpace };

    return {
      form: 'simple',
      name: builtInName(builtIn.localName),
      variety: 'atomic',
      primitive: builtIn.primitive,
      facets,
      itemType: null,
      memberTypes: [],
      builtIn,
      baseName: builtIn.base === null ? null : builtInName(builtIn.base),
      documentation: builtIn.description,
    };
  }

  private bound(lexical: string, primitive: PrimitiveKind | null): Bound {
    return { lexical, value: primitive === null ? null : parseValue(primitive, lexical) };
  }

  // --- facet merging ----------------------------------------------------

  private mergeFacets(
    base: CompiledSimpleType,
    own: readonly RawFacet[],
    origin: Origin,
  ): CompiledFacets {
    let facets: CompiledFacets = base.facets;
    const fixed = new Set(base.facets.fixed);
    // Patterns declared side by side in one restriction are alternatives; across steps they all
    // have to hold. So this step's contribute exactly one new group.
    const stepAlternatives: TranslatedPattern[] = [];
    let enumeration: string[] | null = null;

    const numeric = (facet: RawFacet): number | null => {
      const value = Number(facet.value);
      if (!Number.isInteger(value) || value < 0) {
        this.diagnostics.push({
          severity: 'error',
          code: 'bad-facet-value',
          message: `<xs:${facet.name} value="${facet.value}"> needs a non-negative whole number.`,
          origin: facet.origin,
        });
        return null;
      }
      return value;
    };

    const checkFixed = (facet: RawFacet): boolean => {
      if (!base.facets.fixed.has(facet.name)) return true;
      this.diagnostics.push({
        severity: 'error',
        code: 'fixed-facet-overridden',
        message: `The base type fixes ${facet.name}, so it cannot be changed here.`,
        origin: facet.origin,
      });
      return false;
    };

    for (const facet of own) {
      if (!checkFixed(facet)) continue;
      if (facet.fixed) fixed.add(facet.name);

      switch (facet.name) {
        case 'whiteSpace': {
          const value = facet.value.trim();
          if (value !== 'preserve' && value !== 'replace' && value !== 'collapse') {
            this.diagnostics.push({
              severity: 'error',
              code: 'bad-facet-value',
              message: `whiteSpace must be preserve, replace or collapse, not "${facet.value}".`,
              origin: facet.origin,
            });
            break;
          }
          if (!isWhiteSpaceNarrowing(base.facets.whiteSpace, value)) {
            this.diagnostics.push({
              severity: 'error',
              code: 'facet-loosens-base',
              message: `whiteSpace="${value}" is weaker than the base type's "${base.facets.whiteSpace}".`,
              origin: facet.origin,
            });
            break;
          }
          facets = { ...facets, whiteSpace: value };
          break;
        }

        case 'length':
        case 'minLength':
        case 'maxLength':
        case 'totalDigits':
        case 'fractionDigits': {
          const value = numeric(facet);
          if (value === null) break;
          facets = { ...facets, [facet.name]: narrow(facet.name, facets[facet.name], value) };
          break;
        }

        case 'pattern':
          stepAlternatives.push(translatePattern(facet.value));
          break;

        case 'enumeration':
          (enumeration ??= []).push(facet.value);
          break;

        case 'minInclusive':
        case 'maxInclusive':
        case 'minExclusive':
        case 'maxExclusive':
          facets = { ...facets, [facet.name]: this.bound(facet.value, base.primitive) };
          break;

        case 'explicitTimezone': {
          const value = facet.value.trim();
          if (value === 'required' || value === 'optional' || value === 'prohibited') {
            facets = { ...facets, explicitTimezone: value };
          }
          break;
        }
      }
    }

    for (const pattern of stepAlternatives) {
      if (pattern.error !== null) {
        this.diagnostics.push({
          severity: 'warning',
          code: 'bad-pattern',
          message: `This pattern could not be translated (${pattern.error}), so values are not checked against it.`,
          origin,
        });
      }
    }

    return {
      ...facets,
      patterns:
        stepAlternatives.length === 0
          ? facets.patterns
          : [...facets.patterns, { alternatives: stepAlternatives }],
      // A derived enumeration must be a subset of the base's, so the most derived one is the whole
      // constraint and the base's need not be re-checked.
      enumeration: enumeration ?? facets.enumeration,
      fixed,
    };
  }
}

function isWhiteSpaceNarrowing(base: WhiteSpace, derived: WhiteSpace): boolean {
  const rank: Record<WhiteSpace, number> = { preserve: 0, replace: 1, collapse: 2 };
  return rank[derived] >= rank[base];
}

/** Length-shaped facets may only get stricter down a derivation chain. */
function narrow(name: FacetName, existing: number | null, value: number): number {
  if (existing === null) return value;
  if (name === 'minLength') return Math.max(existing, value);
  return Math.min(existing, value);
}

// --- validation ---------------------------------------------------------

export interface ValueProblem {
  readonly code: string;
  readonly message: string;
}

/**
 * Check a lexical value against a compiled type.
 *
 * Returns *every* problem rather than the first, because the Inspector shows them together and a
 * value that is both too long and not matching a pattern should say both.
 */
export function validateSimpleValue(
  type: CompiledSimpleType,
  lexical: string,
): ValueProblem[] {
  const value = applyWhiteSpace(lexical, type.facets.whiteSpace);

  switch (type.variety) {
    case 'list':
      return validateList(type, value);
    case 'union':
      return validateUnion(type, value);
    case 'atomic':
      return validateAtomic(type, value);
  }
}

function validateAtomic(type: CompiledSimpleType, value: string): ValueProblem[] {
  const problems: ValueProblem[] = [];
  const { primitive, facets } = type;

  if (primitive !== null && !matchesLexicalSpace(primitive, value)) {
    return [
      {
        code: 'cvc-datatype-valid.1.2.1',
        message: `"${value}" is not ${type.documentation}.`,
      },
    ];
  }

  problems.push(...checkLengthFacets(facets, primitive, value));
  problems.push(...checkPatterns(facets, value));
  problems.push(...checkEnumeration(facets, value));

  if (primitive !== null) {
    problems.push(...checkBounds(facets, primitive, value));
    problems.push(...checkDigits(facets, primitive, value));
    problems.push(...checkTimezone(facets, value));
  }

  return problems;
}

function checkLengthFacets(
  facets: CompiledFacets,
  primitive: PrimitiveKind | null,
  value: string,
): ValueProblem[] {
  const problems: ValueProblem[] = [];
  const length = lengthOf(primitive, value);

  if (facets.length !== null && length !== facets.length) {
    problems.push({
      code: 'cvc-length-valid',
      message: `This must be exactly ${facets.length} characters long; "${value}" is ${length}.`,
    });
  }
  if (facets.minLength !== null && length < facets.minLength) {
    problems.push({
      code: 'cvc-minLength-valid',
      message: `This must be at least ${facets.minLength} characters long; "${value}" is ${length}.`,
    });
  }
  if (facets.maxLength !== null && length > facets.maxLength) {
    problems.push({
      code: 'cvc-maxLength-valid',
      message: `This can be at most ${facets.maxLength} characters long; "${value}" is ${length}.`,
    });
  }
  return problems;
}

function checkPatterns(facets: CompiledFacets, value: string): ValueProblem[] {
  for (const group of facets.patterns) {
    // Within a group any alternative may match; a group with nothing translatable is skipped so a
    // pattern we could not read never rejects a value.
    const usable = group.alternatives.filter((pattern) => pattern.regex !== null);
    if (usable.length === 0) continue;
    if (usable.some((pattern) => pattern.regex!.test(value))) continue;

    return [
      {
        code: 'cvc-pattern-valid',
        message: `"${value}" does not match the required pattern ${usable
          .map((pattern) => `"${pattern.source}"`)
          .join(' or ')}.`,
      },
    ];
  }
  return [];
}

function checkEnumeration(facets: CompiledFacets, value: string): ValueProblem[] {
  if (facets.enumeration === null) return [];
  if (facets.enumeration.includes(value)) return [];
  const shown = facets.enumeration.slice(0, 8).join(', ');
  const more = facets.enumeration.length > 8 ? `, and ${facets.enumeration.length - 8} more` : '';
  return [
    {
      code: 'cvc-enumeration-valid',
      message:
        facets.enumeration.length === 0
          ? 'No value is allowed here.'
          : `"${value}" is not one of the allowed values: ${shown}${more}.`,
    },
  ];
}

function checkBounds(
  facets: CompiledFacets,
  primitive: PrimitiveKind,
  value: string,
): ValueProblem[] {
  if (!isOrdered(primitive)) return [];
  const parsed = parseValue(primitive, value);
  if (parsed === null) return [];

  const problems: ValueProblem[] = [];
  const check = (bound: Bound | null, test: (order: number) => boolean, phrase: string): void => {
    if (bound?.value == null) return;
    const order = compareValues(parsed, bound.value);
    if (order === null || test(order)) return;
    problems.push({
      code: 'cvc-range-valid',
      message: `This must be ${phrase} ${bound.lexical}; "${value}" is not.`,
    });
  };

  check(facets.minInclusive, (order) => order >= 0, 'at least');
  check(facets.maxInclusive, (order) => order <= 0, 'at most');
  check(facets.minExclusive, (order) => order > 0, 'greater than');
  check(facets.maxExclusive, (order) => order < 0, 'less than');
  return problems;
}

function checkDigits(
  facets: CompiledFacets,
  primitive: PrimitiveKind,
  value: string,
): ValueProblem[] {
  if (primitive !== 'decimal') return [];
  const match = /^[+-]?(\d*)(?:\.(\d*))?$/.exec(value);
  if (match === null) return [];

  const problems: ValueProblem[] = [];
  const whole = (match[1] ?? '').replace(/^0+/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');

  if (facets.fractionDigits !== null && fraction.length > facets.fractionDigits) {
    problems.push({
      code: 'cvc-fractionDigits-valid',
      message:
        facets.fractionDigits === 0
          ? `This must be a whole number; "${value}" has a decimal part.`
          : `This can have at most ${facets.fractionDigits} decimal places; "${value}" has ${fraction.length}.`,
    });
  }
  if (facets.totalDigits !== null && whole.length + fraction.length > facets.totalDigits) {
    problems.push({
      code: 'cvc-totalDigits-valid',
      message: `This can have at most ${facets.totalDigits} digits in total; "${value}" has ${whole.length + fraction.length}.`,
    });
  }
  return problems;
}

function checkTimezone(facets: CompiledFacets, value: string): ValueProblem[] {
  if (facets.explicitTimezone === null) return [];
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/.test(value);
  if (facets.explicitTimezone === 'required' && !hasTimezone) {
    return [{ code: 'cvc-explicitTimezone-valid', message: 'A timezone is required, like Z or +01:00.' }];
  }
  if (facets.explicitTimezone === 'prohibited' && hasTimezone) {
    return [{ code: 'cvc-explicitTimezone-valid', message: 'A timezone is not allowed here.' }];
  }
  return [];
}

function validateList(type: CompiledSimpleType, value: string): ValueProblem[] {
  const items = value === '' ? [] : value.split(' ');
  const problems: ValueProblem[] = [];

  // Length facets on a list count *items*, not characters — a distinction that silently produces
  // wrong answers if the atomic path is reused here.
  const { facets } = type;
  if (facets.length !== null && items.length !== facets.length) {
    problems.push({
      code: 'cvc-length-valid',
      message: `This must have exactly ${facets.length} items; there are ${items.length}.`,
    });
  }
  if (facets.minLength !== null && items.length < facets.minLength) {
    problems.push({
      code: 'cvc-minLength-valid',
      message: `This must have at least ${facets.minLength} items; there are ${items.length}.`,
    });
  }
  if (facets.maxLength !== null && items.length > facets.maxLength) {
    problems.push({
      code: 'cvc-maxLength-valid',
      message: `This can have at most ${facets.maxLength} items; there are ${items.length}.`,
    });
  }
  problems.push(...checkPatterns(facets, value));
  problems.push(...checkEnumeration(facets, value));

  if (type.itemType !== null) {
    for (const item of items) {
      for (const problem of validateSimpleValue(type.itemType, item)) {
        problems.push({ ...problem, message: `In "${item}": ${problem.message}` });
      }
    }
  }
  return problems;
}

function validateUnion(type: CompiledSimpleType, value: string): ValueProblem[] {
  if (type.memberTypes.length === 0) return [];
  for (const member of type.memberTypes) {
    if (validateSimpleValue(member, value).length === 0) return [];
  }
  return [
    {
      code: 'cvc-datatype-valid.1.2.3',
      message: `"${value}" is not ${type.documentation}.`,
    },
  ];
}
