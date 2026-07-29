/**
 * Content models as particle trees.
 *
 * This is the shape an XSD content model has before it is compiled into something queryable: a tree
 * of sequence / choice / all / element / wildcard nodes, each with occurrence bounds. It is kept
 * separate from the XSD parser so the automaton can be developed and tested against hand-written
 * particles, which is what makes the property tests in `automaton.test.ts` possible.
 */

export const UNBOUNDED = Number.POSITIVE_INFINITY;

export interface Occurs {
  readonly min: number;
  /** `UNBOUNDED` for `maxOccurs="unbounded"`. */
  readonly max: number;
}

export const ONCE: Occurs = { min: 1, max: 1 };
export const OPTIONAL: Occurs = { min: 0, max: 1 };
export const ANY_NUMBER: Occurs = { min: 0, max: UNBOUNDED };

/** An element name in the content model. `null` namespace means "no namespace". */
export interface ElementName {
  readonly namespaceUri: string | null;
  readonly localName: string;
}

export type NamespaceConstraint =
  | { readonly kind: 'any' }
  | { readonly kind: 'other'; readonly exclude: string | null }
  | { readonly kind: 'list'; readonly namespaces: readonly (string | null)[] };

export type ProcessContents = 'strict' | 'lax' | 'skip';

export type Particle =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'element';
      readonly name: ElementName;
      readonly occurs: Occurs;
      /**
       * Elements that may substitute for this one. Kept as a set on the particle rather than
       * expanded into separate automaton positions: on schemas like UBL a head can have hundreds of
       * members, and expanding both explodes the state count and destroys the 1-unambiguity that
       * makes the automaton deterministic.
       */
      readonly substitutions?: readonly ElementName[];
      /**
       * True when the declaration is `abstract="true"`. Such an element may be *referenced* — that
       * is the whole point of a substitution-group head — but may never itself appear in a
       * document, so the matcher accepts its substitutes and not its own name.
       */
      readonly abstract?: boolean;
    }
  | {
      readonly kind: 'wildcard';
      readonly namespaceConstraint: NamespaceConstraint;
      readonly processContents: ProcessContents;
      readonly occurs: Occurs;
    }
  | { readonly kind: 'sequence'; readonly items: readonly Particle[]; readonly occurs: Occurs }
  | { readonly kind: 'choice'; readonly items: readonly Particle[]; readonly occurs: Occurs }
  | {
      /**
       * `xs:all` is not regex-shaped, so it never reaches the automaton. In XSD 1.0 every member has
       * maxOccurs <= 1, it must be the entire content model, and it cannot nest or repeat — which
       * makes a bitset of seen members both simpler and faster than an automaton. XSD 1.1 relaxes
       * this, hence the per-member occurrence bounds here rather than a plain flag.
       */
      readonly kind: 'all';
      readonly items: readonly { readonly name: ElementName; readonly occurs: Occurs }[];
      /** XSD 1.1 allows wildcards inside `xs:all`; under 1.0 this is always empty. */
      readonly wildcards?: readonly {
        readonly namespaceConstraint: NamespaceConstraint;
        readonly processContents: ProcessContents;
        readonly occurs: Occurs;
      }[];
      readonly occurs: Occurs;
    };

export function elementNameEquals(a: ElementName, b: ElementName): boolean {
  return a.localName === b.localName && a.namespaceUri === b.namespaceUri;
}

export function elementNameKey(name: ElementName): string {
  return `${name.namespaceUri ?? ''}|${name.localName}`;
}

export function formatElementName(name: ElementName): string {
  return name.localName;
}

export function namespaceAllowed(constraint: NamespaceConstraint, uri: string | null): boolean {
  switch (constraint.kind) {
    case 'any':
      return true;
    case 'other':
      return uri !== constraint.exclude;
    case 'list':
      return constraint.namespaces.includes(uri);
  }
}

/** Convenience constructors, used heavily by tests and by the XSD compiler. */
export const p = {
  empty: (): Particle => ({ kind: 'empty' }),

  element: (
    localName: string,
    occurs: Occurs = ONCE,
    options: {
      namespaceUri?: string | null;
      substitutions?: readonly ElementName[];
      abstract?: boolean;
    } = {},
  ): Particle => ({
    kind: 'element',
    name: { namespaceUri: options.namespaceUri ?? null, localName },
    occurs,
    ...(options.substitutions === undefined ? {} : { substitutions: options.substitutions }),
    ...(options.abstract === undefined ? {} : { abstract: options.abstract }),
  }),

  wildcard: (
    occurs: Occurs = ONCE,
    namespaceConstraint: NamespaceConstraint = { kind: 'any' },
    processContents: ProcessContents = 'lax',
  ): Particle => ({ kind: 'wildcard', namespaceConstraint, processContents, occurs }),

  sequence: (items: readonly Particle[], occurs: Occurs = ONCE): Particle => ({
    kind: 'sequence',
    items,
    occurs,
  }),

  choice: (items: readonly Particle[], occurs: Occurs = ONCE): Particle => ({
    kind: 'choice',
    items,
    occurs,
  }),

  all: (
    items: readonly { name: ElementName; occurs: Occurs }[],
    occurs: Occurs = ONCE,
  ): Particle => ({ kind: 'all', items, occurs }),
};
