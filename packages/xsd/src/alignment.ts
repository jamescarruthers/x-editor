/**
 * Error-tolerant alignment between what the document says and what the content model allows.
 *
 * When a child list already fails, "invalid content" is the least useful thing to say — it is
 * precisely the moment a beginner needs the most help. So instead of reporting the failure, we ask a
 * harder question: **what is the smallest set of edits that would make this valid?** The answer
 * turns directly into quick fixes, because each edit operation maps one-to-one onto one:
 *
 * | Alignment op | Quick fix |
 * |---|---|
 * | substitution | "rename `<Ordr>` to `<Order>`" |
 * | deletion | "remove `<x>`, it isn't allowed here" |
 * | insertion | "add `<c>` before `<d>`" |
 * | transposition | "swap `<b>` and `<a>` — they're the wrong way round" |
 *
 * The algorithm is Oflazer's error-tolerant recognition (1996): a Wagner–Fischer dynamic program run
 * over (input position × automaton state) rather than (input × input), pruned by an edit-distance
 * cut-off. Cost is `O(n · |states| · |alphabet|)` with a small cut-off, which at the sizes involved —
 * tens of children, tens of positions — is microseconds.
 *
 * Building this deliberately, rather than accreting per-error heuristics, is what stops the quick-fix
 * system becoming a pile of special cases that disagree with each other.
 */

import {
  elementNameEquals,
  elementNameKey,
  formatElementName,
  type ElementName,
} from './particles.js';
import type { CompiledContentModel } from './automaton.js';

export type EditKind = 'insert' | 'delete' | 'replace' | 'transpose';

/**
 * One edit.
 *
 * `index` is a position in the *original* child list, and operations are emitted in increasing
 * order of it. Applying them therefore means walking the list left to right with a running offset —
 * see `applyOperations`, which is the single definition of that contract. Two operations can share
 * an index (insert something, then fix the element that was already there), and only a defined
 * application order makes that unambiguous; a naive right-to-left splice silently produces a
 * different document.
 */
export interface EditOperation {
  readonly kind: EditKind;
  /** Index into the observed child list where the edit applies. */
  readonly index: number;
  /** The name to insert or substitute in. Absent for a deletion. */
  readonly name?: ElementName;
  /** The name being removed or replaced. Absent for an insertion. */
  readonly existing?: ElementName;
}

export interface Alignment {
  readonly operations: readonly EditOperation[];
  readonly cost: number;
}

/** How far we will search before giving up. Beyond this the suggestions stop being credible. */
const DEFAULT_MAX_COST = 4;

/**
 * A search state: how much of the input has been consumed, and where that leaves the automaton.
 *
 * The automaton is an NFA, so the state is a *set* of positions. Keyed as a sorted string because
 * two different paths reaching the same (input index, position set) are the same problem, and
 * without that collapse the search is exponential.
 */
interface SearchState {
  readonly index: number;
  readonly positions: ReadonlySet<number>;
  readonly cost: number;
  readonly operations: readonly EditOperation[];
  /**
   * How many operations throw away something the user wrote. Used only to break ties between
   * equal-cost repairs: given `<item><item>` against `item*, total`, replacing the second `<item>`
   * and adding a `<total>` cost the same, and the one that does not delete the user's work is the
   * one to offer.
   */
  readonly destructive: number;
}

const START = -1;

function transitionsFrom(model: CompiledContentModel, position: number): ReadonlySet<number> {
  return position === START ? model.first : (model.follow.get(position) ?? new Set());
}

function step(
  model: CompiledContentModel,
  positions: ReadonlySet<number>,
  name: ElementName,
): Set<number> {
  const next = new Set<number>();
  for (const position of positions) {
    for (const target of transitionsFrom(model, position)) {
      if (matcherAccepts(model, target, name)) next.add(target);
    }
  }
  return next;
}

function matcherAccepts(model: CompiledContentModel, position: number, name: ElementName): boolean {
  const matcher = model.positions[position]!.matcher;
  if (matcher.kind === 'wildcard') return true;
  if (!matcher.abstract && elementNameEquals(matcher.name, name)) return true;
  return matcher.substitutions.some((substitute) => elementNameEquals(substitute, name));
}

/** Every concrete name the automaton could accept from here — the alphabet for insertions. */
function acceptableFrom(
  model: CompiledContentModel,
  positions: ReadonlySet<number>,
): { name: ElementName; position: number }[] {
  const out: { name: ElementName; position: number }[] = [];
  const seen = new Set<string>();

  for (const position of positions) {
    for (const target of transitionsFrom(model, position)) {
      const matcher = model.positions[target]!.matcher;
      if (matcher.kind !== 'element') continue;
      const names = matcher.abstract ? matcher.substitutions : [matcher.name, ...matcher.substitutions];
      for (const name of names) {
        const key = `${target}:${elementNameKey(name)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name, position: target });
      }
    }
  }
  return out;
}

function isAccepting(model: CompiledContentModel, positions: ReadonlySet<number>): boolean {
  for (const position of positions) {
    if (position === START) {
      if (model.nullable) return true;
    } else if (model.last.has(position)) return true;
  }
  return false;
}

function key(index: number, positions: ReadonlySet<number>): string {
  return `${index}|${[...positions].sort((a, b) => a - b).join(',')}`;
}

/**
 * The cheapest sequence of edits that makes `children` valid, or null if none exists within the
 * cost limit.
 *
 * Uniform-cost search rather than a filled DP table: the interesting answers all sit at cost 1–2, so
 * exploring in cost order finds them almost immediately and never touches the rest of the space.
 */
export function alignToModel(
  model: CompiledContentModel,
  children: readonly ElementName[],
  options: { maxCost?: number } = {},
): Alignment | null {
  const maxCost = options.maxCost ?? DEFAULT_MAX_COST;

  const initial: SearchState = {
    index: 0,
    positions: new Set([START]),
    cost: 0,
    operations: [],
    destructive: 0,
  };

  // Cost never exceeds `maxCost`, so bucketing by cost gives ordered exploration without a heap.
  const frontier: SearchState[][] = Array.from({ length: maxCost + 1 }, () => []);
  frontier[0]!.push(initial);
  const best = new Map<string, number>([[key(0, initial.positions), 0]]);

  for (let cost = 0; cost <= maxCost; cost++) {
    const bucket = frontier[cost]!;
    const solutions: SearchState[] = [];

    for (let i = 0; i < bucket.length; i++) {
      const state = bucket[i]!;
      if (state.cost !== cost) continue;

      if (state.index === children.length && isAccepting(model, state.positions)) {
        // Collected rather than returned: the rest of this bucket may hold an equally cheap repair
        // that destroys less of what the user wrote, and that is the one worth offering.
        solutions.push(state);
        continue;
      }

      const consider = (next: SearchState): void => {
        if (next.cost > maxCost) return;
        const stateKey = key(next.index, next.positions);
        const known = best.get(stateKey);
        if (known !== undefined && known < next.cost) return;
        // Equal cost still gets explored, so a less destructive route to the same state survives;
        // strictly-worse routes are dropped.
        if (known === undefined || next.cost < known) best.set(stateKey, next.cost);
        frontier[next.cost]!.push(next);
      };

      const current = children[state.index];

      // Match: free, and always worth taking.
      if (current !== undefined) {
        const matched = step(model, state.positions, current);
        if (matched.size > 0) {
          consider({ ...state, index: state.index + 1, positions: matched });
        }
      }

      // Delete: the child is not allowed here at all.
      if (current !== undefined) {
        consider({
          index: state.index + 1,
          positions: state.positions,
          cost: state.cost + 1,
          operations: [
            ...state.operations,
            { kind: 'delete', index: state.index, existing: current },
          ],
          destructive: state.destructive + 1,
        });
      }

      // Insert: something required is missing before this point.
      for (const candidate of acceptableFrom(model, state.positions)) {
        const inserted = step(model, state.positions, candidate.name);
        if (inserted.size === 0) continue;
        consider({
          index: state.index,
          positions: inserted,
          cost: state.cost + 1,
          operations: [
            ...state.operations,
            { kind: 'insert', index: state.index, name: candidate.name },
          ],
          destructive: state.destructive,
        });
      }

      // Replace: the child is the wrong element — usually a typo or the wrong vocabulary.
      if (current !== undefined) {
        for (const candidate of acceptableFrom(model, state.positions)) {
          if (elementNameEquals(candidate.name, current)) continue;
          const replaced = step(model, state.positions, candidate.name);
          if (replaced.size === 0) continue;
          consider({
            index: state.index + 1,
            positions: replaced,
            cost: state.cost + 1,
            operations: [
              ...state.operations,
              { kind: 'replace', index: state.index, name: candidate.name, existing: current },
            ],
            destructive: state.destructive + 1,
          });
        }
      }

      // Transpose: two adjacent children the wrong way round. One operation rather than the
      // delete-plus-insert pair it would otherwise decompose into, because "swap these two" is a far
      // better thing to offer a user than "delete this, then add it back over there".
      const following = children[state.index + 1];
      if (current !== undefined && following !== undefined) {
        const first = step(model, state.positions, following);
        if (first.size > 0) {
          const second = step(model, first, current);
          if (second.size > 0) {
            consider({
              index: state.index + 2,
              positions: second,
              cost: state.cost + 1,
              operations: [
                ...state.operations,
                { kind: 'transpose', index: state.index, existing: current, name: following },
              ],
              destructive: state.destructive,
            });
          }
        }
      }
    }

    if (solutions.length > 0) {
      const best = solutions.reduce((a, b) =>
        b.destructive < a.destructive ||
        (b.destructive === a.destructive && b.operations.length < a.operations.length)
          ? b
          : a,
      );
      return { operations: best.operations, cost: best.cost };
    }
  }

  return null;
}

/**
 * Apply an alignment to a list of names — the reference definition of what an alignment *means*.
 *
 * Left to right with a running offset, because operations are emitted in increasing original-index
 * order and two of them may share an index. The command builder that edits the real document has to
 * walk it the same way, and the property test checks this definition against the reference matcher,
 * so the two cannot drift apart.
 */
export function applyOperations(
  names: readonly ElementName[],
  operations: readonly EditOperation[],
): ElementName[] {
  const out = [...names];
  let offset = 0;

  for (const operation of operations) {
    const at = operation.index + offset;
    switch (operation.kind) {
      case 'insert':
        out.splice(at, 0, operation.name!);
        offset++;
        break;
      case 'delete':
        out.splice(at, 1);
        offset--;
        break;
      case 'replace':
        out.splice(at, 1, operation.name!);
        break;
      case 'transpose': {
        const first = out[at]!;
        out[at] = out[at + 1]!;
        out[at + 1] = first;
        break;
      }
    }
  }
  return out;
}

/** A human-readable rendering of one edit, for a quick-fix title. */
export function describeEdit(operation: EditOperation): string {
  const name = operation.name === undefined ? '' : formatElementName(operation.name);
  const existing = operation.existing === undefined ? '' : formatElementName(operation.existing);

  switch (operation.kind) {
    case 'insert':
      return `Add <${name}>`;
    case 'delete':
      return `Remove <${existing}>`;
    case 'replace':
      return `Change <${existing}> to <${name}>`;
    case 'transpose':
      return `Swap <${existing}> and <${name}>`;
  }
}

/**
 * How close two element names are, for ranking a "did you mean?" suggestion.
 *
 * Plain Levenshtein over the local names, case-insensitively. A rename suggestion is only worth
 * offering when the names are actually similar — proposing `<TotalAmount>` for a stray `<x>` is
 * noise, and worse than saying nothing.
 */
export function nameDistance(a: ElementName, b: ElementName): number {
  return levenshtein(a.localName.toLowerCase(), b.localName.toLowerCase());
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** True when a rename is plausible rather than merely possible. */
export function isPlausibleRename(from: ElementName, to: ElementName): boolean {
  const distance = nameDistance(from, to);
  const length = Math.max(from.localName.length, to.localName.length);
  // Within a third of the name's length, and never more than three edits.
  return distance <= Math.min(3, Math.max(1, Math.floor(length / 3)));
}
