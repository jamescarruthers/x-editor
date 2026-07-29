/**
 * Symbol spaces and reference resolution (P3).
 *
 * XSD has six symbol spaces — types, elements, attributes, model groups, attribute groups,
 * notations — plus identity constraints, and a name may be reused freely across them. A single flat
 * table would make `<xs:element ref="Address">` find a *type* called Address on schemas where both
 * exist, which is most large schemas.
 *
 * Every reference resolution in the whole engine goes through this one class, which is what makes
 * two otherwise-awkward features cheap:
 *
 * - **Chameleon includes.** A schema with no target namespace that is `include`d by one that has a
 *   target namespace has all its components pulled into that namespace, *and* its unprefixed
 *   references along with them. Because resolution happens here, and every reference carries the
 *   document it was written in, that is one normalisation step rather than a deep rewrite of the AST.
 * - **`xs:redefine`.** Self-references were rewritten to synthetic names during assembly, so they
 *   arrive here as ordinary lookups into a side table.
 */

import { REDEFINE_NS, type AssembledDocument, type SchemaSet } from './assemble.js';
import {
  formatQName,
  qnameKey,
  type Origin,
  type RawAttribute,
  type RawAttributeGroup,
  type RawElement,
  type RawGroup,
  type RawNotation,
  type RawType,
  type SchemaDiagnostic,
  type XsdQName,
} from './ast.js';

export type SymbolSpace = 'type' | 'element' | 'attribute' | 'group' | 'attributeGroup' | 'notation';

const SPACE_LABEL: Record<SymbolSpace, string> = {
  type: 'type',
  element: 'element',
  attribute: 'attribute',
  group: 'group',
  attributeGroup: 'attribute group',
  notation: 'notation',
};

export interface GlobalComponent<T> {
  readonly name: XsdQName;
  readonly raw: T;
  readonly documentUri: string;
}

export class SymbolTable {
  readonly diagnostics: SchemaDiagnostic[] = [];

  private readonly types = new Map<string, GlobalComponent<RawType>>();
  private readonly elements = new Map<string, GlobalComponent<RawElement>>();
  private readonly attributes = new Map<string, GlobalComponent<RawAttribute>>();
  private readonly groups = new Map<string, GlobalComponent<RawGroup>>();
  private readonly attributeGroups = new Map<string, GlobalComponent<RawAttributeGroup>>();
  private readonly notations = new Map<string, GlobalComponent<RawNotation>>();

  /** Per document: the namespace an absent namespace resolves to. Non-null only for chameleons. */
  private readonly chameleonNamespaces = new Map<string, string>();

  constructor(private readonly set: SchemaSet) {
    for (const [uri, document] of set.documents) {
      if (document.chameleon && document.targetNamespace !== null) {
        this.chameleonNamespaces.set(uri, document.targetNamespace);
      }
    }
    for (const [uri, document] of set.documents) this.index(uri, document);
    for (const [key, original] of set.redefinedOriginals) this.indexRedefined(key, original);
  }

  // --- indexing ---------------------------------------------------------

  private index(uri: string, document: AssembledDocument): void {
    const ns = document.targetNamespace;
    const schema = document.schema;

    for (const type of schema.types) {
      if (type.name !== null) this.add(this.types, 'type', { namespaceUri: ns, localName: type.name }, type, uri);
    }
    for (const element of schema.elements) {
      if (element.name !== null) {
        this.add(this.elements, 'element', { namespaceUri: ns, localName: element.name }, element, uri);
      }
    }
    for (const attribute of schema.attributes) {
      if (attribute.name !== null) {
        this.add(this.attributes, 'attribute', { namespaceUri: ns, localName: attribute.name }, attribute, uri);
      }
    }
    for (const group of schema.groups) {
      if (group.name !== '') this.add(this.groups, 'group', { namespaceUri: ns, localName: group.name }, group, uri);
    }
    for (const attributeGroup of schema.attributeGroups) {
      if (attributeGroup.name !== '') {
        this.add(
          this.attributeGroups,
          'attributeGroup',
          { namespaceUri: ns, localName: attributeGroup.name },
          attributeGroup,
          uri,
        );
      }
    }
    for (const notation of schema.notations) {
      if (notation.name !== '') {
        this.add(this.notations, 'notation', { namespaceUri: ns, localName: notation.name }, notation, uri);
      }
    }
  }

  private indexRedefined(key: string, original: RawType | RawGroup | RawAttributeGroup): void {
    if ('form' in original) {
      this.types.set(key, {
        name: { namespaceUri: REDEFINE_NS, localName: original.name ?? '' },
        raw: original,
        documentUri: original.origin.documentUri,
      });
      return;
    }
    const entry = {
      name: { namespaceUri: REDEFINE_NS, localName: original.name },
      raw: original,
      documentUri: original.origin.documentUri,
    };
    if ('particle' in original) this.groups.set(key, entry as GlobalComponent<RawGroup>);
    else this.attributeGroups.set(key, entry as GlobalComponent<RawAttributeGroup>);
  }

  private add<T extends { origin: Origin }>(
    table: Map<string, GlobalComponent<T>>,
    space: SymbolSpace,
    name: XsdQName,
    raw: T,
    documentUri: string,
  ): void {
    const key = qnameKey(name);
    const existing = table.get(key);
    if (existing !== undefined) {
      // Two definitions of the same name in the same namespace. Reported, then last-one-wins is
      // avoided: the first is kept, so behaviour does not depend on document traversal order.
      this.diagnostics.push({
        severity: 'error',
        code: 'duplicate-definition',
        message: `There is already a ${SPACE_LABEL[space]} named ${formatQName(name)} (in ${existing.documentUri}).`,
        origin: raw.origin,
      });
      return;
    }
    table.set(key, { name, raw, documentUri });
  }

  // --- resolution -------------------------------------------------------

  /**
   * The namespace a reference written in `origin`'s document actually means.
   *
   * Only chameleon inclusion makes this anything other than the identity: inside a schema that had
   * no target namespace of its own, an unprefixed reference was written expecting no namespace, and
   * now has to find components that live in the including schema's namespace.
   */
  normalize(name: XsdQName, origin: Origin): XsdQName {
    if (name.namespaceUri !== null) return name;
    const chameleon = this.chameleonNamespaces.get(origin.documentUri);
    return chameleon === undefined ? name : { namespaceUri: chameleon, localName: name.localName };
  }

  lookupType(name: XsdQName, origin: Origin): RawType | null {
    return this.types.get(qnameKey(this.normalize(name, origin)))?.raw ?? null;
  }

  lookupElement(name: XsdQName, origin: Origin): RawElement | null {
    return this.elements.get(qnameKey(this.normalize(name, origin)))?.raw ?? null;
  }

  lookupAttribute(name: XsdQName, origin: Origin): RawAttribute | null {
    return this.attributes.get(qnameKey(this.normalize(name, origin)))?.raw ?? null;
  }

  lookupGroup(name: XsdQName, origin: Origin): RawGroup | null {
    return this.groups.get(qnameKey(this.normalize(name, origin)))?.raw ?? null;
  }

  lookupAttributeGroup(name: XsdQName, origin: Origin): RawAttributeGroup | null {
    return this.attributeGroups.get(qnameKey(this.normalize(name, origin)))?.raw ?? null;
  }

  lookupNotation(name: XsdQName, origin: Origin): RawNotation | null {
    return this.notations.get(qnameKey(this.normalize(name, origin)))?.raw ?? null;
  }

  /** Records an unresolvable reference. Callers continue with a fallback rather than aborting. */
  reportUnresolved(space: SymbolSpace, name: XsdQName, origin: Origin): void {
    this.diagnostics.push({
      severity: 'error',
      code: 'unresolved-reference',
      message: `No ${SPACE_LABEL[space]} named ${formatQName(this.normalize(name, origin))} is defined in this schema set.`,
      origin,
    });
  }

  // --- enumeration ------------------------------------------------------

  globalElements(): readonly GlobalComponent<RawElement>[] {
    return [...this.elements.values()];
  }

  globalTypes(): readonly GlobalComponent<RawType>[] {
    return [...this.types.values()].filter((t) => t.name.namespaceUri !== REDEFINE_NS);
  }

  globalAttributes(): readonly GlobalComponent<RawAttribute>[] {
    return [...this.attributes.values()];
  }

  globalGroups(): readonly GlobalComponent<RawGroup>[] {
    return [...this.groups.values()].filter((g) => g.name.namespaceUri !== REDEFINE_NS);
  }

  /** The document a component was written in, for chameleon-aware resolution further down. */
  documentOf(uri: string): AssembledDocument | undefined {
    return this.set.documents.get(uri);
  }

  get schemaSet(): SchemaSet {
    return this.set;
  }
}

/**
 * The name a declaration contributes, accounting for `form` / `*FormDefault` and XSD 1.1's explicit
 * `targetNamespace` on local declarations.
 *
 * The `elementFormDefault="unqualified"` default is the single most confusing thing in XSD for a
 * beginner — it means local elements are *not* in the schema's namespace, so a document that looks
 * obviously right fails to validate. `docs/schema-engine.md` §4.3 gives this its own diagnostic.
 */
export function declaredName(
  declaration: { name: string | null; qualified: boolean; explicitTargetNamespace: string | null },
  document: AssembledDocument,
): XsdQName | null {
  if (declaration.name === null) return null;
  if (declaration.explicitTargetNamespace !== null) {
    return { namespaceUri: declaration.explicitTargetNamespace, localName: declaration.name };
  }
  return {
    namespaceUri: declaration.qualified ? document.targetNamespace : null,
    localName: declaration.name,
  };
}
