import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compileContentModel } from '../src/automaton.js';
import { ANY_NUMBER, ONCE, OPTIONAL, p, type ElementName, type Particle } from '../src/particles.js';
import {
  alignToModel,
  applyOperations,
  describeEdit,
  isPlausibleRename,
  levenshtein,
} from '../src/alignment.js';
import { referenceAccepts } from './reference.js';

const n = (localName: string): ElementName => ({ namespaceUri: null, localName });
const names = (...list: string[]): ElementName[] => list.map(n);

function align(particle: Particle, children: string[], maxCost = 4) {
  return alignToModel(compileContentModel(particle), names(...children), { maxCost });
}

/** Apply the edits, through the module's own definition of what applying them means. */
function applyEdits(children: string[], alignment: NonNullable<ReturnType<typeof align>>): string[] {
  return applyOperations(names(...children), alignment.operations).map((name) => name.localName);
}

describe('alignment finds the smallest repair', () => {
  const sequence = p.sequence([p.element('a'), p.element('b'), p.element('c')]);

  it('reports no edits for a list that already validates', () => {
    expect(align(sequence, ['a', 'b', 'c'])).toEqual({ operations: [], cost: 0 });
  });

  it('proposes an insertion for something missing', () => {
    const result = align(sequence, ['a', 'c'])!;
    expect(result.cost).toBe(1);
    expect(result.operations).toEqual([{ kind: 'insert', index: 1, name: n('b') }]);
  });

  it('proposes a deletion for something not allowed', () => {
    const result = align(sequence, ['a', 'x', 'b', 'c'])!;
    expect(result.cost).toBe(1);
    expect(result.operations).toEqual([{ kind: 'delete', index: 1, existing: n('x') }]);
  });

  it('proposes a swap rather than a delete-and-insert pair', () => {
    // "Swap these two" is a far better thing to offer than "delete this, add it back over there",
    // and it is also cheaper, so the search finds it first.
    const result = align(sequence, ['b', 'a', 'c'])!;
    expect(result.cost).toBe(1);
    expect(result.operations).toEqual([
      { kind: 'transpose', index: 0, existing: n('b'), name: n('a') },
    ]);
  });

  it('proposes a rename when a name is wrong but the position is right', () => {
    const result = align(sequence, ['a', 'x', 'c'])!;
    expect(result.cost).toBe(1);
    expect(result.operations).toEqual([
      { kind: 'replace', index: 1, name: n('b'), existing: n('x') },
    ]);
  });

  it('combines edits when more than one thing is wrong', () => {
    const result = align(sequence, ['x', 'c'])!;
    expect(result.cost).toBe(2);
    expect(applyEdits(['x', 'c'], result)).toEqual(['a', 'b', 'c']);
  });

  it('gives up rather than proposing an implausible pile of edits', () => {
    expect(align(p.sequence([p.element('a')]), ['q', 'r', 's', 't', 'u', 'v'], 2)).toBeNull();
  });
});

describe('alignment across model shapes', () => {
  it('handles a choice by picking one branch', () => {
    const model = p.sequence([p.choice([p.element('a'), p.element('b')]), p.element('z')]);
    const result = align(model, ['z'])!;
    expect(result.cost).toBe(1);
    expect(result.operations[0]?.kind).toBe('insert');
    expect(applyEdits(['z'], result)).toEqual(['a', 'z']);
  });

  it('handles repetition without inserting more than it must', () => {
    const model = p.sequence([p.element('item', ANY_NUMBER), p.element('total', ONCE)]);
    const result = align(model, ['item', 'item'])!;
    expect(result.operations).toEqual([{ kind: 'insert', index: 2, name: n('total') }]);
  });

  it('handles an optional element being absent, with no edits at all', () => {
    const model = p.sequence([p.element('a'), p.element('b', OPTIONAL), p.element('c')]);
    expect(align(model, ['a', 'c'])).toEqual({ operations: [], cost: 0 });
  });

  it('completes an empty list against a required sequence', () => {
    const result = align(p.sequence([p.element('a'), p.element('b')]), [])!;
    expect(result.operations.map((o) => o.name?.localName)).toEqual(['a', 'b']);
  });

  it('offers a substitution-group member rather than the abstract head', () => {
    const head = p.element('vehicle', ONCE, {
      substitutions: [n('car'), n('van')],
      abstract: true,
    });
    const result = align(p.sequence([head]), [])!;
    expect(result.operations[0]?.name?.localName).toBe('car');
  });
});

describe('describeEdit', () => {
  it('reads as an instruction rather than a diagnosis', () => {
    expect(describeEdit({ kind: 'insert', index: 0, name: n('total') })).toBe('Add <total>');
    expect(describeEdit({ kind: 'delete', index: 0, existing: n('x') })).toBe('Remove <x>');
    expect(describeEdit({ kind: 'replace', index: 0, name: n('b'), existing: n('x') })).toBe(
      'Change <x> to <b>',
    );
    expect(describeEdit({ kind: 'transpose', index: 0, existing: n('b'), name: n('a') })).toBe(
      'Swap <b> and <a>',
    );
  });
});

describe('name similarity', () => {
  it('measures edit distance', () => {
    expect(levenshtein('order', 'ordr')).toBe(1);
    expect(levenshtein('order', 'order')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('accepts a typo as a plausible rename', () => {
    expect(isPlausibleRename(n('Ordr'), n('Order'))).toBe(true);
    expect(isPlausibleRename(n('shipdate'), n('shipDate'))).toBe(true);
  });

  it('refuses an implausible one, because a wrong suggestion is worse than none', () => {
    expect(isPlausibleRename(n('x'), n('TotalAmount'))).toBe(false);
    expect(isPlausibleRename(n('quantity'), n('description'))).toBe(false);
  });
});

describe('property: an alignment always produces a valid child list', () => {
  const nameArb = fc.constantFrom(...names('a', 'b', 'c', 'd'));

  const particleArb: fc.Arbitrary<Particle> = fc.letrec((tie) => ({
    particle: fc.oneof(
      { depthSize: 'small' },
      fc.record({ localName: fc.constantFrom('a', 'b', 'c', 'd'), occurs: fc.constantFrom(ONCE, OPTIONAL, ANY_NUMBER) })
        .map(({ localName, occurs }) => p.element(localName, occurs)),
      fc
        .tuple(fc.array(tie('particle') as fc.Arbitrary<Particle>, { minLength: 1, maxLength: 3 }), fc.constantFrom(ONCE, OPTIONAL))
        .map(([items, occurs]) => p.sequence(items, occurs)),
      fc
        .tuple(fc.array(tie('particle') as fc.Arbitrary<Particle>, { minLength: 2, maxLength: 3 }), fc.constantFrom(ONCE, OPTIONAL))
        .map(([items, occurs]) => p.choice(items, occurs)),
    ),
  })).particle;

  it('holds over random models and random broken child lists', () => {
    // The guarantee that matters: whatever the algorithm proposes, doing it produces a document the
    // validator accepts. A quick fix that leaves the document still invalid is worse than no fix.
    fc.assert(
      fc.property(particleArb, fc.array(nameArb, { maxLength: 5 }), (particle, children) => {
        const model = compileContentModel(particle);
        const result = alignToModel(model, children, { maxCost: 3 });
        if (result === null) return true;

        return referenceAccepts(particle, applyOperations(children, result.operations));
      }),
      { numRuns: 400 },
    );
  });
});
