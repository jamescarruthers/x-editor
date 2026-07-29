/**
 * XSD document → raw AST (P1 in `docs/schema-engine.md` §6).
 *
 * Two rules govern this file:
 *
 * 1. **It never throws.** A schema a beginner is halfway through writing must still produce an AST,
 *    because the XSD editing mode is driven by the same parse. Everything wrong becomes a
 *    diagnostic and parsing continues with a defensible default.
 * 2. **It resolves names but interprets nothing.** QNames in attribute values are resolved here,
 *    because only here are the in-scope prefix bindings available — and resolving them against the
 *    *instance* document later is the classic XSD bug. Everything else is left for later stages.
 */

import { ROOT_ID, XmlDocument, isElement, type ElementNode, type NodeId } from '@x-editor/xml-core';
import {
  EMPTY_DERIVATION_SET,
  FACET_NAMES,
  UNBOUNDED,
  XSD_NS,
  emptyComponents,
  type Annotation,
  type DerivationControl,
  type DerivationSet,
  type FacetName,
  type Form,
  type NamespaceSpec,
  type NamespaceToken,
  type Occurs,
  type Origin,
  type ProcessContents,
  type RawAnyAttribute,
  type RawAssertion,
  type RawAttribute,
  type RawAttributeGroup,
  type RawComplexContent,
  type RawComplexType,
  type RawComposition,
  type RawElement,
  type RawFacet,
  type RawGroup,
  type RawIdentityConstraint,
  type RawModelGroup,
  type RawNotation,
  type RawParticle,
  type RawSchema,
  type RawSchemaComponents,
  type RawSimpleDerivation,
  type RawSimpleType,
  type RawType,
  type SchemaDiagnostic,
  type XsdQName,
} from './ast.js';

const VC_NS = 'http://www.w3.org/2007/XMLSchema-versioning';

export interface ParseSchemaResult {
  readonly schema: RawSchema;
  readonly diagnostics: readonly SchemaDiagnostic[];
  /** The parsed document, retained so callers can map diagnostics back to source spans. */
  readonly document: XmlDocument;
}

export function parseSchemaSource(source: string, documentUri: string): ParseSchemaResult {
  return parseSchemaDocument(XmlDocument.parse(source), documentUri);
}

export function parseSchemaDocument(document: XmlDocument, documentUri: string): ParseSchemaResult {
  const parser = new SchemaParser(document, documentUri);
  const schema = parser.parse();
  return { schema, diagnostics: parser.diagnostics, document };
}

class SchemaParser {
  readonly diagnostics: SchemaDiagnostic[] = [];

  private elementFormDefault: Form = 'unqualified';
  private attributeFormDefault: Form = 'unqualified';
  private targetNamespace: string | null = null;

  constructor(
    private readonly doc: XmlDocument,
    private readonly documentUri: string,
  ) {}

  // --- infrastructure ---------------------------------------------------

  private origin(node: NodeId): Origin {
    return { documentUri: this.documentUri, node };
  }

  private error(node: NodeId, code: string, message: string): void {
    this.diagnostics.push({ severity: 'error', code, message, origin: this.origin(node) });
  }

  private warn(node: NodeId, code: string, message: string): void {
    this.diagnostics.push({ severity: 'warning', code, message, origin: this.origin(node) });
  }

  private element(id: NodeId): ElementNode | null {
    const node = this.doc.node(id);
    return node !== undefined && isElement(node) ? node : null;
  }

  /** XSD-namespace element children, in order. Anything else is reported and skipped. */
  private xsdChildren(id: NodeId): { id: NodeId; name: string }[] {
    const out: { id: NodeId; name: string }[] = [];
    for (const childId of this.doc.childrenOf(id)) {
      const child = this.element(childId);
      if (child === null) continue;
      if (child.name.namespaceUri !== XSD_NS) {
        this.warn(
          childId,
          'foreign-element',
          `<${child.name.localName}> is not in the XML Schema namespace and was ignored.`,
        );
        continue;
      }
      out.push({ id: childId, name: child.name.localName });
    }
    return out;
  }

  /** An unprefixed attribute value. XSD attributes are always unqualified. */
  private attr(id: NodeId, name: string): string | null {
    const element = this.element(id);
    if (element === null) return null;
    for (const attribute of element.attributes) {
      if (attribute.name.prefix === '' && attribute.name.localName === name) return attribute.value;
    }
    return null;
  }

  private boolAttr(id: NodeId, name: string, fallback: boolean): boolean {
    const raw = this.attr(id, name);
    if (raw === null) return fallback;
    const value = raw.trim();
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    this.error(id, 'bad-boolean', `@${name} must be true or false, not "${raw}".`);
    return fallback;
  }

  /**
   * A QName written inside an attribute value, resolved against the bindings in scope *here*.
   *
   * An unprefixed QName resolves through the default namespace, which is why so many schemas that
   * declare `xmlns="…the target namespace…"` work and so many that do not, quietly do not.
   */
  private qnameAttr(id: NodeId, name: string): XsdQName | null {
    const raw = this.attr(id, name);
    if (raw === null) return null;
    return this.resolveQName(id, raw.trim(), name);
  }

  private resolveQName(id: NodeId, text: string, attributeName: string): XsdQName | null {
    const colon = text.indexOf(':');
    if (colon < 0) {
      const bindings = this.doc.inScopeNamespaces(id);
      return { namespaceUri: bindings.get('') ?? null, localName: text };
    }
    const prefix = text.slice(0, colon);
    const localName = text.slice(colon + 1);
    const uri = this.doc.inScopeNamespaces(id).get(prefix);
    if (uri === undefined) {
      this.error(
        id,
        'undeclared-prefix',
        `@${attributeName} uses the prefix "${prefix}:", which is not declared here.`,
      );
      return null;
    }
    return { namespaceUri: uri, localName };
  }

  private qnameListAttr(id: NodeId, name: string): XsdQName[] {
    const raw = this.attr(id, name);
    if (raw === null) return [];
    const out: XsdQName[] = [];
    for (const token of raw.split(/\s+/).filter((t) => t !== '')) {
      const resolved = this.resolveQName(id, token, name);
      if (resolved !== null) out.push(resolved);
    }
    return out;
  }

  private occurs(id: NodeId): Occurs {
    const parse = (name: string, fallback: number): number => {
      const raw = this.attr(id, name);
      if (raw === null) return fallback;
      const text = raw.trim();
      if (name === 'maxOccurs' && text === 'unbounded') return UNBOUNDED;
      const value = Number(text);
      if (!Number.isInteger(value) || value < 0) {
        this.error(id, 'bad-occurs', `@${name} must be a non-negative integer, not "${raw}".`);
        return fallback;
      }
      return value;
    };
    const min = parse('minOccurs', 1);
    const max = parse('maxOccurs', 1);
    if (max < min) {
      this.error(id, 'bad-occurs', `@maxOccurs (${max}) is less than @minOccurs (${min}).`);
      return { min, max: min };
    }
    return { min, max };
  }

  private derivationSet(id: NodeId, name: string): DerivationSet | null {
    const raw = this.attr(id, name);
    if (raw === null) return null;
    const text = raw.trim();
    if (text === '#all') return { kind: 'all' };
    const values: DerivationControl[] = [];
    for (const token of text.split(/\s+/).filter((t) => t !== '')) {
      if (
        token === 'extension' ||
        token === 'restriction' ||
        token === 'substitution' ||
        token === 'list' ||
        token === 'union'
      ) {
        values.push(token);
      } else {
        this.error(id, 'bad-derivation-control', `"${token}" is not a valid value for @${name}.`);
      }
    }
    return { kind: 'set', values };
  }

  private formAttr(id: NodeId, fallback: Form): Form {
    const raw = this.attr(id, 'form');
    if (raw === null) return fallback;
    if (raw === 'qualified' || raw === 'unqualified') return raw;
    this.error(id, 'bad-form', `@form must be qualified or unqualified, not "${raw}".`);
    return fallback;
  }

  private annotation(id: NodeId): Annotation | null {
    for (const child of this.xsdChildren(id)) {
      if (child.name !== 'annotation') continue;
      const parts: string[] = [];
      const appinfo: NodeId[] = [];
      for (const grandchild of this.xsdChildren(child.id)) {
        if (grandchild.name === 'documentation') parts.push(this.textOf(grandchild.id));
        else if (grandchild.name === 'appinfo') appinfo.push(grandchild.id);
      }
      return {
        origin: this.origin(child.id),
        documentation: parts.join(' ').replace(/\s+/g, ' ').trim(),
        appinfo,
      };
    }
    return null;
  }

  /** Concatenated descendant text, used only for `xs:documentation`. */
  private textOf(id: NodeId): string {
    let out = '';
    const visit = (nodeId: NodeId): void => {
      const node = this.doc.node(nodeId);
      if (node === undefined) return;
      if (node.kind === 'text' || node.kind === 'cdata') out += node.value;
      for (const child of this.doc.childrenOf(nodeId)) visit(child);
    };
    visit(id);
    return out;
  }

  private namespaceSpec(id: NodeId): NamespaceSpec {
    const raw = this.attr(id, 'namespace');
    if (raw === null) return { kind: 'any' };
    const text = raw.trim();
    if (text === '##any') return { kind: 'any' };
    if (text === '##other') return { kind: 'other' };
    return { kind: 'list', namespaces: this.namespaceTokens(text) };
  }

  private processContents(id: NodeId): ProcessContents {
    const raw = this.attr(id, 'processContents');
    if (raw === null) return 'strict';
    if (raw === 'strict' || raw === 'lax' || raw === 'skip') return raw;
    this.error(id, 'bad-process-contents', `@processContents cannot be "${raw}".`);
    return 'strict';
  }

  private namespaceTokens(text: string): NamespaceToken[] {
    return text
      .split(/\s+/)
      .filter((t) => t !== '')
      .map((token): NamespaceToken =>
        token === '##targetNamespace'
          ? { kind: 'target' }
          : token === '##local'
            ? { kind: 'absent' }
            : { kind: 'uri', uri: token },
      );
  }

  private notNamespace(id: NodeId): NamespaceToken[] | null {
    const raw = this.attr(id, 'notNamespace');
    if (raw === null) return null;
    return this.namespaceTokens(raw.trim());
  }

  // --- the schema element -----------------------------------------------

  parse(): RawSchema {
    const rootId = this.doc.documentElement();
    const root = rootId === undefined ? null : this.element(rootId);

    if (rootId === undefined || root === null) {
      this.error(ROOT_ID, 'no-schema', 'This file has no root element, so it is not a schema.');
      return this.emptySchema(ROOT_ID);
    }
    if (root.name.namespaceUri !== XSD_NS || root.name.localName !== 'schema') {
      this.error(
        rootId,
        'not-a-schema',
        `Expected <xs:schema> at the top level, found <${root.name.localName}>.`,
      );
      return this.emptySchema(rootId);
    }

    const rawTarget = this.attr(rootId, 'targetNamespace');
    // `targetNamespace=""` is invalid rather than "no namespace", and it is a common paste error.
    if (rawTarget === '') {
      this.error(rootId, 'empty-target-namespace', '@targetNamespace cannot be the empty string.');
    }
    this.targetNamespace = rawTarget === null || rawTarget === '' ? null : rawTarget;
    this.elementFormDefault = this.formDefault(rootId, 'elementFormDefault');
    this.attributeFormDefault = this.formDefault(rootId, 'attributeFormDefault');

    const components = this.components(rootId, { topLevel: true });
    const compositions: RawComposition[] = [];
    for (const child of this.xsdChildren(rootId)) {
      const composition = this.composition(child.id, child.name);
      if (composition !== null) compositions.push(composition);
    }

    return {
      documentUri: this.documentUri,
      origin: this.origin(rootId),
      targetNamespace: this.targetNamespace,
      elementFormDefault: this.elementFormDefault,
      attributeFormDefault: this.attributeFormDefault,
      blockDefault: this.derivationSet(rootId, 'blockDefault') ?? EMPTY_DERIVATION_SET,
      finalDefault: this.derivationSet(rootId, 'finalDefault') ?? EMPTY_DERIVATION_SET,
      version: this.attr(rootId, 'version'),
      compositions,
      declaredVersion: this.declaredVersion(rootId),
      annotation: this.annotation(rootId),
      ...components,
    };
  }

  private formDefault(id: NodeId, name: string): Form {
    const raw = this.attr(id, name);
    if (raw === null) return 'unqualified';
    if (raw === 'qualified' || raw === 'unqualified') return raw;
    this.error(id, 'bad-form', `@${name} must be qualified or unqualified, not "${raw}".`);
    return 'unqualified';
  }

  /**
   * Which XSD version this document asks for.
   *
   * `vc:minVersion="1.1"` is the conventional marker, and it matters well beyond pedantry: the
   * differential harness dispatches on it, and pointing a 1.0 oracle at a 1.1 schema produces a
   * flood of false failures rather than one clear one (PLAN.md §5.1).
   */
  private declaredVersion(id: NodeId): '1.0' | '1.1' {
    const element = this.element(id);
    if (element !== null) {
      for (const attribute of element.attributes) {
        if (attribute.name.namespaceUri === VC_NS && attribute.name.localName === 'minVersion') {
          return attribute.value.trim().startsWith('1.1') ? '1.1' : '1.0';
        }
      }
    }
    // A schema using 1.1-only constructs without declaring itself is common; the assembler upgrades
    // the verdict after it has seen the components.
    return '1.0';
  }

  private emptySchema(node: NodeId): RawSchema {
    return {
      documentUri: this.documentUri,
      origin: this.origin(node),
      targetNamespace: null,
      elementFormDefault: 'unqualified',
      attributeFormDefault: 'unqualified',
      blockDefault: EMPTY_DERIVATION_SET,
      finalDefault: EMPTY_DERIVATION_SET,
      version: null,
      compositions: [],
      declaredVersion: '1.0',
      annotation: null,
      ...emptyComponents(),
    };
  }

  // --- top-level component lists ----------------------------------------

  private components(id: NodeId, options: { topLevel: boolean }): RawSchemaComponents {
    const elements: RawElement[] = [];
    const attributes: RawAttribute[] = [];
    const types: RawType[] = [];
    const groups: RawGroup[] = [];
    const attributeGroups: RawAttributeGroup[] = [];
    const notations: RawNotation[] = [];

    for (const child of this.xsdChildren(id)) {
      switch (child.name) {
        case 'element':
          elements.push(this.elementDeclaration(child.id, { global: true }));
          break;
        case 'attribute':
          attributes.push(this.attributeDeclaration(child.id, { global: true }));
          break;
        case 'simpleType':
          types.push(this.simpleType(child.id, { global: true }));
          break;
        case 'complexType':
          types.push(this.complexType(child.id, { global: true }));
          break;
        case 'group':
          groups.push(this.groupDefinition(child.id));
          break;
        case 'attributeGroup':
          attributeGroups.push(this.attributeGroupDefinition(child.id));
          break;
        case 'notation':
          notations.push(this.notation(child.id));
          break;
        case 'annotation':
        case 'include':
        case 'import':
        case 'redefine':
        case 'override':
          break;
        default:
          if (options.topLevel) {
            this.error(
              child.id,
              'unexpected-child',
              `<xs:${child.name}> is not allowed at the top level of a schema.`,
            );
          }
      }
    }

    return { elements, attributes, types, groups, attributeGroups, notations };
  }

  private composition(id: NodeId, name: string): RawComposition | null {
    if (name !== 'include' && name !== 'import' && name !== 'redefine' && name !== 'override') {
      return null;
    }
    const schemaLocation = this.attr(id, 'schemaLocation');
    if (schemaLocation === null && name !== 'import') {
      this.error(id, 'missing-schema-location', `<xs:${name}> requires @schemaLocation.`);
    }
    return {
      origin: this.origin(id),
      kind: name,
      schemaLocation,
      namespace: name === 'import' ? this.attr(id, 'namespace') : null,
      components:
        name === 'redefine' || name === 'override'
          ? this.components(id, { topLevel: false })
          : null,
    };
  }

  // --- element and attribute declarations -------------------------------

  private elementDeclaration(id: NodeId, options: { global: boolean }): RawElement {
    const name = this.attr(id, 'name');
    const ref = this.qnameAttr(id, 'ref');

    if (name === null && ref === null) {
      this.error(id, 'missing-name', '<xs:element> needs either @name or @ref.');
    }
    if (name !== null && ref !== null) {
      this.error(id, 'name-and-ref', '<xs:element> cannot have both @name and @ref.');
    }

    const form = options.global ? 'qualified' : this.formAttr(id, this.elementFormDefault);
    let inlineType: RawSimpleType | RawComplexType | null = null;
    const identityConstraints: RawIdentityConstraint[] = [];

    for (const child of this.xsdChildren(id)) {
      switch (child.name) {
        case 'simpleType':
          inlineType = this.simpleType(child.id, { global: false });
          break;
        case 'complexType':
          inlineType = this.complexType(child.id, { global: false });
          break;
        case 'key':
        case 'keyref':
        case 'unique':
          identityConstraints.push(this.identityConstraint(child.id, child.name));
          break;
        default:
          break;
      }
    }

    if (inlineType !== null && this.attr(id, 'type') !== null) {
      this.error(
        id,
        'type-and-inline',
        'An element cannot have both @type and an inline type definition.',
      );
    }

    return {
      origin: this.origin(id),
      name,
      ref,
      qualified: form === 'qualified',
      explicitTargetNamespace: this.attr(id, 'targetNamespace'),
      global: options.global,
      type: this.qnameAttr(id, 'type'),
      inlineType,
      occurs: options.global ? { min: 1, max: 1 } : this.occurs(id),
      nillable: this.boolAttr(id, 'nillable', false),
      abstract: this.boolAttr(id, 'abstract', false),
      defaultValue: this.attr(id, 'default'),
      fixedValue: this.attr(id, 'fixed'),
      substitutionGroup: this.qnameListAttr(id, 'substitutionGroup'),
      block: this.derivationSet(id, 'block'),
      final: this.derivationSet(id, 'final'),
      identityConstraints,
      annotation: this.annotation(id),
    };
  }

  private attributeDeclaration(id: NodeId, options: { global: boolean }): RawAttribute {
    const name = this.attr(id, 'name');
    const ref = this.qnameAttr(id, 'ref');
    if (name === null && ref === null) {
      this.error(id, 'missing-name', '<xs:attribute> needs either @name or @ref.');
    }

    const form = options.global ? 'qualified' : this.formAttr(id, this.attributeFormDefault);
    let inlineType: RawSimpleType | null = null;
    for (const child of this.xsdChildren(id)) {
      if (child.name === 'simpleType') inlineType = this.simpleType(child.id, { global: false });
    }

    const rawUse = this.attr(id, 'use');
    let use: RawAttribute['use'] = 'optional';
    if (rawUse !== null) {
      if (rawUse === 'optional' || rawUse === 'required' || rawUse === 'prohibited') use = rawUse;
      else this.error(id, 'bad-use', `@use cannot be "${rawUse}".`);
    }

    return {
      origin: this.origin(id),
      name,
      ref,
      qualified: form === 'qualified',
      explicitTargetNamespace: this.attr(id, 'targetNamespace'),
      global: options.global,
      type: this.qnameAttr(id, 'type'),
      inlineType,
      use: options.global ? 'optional' : use,
      defaultValue: this.attr(id, 'default'),
      fixedValue: this.attr(id, 'fixed'),
      annotation: this.annotation(id),
    };
  }

  private identityConstraint(
    id: NodeId,
    kind: 'key' | 'keyref' | 'unique',
  ): RawIdentityConstraint {
    let selector: string | null = null;
    const fields: string[] = [];
    for (const child of this.xsdChildren(id)) {
      if (child.name === 'selector') selector = this.attr(child.id, 'xpath');
      else if (child.name === 'field') {
        const xpath = this.attr(child.id, 'xpath');
        if (xpath !== null) fields.push(xpath);
      }
    }
    return {
      origin: this.origin(id),
      kind,
      name: this.attr(id, 'name'),
      ref: this.qnameAttr(id, 'ref'),
      refer: this.qnameAttr(id, 'refer'),
      selector,
      fields,
    };
  }

  private anyAttribute(id: NodeId): RawAnyAttribute {
    return {
      origin: this.origin(id),
      namespace: this.namespaceSpec(id),
      processContents: this.processContents(id),
      notNamespace: this.notNamespace(id),
      notQName: this.tokenListAttr(id, 'notQName'),
    };
  }

  private tokenListAttr(id: NodeId, name: string): string[] | null {
    const raw = this.attr(id, name);
    if (raw === null) return null;
    return raw
      .trim()
      .split(/\s+/)
      .filter((t) => t !== '');
  }

  /** The attribute uses shared by complex types and attribute groups. */
  private attributeOwner(id: NodeId): {
    attributes: RawAttribute[];
    attributeGroups: XsdQName[];
    anyAttribute: RawAnyAttribute | null;
  } {
    const attributes: RawAttribute[] = [];
    const attributeGroups: XsdQName[] = [];
    let anyAttribute: RawAnyAttribute | null = null;

    for (const child of this.xsdChildren(id)) {
      if (child.name === 'attribute') {
        attributes.push(this.attributeDeclaration(child.id, { global: false }));
      } else if (child.name === 'attributeGroup') {
        const ref = this.qnameAttr(child.id, 'ref');
        if (ref === null) {
          this.error(child.id, 'missing-ref', 'A nested <xs:attributeGroup> must have @ref.');
        } else {
          attributeGroups.push(ref);
        }
      } else if (child.name === 'anyAttribute') {
        anyAttribute = this.anyAttribute(child.id);
      }
    }

    return { attributes, attributeGroups, anyAttribute };
  }

  // --- particles ---------------------------------------------------------

  /** The first particle among a node's children, or null if there is none. */
  private childParticle(id: NodeId): RawParticle | null {
    for (const child of this.xsdChildren(id)) {
      const particle = this.particle(child.id, child.name);
      if (particle !== null) return particle;
    }
    return null;
  }

  private particle(id: NodeId, name: string): RawParticle | null {
    switch (name) {
      case 'element':
        return { kind: 'element', element: this.elementDeclaration(id, { global: false }) };

      case 'group': {
        const ref = this.qnameAttr(id, 'ref');
        if (ref === null) {
          this.error(id, 'missing-ref', 'A <xs:group> used as a particle must have @ref.');
          return null;
        }
        return {
          kind: 'group-ref',
          origin: this.origin(id),
          ref,
          occurs: this.occurs(id),
          annotation: this.annotation(id),
        };
      }

      case 'sequence':
      case 'choice':
      case 'all':
        return this.modelGroup(id, name);

      case 'any':
        return {
          kind: 'any',
          origin: this.origin(id),
          namespace: this.namespaceSpec(id),
          processContents: this.processContents(id),
          occurs: this.occurs(id),
          notNamespace: this.notNamespace(id),
          notQName: this.tokenListAttr(id, 'notQName'),
          annotation: this.annotation(id),
        };

      default:
        return null;
    }
  }

  private modelGroup(id: NodeId, kind: 'sequence' | 'choice' | 'all'): RawModelGroup {
    const items: RawParticle[] = [];
    for (const child of this.xsdChildren(id)) {
      const particle = this.particle(child.id, child.name);
      if (particle !== null) items.push(particle);
    }
    return {
      kind,
      origin: this.origin(id),
      items,
      occurs: this.occurs(id),
      annotation: this.annotation(id),
    };
  }

  // --- type definitions --------------------------------------------------

  private simpleType(id: NodeId, options: { global: boolean }): RawSimpleType {
    const name = this.attr(id, 'name');
    if (options.global && name === null) {
      this.error(id, 'missing-name', 'A top-level <xs:simpleType> must have @name.');
    }

    let derivation: RawSimpleDerivation | null = null;
    for (const child of this.xsdChildren(id)) {
      if (child.name === 'restriction') derivation = this.simpleRestriction(child.id);
      else if (child.name === 'list') derivation = this.simpleList(child.id);
      else if (child.name === 'union') derivation = this.simpleUnion(child.id);
    }
    if (derivation === null) {
      this.error(
        id,
        'empty-simple-type',
        '<xs:simpleType> must contain a restriction, list or union.',
      );
    }

    return {
      form: 'simple',
      origin: this.origin(id),
      name,
      final: this.derivationSet(id, 'final'),
      derivation,
      annotation: this.annotation(id),
    };
  }

  private simpleRestriction(id: NodeId): RawSimpleDerivation {
    const facets: RawFacet[] = [];
    const assertions: RawAssertion[] = [];
    let baseInline: RawSimpleType | null = null;

    for (const child of this.xsdChildren(id)) {
      if (child.name === 'simpleType') {
        baseInline = this.simpleType(child.id, { global: false });
      } else if (child.name === 'assertion') {
        assertions.push(this.assertion(child.id));
      } else if ((FACET_NAMES as readonly string[]).includes(child.name)) {
        const value = this.attr(child.id, 'value');
        if (value === null) {
          this.error(child.id, 'missing-facet-value', `<xs:${child.name}> requires @value.`);
        } else {
          facets.push({
            origin: this.origin(child.id),
            name: child.name as FacetName,
            value,
            fixed: this.boolAttr(child.id, 'fixed', false),
            annotation: this.annotation(child.id),
          });
        }
      }
    }

    return { kind: 'restriction', base: this.qnameAttr(id, 'base'), baseInline, facets, assertions };
  }

  private simpleList(id: NodeId): RawSimpleDerivation {
    let itemInline: RawSimpleType | null = null;
    for (const child of this.xsdChildren(id)) {
      if (child.name === 'simpleType') itemInline = this.simpleType(child.id, { global: false });
    }
    return { kind: 'list', itemType: this.qnameAttr(id, 'itemType'), itemInline };
  }

  private simpleUnion(id: NodeId): RawSimpleDerivation {
    const memberInline: RawSimpleType[] = [];
    for (const child of this.xsdChildren(id)) {
      if (child.name === 'simpleType') memberInline.push(this.simpleType(child.id, { global: false }));
    }
    return {
      kind: 'union',
      memberTypes: this.qnameListAttr(id, 'memberTypes'),
      memberInline,
    };
  }

  private assertion(id: NodeId): RawAssertion {
    const test = this.attr(id, 'test');
    if (test === null) {
      this.error(id, 'missing-test', `<xs:${this.element(id)?.name.localName}> requires @test.`);
    }
    return {
      origin: this.origin(id),
      test: test ?? 'true()',
      xpathDefaultNamespace: this.attr(id, 'xpathDefaultNamespace'),
      annotation: this.annotation(id),
    };
  }

  private complexType(id: NodeId, options: { global: boolean }): RawComplexType {
    const name = this.attr(id, 'name');
    if (options.global && name === null) {
      this.error(id, 'missing-name', 'A top-level <xs:complexType> must have @name.');
    }

    const mixed = this.boolAttr(id, 'mixed', false);
    const assertions: RawAssertion[] = [];
    let content: RawComplexContent | null = null;
    let attributeOwner = this.attributeOwner(id);

    for (const child of this.xsdChildren(id)) {
      if (child.name === 'simpleContent') {
        content = this.simpleContent(child.id);
        attributeOwner = this.contentAttributeOwner(child.id);
      } else if (child.name === 'complexContent') {
        content = this.complexContent(child.id);
        attributeOwner = this.contentAttributeOwner(child.id);
      } else if (child.name === 'assert') {
        assertions.push(this.assertion(child.id));
      }
    }

    if (content === null) content = { kind: 'particle', particle: this.childParticle(id) };

    return {
      form: 'complex',
      origin: this.origin(id),
      name,
      abstract: this.boolAttr(id, 'abstract', false),
      mixed,
      block: this.derivationSet(id, 'block'),
      final: this.derivationSet(id, 'final'),
      content,
      assertions,
      annotation: this.annotation(id),
      ...attributeOwner,
    };
  }

  /** Attribute uses live on the extension/restriction element, not on the content wrapper. */
  private contentAttributeOwner(wrapperId: NodeId): {
    attributes: RawAttribute[];
    attributeGroups: XsdQName[];
    anyAttribute: RawAnyAttribute | null;
  } {
    for (const child of this.xsdChildren(wrapperId)) {
      if (child.name === 'extension' || child.name === 'restriction') {
        return this.attributeOwner(child.id);
      }
    }
    return { attributes: [], attributeGroups: [], anyAttribute: null };
  }

  private simpleContent(id: NodeId): RawComplexContent {
    for (const child of this.xsdChildren(id)) {
      if (child.name !== 'extension' && child.name !== 'restriction') continue;

      const facets: RawFacet[] = [];
      let baseInline: RawSimpleType | null = null;
      if (child.name === 'restriction') {
        const derivation = this.simpleRestriction(child.id);
        if (derivation.kind === 'restriction') {
          facets.push(...derivation.facets);
          baseInline = derivation.baseInline;
        }
      }

      return {
        kind: 'simple-content',
        derivationKind: child.name,
        base: this.qnameAttr(child.id, 'base'),
        baseInline,
        facets,
        origin: this.origin(child.id),
      };
    }

    this.error(id, 'empty-content', '<xs:simpleContent> must contain an extension or restriction.');
    return { kind: 'particle', particle: null };
  }

  private complexContent(id: NodeId): RawComplexContent {
    const mixed = this.attr(id, 'mixed');
    for (const child of this.xsdChildren(id)) {
      if (child.name !== 'extension' && child.name !== 'restriction') continue;
      return {
        kind: 'complex-content',
        derivationKind: child.name,
        base: this.qnameAttr(child.id, 'base'),
        mixed: mixed === null ? null : mixed === 'true' || mixed === '1',
        particle: this.childParticle(child.id),
        origin: this.origin(child.id),
      };
    }

    this.error(id, 'empty-content', '<xs:complexContent> must contain an extension or restriction.');
    return { kind: 'particle', particle: null };
  }

  private groupDefinition(id: NodeId): RawGroup {
    const name = this.attr(id, 'name');
    if (name === null) this.error(id, 'missing-name', 'A top-level <xs:group> must have @name.');

    let particle: RawModelGroup | null = null;
    for (const child of this.xsdChildren(id)) {
      if (child.name === 'sequence' || child.name === 'choice' || child.name === 'all') {
        particle = this.modelGroup(child.id, child.name);
      }
    }

    return {
      origin: this.origin(id),
      name: name ?? '',
      particle,
      annotation: this.annotation(id),
    };
  }

  private attributeGroupDefinition(id: NodeId): RawAttributeGroup {
    const name = this.attr(id, 'name');
    if (name === null) {
      this.error(id, 'missing-name', 'A top-level <xs:attributeGroup> must have @name.');
    }
    return {
      origin: this.origin(id),
      name: name ?? '',
      annotation: this.annotation(id),
      ...this.attributeOwner(id),
    };
  }

  private notation(id: NodeId): RawNotation {
    const name = this.attr(id, 'name');
    if (name === null) this.error(id, 'missing-name', '<xs:notation> requires @name.');
    return {
      origin: this.origin(id),
      name: name ?? '',
      publicId: this.attr(id, 'public'),
      systemId: this.attr(id, 'system'),
      annotation: this.annotation(id),
    };
  }
}
