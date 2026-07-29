/**
 * The raw XSD abstract syntax tree.
 *
 * This is the schema document as written, with names resolved and attribute defaults applied, but
 * with *nothing* interpreted: no reference resolution, no type derivation, no content-model
 * compilation. Keeping that boundary sharp is what lets the later stages be rewritten independently,
 * and it is what makes the XSD *editor* possible — a half-finished schema still parses into this
 * shape, whereas it would fail to compile into a component model.
 *
 * Every node keeps its origin, so a diagnostic produced four stages later still points at a real
 * range in a real file.
 */

import type { NodeId } from '@x-editor/xml-core';
import { UNBOUNDED, type Occurs, type ProcessContents } from './particles.js';

export { UNBOUNDED };
export type { Occurs, ProcessContents };

export const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

/** Where a component was written. `documentUri` is the key into the schema set, not a fetch target. */
export interface Origin {
  readonly documentUri: string;
  readonly node: NodeId;
}

/**
 * A resolved QName reference. Structurally identical to `ElementName` in `particles.ts`, and
 * deliberately so — element references flow into content models without conversion.
 */
export interface XsdQName {
  readonly namespaceUri: string | null;
  readonly localName: string;
}

export function qnameKey(name: XsdQName): string {
  return `${name.namespaceUri ?? ''}|${name.localName}`;
}

export function qnameEquals(a: XsdQName, b: XsdQName): boolean {
  return a.localName === b.localName && a.namespaceUri === b.namespaceUri;
}

export function formatQName(name: XsdQName): string {
  return name.namespaceUri === null ? name.localName : `{${name.namespaceUri}}${name.localName}`;
}

export type Form = 'qualified' | 'unqualified';

export type DerivationControl = 'extension' | 'restriction' | 'substitution' | 'list' | 'union';

/** `#all` is kept as an explicit variant rather than the expanded set, because it re-expands
 *  differently depending on which of `block` / `final` it appeared on. */
export type DerivationSet = { readonly kind: 'all' } | { readonly kind: 'set'; readonly values: readonly DerivationControl[] };

export const EMPTY_DERIVATION_SET: DerivationSet = { kind: 'set', values: [] };

export function derivationSetHas(set: DerivationSet, value: DerivationControl): boolean {
  return set.kind === 'all' || set.values.includes(value);
}

export interface Annotation {
  readonly origin: Origin;
  /** Concatenated `xs:documentation` text, whitespace-collapsed. Empty when there is none. */
  readonly documentation: string;
  /** `xs:appinfo` element ids, kept for embedded Schematron (§8 of the plan) rather than read here. */
  readonly appinfo: readonly NodeId[];
}

// --- particles ----------------------------------------------------------

/**
 * One entry in a wildcard's namespace list.
 *
 * `##targetNamespace` is kept as a token rather than resolved at parse time, because a schema
 * included as a chameleon acquires its target namespace from whoever included it — resolving early
 * would bake in the wrong answer, and `##local` would become indistinguishable from it.
 */
export type NamespaceToken =
  | { readonly kind: 'uri'; readonly uri: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'target' };

export type NamespaceSpec =
  | { readonly kind: 'any' }
  | { readonly kind: 'other' }
  | { readonly kind: 'list'; readonly namespaces: readonly NamespaceToken[] };

export interface RawAny {
  readonly kind: 'any';
  readonly origin: Origin;
  readonly namespace: NamespaceSpec;
  readonly processContents: ProcessContents;
  readonly occurs: Occurs;
  /** XSD 1.1 `notNamespace` / `notQName`. Parsed now, honoured from Phase 4b. */
  readonly notNamespace: readonly NamespaceToken[] | null;
  readonly notQName: readonly string[] | null;
  readonly annotation: Annotation | null;
}

export interface RawGroupRef {
  readonly kind: 'group-ref';
  readonly origin: Origin;
  readonly ref: XsdQName;
  readonly occurs: Occurs;
  readonly annotation: Annotation | null;
}

export interface RawModelGroup {
  readonly kind: 'sequence' | 'choice' | 'all';
  readonly origin: Origin;
  readonly items: readonly RawParticle[];
  readonly occurs: Occurs;
  readonly annotation: Annotation | null;
}

export interface RawElementParticle {
  readonly kind: 'element';
  readonly element: RawElement;
}

export type RawParticle = RawElementParticle | RawGroupRef | RawModelGroup | RawAny;

// --- declarations -------------------------------------------------------

/**
 * XSD 1.1 conditional type assignment: `<xs:alternative test="…" type="…"/>`.
 *
 * The element's type is chosen at validation time from its own attributes — the standard way to
 * express "a payment of kind 'card' has these fields, one of kind 'transfer' has those". A final
 * alternative with no test is the fallback.
 */
export interface RawTypeAlternative {
  readonly origin: Origin;
  readonly test: string | null;
  readonly type: XsdQName | null;
  readonly inlineType: RawType | null;
  readonly xpathDefaultNamespace: string | null;
  readonly namespaces: Readonly<Record<string, string>>;
}

/** XSD 1.1 `xs:openContent` — a wildcard that applies alongside the declared content model. */
export interface RawOpenContent {
  readonly origin: Origin;
  readonly mode: 'none' | 'interleave' | 'suffix';
  readonly wildcard: RawAny | null;
}

export interface RawElement {
  readonly origin: Origin;
  /** Null exactly when this is a `ref=`. */
  readonly name: string | null;
  readonly ref: XsdQName | null;
  /**
   * Whether the declared name lands in the schema's target namespace.
   *
   * Deliberately stored as a flag rather than a resolved URI: a chameleon `include` changes the
   * target namespace after parsing, and a resolved-too-early `null` cannot be told apart from a
   * genuinely unqualified local declaration.
   */
  readonly qualified: boolean;
  /** XSD 1.1 lets a local declaration name its namespace outright; that wins over `qualified`. */
  readonly explicitTargetNamespace: string | null;
  readonly global: boolean;
  readonly type: XsdQName | null;
  readonly inlineType: RawSimpleType | RawComplexType | null;
  readonly occurs: Occurs;
  readonly nillable: boolean;
  readonly abstract: boolean;
  readonly defaultValue: string | null;
  readonly fixedValue: string | null;
  readonly substitutionGroup: readonly XsdQName[];
  readonly block: DerivationSet | null;
  readonly final: DerivationSet | null;
  readonly identityConstraints: readonly RawIdentityConstraint[];
  /** XSD 1.1 conditional type assignment, in declaration order. */
  readonly alternatives: readonly RawTypeAlternative[];
  readonly annotation: Annotation | null;
}

export type AttributeUseKind = 'optional' | 'required' | 'prohibited';

export interface RawAttribute {
  readonly origin: Origin;
  readonly name: string | null;
  readonly ref: XsdQName | null;
  readonly qualified: boolean;
  readonly explicitTargetNamespace: string | null;
  readonly global: boolean;
  readonly type: XsdQName | null;
  readonly inlineType: RawSimpleType | null;
  readonly use: AttributeUseKind;
  readonly defaultValue: string | null;
  readonly fixedValue: string | null;
  readonly annotation: Annotation | null;
}

export interface RawAnyAttribute {
  readonly origin: Origin;
  readonly namespace: NamespaceSpec;
  readonly processContents: ProcessContents;
  readonly notNamespace: readonly NamespaceToken[] | null;
  readonly notQName: readonly string[] | null;
}

export interface RawAttributeOwner {
  readonly attributes: readonly RawAttribute[];
  readonly attributeGroups: readonly XsdQName[];
  readonly anyAttribute: RawAnyAttribute | null;
}

export interface RawIdentityConstraint {
  readonly origin: Origin;
  readonly kind: 'key' | 'keyref' | 'unique';
  readonly name: string | null;
  readonly ref: XsdQName | null;
  readonly refer: XsdQName | null;
  readonly selector: string | null;
  readonly fields: readonly string[];
}

// --- type definitions ---------------------------------------------------

export type FacetName =
  | 'length'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'enumeration'
  | 'whiteSpace'
  | 'maxInclusive'
  | 'maxExclusive'
  | 'minInclusive'
  | 'minExclusive'
  | 'totalDigits'
  | 'fractionDigits'
  | 'explicitTimezone';

export const FACET_NAMES: readonly FacetName[] = [
  'length',
  'minLength',
  'maxLength',
  'pattern',
  'enumeration',
  'whiteSpace',
  'maxInclusive',
  'maxExclusive',
  'minInclusive',
  'minExclusive',
  'totalDigits',
  'fractionDigits',
  'explicitTimezone',
];

export interface RawFacet {
  readonly origin: Origin;
  readonly name: FacetName;
  readonly value: string;
  readonly fixed: boolean;
  readonly annotation: Annotation | null;
}

export interface RawAssertion {
  readonly origin: Origin;
  readonly test: string;
  readonly xpathDefaultNamespace: string | null;
  /**
   * Prefix bindings in scope where the expression was written.
   *
   * Captured at parse time for the same reason QName-valued attributes are resolved there: an XPath
   * in a schema means what the *schema's* prefixes say, and resolving it later against the instance
   * document's prefixes is the classic way to get a subtly wrong answer.
   */
  readonly namespaces: Readonly<Record<string, string>>;
  readonly annotation: Annotation | null;
}

export type RawSimpleDerivation =
  | {
      readonly kind: 'restriction';
      readonly base: XsdQName | null;
      readonly baseInline: RawSimpleType | null;
      readonly facets: readonly RawFacet[];
      /** XSD 1.1 `xs:assertion` inside a simple-type restriction. */
      readonly assertions: readonly RawAssertion[];
    }
  | {
      readonly kind: 'list';
      readonly itemType: XsdQName | null;
      readonly itemInline: RawSimpleType | null;
    }
  | {
      readonly kind: 'union';
      readonly memberTypes: readonly XsdQName[];
      readonly memberInline: readonly RawSimpleType[];
    };

export interface RawSimpleType {
  readonly form: 'simple';
  readonly origin: Origin;
  readonly name: string | null;
  readonly final: DerivationSet | null;
  readonly derivation: RawSimpleDerivation | null;
  readonly annotation: Annotation | null;
}

export type RawComplexContent =
  /** No `xs:simpleContent` / `xs:complexContent` wrapper: children are a particle, or nothing. */
  | { readonly kind: 'particle'; readonly particle: RawParticle | null }
  | {
      readonly kind: 'simple-content';
      readonly derivationKind: 'extension' | 'restriction';
      readonly base: XsdQName | null;
      /** `xs:simpleType` inside a simple-content restriction. */
      readonly baseInline: RawSimpleType | null;
      readonly facets: readonly RawFacet[];
      readonly origin: Origin;
    }
  | {
      readonly kind: 'complex-content';
      readonly derivationKind: 'extension' | 'restriction';
      readonly base: XsdQName | null;
      readonly mixed: boolean | null;
      readonly particle: RawParticle | null;
      readonly origin: Origin;
    };

export interface RawComplexType extends RawAttributeOwner {
  readonly form: 'complex';
  readonly origin: Origin;
  readonly name: string | null;
  readonly abstract: boolean;
  readonly mixed: boolean;
  readonly block: DerivationSet | null;
  readonly final: DerivationSet | null;
  readonly content: RawComplexContent;
  readonly assertions: readonly RawAssertion[];
  readonly openContent: RawOpenContent | null;
  readonly annotation: Annotation | null;
}

export type RawType = RawSimpleType | RawComplexType;

export interface RawGroup {
  readonly origin: Origin;
  readonly name: string;
  readonly particle: RawModelGroup | null;
  readonly annotation: Annotation | null;
}

export interface RawAttributeGroup extends RawAttributeOwner {
  readonly origin: Origin;
  readonly name: string;
  readonly annotation: Annotation | null;
}

export interface RawNotation {
  readonly origin: Origin;
  readonly name: string;
  readonly publicId: string | null;
  readonly systemId: string | null;
  readonly annotation: Annotation | null;
}

// --- composition --------------------------------------------------------

export type CompositionKind = 'include' | 'import' | 'redefine' | 'override';

export interface RawComposition {
  readonly origin: Origin;
  readonly kind: CompositionKind;
  /** Absent for `xs:import` with no `schemaLocation` — a hint that the namespace may appear. */
  readonly schemaLocation: string | null;
  /** Only meaningful for `import`. */
  readonly namespace: string | null;
  /**
   * `xs:redefine` and `xs:override` carry component definitions that replace the included ones.
   * Held unparsed-by-purpose here: the redefinition rules are applied during assembly.
   */
  readonly components: RawSchemaComponents | null;
}

export interface RawSchemaComponents {
  readonly elements: readonly RawElement[];
  readonly attributes: readonly RawAttribute[];
  readonly types: readonly RawType[];
  readonly groups: readonly RawGroup[];
  readonly attributeGroups: readonly RawAttributeGroup[];
  readonly notations: readonly RawNotation[];
}

export function emptyComponents(): RawSchemaComponents {
  return { elements: [], attributes: [], types: [], groups: [], attributeGroups: [], notations: [] };
}

export interface RawSchema extends RawSchemaComponents {
  readonly documentUri: string;
  readonly origin: Origin;
  readonly targetNamespace: string | null;
  readonly elementFormDefault: Form;
  readonly attributeFormDefault: Form;
  readonly blockDefault: DerivationSet;
  readonly finalDefault: DerivationSet;
  readonly version: string | null;
  readonly compositions: readonly RawComposition[];
  /** `vc:minVersion` on the schema element — the usual way a document declares it needs XSD 1.1. */
  readonly declaredVersion: '1.0' | '1.1';
  readonly annotation: Annotation | null;
}

/** A problem found while reading a schema. Never thrown: a broken schema must still open. */
export interface SchemaDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly origin: Origin;
}
