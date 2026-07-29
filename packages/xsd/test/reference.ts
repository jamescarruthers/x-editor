import {
  UNBOUNDED,
  elementNameEquals,
  namespaceAllowed,
  type ElementName,
  type Particle,
} from '../src/particles.js';

/**
 * A deliberately naive backtracking matcher over the particle tree.
 *
 * This exists only to be obviously correct, not fast. It is the oracle the Glushkov automaton is
 * checked against: the automaton is where the subtle bugs live (follow-set construction, unrolling,
 * co-reachability), and those bugs would reach users as "the editor says I can't add this but the
 * validator says it's fine" — the one failure mode that destroys trust in the whole product.
 *
 * Read this file as the specification. If it and the automaton disagree, the automaton is wrong
 * until proven otherwise.
 */

/** Every index the particle could consume up to, starting from `start`. */
function matchOnce(
  particle: Particle,
  children: readonly ElementName[],
  start: number,
): Set<number> {
  switch (particle.kind) {
    case 'empty':
      return new Set([start]);

    case 'element': {
      const child = children[start];
      if (child === undefined) return new Set();
      // An abstract head is referenced but never written: only its substitutes match.
      const names = particle.abstract === true
        ? [...(particle.substitutions ?? [])]
        : [particle.name, ...(particle.substitutions ?? [])];
      return names.some((n) => elementNameEquals(n, child)) ? new Set([start + 1]) : new Set();
    }

    case 'wildcard': {
      const child = children[start];
      if (child === undefined) return new Set();
      return namespaceAllowed(particle.namespaceConstraint, child.namespaceUri)
        ? new Set([start + 1])
        : new Set();
    }

    case 'sequence': {
      let current = new Set([start]);
      for (const item of particle.items) {
        const next = new Set<number>();
        for (const position of current) {
          for (const end of match(item, children, position)) next.add(end);
        }
        current = next;
        if (current.size === 0) break;
      }
      return current;
    }

    case 'choice': {
      const out = new Set<number>();
      for (const item of particle.items) {
        for (const end of match(item, children, start)) out.add(end);
      }
      return out;
    }

    case 'all':
      throw new Error('xs:all is not handled by the automaton path');
  }
}

/**
 * Applies the particle's own occurrence bounds around `matchOnce`.
 *
 * Empty iterations must be allowed: `(a?){1,}` accepts the empty list, because a single iteration
 * can match nothing. Dropping zero-width matches to guarantee termination is the obvious shortcut
 * and it is wrong. Termination instead comes from bounding the iteration count — every non-empty
 * iteration consumes at least one child, so `min + remaining + 1` iterations can always be reached
 * and never exceeded usefully.
 */
export function match(
  particle: Particle,
  children: readonly ElementName[],
  start: number,
): Set<number> {
  const occurs = particle.kind === 'empty' ? { min: 1, max: 1 } : particle.occurs;
  const results = new Set<number>();

  if (occurs.min === 0) results.add(start);

  const ceiling =
    occurs.max === UNBOUNDED ? occurs.min + (children.length - start) + 1 : occurs.max;

  let current = new Set([start]);
  for (let count = 1; count <= ceiling; count++) {
    const next = new Set<number>();
    for (const position of current) {
      for (const end of matchOnce(particle, children, position)) next.add(end);
    }
    if (next.size === 0) break;
    current = next;
    if (count >= occurs.min) for (const end of current) results.add(end);
  }

  return results;
}

/** Does this child sequence fully satisfy the content model? */
export function referenceAccepts(particle: Particle, children: readonly ElementName[]): boolean {
  return match(particle, children, 0).has(children.length);
}
