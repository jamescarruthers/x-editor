import {
  UNBOUNDED,
  elementNameEquals,
  elementNameKey,
  namespaceAllowed,
  type ElementName,
  type NamespaceConstraint,
  type Particle,
  type ProcessContents,
} from './particles.js';

/**
 * The content-model automaton.
 *
 * This is the component the whole product rests on. Validators answer "is this document valid" over
 * a *complete* document; a beginner needs "what may I put here" at a position in a half-finished
 * one, and no validator exposes the machinery to answer that. So we build it.
 *
 * The construction is Glushkov (position automaton). XSD's Unique Particle Attribution rule makes
 * content models 1-unambiguous, which means the position automaton is already deterministic — no
 * subset construction needed. Real schemas do violate UPA though, including hand-written ones a
 * beginner will bring, so this is implemented as an NFA over sets of positions: it costs almost
 * nothing at these alphabet sizes and it means a slightly-broken schema still opens and still gives
 * guidance. Refusing to open it would be a product failure.
 */

/** A position in the automaton — one occurrence of one leaf particle. */
interface Position {
  readonly index: number;
  readonly matcher: Matcher;
}

type Matcher =
  | { readonly kind: 'element'; readonly name: ElementName; readonly substitutions: readonly ElementName[] }
  | {
      readonly kind: 'wildcard';
      readonly namespaceConstraint: NamespaceConstraint;
      readonly processContents: ProcessContents;
    };

/** The virtual state before anything has been matched. */
const START = -1;

export interface CompiledContentModel {
  readonly positions: readonly Position[];
  readonly first: ReadonlySet<number>;
  readonly last: ReadonlySet<number>;
  readonly follow: ReadonlyMap<number, ReadonlySet<number>>;
  readonly nullable: boolean;
  /**
   * Set when occurrence bounds were too large to unroll exactly. Suggestions stay useful but may
   * over-permit near the bound; the UI should say so rather than pretend to be exact.
   */
  readonly approximate: boolean;
  /**
   * True when two branches can match the same name from the same state — a Unique Particle
   * Attribution violation. Worth surfacing in the XSD editor ("this choice is ambiguous"), and
   * harmless here because the runtime is an NFA.
   */
  readonly ambiguous: boolean;
}

/** How many positions we will unroll before approximating. Real schemas rarely come close. */
const POSITION_BUDGET = 2000;

// --- compilation --------------------------------------------------------

type Node =
  | { kind: 'empty' }
  | { kind: 'symbol'; matcher: Matcher }
  | { kind: 'concat'; items: Node[] }
  | { kind: 'alternate'; items: Node[] }
  | { kind: 'star'; item: Node }
  | { kind: 'optional'; item: Node };

export function compileContentModel(particle: Particle): CompiledContentModel {
  const state = { count: 0, approximate: false };
  const node = normalize(particle, state);

  const positions: Position[] = [];
  const first = new Set<number>();
  const last = new Set<number>();
  const follow = new Map<number, Set<number>>();

  const assign = (n: Node): { first: Set<number>; last: Set<number>; nullable: boolean } => {
    switch (n.kind) {
      case 'empty':
        return { first: new Set(), last: new Set(), nullable: true };

      case 'symbol': {
        const index = positions.length;
        positions.push({ index, matcher: n.matcher });
        follow.set(index, new Set());
        return { first: new Set([index]), last: new Set([index]), nullable: false };
      }

      case 'concat': {
        const f = new Set<number>();
        const l = new Set<number>();
        let nullableSoFar = true;
        let prevLast = new Set<number>();

        for (const item of n.items) {
          const r = assign(item);
          // first(e1 e2) = first(e1) ∪ (nullable(e1) ? first(e2) : ∅)
          if (nullableSoFar) for (const x of r.first) f.add(x);
          // follow: everything that could end the prefix links to everything that could start here
          for (const a of prevLast) for (const b of r.first) follow.get(a)!.add(b);

          if (r.nullable) for (const x of r.last) l.add(x);
          else {
            l.clear();
            for (const x of r.last) l.add(x);
          }

          prevLast = r.nullable ? new Set([...prevLast, ...r.last]) : new Set(r.last);
          nullableSoFar = nullableSoFar && r.nullable;
        }
        return { first: f, last: l, nullable: nullableSoFar };
      }

      case 'alternate': {
        const f = new Set<number>();
        const l = new Set<number>();
        let nullable = false;
        for (const item of n.items) {
          const r = assign(item);
          for (const x of r.first) f.add(x);
          for (const x of r.last) l.add(x);
          nullable = nullable || r.nullable;
        }
        return { first: f, last: l, nullable };
      }

      case 'star': {
        const r = assign(n.item);
        // The loop edge: anything that can end the body can be followed by anything that starts it.
        for (const a of r.last) for (const b of r.first) follow.get(a)!.add(b);
        return { first: r.first, last: r.last, nullable: true };
      }

      case 'optional': {
        const r = assign(n.item);
        return { first: r.first, last: r.last, nullable: true };
      }
    }
  };

  const root = assign(node);
  for (const x of root.first) first.add(x);
  for (const x of root.last) last.add(x);

  return {
    positions,
    first,
    last,
    follow,
    nullable: root.nullable,
    approximate: state.approximate,
    ambiguous: detectAmbiguity(positions, first, follow),
  };
}

function normalize(particle: Particle, state: { count: number; approximate: boolean }): Node {
  switch (particle.kind) {
    case 'empty':
      return { kind: 'empty' };

    case 'element':
      return repeat(
        () => ({
          kind: 'symbol' as const,
          matcher: {
            kind: 'element' as const,
            name: particle.name,
            substitutions: particle.substitutions ?? [],
          },
        }),
        particle.occurs.min,
        particle.occurs.max,
        state,
      );

    case 'wildcard':
      return repeat(
        () => ({
          kind: 'symbol' as const,
          matcher: {
            kind: 'wildcard' as const,
            namespaceConstraint: particle.namespaceConstraint,
            processContents: particle.processContents,
          },
        }),
        particle.occurs.min,
        particle.occurs.max,
        state,
      );

    case 'sequence':
      return repeat(
        () => ({ kind: 'concat' as const, items: particle.items.map((i) => normalize(i, state)) }),
        particle.occurs.min,
        particle.occurs.max,
        state,
      );

    case 'choice':
      return repeat(
        () => ({ kind: 'alternate' as const, items: particle.items.map((i) => normalize(i, state)) }),
        particle.occurs.min,
        particle.occurs.max,
        state,
      );

    case 'all':
      // `xs:all` never reaches the automaton — see `allModel.ts`. Compiling it here would mean
      // interleaving, which blows up combinatorially for no benefit.
      throw new Error('xs:all must be handled by AllContentModel, not the automaton');
  }
}

/**
 * Expands occurrence bounds by unrolling: `min` mandatory copies, then either optional copies up to
 * `max`, or a star for unbounded. Exact and easy to debug, at the cost of size — hence the budget.
 * In real schemas (UBL, GML, NIEM, DocBook, HL7) maxOccurs is essentially always 1 or unbounded, so
 * the budget is rarely reached; when it is, we approximate and say so.
 */
function repeat(
  make: () => Node,
  min: number,
  max: number,
  state: { count: number; approximate: boolean },
): Node {
  if (max === 0) return { kind: 'empty' };
  if (min === 1 && max === 1) {
    state.count++;
    return make();
  }

  const items: Node[] = [];
  const budgetLeft = (): number => POSITION_BUDGET - state.count;

  const mandatory = Math.min(min, Math.max(0, budgetLeft()));
  for (let i = 0; i < mandatory; i++) {
    state.count++;
    items.push(make());
  }
  if (mandatory < min) state.approximate = true;

  if (max === UNBOUNDED) {
    state.count++;
    items.push({ kind: 'star', item: make() });
  } else {
    const optional = max - min;
    const affordable = Math.min(optional, Math.max(0, budgetLeft()));
    for (let i = 0; i < affordable; i++) {
      state.count++;
      items.push({ kind: 'optional', item: make() });
    }
    if (affordable < optional) {
      // Ran out of budget. Over-permitting near the bound beats hiding valid choices, but it is an
      // approximation and the model says so.
      state.approximate = true;
      state.count++;
      items.push({ kind: 'star', item: make() });
    }
  }

  if (items.length === 0) return { kind: 'empty' };
  if (items.length === 1) return items[0]!;
  return { kind: 'concat', items };
}

/** Two outgoing transitions from one state that accept the same name means UPA is violated. */
function detectAmbiguity(
  positions: readonly Position[],
  first: ReadonlySet<number>,
  follow: ReadonlyMap<number, ReadonlySet<number>>,
): boolean {
  const check = (targets: ReadonlySet<number>): boolean => {
    const names = new Set<string>();
    for (const index of targets) {
      const matcher = positions[index]!.matcher;
      if (matcher.kind === 'wildcard') continue;
      for (const name of [matcher.name, ...matcher.substitutions]) {
        const key = elementNameKey(name);
        if (names.has(key)) return true;
        names.add(key);
      }
    }
    return false;
  };

  if (check(first)) return true;
  for (const targets of follow.values()) if (check(targets)) return true;
  return false;
}

// --- querying -----------------------------------------------------------

function matches(matcher: Matcher, name: ElementName): boolean {
  if (matcher.kind === 'wildcard') return namespaceAllowed(matcher.namespaceConstraint, name.namespaceUri);
  if (elementNameEquals(matcher.name, name)) return true;
  return matcher.substitutions.some((s) => elementNameEquals(s, name));
}

function transitionsFrom(model: CompiledContentModel, state: number): ReadonlySet<number> {
  return state === START ? model.first : (model.follow.get(state) ?? new Set());
}

function step(model: CompiledContentModel, states: ReadonlySet<number>, name: ElementName): Set<number> {
  const next = new Set<number>();
  for (const state of states) {
    for (const target of transitionsFrom(model, state)) {
      if (matches(model.positions[target]!.matcher, name)) next.add(target);
    }
  }
  return next;
}

function isAccepting(model: CompiledContentModel, states: ReadonlySet<number>): boolean {
  for (const state of states) {
    if (state === START) {
      if (model.nullable) return true;
    } else if (model.last.has(state)) return true;
  }
  return false;
}

/** Runs the prefix, returning the set of positions reachable after it. Empty means it went wrong. */
export function run(model: CompiledContentModel, children: readonly ElementName[]): Set<number> {
  let states: Set<number> = new Set([START]);
  for (const child of children) {
    states = step(model, states, child);
    if (states.size === 0) break;
  }
  return states;
}

export function isValidSequence(
  model: CompiledContentModel,
  children: readonly ElementName[],
): boolean {
  const states = run(model, children);
  return states.size > 0 && isAccepting(model, states);
}

export interface Candidate {
  readonly matcher: Matcher;
  /** Present for a named element candidate. */
  readonly name?: ElementName;
}

/**
 * The core query: what may be inserted at index `i` of this child list?
 *
 * Answered by intersecting a forward run over `children[0..i)` with a backward co-reachability
 * sweep over `children[i..n)`. The backward half is what makes this genuinely position-aware rather
 * than merely "children this type allows": a candidate is only offered if what already sits *after*
 * the caret can still be completed.
 *
 * One backward pass yields the co-reachable set for every index at once, so computing candidates at
 * every gap in a parent costs one sweep rather than one per gap.
 */
export function whatCanGoHere(
  model: CompiledContentModel,
  children: readonly ElementName[],
  index: number,
): Candidate[] {
  const coReach = coReachableSets(model, children);
  const target = coReach[index];
  if (target === undefined) return [];

  const prefixStates = run(model, children.slice(0, index));

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const state of prefixStates) {
    for (const positionIndex of transitionsFrom(model, state)) {
      // The inserted element must itself leave the automaton in a state from which the untouched
      // remainder still completes.
      if (!target.has(positionIndex)) continue;

      const matcher = model.positions[positionIndex]!.matcher;
      if (matcher.kind === 'element') {
        for (const name of [matcher.name, ...matcher.substitutions]) {
          const key = `e:${elementNameKey(name)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ matcher, name });
        }
      } else {
        const key = `w:${JSON.stringify(matcher.namespaceConstraint)}:${matcher.processContents}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ matcher });
      }
    }
  }

  return candidates;
}

/**
 * The states from which an accepting state is still reachable by consuming further elements.
 *
 * This is the difference between "the document is finished" and "the document can still be
 * finished", and getting it wrong makes the palette almost useless: requiring the stricter
 * condition means `sequence(a, b, c)` with `<a>` already present would offer nothing at all, since
 * inserting `<b>` does not by itself complete the element.
 */
function coAccessibleStates(model: CompiledContentModel): Set<number> {
  // Reverse the transition graph, then flood back from every accepting state.
  const incoming = new Map<number, number[]>();
  const addEdge = (from: number, to: number): void => {
    const list = incoming.get(to);
    if (list === undefined) incoming.set(to, [from]);
    else list.push(from);
  };

  for (const target of model.first) addEdge(START, target);
  for (const [source, targets] of model.follow) {
    for (const target of targets) addEdge(source, target);
  }

  const result = new Set<number>();
  const queue: number[] = [];
  for (const accepting of model.last) {
    result.add(accepting);
    queue.push(accepting);
  }
  if (model.nullable) result.add(START);

  while (queue.length > 0) {
    const node = queue.pop()!;
    for (const source of incoming.get(node) ?? []) {
      if (result.has(source)) continue;
      result.add(source);
      queue.push(source);
    }
  }

  return result;
}

/**
 * For each index `i`, the set of positions from which `children[i..n)` can still be consumed and an
 * accepting state remains reachable afterwards. Computed once, backwards, for all indices — so
 * every insertion gap in a parent costs one sweep rather than one per gap.
 */
function coReachableSets(
  model: CompiledContentModel,
  children: readonly ElementName[],
): Set<number>[] {
  const n = children.length;
  const sets: Set<number>[] = new Array(n + 1);

  // Past the last existing child, any state that can still reach acceptance is fair game — the user
  // may keep adding after the insertion point.
  sets[n] = coAccessibleStates(model);

  for (let i = n - 1; i >= 0; i--) {
    const nextSet = sets[i + 1]!;
    const current = new Set<number>();
    const candidateStates = [START, ...model.positions.map((p) => p.index)];
    for (const state of candidateStates) {
      for (const target of transitionsFrom(model, state)) {
        if (matches(model.positions[target]!.matcher, children[i]!) && nextSet.has(target)) {
          current.add(state);
          break;
        }
      }
    }
    sets[i] = current;
  }

  return sets;
}

/**
 * The shortest list of elements that would complete this parent, in order.
 *
 * A BFS from the current state to the nearest accepting one. Concrete elements are preferred over
 * wildcards, because "add <total>" is a usable suggestion and "add any element from namespace X" is
 * not. This is what powers the "Add all N missing children" action, inserting each at the position
 * the automaton actually expects.
 */
export function requiredToComplete(
  model: CompiledContentModel,
  children: readonly ElementName[],
): ElementName[] | null {
  const start = run(model, children);
  if (start.size === 0) return null; // already invalid — repair, not completion
  if (isAccepting(model, start)) return [];

  const key = (states: ReadonlySet<number>): string => [...states].sort((a, b) => a - b).join(',');

  const queue: { states: Set<number>; path: ElementName[] }[] = [{ states: start, path: [] }];
  const visited = new Set<string>([key(start)]);

  while (queue.length > 0) {
    const { states, path } = queue.shift()!;
    if (path.length > 40) break; // recursive models can wander; bound the search

    // Concrete names first, so a wildcard is only ever suggested when nothing else completes.
    const names: ElementName[] = [];
    for (const state of states) {
      for (const target of transitionsFrom(model, state)) {
        const matcher = model.positions[target]!.matcher;
        if (matcher.kind === 'element') names.push(matcher.name);
      }
    }

    for (const name of names) {
      const next = step(model, states, name);
      if (next.size === 0) continue;
      const k = key(next);
      if (visited.has(k)) continue;
      visited.add(k);
      const nextPath = [...path, name];
      if (isAccepting(model, next)) return nextPath;
      queue.push({ states: next, path: nextPath });
    }
  }

  return null;
}

/** Where the child list first stops being valid, or null if it never does. */
export function firstInvalidIndex(
  model: CompiledContentModel,
  children: readonly ElementName[],
): number | null {
  let states: Set<number> = new Set([START]);
  for (let i = 0; i < children.length; i++) {
    states = step(model, states, children[i]!);
    if (states.size === 0) return i;
  }
  return null;
}
