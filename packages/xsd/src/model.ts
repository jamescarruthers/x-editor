/**
 * The compiled schema model: complex types, element declarations, and the derivation indices
 * (P5 and P7). This is where the raw AST finally becomes something the automaton can run.
 *
 * Everything is compiled lazily and memoised. XSD is freely recursive — a `Section` contains
 * `Section` — so eager compilation either loops or needs a topological sort that does not exist for
 * cyclic graphs. Laziness plus an in-progress guard is the whole answer, and it also means opening a
 * 4,000-component schema like UBL costs only what the user actually looks at.
 *
 * The one thing done eagerly is the substitution index, because an element particle has to carry
 * its substitutable names *before* any content model is built.
 */

import {
  EMPTY_DERIVATION_SET,
  XSD_NS,
  derivationSetHas,
  formatQName,
  qnameKey,
  type DerivationSet,
  type NamespaceSpec,
  type Occurs,
  type Origin,
  type RawAssertion,
  type RawAttribute,
  type RawAttributeOwner,
  type RawComplexType,
  type RawElement,
  type RawFacet,
  type RawParticle,
  type RawType,
  type SchemaDiagnostic,
  type XsdQName,
} from './ast.js';
import { ANY_TYPE, builtInType } from './builtins.js';
import {
  ANY_NUMBER,
  ONCE,
  p as particleOf,
  type ElementName,
  type NamespaceConstraint,
  type Particle,
  type ProcessContents,
} from './particles.js';
import { compileContentModel, type CompiledContentModel } from './automaton.js';
import { compileAll, type AllContentModel } from './allModel.js';
import { SimpleTypeCompiler, type CompiledSimpleType } from './simpleTypes.js';
import { SymbolTable, declaredName } from './symbols.js';
import type { AssembledDocument, SchemaSet } from './assemble.js';

export type ContentKind = 'empty' | 'simple' | 'element-only' | 'mixed';

export interface AttributeUse {
  readonly name: XsdQName;
  readonly type: CompiledSimpleType;
  readonly use: 'optional' | 'required' | 'prohibited';
  readonly defaultValue: string | null;
  readonly fixedValue: string | null;
  readonly documentation: string;
  readonly origin: Origin;
}

export interface Wildcard {
  readonly namespaceConstraint: NamespaceConstraint;
  readonly processContents: ProcessContents;
}

export interface CompiledComplexType {
  readonly form: 'complex';
  readonly name: XsdQName | null;
  readonly contentKind: ContentKind;
  /** Present for element-only and mixed content. Null when the content is empty or simple. */
  readonly particle: Particle | null;
  /** The text type, for simple content. */
  readonly simpleType: CompiledSimpleType | null;
  readonly attributes: readonly AttributeUse[];
  readonly anyAttribute: Wildcard | null;
  readonly abstract: boolean;
  readonly baseName: XsdQName | null;
  readonly derivationMethod: 'extension' | 'restriction' | null;
  readonly block: DerivationSet;
  readonly final: DerivationSet;
  /** XSD 1.1 assertions, carried through for Phase 4b rather than evaluated. */
  readonly assertions: readonly RawAssertion[];
  readonly documentation: string;
  readonly origin: Origin;
}

export type CompiledType = CompiledSimpleType | CompiledComplexType;

export interface CompiledElement {
  readonly name: ElementName;
  readonly global: boolean;
  readonly nillable: boolean;
  readonly abstract: boolean;
  readonly occurs: Occurs;
  readonly defaultValue: string | null;
  readonly fixedValue: string | null;
  readonly substitutionGroup: readonly XsdQName[];
  readonly block: DerivationSet;
  readonly documentation: string;
  readonly origin: Origin;
  /** Resolved through `SchemaModel.typeOf`, so a recursive schema does not loop while compiling. */
  readonly typeName: XsdQName | null;
  readonly inlineType: RawType | null;
}

/**
 * A content model in whichever form fits it. `xs:all` never becomes an automaton — see
 * `allModel.ts` — and `xs:anyType` short-circuits entirely, because the ur-type permits everything
 * and running an automaton to discover that would be both slow and useless for guidance.
 */
export type ContentModel =
  | { readonly kind: 'empty' }
  | { readonly kind: 'any' }
  | { readonly kind: 'automaton'; readonly model: CompiledContentModel; readonly particle: Particle }
  | { readonly kind: 'all'; readonly model: AllContentModel };

export class SchemaModel {
  readonly diagnostics: SchemaDiagnostic[] = [];
  readonly symbols: SymbolTable;
  readonly simpleTypes: SimpleTypeCompiler;

  private readonly complexByRaw = new Map<RawComplexType, CompiledComplexType>();
  private readonly typeCache = new Map<string, CompiledType>();
  private readonly elementsByName = new Map<string, CompiledElement>();
  private readonly contentModels = new Map<CompiledComplexType, ContentModel>();
  private readonly compilingComplex = new Set<RawComplexType>();

  /** head key → every element that may appear in its place, transitively. */
  private readonly substitutions = new Map<string, ElementName[]>();

  constructor(readonly set: SchemaSet) {
    this.symbols = new SymbolTable(set);
    this.simpleTypes = new SimpleTypeCompiler(this.symbols);
    this.indexGlobalElements();
    this.indexSubstitutionGroups();
  }

  /** Diagnostics from every stage, in one list, since the UI shows one Problems panel. */
  allDiagnostics(): SchemaDiagnostic[] {
    return [
      ...this.set.diagnostics,
      ...this.symbols.diagnostics,
      ...this.simpleTypes.diagnostics,
      ...this.diagnostics,
    ];
  }

  // --- global elements --------------------------------------------------

  private indexGlobalElements(): void {
    for (const entry of this.symbols.globalElements()) {
      const document = this.symbols.documentOf(entry.documentUri);
      if (document === undefined) continue;
      const compiled = this.compileElement(entry.raw, document, true);
      if (compiled !== null) this.elementsByName.set(qnameKey(compiled.name), compiled);
    }
  }

  globalElement(name: XsdQName): CompiledElement | null {
    return this.elementsByName.get(qnameKey(name)) ?? null;
  }

  globalElements(): readonly CompiledElement[] {
    return [...this.elementsByName.values()];
  }

  private compileElement(
    raw: RawElement,
    document: AssembledDocument,
    global: boolean,
  ): CompiledElement | null {
    if (raw.name === null) return null;
    const name = declaredName(raw, document);
    if (name === null) return null;

    return {
      name,
      global,
      nillable: raw.nillable,
      abstract: raw.abstract,
      occurs: raw.occurs,
      defaultValue: raw.defaultValue,
      fixedValue: raw.fixedValue,
      substitutionGroup: raw.substitutionGroup,
      block: raw.block ?? document.schema.blockDefault,
      documentation: raw.annotation?.documentation ?? '',
      origin: raw.origin,
      typeName: raw.type,
      inlineType: raw.inlineType,
    };
  }

  /**
   * Substitution groups, resolved to a flat member list per head.
   *
   * Kept as a set of names on the particle rather than expanded into separate automaton positions:
   * on UBL a head can have hundreds of members, and expanding both explodes the state count and
   * destroys the 1-unambiguity that makes the automaton deterministic.
   */
  private indexSubstitutionGroups(): void {
    const direct = new Map<string, CompiledElement[]>();
    for (const element of this.elementsByName.values()) {
      for (const head of element.substitutionGroup) {
        const key = qnameKey(this.symbols.normalize(head, element.origin));
        const list = direct.get(key);
        if (list === undefined) direct.set(key, [element]);
        else list.push(element);
      }
    }

    const collect = (headKey: string, seen: Set<string>): ElementName[] => {
      const out: ElementName[] = [];
      for (const member of direct.get(headKey) ?? []) {
        const memberKey = qnameKey(member.name);
        if (seen.has(memberKey)) continue; // a cycle; a schema error, but not a hang
        seen.add(memberKey);
        // An abstract element cannot itself appear, but its own substitutes still can.
        if (!member.abstract) out.push(member.name);
        out.push(...collect(memberKey, seen));
      }
      return out;
    };

    for (const headKey of direct.keys()) {
      this.substitutions.set(headKey, collect(headKey, new Set([headKey])));
    }
  }

  substitutionMembers(head: ElementName): readonly ElementName[] {
    return this.substitutions.get(qnameKey(head)) ?? [];
  }

  // --- types ------------------------------------------------------------

  typeByName(name: XsdQName, origin: Origin): CompiledType {
    const normalized = this.symbols.normalize(name, origin);
    const key = qnameKey(normalized);
    const cached = this.typeCache.get(key);
    if (cached !== undefined) return cached;

    if (normalized.namespaceUri === XSD_NS && normalized.localName === 'anyType') {
      this.typeCache.set(key, ANY_TYPE_DEF);
      return ANY_TYPE_DEF;
    }
    if (builtInType(normalized) !== null) {
      const simple = this.simpleTypes.compileByName(normalized, origin);
      this.typeCache.set(key, simple);
      return simple;
    }

    const raw = this.symbols.lookupType(normalized, origin);
    if (raw === null) {
      this.symbols.reportUnresolved('type', normalized, origin);
      return ANY_TYPE_DEF;
    }

    const compiled =
      raw.form === 'simple' ? this.simpleTypes.compile(raw) : this.compileComplex(raw);
    this.typeCache.set(key, compiled);
    return compiled;
  }

  /** The type of an element declaration, resolved on demand. */
  typeOf(element: CompiledElement): CompiledType {
    if (element.inlineType !== null) {
      return element.inlineType.form === 'simple'
        ? this.simpleTypes.compile(element.inlineType)
        : this.compileComplex(element.inlineType);
    }
    if (element.typeName !== null) return this.typeByName(element.typeName, element.origin);
    // An element with no type at all is `xs:anyType`, which is why an unconstrained document still
    // opens and still edits.
    return ANY_TYPE_DEF;
  }

  compileComplex(raw: RawComplexType): CompiledComplexType {
    const cached = this.complexByRaw.get(raw);
    if (cached !== undefined) return cached;

    if (this.compilingComplex.has(raw)) {
      this.diagnostics.push({
        severity: 'error',
        code: 'circular-type',
        message: `The type "${raw.name ?? 'this anonymous type'}" is derived from itself.`,
        origin: raw.origin,
      });
      return ANY_TYPE_DEF;
    }
    this.compilingComplex.add(raw);
    const compiled = this.compileComplexUncached(raw);
    this.compilingComplex.delete(raw);
    this.complexByRaw.set(raw, compiled);
    return compiled;
  }

  private compileComplexUncached(raw: RawComplexType): CompiledComplexType {
    const document = this.symbols.documentOf(raw.origin.documentUri);
    const name =
      raw.name === null
        ? null
        : { namespaceUri: document?.targetNamespace ?? null, localName: raw.name };

    const base: Partial<CompiledComplexType> = {
      form: 'complex',
      name,
      abstract: raw.abstract,
      block: raw.block ?? document?.schema.blockDefault ?? EMPTY_DERIVATION_SET,
      final: raw.final ?? document?.schema.finalDefault ?? EMPTY_DERIVATION_SET,
      assertions: raw.assertions,
      documentation: raw.annotation?.documentation ?? '',
      origin: raw.origin,
    };

    switch (raw.content.kind) {
      case 'particle': {
        const particle = this.toParticle(raw.content.particle, raw.origin);
        return {
          ...(base as CompiledComplexType),
          contentKind: particle === null ? (raw.mixed ? 'mixed' : 'empty') : raw.mixed ? 'mixed' : 'element-only',
          particle,
          simpleType: null,
          attributes: this.mergeAttributes([], this.attributeUses(raw, raw.origin)),
          anyAttribute: this.wildcardOf(raw.anyAttribute, raw.origin),
          baseName: ANY_TYPE,
          derivationMethod: null,
        };
      }

      case 'simple-content': {
        const content = raw.content;
        const baseType =
          content.base === null ? ANY_TYPE_DEF : this.typeByName(content.base, content.origin);

        // Extending a complex type with simple content keeps its text type and adds attributes;
        // extending a simple type makes that the text type.
        let simpleType: CompiledSimpleType | null =
          baseType.form === 'simple' ? baseType : baseType.simpleType;

        if (content.derivationKind === 'restriction' && content.facets.length > 0) {
          simpleType = this.restrictSimpleContent(simpleType, content.facets, content.origin);
        } else if (content.baseInline !== null) {
          simpleType = this.simpleTypes.compile(content.baseInline);
        }

        const inherited = baseType.form === 'complex' ? baseType.attributes : [];
        return {
          ...(base as CompiledComplexType),
          contentKind: 'simple',
          particle: null,
          simpleType,
          attributes: this.mergeAttributes(inherited, this.attributeUses(raw, content.origin)),
          anyAttribute:
            this.wildcardOf(raw.anyAttribute, content.origin) ??
            (baseType.form === 'complex' ? baseType.anyAttribute : null),
          baseName: content.base,
          derivationMethod: content.derivationKind,
        };
      }

      case 'complex-content': {
        const content = raw.content;
        const baseType =
          content.base === null ? ANY_TYPE_DEF : this.typeByName(content.base, content.origin);
        const baseComplex = baseType.form === 'complex' ? baseType : ANY_TYPE_DEF;
        const own = this.toParticle(content.particle, content.origin);

        // Extension concatenates: the base's content, then the extension's. Restriction replaces —
        // the spec requires the replacement to be a valid restriction, which is checked in Phase 6
        // rather than here, since a schema *author* needs that and a document user does not.
        const particle =
          content.derivationKind === 'extension'
            ? concatenate(baseComplex.particle, own)
            : own;

        const mixed = content.mixed ?? raw.mixed ?? baseComplex.contentKind === 'mixed';
        return {
          ...(base as CompiledComplexType),
          contentKind: particle === null ? (mixed ? 'mixed' : 'empty') : mixed ? 'mixed' : 'element-only',
          particle,
          simpleType: null,
          attributes: this.mergeAttributes(
            baseComplex.attributes,
            this.attributeUses(raw, content.origin),
          ),
          anyAttribute: this.wildcardOf(raw.anyAttribute, content.origin) ?? baseComplex.anyAttribute,
          baseName: content.base,
          derivationMethod: content.derivationKind,
        };
      }
    }
  }

  private restrictSimpleContent(
    base: CompiledSimpleType | null,
    facets: readonly RawFacet[],
    origin: Origin,
  ): CompiledSimpleType | null {
    if (base === null) return null;
    // Reuse the simple-type compiler by handing it a synthetic restriction, so facet inheritance
    // behaves identically whether the facets were written in a simpleType or a simpleContent.
    return this.simpleTypes.compile({
      form: 'simple',
      origin,
      name: null,
      final: null,
      derivation: {
        kind: 'restriction',
        base: base.name,
        baseInline: null,
        facets,
        assertions: [],
      },
      annotation: null,
    });
  }

  // --- attributes -------------------------------------------------------

  private attributeUses(owner: RawAttributeOwner, origin: Origin): AttributeUse[] {
    const out: AttributeUse[] = [];

    for (const groupRef of owner.attributeGroups) {
      const group = this.symbols.lookupAttributeGroup(groupRef, origin);
      if (group === null) {
        this.symbols.reportUnresolved('attributeGroup', groupRef, origin);
        continue;
      }
      // Attribute groups nest; the recursion is bounded by the symbol table, and a cycle would be a
      // schema error caught by the duplicate check rather than looping here.
      out.push(...this.attributeUses(group, group.origin));
    }

    for (const attribute of owner.attributes) {
      const use = this.attributeUse(attribute);
      if (use !== null) out.push(use);
    }
    // Deliberately keeps `prohibited` entries: they are instructions to the merge against the base,
    // and dropping them here would silently turn a restriction into a no-op.
    const byName = new Map<string, AttributeUse>();
    for (const use of out) byName.set(qnameKey(use.name), use);
    return [...byName.values()];
  }

  private attributeUse(raw: RawAttribute): AttributeUse | null {
    const document = this.symbols.documentOf(raw.origin.documentUri);
    if (document === undefined) return null;

    let name: XsdQName | null;
    let declaration: RawAttribute = raw;

    if (raw.ref !== null) {
      const global = this.symbols.lookupAttribute(raw.ref, raw.origin);
      if (global === null) {
        this.symbols.reportUnresolved('attribute', raw.ref, raw.origin);
        return null;
      }
      const globalDocument = this.symbols.documentOf(global.origin.documentUri);
      name = globalDocument === undefined ? null : declaredName(global, globalDocument);
      declaration = global;
    } else {
      name = declaredName(raw, document);
    }
    if (name === null) return null;

    const type =
      declaration.inlineType !== null
        ? this.simpleTypes.compile(declaration.inlineType)
        : declaration.type !== null
          ? this.simpleTypes.compileByName(declaration.type, declaration.origin)
          : this.simpleTypes.compileByName(
              { namespaceUri: XSD_NS, localName: 'anySimpleType' },
              declaration.origin,
            );

    return {
      name,
      type,
      // `use` and the value constraints come from the *reference*, not the global declaration.
      use: raw.use,
      defaultValue: raw.defaultValue ?? declaration.defaultValue,
      fixedValue: raw.fixedValue ?? declaration.fixedValue,
      documentation: declaration.annotation?.documentation ?? raw.annotation?.documentation ?? '',
      origin: raw.origin,
    };
  }

  /** Later uses win, and `prohibited` removes rather than shadows. */
  private mergeAttributes(
    inherited: readonly AttributeUse[],
    own: readonly AttributeUse[],
  ): AttributeUse[] {
    const byName = new Map<string, AttributeUse>();
    for (const use of inherited) byName.set(qnameKey(use.name), use);
    for (const use of own) {
      const key = qnameKey(use.name);
      if (use.use === 'prohibited') byName.delete(key);
      else byName.set(key, use);
    }
    return [...byName.values()];
  }

  private wildcardOf(
    raw: { namespace: NamespaceSpec; processContents: ProcessContents } | null,
    origin: Origin,
  ): Wildcard | null {
    if (raw === null) return null;
    return {
      namespaceConstraint: this.namespaceConstraint(raw.namespace, origin),
      processContents: raw.processContents,
    };
  }

  private namespaceConstraint(spec: NamespaceSpec, origin: Origin): NamespaceConstraint {
    const target = this.symbols.documentOf(origin.documentUri)?.targetNamespace ?? null;
    switch (spec.kind) {
      case 'any':
        return { kind: 'any' };
      case 'other':
        return { kind: 'other', exclude: target };
      case 'list':
        return {
          kind: 'list',
          namespaces: spec.namespaces.map((token) =>
            token.kind === 'uri' ? token.uri : token.kind === 'target' ? target : null,
          ),
        };
    }
  }

  // --- particles --------------------------------------------------------

  /**
   * Raw particle → the automaton's particle shape, resolving group and element references.
   *
   * This is the bridge between the two halves of the engine, and the place substitution groups are
   * baked in: by the time the automaton sees an element particle, it already knows every name that
   * may stand in for it.
   */
  private toParticle(raw: RawParticle | null, origin: Origin, seenGroups = new Set<string>()): Particle | null {
    if (raw === null) return null;

    switch (raw.kind) {
      case 'element': {
        const element = raw.element;
        if (element.ref !== null) {
          const global = this.symbols.lookupElement(element.ref, element.origin);
          if (global === null) {
            this.symbols.reportUnresolved('element', element.ref, element.origin);
            return null;
          }
          const name = this.symbols.normalize(element.ref, element.origin);
          return {
            kind: 'element',
            name,
            occurs: element.occurs,
            substitutions: this.substitutionMembers(name),
          };
        }

        const document = this.symbols.documentOf(element.origin.documentUri);
        if (document === undefined) return null;
        const name = declaredName(element, document);
        if (name === null) return null;
        return { kind: 'element', name, occurs: element.occurs, substitutions: [] };
      }

      case 'group-ref': {
        const key = qnameKey(this.symbols.normalize(raw.ref, raw.origin));
        if (seenGroups.has(key)) {
          this.diagnostics.push({
            severity: 'error',
            code: 'circular-group',
            message: `The group ${formatQName(raw.ref)} refers to itself.`,
            origin: raw.origin,
          });
          return null;
        }
        const group = this.symbols.lookupGroup(raw.ref, raw.origin);
        if (group === null) {
          this.symbols.reportUnresolved('group', raw.ref, raw.origin);
          return null;
        }
        const inner = this.toParticle(group.particle, group.origin, new Set([...seenGroups, key]));
        if (inner === null) return null;
        // The reference's own occurrence bounds wrap the group's content.
        return applyOccurs(inner, raw.occurs);
      }

      case 'sequence':
      case 'choice': {
        const items = raw.items
          .map((item) => this.toParticle(item, origin, seenGroups))
          .filter((item): item is Particle => item !== null);
        if (items.length === 0) return null;
        return { kind: raw.kind, items, occurs: raw.occurs };
      }

      case 'all': {
        const items: { name: ElementName; occurs: Occurs }[] = [];
        for (const item of raw.items) {
          const compiled = this.toParticle(item, origin, seenGroups);
          if (compiled?.kind === 'element') items.push({ name: compiled.name, occurs: compiled.occurs });
        }
        return { kind: 'all', items, occurs: raw.occurs };
      }

      case 'any':
        return {
          kind: 'wildcard',
          namespaceConstraint: this.namespaceConstraint(raw.namespace, raw.origin),
          processContents: raw.processContents,
          occurs: raw.occurs,
        };
    }
  }

  // --- content models ---------------------------------------------------

  contentModel(type: CompiledComplexType): ContentModel {
    const cached = this.contentModels.get(type);
    if (cached !== undefined) return cached;

    const model = this.buildContentModel(type);
    this.contentModels.set(type, model);
    return model;
  }

  private buildContentModel(type: CompiledComplexType): ContentModel {
    if (type === ANY_TYPE_DEF) return { kind: 'any' };
    if (type.particle === null) return { kind: 'empty' };
    if (type.particle.kind === 'all') return { kind: 'all', model: compileAll(type.particle) };
    return { kind: 'automaton', model: compileContentModel(type.particle), particle: type.particle };
  }

  // --- derivation -------------------------------------------------------

  /** Whether `derived` is `base`, or reaches it by extension or restriction. */
  isDerivedFrom(derived: CompiledType, base: XsdQName, origin: Origin): boolean {
    let cursor: CompiledType | null = derived;
    const seen = new Set<string>();

    while (cursor !== null) {
      if (cursor.name !== null) {
        const key = qnameKey(cursor.name);
        if (key === qnameKey(this.symbols.normalize(base, origin))) return true;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      const next: XsdQName | null = cursor.form === 'complex' ? cursor.baseName : cursor.baseName;
      if (next === null) return false;
      const resolved: CompiledType = this.typeByName(next, origin);
      cursor = resolved === cursor ? null : resolved;
    }
    return false;
  }

  /**
   * Whether an element may be replaced by `member` through its substitution group.
   *
   * `block="substitution"` on the head is the reason this is a method rather than a set lookup: a
   * head can advertise members and then forbid their use, and a palette that ignored that would
   * offer elements the validator rejects.
   */
  canSubstitute(head: CompiledElement, member: ElementName): boolean {
    if (derivationSetHas(head.block, 'substitution')) return false;
    const candidate = this.globalElement(member);
    return candidate !== null && !candidate.abstract;
  }
}

/**
 * `xs:anyType`, the ur-type: mixed content, any children, any attributes.
 *
 * Every element with no declared type has this type, so it is what makes an unconstrained document
 * editable rather than an error.
 */
export const ANY_TYPE_DEF: CompiledComplexType = {
  form: 'complex',
  name: ANY_TYPE,
  contentKind: 'mixed',
  particle: particleOf.wildcard(ANY_NUMBER, { kind: 'any' }, 'lax'),
  simpleType: null,
  attributes: [],
  anyAttribute: { namespaceConstraint: { kind: 'any' }, processContents: 'lax' },
  abstract: false,
  baseName: null,
  derivationMethod: null,
  block: EMPTY_DERIVATION_SET,
  final: EMPTY_DERIVATION_SET,
  assertions: [],
  documentation: 'anything',
  origin: { documentUri: '', node: 0 as never },
};

function applyOccurs(particle: Particle, occurs: Occurs): Particle {
  if (occurs.min === 1 && occurs.max === 1) return particle;
  if (particle.kind === 'empty') return particle;
  // Wrapping in a sequence keeps the group's own internal bounds intact.
  return { kind: 'sequence', items: [particle], occurs };
}

/** Extension appends the derived content to the base's, in that order. */
function concatenate(base: Particle | null, own: Particle | null): Particle | null {
  if (base === null) return own;
  if (own === null) return base;
  return { kind: 'sequence', items: [base, own], occurs: ONCE };
}
