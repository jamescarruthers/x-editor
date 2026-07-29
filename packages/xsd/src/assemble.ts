/**
 * Schema assembly (P2): follow `include`, `import`, `redefine` and `override` until the schema set
 * is closed.
 *
 * Two things about this file are policy, not implementation detail.
 *
 * **Nothing here fetches.** A `SchemaCatalogue` hands back buffers that are already present. The
 * plan names auto-fetching a remote `schemaLocation` as the most likely place someone later adds a
 * convenience `fetch()` (PLAN.md §8), so the seam is drawn where that would have to be a deliberate
 * change rather than an easy one. It is also what makes multi-file schema sets work under
 * `libxml2-wasm`, whose own import/include support is flagged experimental: we resolve the graph
 * here and materialise the closure, and libxml2 never resolves anything.
 *
 * **A missing document is not fatal.** UBL imports a dozen files; a user who opens one of them
 * alone should get guidance for the parts that did resolve, plus a clear diagnostic naming what is
 * missing — not an empty editor.
 */

import { XmlDocument } from '@x-editor/xml-core';
import {
  qnameKey,
  type RawAttributeGroup,
  type RawComplexType,
  type RawGroup,
  type RawParticle,
  type RawSchema,
  type RawSimpleType,
  type RawType,
  type SchemaDiagnostic,
  type XsdQName,
} from './ast.js';
import { parseSchemaDocument } from './parseSchema.js';

/**
 * Where schema documents come from. Deliberately synchronous and buffer-shaped: the catalogue is
 * populated by the app (from opened files, the bundled well-known schemas, or an explicit fetch the
 * user approved), never by this module.
 */
export interface SchemaCatalogue {
  /** Turn a `schemaLocation` into an absolute key, relative to the document that wrote it. */
  resolve(schemaLocation: string, baseUri: string): string;
  /** Source text for an absolute key, or null when the catalogue does not hold it. */
  read(uri: string): string | null;
}

export interface AssembledDocument {
  readonly schema: RawSchema;
  readonly document: XmlDocument;
  /**
   * The target namespace in force for this document's components — the schema's own, or the
   * including schema's when this was pulled in as a chameleon.
   */
  readonly targetNamespace: string | null;
  /** True when this document declares no target namespace but acquired one from an `include`. */
  readonly chameleon: boolean;
}

export interface SchemaSet {
  readonly rootUri: string;
  readonly documents: ReadonlyMap<string, AssembledDocument>;
  readonly diagnostics: readonly SchemaDiagnostic[];
  /** 1.1 if any document declares it. The differential harness dispatches on this. */
  readonly declaredVersion: '1.0' | '1.1';
  /** Namespaces the set defines components in. */
  readonly namespaces: ReadonlySet<string | null>;
  /**
   * Components displaced by `xs:redefine`, keyed by the synthetic QName their redefinition now
   * refers to. See `applyRedefine`.
   */
  readonly redefinedOriginals: ReadonlyMap<string, RawType | RawGroup | RawAttributeGroup>;
}

/** The namespace synthetic names for redefined originals live in. Never appears in a document. */
export const REDEFINE_NS = 'urn:x-editor:redefined';

// --- URI handling -------------------------------------------------------

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Resolve a relative reference against a base. `new URL` handles real URLs; the fallback exists
 * because catalogue keys are often bare filenames, which `new URL` rejects outright.
 */
export function resolveUri(location: string, baseUri: string): string {
  if (SCHEME.test(location)) return location;
  if (SCHEME.test(baseUri)) {
    try {
      return new URL(location, baseUri).href;
    } catch {
      // Fall through to path joining.
    }
  }
  if (location.startsWith('/')) return normalizePath(location);
  const lastSlash = baseUri.lastIndexOf('/');
  const directory = lastSlash < 0 ? '' : baseUri.slice(0, lastSlash + 1);
  return normalizePath(directory + location);
}

function normalizePath(path: string): string {
  const leadingSlash = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return (leadingSlash ? '/' : '') + out.join('/');
}

/** A catalogue over an in-memory map. This is what the worker gets handed, and what tests use. */
export function catalogueFrom(entries: Readonly<Record<string, string>>): SchemaCatalogue {
  return {
    resolve: resolveUri,
    read: (uri) => entries[uri] ?? null,
  };
}

// --- assembly -----------------------------------------------------------

interface PendingDocument {
  readonly uri: string;
  /** Set when the referrer had a target namespace and this document may not have one of its own. */
  readonly chameleonNamespace: string | null;
  readonly referrer: RawSchema | null;
}

export function assembleSchema(rootUri: string, catalogue: SchemaCatalogue): SchemaSet {
  const documents = new Map<string, AssembledDocument>();
  const diagnostics: SchemaDiagnostic[] = [];
  const redefinedOriginals = new Map<string, RawType | RawGroup | RawAttributeGroup>();
  const namespaces = new Set<string | null>();
  let declaredVersion: '1.0' | '1.1' = '1.0';
  let syntheticCount = 0;

  const queue: PendingDocument[] = [{ uri: rootUri, chameleonNamespace: null, referrer: null }];

  while (queue.length > 0) {
    const pending = queue.shift()!;
    const existing = documents.get(pending.uri);

    if (existing !== undefined) {
      // Including the same document under two different namespaces would mean two different sets of
      // components from one file. Legal in principle, unsupported here, and always a mistake in
      // practice — so it is reported rather than silently resolved one way.
      if (
        pending.chameleonNamespace !== null &&
        existing.chameleon &&
        existing.targetNamespace !== pending.chameleonNamespace
      ) {
        diagnostics.push({
          severity: 'error',
          code: 'chameleon-conflict',
          message: `${pending.uri} has no target namespace of its own and is included from two namespaces (${existing.targetNamespace ?? 'none'} and ${pending.chameleonNamespace}).`,
          origin: existing.schema.origin,
        });
      }
      continue;
    }

    const source = catalogue.read(pending.uri);
    if (source === null) {
      if (pending.referrer !== null) {
        diagnostics.push({
          severity: 'error',
          code: 'schema-not-found',
          message: `The schema document "${pending.uri}" was referenced but is not available. Open it alongside this one, or remove the reference.`,
          origin: pending.referrer.origin,
        });
      }
      continue;
    }

    const parsed = parseSchemaDocument(XmlDocument.parse(source), pending.uri);
    diagnostics.push(...parsed.diagnostics);
    const schema = parsed.schema;

    if (schema.declaredVersion === '1.1') declaredVersion = '1.1';

    const chameleon = schema.targetNamespace === null && pending.chameleonNamespace !== null;
    const targetNamespace = chameleon ? pending.chameleonNamespace : schema.targetNamespace;
    namespaces.add(targetNamespace);

    documents.set(pending.uri, { schema, document: parsed.document, targetNamespace, chameleon });

    for (const composition of schema.compositions) {
      if (composition.schemaLocation === null) {
        // `xs:import` with no location: legal, and means "components from this namespace may
        // appear, resolve them however you like". We can only resolve what is already loaded.
        if (composition.kind === 'import' && composition.namespace !== null) {
          namespaces.add(composition.namespace);
        }
        continue;
      }

      const uri = catalogue.resolve(composition.schemaLocation, pending.uri);

      switch (composition.kind) {
        case 'include':
        case 'redefine':
        case 'override':
          queue.push({ uri, chameleonNamespace: targetNamespace, referrer: schema });
          break;
        case 'import':
          // An import crosses a namespace boundary, so it is never chameleon.
          queue.push({ uri, chameleonNamespace: null, referrer: schema });
          break;
      }
    }
  }

  // Redefinition is applied after the whole set is loaded, so a redefine of a document that is also
  // plainly included resolves against the same parsed instance either way.
  for (const assembled of documents.values()) {
    for (const composition of assembled.schema.compositions) {
      if (composition.kind !== 'redefine' && composition.kind !== 'override') continue;
      if (composition.schemaLocation === null || composition.components === null) continue;

      const targetUri = catalogue.resolve(composition.schemaLocation, assembled.schema.documentUri);
      const target = documents.get(targetUri);
      if (target === undefined) continue;

      const replaced = applyRedefine(
        target,
        composition.components,
        composition.kind,
        assembled.targetNamespace,
        () => syntheticCount++,
        diagnostics,
      );
      documents.set(targetUri, replaced.document);
      for (const [key, original] of replaced.originals) redefinedOriginals.set(key, original);
    }
  }

  return { rootUri, documents, diagnostics, declaredVersion, namespaces, redefinedOriginals };
}

// --- redefinition -------------------------------------------------------

interface RedefineResult {
  readonly document: AssembledDocument;
  readonly originals: ReadonlyMap<string, RawType | RawGroup | RawAttributeGroup>;
}

/**
 * Replace components in the redefined document with the redefining ones.
 *
 * The wrinkle is that a redefinition almost always refers to itself — `<xs:complexType name="X">
 * <xs:complexContent><xs:restriction base="X">` is the canonical form — and that self-reference
 * means *the original*, not the thing being defined. Rather than special-casing lookup everywhere
 * downstream, the original is moved to a synthetic name in a reserved namespace and the
 * redefinition's own base reference is rewritten to point at it. After this pass, reference
 * resolution is completely ordinary.
 *
 * `xs:override` (XSD 1.1, which deprecates `redefine` precisely because of the above) replaces
 * outright, with no self-reference, so it skips the rewrite.
 */
function applyRedefine(
  target: AssembledDocument,
  components: {
    readonly types: readonly RawType[];
    readonly groups: readonly RawGroup[];
    readonly attributeGroups: readonly RawAttributeGroup[];
  },
  kind: 'redefine' | 'override',
  namespace: string | null,
  nextSynthetic: () => number,
  diagnostics: SchemaDiagnostic[],
): RedefineResult {
  const originals = new Map<string, RawType | RawGroup | RawAttributeGroup>();
  const schema = target.schema;

  const syntheticName = (localName: string): XsdQName => ({
    namespaceUri: REDEFINE_NS,
    localName: `${localName}#${nextSynthetic()}`,
  });

  const types = [...schema.types];
  const groups = [...schema.groups];
  const attributeGroups = [...schema.attributeGroups];

  const replace = <T extends { name: string | null }>(
    list: T[],
    replacement: T,
    label: string,
  ): T | null => {
    const index = list.findIndex((existing) => existing.name === replacement.name);
    if (index < 0) {
      diagnostics.push({
        severity: 'error',
        code: 'redefine-missing-target',
        message: `<xs:${kind}> redefines the ${label} "${replacement.name ?? ''}", but the included schema does not define it.`,
        origin: (replacement as unknown as { origin: SchemaDiagnostic['origin'] }).origin,
      });
      return null;
    }
    const original = list[index]!;
    list[index] = replacement;
    return original;
  };

  for (const type of components.types) {
    if (type.name === null) continue;
    const original = replace(types, type, 'type');
    if (original === null || kind === 'override') continue;
    const synthetic = syntheticName(type.name);
    originals.set(qnameKey(synthetic), renameType(original, synthetic.localName));
    types[types.findIndex((t) => t === type)] = rewriteSelfReference(type, namespace, synthetic);
  }

  for (const group of components.groups) {
    const original = replace(groups, group, 'group');
    if (original === null || kind === 'override') continue;
    const synthetic = syntheticName(group.name);
    originals.set(qnameKey(synthetic), { ...original, name: synthetic.localName });
    const index = groups.findIndex((g) => g === group);
    groups[index] = {
      ...group,
      particle:
        group.particle === null
          ? null
          : (rewriteGroupRefs(group.particle, { namespaceUri: namespace, localName: group.name }, synthetic) as RawGroup['particle']),
    };
  }

  for (const attributeGroup of components.attributeGroups) {
    const original = replace(attributeGroups, attributeGroup, 'attribute group');
    if (original === null || kind === 'override') continue;
    const synthetic = syntheticName(attributeGroup.name);
    originals.set(qnameKey(synthetic), { ...original, name: synthetic.localName });
    const index = attributeGroups.findIndex((g) => g === attributeGroup);
    attributeGroups[index] = {
      ...attributeGroup,
      attributeGroups: attributeGroup.attributeGroups.map((ref) =>
        ref.localName === attributeGroup.name && ref.namespaceUri === namespace ? synthetic : ref,
      ),
    };
  }

  return {
    document: { ...target, schema: { ...schema, types, groups, attributeGroups } },
    originals,
  };
}

function renameType(type: RawType, localName: string): RawType {
  return { ...type, name: localName } as RawType;
}

/** Point a redefinition's `base` at the synthetic name the original now has. */
function rewriteSelfReference(type: RawType, namespace: string | null, synthetic: XsdQName): RawType {
  const isSelf = (name: XsdQName | null): boolean =>
    name !== null && name.localName === type.name && name.namespaceUri === namespace;

  if (type.form === 'simple') {
    const derivation = type.derivation;
    if (derivation === null || derivation.kind !== 'restriction' || !isSelf(derivation.base)) {
      return type;
    }
    return { ...type, derivation: { ...derivation, base: synthetic } } satisfies RawSimpleType;
  }

  const content = type.content;
  if (content.kind === 'particle' || !isSelf(content.base)) return type;
  return { ...type, content: { ...content, base: synthetic } } satisfies RawComplexType;
}

function rewriteGroupRefs(
  particle: RawParticle,
  self: XsdQName,
  synthetic: XsdQName,
): RawParticle {
  switch (particle.kind) {
    case 'group-ref':
      return particle.ref.localName === self.localName &&
        particle.ref.namespaceUri === self.namespaceUri
        ? { ...particle, ref: synthetic }
        : particle;
    case 'sequence':
    case 'choice':
    case 'all':
      return {
        ...particle,
        items: particle.items.map((item) => rewriteGroupRefs(item, self, synthetic)),
      };
    default:
      return particle;
  }
}
