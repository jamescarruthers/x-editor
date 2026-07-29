import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  compileContentModel,
  isValidSequence,
  requiredToComplete,
  whatCanGoHere,
  firstInvalidIndex,
} from '../src/automaton.js';
import { ANY_NUMBER, ONCE, OPTIONAL, p, type ElementName, type Particle } from '../src/particles.js';
import { referenceAccepts } from './reference.js';

const n = (localName: string): ElementName => ({ namespaceUri: null, localName });
const names = (...list: string[]): ElementName[] => list.map(n);

function candidateNames(
  particle: Particle,
  children: readonly ElementName[],
  index: number,
): string[] {
  const model = compileContentModel(particle);
  return whatCanGoHere(model, children, index)
    .filter((c) => c.name !== undefined)
    .map((c) => c.name!.localName)
    .sort();
}

describe('sequence', () => {
  const model = p.sequence([p.element('a'), p.element('b'), p.element('c')]);

  it('accepts the exact sequence', () => {
    expect(isValidSequence(compileContentModel(model), names('a', 'b', 'c'))).toBe(true);
  });

  it('rejects a wrong order', () => {
    expect(isValidSequence(compileContentModel(model), names('b', 'a', 'c'))).toBe(false);
  });

  it('rejects an incomplete sequence', () => {
    expect(isValidSequence(compileContentModel(model), names('a', 'b'))).toBe(false);
  });

  it('offers only the next element in order', () => {
    expect(candidateNames(model, names('a'), 1)).toEqual(['b']);
  });

  it('offers nothing once the sequence is complete', () => {
    expect(candidateNames(model, names('a', 'b', 'c'), 3)).toEqual([]);
  });

  it('offers a candidate only where it fits, not merely because the type allows it', () => {
    // The same element, the same children, two positions, two answers. A model that only asked
    // "what does this type allow?" would offer <a> in both places.
    const ab = p.sequence([p.element('a'), p.element('b')]);
    expect(candidateNames(ab, names('b'), 0)).toEqual(['a']);
    expect(candidateNames(ab, names('b'), 1)).toEqual([]);
  });

  it('offers nothing inside an already-broken child list', () => {
    // With only <c> present, no insertion at the front can keep the list consumable — <a> then <b>
    // would still have to come first. This is the repair path's job, not the palette's.
    expect(candidateNames(model, names('c'), 0)).toEqual([]);
  });

  it('names what is missing, in order', () => {
    const compiled = compileContentModel(model);
    expect(requiredToComplete(compiled, names('a'))?.map((x) => x.localName)).toEqual(['b', 'c']);
  });
});

describe('choice', () => {
  const model = p.choice([p.element('a'), p.element('b')]);

  it('accepts either branch', () => {
    const compiled = compileContentModel(model);
    expect(isValidSequence(compiled, names('a'))).toBe(true);
    expect(isValidSequence(compiled, names('b'))).toBe(true);
  });

  it('rejects both branches together', () => {
    expect(isValidSequence(compileContentModel(model), names('a', 'b'))).toBe(false);
  });

  it('offers both when empty', () => {
    expect(candidateNames(model, [], 0)).toEqual(['a', 'b']);
  });

  it('offers neither once one is chosen', () => {
    expect(candidateNames(model, names('a'), 1)).toEqual([]);
  });
});

describe('occurrence bounds', () => {
  it('handles unbounded repetition', () => {
    const model = compileContentModel(p.sequence([p.element('item', ANY_NUMBER)]));
    expect(isValidSequence(model, [])).toBe(true);
    expect(isValidSequence(model, names('item', 'item', 'item'))).toBe(true);
  });

  it('enforces a minimum', () => {
    const model = compileContentModel(p.element('item', { min: 2, max: 4 }));
    expect(isValidSequence(model, names('item'))).toBe(false);
    expect(isValidSequence(model, names('item', 'item'))).toBe(true);
  });

  it('enforces a maximum', () => {
    const model = compileContentModel(p.element('item', { min: 2, max: 3 }));
    expect(isValidSequence(model, names('item', 'item', 'item'))).toBe(true);
    expect(isValidSequence(model, names('item', 'item', 'item', 'item'))).toBe(false);
  });

  it('stops offering a candidate at its maximum', () => {
    const model = p.element('item', { min: 1, max: 2 });
    expect(candidateNames(model, names('item'), 1)).toEqual(['item']);
    expect(candidateNames(model, names('item', 'item'), 2)).toEqual([]);
  });

  it('flags very large bounds as approximate rather than pretending to be exact', () => {
    const exact = compileContentModel(p.element('x', { min: 1, max: 10 }));
    expect(exact.approximate).toBe(false);
    const huge = compileContentModel(p.element('x', { min: 1, max: 100000 }));
    expect(huge.approximate).toBe(true);
  });
});

describe('optional elements', () => {
  const model = p.sequence([p.element('a'), p.element('b', OPTIONAL), p.element('c')]);

  it('accepts with and without the optional part', () => {
    const compiled = compileContentModel(model);
    expect(isValidSequence(compiled, names('a', 'c'))).toBe(true);
    expect(isValidSequence(compiled, names('a', 'b', 'c'))).toBe(true);
  });

  it('offers both the optional element and the next required one', () => {
    expect(candidateNames(model, names('a'), 1)).toEqual(['b', 'c']);
  });

  it('excludes the optional element once past it', () => {
    expect(candidateNames(model, names('a', 'c'), 2)).toEqual([]);
  });

  it('does not count an optional element as missing', () => {
    const compiled = compileContentModel(model);
    expect(requiredToComplete(compiled, names('a'))?.map((x) => x.localName)).toEqual(['c']);
  });
});

describe('substitution groups', () => {
  const model = p.element('vehicle', ONCE, { substitutions: names('car', 'van') });

  it('accepts any member', () => {
    const compiled = compileContentModel(model);
    expect(isValidSequence(compiled, names('car'))).toBe(true);
    expect(isValidSequence(compiled, names('van'))).toBe(true);
    expect(isValidSequence(compiled, names('bicycle'))).toBe(false);
  });

  it('offers the head and every member', () => {
    expect(candidateNames(model, [], 0)).toEqual(['car', 'van', 'vehicle']);
  });
});

describe('wildcards', () => {
  it('accepts anything under ##any', () => {
    const model = compileContentModel(p.wildcard());
    expect(isValidSequence(model, names('whatever'))).toBe(true);
  });

  it('respects a namespace list', () => {
    const model = compileContentModel(
      p.wildcard(ONCE, { kind: 'list', namespaces: ['urn:allowed'] }),
    );
    expect(isValidSequence(model, [{ namespaceUri: 'urn:allowed', localName: 'x' }])).toBe(true);
    expect(isValidSequence(model, [{ namespaceUri: 'urn:other', localName: 'x' }])).toBe(false);
  });

  it('is offered as a wildcard candidate, not as a name', () => {
    const model = compileContentModel(p.sequence([p.element('a'), p.wildcard()]));
    const candidates = whatCanGoHere(model, names('a'), 1);
    expect(candidates.some((c) => c.matcher.kind === 'wildcard')).toBe(true);
  });
});

describe('unique particle attribution', () => {
  it('flags an ambiguous choice instead of refusing to compile it', () => {
    // Real schemas, especially hand-written ones, do violate UPA. Refusing to open them would be a
    // product failure; the NFA runtime copes, and the XSD editor can surface the warning.
    const model = compileContentModel(p.choice([p.element('a'), p.element('a')]));
    expect(model.ambiguous).toBe(true);
    expect(isValidSequence(model, names('a'))).toBe(true);
  });

  it('does not flag an unambiguous model', () => {
    expect(compileContentModel(p.choice([p.element('a'), p.element('b')])).ambiguous).toBe(false);
  });
});

describe('error location', () => {
  it('reports where the child list first goes wrong', () => {
    const model = compileContentModel(p.sequence([p.element('a'), p.element('b')]));
    expect(firstInvalidIndex(model, names('a', 'x'))).toBe(1);
    expect(firstInvalidIndex(model, names('a', 'b'))).toBeNull();
  });
});

// --- the property tests -------------------------------------------------

// Two symbols keep the two-depth enumeration affordable while still exercising ordering,
// cardinality, choice and optionality. Coverage of wider alphabets comes from the unit tests.
const ALPHABET = ['a', 'b'];
const arbitraryName = fc.constantFrom(...ALPHABET);

/** Longest word we enumerate when building the reference language. */
const MAX_WORD = 6;

const arbitraryOccurs = fc.oneof(
  fc.constant(ONCE),
  fc.constant(OPTIONAL),
  fc.constant(ANY_NUMBER),
  fc.constant({ min: 1, max: Number.POSITIVE_INFINITY }),
  fc.constant({ min: 1, max: 2 }),
);

/**
 * The shortest word this particle accepts. Used to keep the enumerated-language oracle honest: a
 * model whose shortest word is longer than `MAX_WORD` cannot be judged against a bounded
 * enumeration, and would produce false failures rather than real ones.
 */
function minWordLength(particle: Particle): number {
  switch (particle.kind) {
    case 'empty':
      return 0;
    case 'element':
    case 'wildcard':
      return particle.occurs.min;
    case 'sequence':
      return (
        particle.occurs.min * particle.items.reduce((sum, item) => sum + minWordLength(item), 0)
      );
    case 'choice':
      return (
        particle.occurs.min *
        (particle.items.length === 0
          ? 0
          : Math.min(...particle.items.map((item) => minWordLength(item))))
      );
    case 'all':
      return particle.occurs.min * particle.items.reduce((sum, item) => sum + item.occurs.min, 0);
  }
}

const arbitraryParticle: fc.Arbitrary<Particle> = fc.letrec<{ particle: Particle }>((tie) => ({
  particle: fc.oneof(
    { depthSize: 'xsmall', withCrossShrink: true },
    fc.tuple(arbitraryName, arbitraryOccurs).map(([name, occurs]) => p.element(name, occurs)),
    fc
      .tuple(fc.array(tie('particle'), { minLength: 1, maxLength: 2 }), arbitraryOccurs)
      .map(([items, occurs]) => p.sequence(items, occurs)),
    fc
      .tuple(fc.array(tie('particle'), { minLength: 1, maxLength: 2 }), arbitraryOccurs)
      .map(([items, occurs]) => p.choice(items, occurs)),
  ),
})).particle;

const arbitraryChildren = fc.array(arbitraryName, { maxLength: 3 }).map((xs) => xs.map(n));

/**
 * Every word the particle accepts, up to `depth` symbols, found by brute force over the alphabet
 * and checked with the reference matcher.
 *
 * Enumerating the language outright removes the last shared logic between the oracle and the thing
 * under test: the automaton is compared against a set of strings, not against another algorithm
 * that could be wrong in the same way.
 */
function enumerateLanguage(particle: Particle, depth: number): Set<string> {
  const accepted = new Set<string>();
  const word: string[] = [];

  const recurse = (remaining: number): void => {
    if (referenceAccepts(particle, word.map(n))) accepted.add(word.join(','));
    if (remaining === 0) return;
    for (const symbol of ALPHABET) {
      word.push(symbol);
      recurse(remaining - 1);
      word.pop();
    }
  };

  recurse(depth);
  return accepted;
}

/** Is this child list a prefix of some accepted word — i.e. can the user still finish? */
function isCompletablePrefix(language: ReadonlySet<string>, children: readonly ElementName[]): boolean {
  const prefix = children.map((c) => c.localName).join(',');
  if (language.has(prefix)) return true;
  const withComma = prefix === '' ? '' : `${prefix},`;
  for (const word of language) {
    if (word.startsWith(withComma) && word.length > prefix.length) return true;
  }
  return false;
}

describe('property: the automaton agrees with the reference matcher', () => {
  it('on acceptance', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(arbitraryParticle, arbitraryChildren, (particle, children) => {
        const model = compileContentModel(particle);
        // Approximated models are allowed to over-permit near the bound; skip those.
        fc.pre(!model.approximate);
        expect(isValidSequence(model, children)).toBe(referenceAccepts(particle, children));
      }),
      { numRuns: 2000 },
    );
  });

  it('on what may be inserted', { timeout: 120_000 }, () => {
    /**
     * The property that actually matters, and the one that would otherwise reach users as "the
     * editor says I can't add this but the validator says it's fine".
     *
     * A candidate must be offered exactly when inserting it leaves the document still completable —
     * not when it completes the document outright. Requiring the stricter condition is a subtle and
     * very plausible bug: it passes every hand-written test where the insertion happens to finish
     * the element, and silently offers nothing in the far more common mid-edit case.
     */
    fc.assert(
      fc.property(arbitraryParticle, arbitraryChildren, (particle, children) => {
        const model = compileContentModel(particle);
        fc.pre(!model.approximate);

        fc.pre(minWordLength(particle) + children.length + 1 <= MAX_WORD);

        /*
         * A bounded enumeration can only prove a prefix *is* completable — never that it is not,
         * since the witness may simply be longer than the bound. So the language is enumerated at
         * two depths and a candidate is only asserted on where both agree. Where they disagree the
         * bound is the limiting factor, not the automaton, and asserting there produces false
         * failures rather than real ones.
         */
        const shallow = enumerateLanguage(particle, MAX_WORD);
        const deep = enumerateLanguage(particle, MAX_WORD + 2);
        fc.pre(deep.size > 0);

        for (let index = 0; index <= children.length; index++) {
          const offered = new Set(
            whatCanGoHere(model, children, index)
              .filter((c) => c.name !== undefined)
              .map((c) => c.name!.localName),
          );

          for (const candidate of ALPHABET.map(n)) {
            const hypothetical = [...children.slice(0, index), candidate, ...children.slice(index)];
            const nearAnswer = isCompletablePrefix(shallow, hypothetical);
            const farAnswer = isCompletablePrefix(deep, hypothetical);
            if (nearAnswer !== farAnswer) continue; // answer not stable at this bound

            expect(
              offered.has(candidate.localName),
              `at index ${index}, candidate <${candidate.localName}>, children [${children
                .map((c) => c.localName)
                .join(',')}]`,
            ).toBe(farAnswer);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
