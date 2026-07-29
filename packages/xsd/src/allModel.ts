/**
 * `xs:all` — a bitset, not an automaton.
 *
 * `xs:all` means "these children, in any order". Compiling that into a finite automaton means
 * enumerating every interleaving, which is factorial in the member count: a 10-member `xs:all`
 * would be 3.6 million states. Since XSD 1.0 constrains `xs:all` hard — every member at most once,
 * it must be the entire content model, it cannot nest or repeat — counting occurrences is both
 * simpler and exactly correct.
 *
 * XSD 1.1 relaxes the "at most once" rule and allows wildcards, which is why members carry their own
 * occurrence bounds here rather than a plain seen/not-seen flag.
 */

import {
  elementNameEquals,
  elementNameKey,
  namespaceAllowed,
  type ElementName,
  type NamespaceConstraint,
  type Occurs,
  type Particle,
  type ProcessContents,
} from './particles.js';

export interface AllMember {
  readonly name: ElementName;
  readonly occurs: Occurs;
}

export interface AllContentModel {
  readonly members: readonly AllMember[];
  /** XSD 1.1 wildcards inside `xs:all`. Empty under 1.0. */
  readonly wildcards: readonly {
    readonly namespaceConstraint: NamespaceConstraint;
    readonly processContents: ProcessContents;
    readonly occurs: Occurs;
  }[];
  readonly occurs: Occurs;
}

export function isAllParticle(particle: Particle): particle is Extract<Particle, { kind: 'all' }> {
  return particle.kind === 'all';
}

export function compileAll(particle: Extract<Particle, { kind: 'all' }>): AllContentModel {
  return { members: particle.items, wildcards: [], occurs: particle.occurs };
}

function counts(children: readonly ElementName[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const child of children) {
    const key = elementNameKey(child);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function memberFor(model: AllContentModel, name: ElementName): AllMember | undefined {
  return model.members.find((member) => elementNameEquals(member.name, name));
}

function wildcardAccepts(model: AllContentModel, name: ElementName): boolean {
  return model.wildcards.some((wildcard) =>
    namespaceAllowed(wildcard.namespaceConstraint, name.namespaceUri),
  );
}

export function allIsValid(model: AllContentModel, children: readonly ElementName[]): boolean {
  const seen = counts(children);

  for (const child of children) {
    if (memberFor(model, child) === undefined && !wildcardAccepts(model, child)) return false;
  }
  for (const member of model.members) {
    const count = seen.get(elementNameKey(member.name)) ?? 0;
    if (count < member.occurs.min || count > member.occurs.max) return false;
  }
  return true;
}

/**
 * What may be inserted. Position is irrelevant by definition, so the index is ignored — but the
 * signature matches the automaton's so the query layer does not have to branch on model shape.
 */
export function allWhatCanGoHere(
  model: AllContentModel,
  children: readonly ElementName[],
): AllMember[] {
  const seen = counts(children);
  return model.members.filter(
    (member) => (seen.get(elementNameKey(member.name)) ?? 0) < member.occurs.max,
  );
}

/** Members that still have to appear, in declaration order — which is the order a user expects. */
export function allRequiredMissing(
  model: AllContentModel,
  children: readonly ElementName[],
): ElementName[] {
  const seen = counts(children);
  const missing: ElementName[] = [];
  for (const member of model.members) {
    const count = seen.get(elementNameKey(member.name)) ?? 0;
    for (let i = count; i < member.occurs.min; i++) missing.push(member.name);
  }
  return missing;
}

/** The first child that cannot be there at all, or null. Used to point at the actual mistake. */
export function allFirstInvalidIndex(
  model: AllContentModel,
  children: readonly ElementName[],
): number | null {
  const used = new Map<string, number>();
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const member = memberFor(model, child);
    if (member === undefined) {
      if (!wildcardAccepts(model, child)) return i;
      continue;
    }
    const key = elementNameKey(child);
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    if (count > member.occurs.max) return i;
  }
  return null;
}
