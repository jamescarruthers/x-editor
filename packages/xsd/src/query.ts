/**
 * The query API (P9) — the half of the engine the product is actually made of.
 *
 * Everything below answers a question about a *position in a half-finished document*, which is the
 * question no validator can answer. libxml2, Xerces and Saxon are yes/no oracles over a complete
 * document; none of them expose the content-model state machine, so none of them can say "what may
 * I put here". That gap is the reason this package exists.
 *
 * The entry point is `elementContext`, which walks from the document root to a node resolving
 * declarations as it goes. Everything else takes a context and answers one question about it.
 */

import {
  isElement,
  qnameToString,
  type NodeId,
  type XmlDocument,
} from '@x-editor/xml-core';
import { XSI_NS, qnameKey, type Occurs, type XsdQName } from './ast.js';
import { UNBOUNDED, elementNameEquals, elementNameKey, type ElementName } from './particles.js';
import { firstInvalidIndex, requiredToComplete, whatCanGoHere } from './automaton.js';
import { allFirstInvalidIndex, allRequiredMissing, allWhatCanGoHere } from './allModel.js';
import { validateSimpleValue, type CompiledSimpleType, type ValueProblem } from './simpleTypes.js';
import {
  ANY_TYPE_DEF,
  type AttributeUse,
  type CompiledComplexType,
  type CompiledElement,
  type CompiledType,
  type SchemaModel,
} from './model.js';
import { sampleFor } from './xsdRegex.js';
import {
  cardinalityChip,
  describeElement,
  describeWildcard,
  type Description,
} from './describe.js';

// --- context ------------------------------------------------------------

export interface ChildElement {
  readonly id: NodeId;
  readonly name: ElementName;
}

export interface ElementContext {
  readonly nodeId: NodeId;
  readonly name: ElementName;
  /** Null when the element is not declared — inside a lax wildcard, or in a broken document. */
  readonly declaration: CompiledElement | null;
  readonly type: CompiledType;
  readonly children: readonly ChildElement[];
  /** True when the type came from an `xsi:type` attribute rather than the declaration. */
  readonly typeOverridden: boolean;
}

/**
 * Resolve the declaration and type governing a node, by walking down from the document root.
 *
 * Downward rather than upward because a local element declaration only has meaning inside its
 * parent's type — the same name can be declared differently in two places, and resolving it against
 * the global symbol table would silently pick the wrong one.
 */
export function elementContext(
  model: SchemaModel,
  document: XmlDocument,
  nodeId: NodeId,
): ElementContext | null {
  const path = [nodeId, ...document.ancestorsOf(nodeId)]
    .reverse()
    .filter((id) => document.node(id)?.kind === 'element');
  if (path.length === 0) return null;

  let context: ElementContext | null = null;

  for (const id of path) {
    const node = document.node(id);
    if (node === undefined || !isElement(node)) return null;
    const name: ElementName = {
      namespaceUri: node.name.namespaceUri,
      localName: node.name.localName,
    };

    const parent: ElementContext | null = context;
    const declaration: CompiledElement | null =
      parent === null
        ? model.globalElement(name)
        : parent.type.form === 'complex'
          ? model.elementDeclarationIn(parent.type, name)
          : null;

    let type: CompiledType = declaration === null ? ANY_TYPE_DEF : model.typeOf(declaration);
    let typeOverridden = false;

    // `xsi:type` substitutes a derived type at runtime. Real documents use it constantly — an
    // abstract head type with concrete subtypes is the standard XSD polymorphism idiom — and
    // ignoring it makes the palette offer the base type's children, which is simply wrong.
    const override = xsiType(node.attributes, document, id);
    if (override !== null) {
      const resolved = model.typeByName(override, { documentUri: '', node: id });
      if (resolved !== ANY_TYPE_DEF) {
        type = resolved;
        typeOverridden = true;
      }
    }

    const next: ElementContext = {
      nodeId: id,
      name,
      declaration,
      type,
      children: childElements(document, id),
      typeOverridden,
    };
    context = next;
  }

  return context;
}

function xsiType(
  attributes: readonly { name: { namespaceUri: string | null; localName: string }; value: string }[],
  document: XmlDocument,
  nodeId: NodeId,
): XsdQName | null {
  for (const attribute of attributes) {
    if (attribute.name.namespaceUri !== XSI_NS || attribute.name.localName !== 'type') continue;
    const text = attribute.value.trim();
    const colon = text.indexOf(':');
    const bindings = document.inScopeNamespaces(nodeId);
    if (colon < 0) return { namespaceUri: bindings.get('') ?? null, localName: text };
    const uri = bindings.get(text.slice(0, colon));
    if (uri === undefined) return null;
    return { namespaceUri: uri, localName: text.slice(colon + 1) };
  }
  return null;
}

export function childElements(document: XmlDocument, parentId: NodeId): ChildElement[] {
  const out: ChildElement[] = [];
  for (const id of document.childrenOf(parentId)) {
    const node = document.node(id);
    if (node === undefined || !isElement(node)) continue;
    out.push({
      id,
      name: { namespaceUri: node.name.namespaceUri, localName: node.name.localName },
    });
  }
  return out;
}

// --- the insert palette -------------------------------------------------

/**
 * The palette's fixed groups. The order is deliberate and does not adapt: a beginner learns where
 * to look, and a layout that reorders itself defeats that.
 */
export type CandidateGroup = 'required-missing' | 'suggested' | 'optional' | 'repeat';

export interface InsertCandidate {
  readonly name: ElementName;
  readonly declaration: CompiledElement | null;
  readonly group: CandidateGroup;
  readonly description: Description;
  /** Reads literally: `2 of 1–3`. */
  readonly cardinality: string;
  readonly presentCount: number;
  readonly occurs: Occurs;
  /** True when the element is admitted by a wildcard rather than a declaration. */
  readonly viaWildcard: boolean;
}

export function insertCandidates(
  model: SchemaModel,
  context: ElementContext,
  index: number,
): InsertCandidate[] {
  if (context.type.form !== 'complex') return [];
  const content = model.contentModel(context.type);
  const childNames = context.children.map((child) => child.name);

  const required = new Set(
    requiredMissing(model, context).map((name) => elementNameKey(name)),
  );
  const present = new Map<string, number>();
  for (const child of childNames) {
    const key = elementNameKey(child);
    present.set(key, (present.get(key) ?? 0) + 1);
  }

  const names: { name: ElementName; viaWildcard: boolean }[] = [];

  switch (content.kind) {
    case 'empty':
      return [];
    case 'any':
      // `xs:anyType`: everything is allowed, so there is nothing useful to list. The palette shows
      // its free-text entry instead of a wrong-looking empty list.
      return [];
    case 'all':
      for (const member of allWhatCanGoHere(content.model, childNames)) {
        names.push({ name: member.name, viaWildcard: false });
      }
      break;
    case 'automaton':
      for (const candidate of whatCanGoHere(content.model, childNames, index)) {
        if (candidate.name !== undefined) names.push({ name: candidate.name, viaWildcard: false });
        else if (candidate.matcher.kind === 'wildcard') {
          // A wildcard cannot enumerate names, but the global elements it admits can.
          for (const element of model.globalElements()) {
            if (namespaceMatches(candidate.matcher.namespaceConstraint, element.name.namespaceUri)) {
              names.push({ name: element.name, viaWildcard: true });
            }
          }
        }
      }
      break;
  }

  const seen = new Set<string>();
  const candidates: InsertCandidate[] = [];

  for (const { name, viaWildcard } of names) {
    const key = elementNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const declaration = model.elementDeclarationIn(
      context.type as CompiledComplexType,
      name,
    );
    // An abstract element cannot appear; only the things that substitute for it can.
    if (declaration?.abstract === true) continue;

    const presentCount = present.get(key) ?? 0;
    const occurs = occursOf(model, context.type, name, declaration);

    candidates.push({
      name,
      declaration,
      group: required.has(key) ? 'required-missing' : presentCount > 0 ? 'repeat' : 'optional',
      description:
        declaration === null
          ? describeWildcard(name)
          : describeElement(declaration, model.typeOf(declaration), occurs),
      cardinality: cardinalityChip(occurs, presentCount),
      presentCount,
      occurs,
      viaWildcard,
    });
  }

  // "Suggested next" only earns its place when nothing is outright required — otherwise the palette
  // would show two competing calls to action and the beginner has to choose between them.
  if (!candidates.some((candidate) => candidate.group === 'required-missing')) {
    const first = candidates.find((candidate) => candidate.group === 'optional');
    if (first !== undefined) {
      candidates[candidates.indexOf(first)] = { ...first, group: 'suggested' };
    }
  }

  return candidates;
}

const GROUP_ORDER: Record<CandidateGroup, number> = {
  'required-missing': 0,
  suggested: 1,
  optional: 2,
  repeat: 3,
};

/** Group and order for display, preserving schema declaration order inside each group. */
export function groupCandidates(
  candidates: readonly InsertCandidate[],
): { group: CandidateGroup; candidates: InsertCandidate[] }[] {
  const groups = new Map<CandidateGroup, InsertCandidate[]>();
  for (const candidate of candidates) {
    const list = groups.get(candidate.group);
    if (list === undefined) groups.set(candidate.group, [candidate]);
    else list.push(candidate);
  }
  return [...groups.entries()]
    .map(([group, list]) => ({ group, candidates: list }))
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
}

function namespaceMatches(
  constraint: { kind: string; exclude?: string | null; namespaces?: readonly (string | null)[] },
  uri: string | null,
): boolean {
  if (constraint.kind === 'any') return true;
  if (constraint.kind === 'other') return uri !== (constraint.exclude ?? null);
  return constraint.namespaces?.includes(uri) ?? false;
}

/** The declared bounds for a name inside a type, falling back to "any number" for a wildcard. */
function occursOf(
  model: SchemaModel,
  type: CompiledType,
  name: ElementName,
  declaration: CompiledElement | null,
): Occurs {
  if (type.form === 'complex' && type.particle !== null) {
    const found = findOccurs(type.particle, name);
    if (found !== null) return found;
  }
  return declaration?.occurs ?? { min: 0, max: UNBOUNDED };
}

function findOccurs(
  particle: import('./particles.js').Particle,
  name: ElementName,
): Occurs | null {
  switch (particle.kind) {
    case 'element':
      return elementNameEquals(particle.name, name) ||
        (particle.substitutions ?? []).some((substitute) => elementNameEquals(substitute, name))
        ? particle.occurs
        : null;
    case 'all': {
      const member = particle.items.find((item) => elementNameEquals(item.name, name));
      return member?.occurs ?? null;
    }
    case 'sequence':
    case 'choice': {
      for (const item of particle.items) {
        const found = findOccurs(item, name);
        if (found !== null) return found;
      }
      return null;
    }
    default:
      return null;
  }
}

// --- required and missing -----------------------------------------------

/**
 * The shortest list of children that would complete this element, in the order the schema expects.
 *
 * This is what powers "Add all N missing children" — a button that turns an invalid document into a
 * valid one in a single undoable step, which is the most useful thing the palette does.
 */
export function requiredMissing(model: SchemaModel, context: ElementContext): ElementName[] {
  if (context.type.form !== 'complex') return [];
  const content = model.contentModel(context.type);
  const childNames = context.children.map((child) => child.name);

  switch (content.kind) {
    case 'all':
      return allRequiredMissing(content.model, childNames);
    case 'automaton':
      return requiredToComplete(content.model, childNames) ?? [];
    default:
      return [];
  }
}

/** Where the child list first stops being valid, or null. Points the UI at the actual mistake. */
export function firstProblemIndex(model: SchemaModel, context: ElementContext): number | null {
  if (context.type.form !== 'complex') return null;
  const content = model.contentModel(context.type);
  const childNames = context.children.map((child) => child.name);

  switch (content.kind) {
    case 'all':
      return allFirstInvalidIndex(content.model, childNames);
    case 'automaton':
      return firstInvalidIndex(content.model, childNames);
    default:
      return null;
  }
}

// --- attributes ---------------------------------------------------------

export interface AttributeStatus {
  readonly use: AttributeUse;
  readonly present: boolean;
  readonly value: string | null;
  readonly problems: readonly ValueProblem[];
}

/**
 * Attributes for the Inspector, in the order it shows them: required first, then set, then unset.
 *
 * The ordering is the feature. An alphabetical list buries the one attribute the document is
 * missing among forty it does not need.
 */
export function attributeStatuses(
  document: XmlDocument,
  context: ElementContext,
): AttributeStatus[] {
  if (context.type.form !== 'complex') return [];
  const node = document.node(context.nodeId);
  const written = new Map<string, string>();
  if (node !== undefined && isElement(node)) {
    for (const attribute of node.attributes) {
      if (attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns') continue;
      written.set(
        qnameKey({ namespaceUri: attribute.name.namespaceUri, localName: attribute.name.localName }),
        attribute.value,
      );
    }
  }

  const statuses = context.type.attributes.map((use): AttributeStatus => {
    const value = written.get(qnameKey(use.name)) ?? null;
    return {
      use,
      present: value !== null,
      value,
      problems: value === null ? [] : validateSimpleValue(use.type, value),
    };
  });

  return statuses.sort((a, b) => rankAttribute(a) - rankAttribute(b));
}

function rankAttribute(status: AttributeStatus): number {
  if (status.use.use === 'required') return 0;
  return status.present ? 1 : 2;
}

/** Attributes the element must carry and does not. */
export function missingRequiredAttributes(
  document: XmlDocument,
  context: ElementContext,
): AttributeUse[] {
  return attributeStatuses(document, context)
    .filter((status) => status.use.use === 'required' && !status.present)
    .map((status) => status.use);
}

// --- text content -------------------------------------------------------

/** The simple type governing this element's text, or null when it holds elements instead. */
export function textTypeOf(context: ElementContext): CompiledSimpleType | null {
  if (context.type.form === 'simple') return context.type;
  return context.type.contentKind === 'simple' ? context.type.simpleType : null;
}

export function validateText(context: ElementContext, text: string): ValueProblem[] {
  const type = textTypeOf(context);
  return type === null ? [] : validateSimpleValue(type, text);
}

// --- skeletons ----------------------------------------------------------

export interface SkeletonNode {
  readonly name: ElementName;
  readonly attributes: readonly { name: XsdQName; value: string }[];
  readonly children: readonly SkeletonNode[];
  readonly text: string | null;
}

export interface SkeletonOptions {
  /** `required` inserts only what the schema demands; `all` fills in every optional child too. */
  readonly include?: 'required' | 'all';
  readonly maxDepth?: number;
}

/**
 * Generate a valid subtree for an element.
 *
 * Used three ways: the palette's preview pane, the "add all required children" fix, and
 * "generate a sample document" (§7.3). Depth is bounded because recursive schemas otherwise
 * generate forever — `Section` containing `Section` is the common case, not an exotic one.
 */
export function skeletonFor(
  model: SchemaModel,
  element: CompiledElement,
  options: SkeletonOptions = {},
): SkeletonNode {
  const include = options.include ?? 'required';
  const maxDepth = options.maxDepth ?? 6;
  return build(model, element, include, maxDepth, new Set());
}

function build(
  model: SchemaModel,
  element: CompiledElement,
  include: 'required' | 'all',
  depth: number,
  stack: Set<string>,
): SkeletonNode {
  const type = model.typeOf(element);
  const attributes: { name: XsdQName; value: string }[] = [];
  const children: SkeletonNode[] = [];
  let text: string | null = null;

  if (type.form === 'complex') {
    for (const use of type.attributes) {
      if (use.use !== 'required' && include === 'required') continue;
      if (use.use === 'prohibited') continue;
      attributes.push({
        name: use.name,
        value: use.fixedValue ?? use.defaultValue ?? placeholderFor(use.type),
      });
    }

    if (type.contentKind === 'simple' && type.simpleType !== null) {
      text = element.fixedValue ?? element.defaultValue ?? placeholderFor(type.simpleType);
    } else if (depth > 0) {
      const key = qnameKey(element.name);
      // A recursive type would otherwise expand until the depth budget ran out, producing a
      // "sample" nobody can read. One level of recursion illustrates the shape; more does not.
      const nextStack = new Set([...stack, key]);
      for (const child of skeletonChildren(model, type, include)) {
        if (stack.has(qnameKey(child.name))) continue;
        children.push(build(model, child, include, depth - 1, nextStack));
      }
    }
  } else {
    text = element.fixedValue ?? element.defaultValue ?? placeholderFor(type);
  }

  return { name: element.name, attributes, children, text };
}

function skeletonChildren(
  model: SchemaModel,
  type: CompiledComplexType,
  include: 'required' | 'all',
): CompiledElement[] {
  const content = model.contentModel(type);
  const names: ElementName[] = [];

  if (content.kind === 'all') {
    for (const member of content.model.members) {
      if (include === 'all' || member.occurs.min > 0) names.push(member.name);
    }
  } else if (content.kind === 'automaton') {
    if (include === 'required') {
      names.push(...(requiredToComplete(content.model, []) ?? []));
    } else {
      // Everything the model would accept at the start, then everything it accepts after that, so
      // an "everything" skeleton walks the whole sequence rather than only its first step.
      let cursor: ElementName[] = [];
      for (let step = 0; step < 64; step++) {
        const next = whatCanGoHere(content.model, cursor, cursor.length)
          .map((candidate) => candidate.name)
          .find((name): name is ElementName => name !== undefined);
        if (next === undefined) break;
        cursor = [...cursor, next];
        names.push(next);
      }
    }
  }

  const out: CompiledElement[] = [];
  for (const name of names) {
    const declaration = model.elementDeclarationIn(type, name);
    if (declaration !== null && !declaration.abstract) out.push(declaration);
  }
  return out;
}

/** A value that will pass the type's own constraints, for a skeleton or a preview. */
export function placeholderFor(type: CompiledSimpleType): string {
  const { facets } = type;
  if (facets.enumeration !== null && facets.enumeration.length > 0) return facets.enumeration[0]!;
  if (facets.fixed.size > 0 && facets.minInclusive !== null) return facets.minInclusive.lexical;

  const pattern = facets.patterns.at(-1)?.alternatives[0];
  if (pattern !== undefined) {
    const sample = sampleFor(pattern.source);
    if (sample !== null && sample !== '') return sample;
  }

  switch (type.primitive) {
    case 'boolean':
      return 'false';
    case 'decimal':
    case 'float':
    case 'double':
      return facets.minInclusive?.lexical ?? '0';
    case 'date':
      return '2026-01-01';
    case 'dateTime':
      return '2026-01-01T00:00:00';
    case 'time':
      return '00:00:00';
    case 'gYear':
      return '2026';
    case 'duration':
      return 'P1D';
    case 'anyURI':
      return 'https://example.com';
    case 'hexBinary':
      return '00';
    case 'base64Binary':
      return 'AA==';
    default:
      return '';
  }
}

/** Render a skeleton as XML text, for the palette's preview pane. */
export function serializeSkeleton(node: SkeletonNode, indent = ''): string {
  const name = node.name.localName;
  const attributes = node.attributes
    .map((attribute) => ` ${attribute.name.localName}="${escapeAttribute(attribute.value)}"`)
    .join('');

  if (node.children.length === 0) {
    if (node.text === null || node.text === '') return `${indent}<${name}${attributes}/>`;
    return `${indent}<${name}${attributes}>${escapeText(node.text)}</${name}>`;
  }

  const inner = node.children
    .map((child) => serializeSkeleton(child, `${indent}  `))
    .join('\n');
  return `${indent}<${name}${attributes}>\n${inner}\n${indent}</${name}>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/** Re-exported so callers do not need `qnameToString` from two packages. */
export { qnameToString };
