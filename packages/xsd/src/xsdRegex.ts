/**
 * XSD regular expressions — a translator, not a pass-through.
 *
 * `xs:pattern` looks like a JavaScript regex and is not one. Handing the string straight to
 * `new RegExp` corrupts validation *silently*, which is the worst failure mode available: no error,
 * just wrong answers. The differences that bite:
 *
 * | XSD | JavaScript |
 * |---|---|
 * | implicitly anchored — the whole value must match | unanchored substring search |
 * | `^` and `$` are ordinary characters | anchors |
 * | `[a-z-[aeiou]]` subtracts a class | no such syntax |
 * | `\i` / `\c` are the XML name-start and name characters | not supported at all |
 * | `\w` is "not punctuation, separator or other" | `[A-Za-z0-9_]` |
 * | `\s` is exactly space, tab, LF, CR | includes vertical tab, form feed, NBSP, … |
 * | no backreferences, no lazy quantifiers, no lookaround | all present |
 *
 * So this parses the XSD dialect into an AST and re-emits JavaScript. Character-class subtraction is
 * done as exact arithmetic over codepoint ranges wherever the operands are enumerable — which
 * includes `\i`, `\c`, `\s` and every literal range, so nearly all real patterns come out exact.
 * When a Unicode property is involved in subtraction the ranges are not enumerable here, and the
 * ES2024 `v` flag does it natively; where that is unavailable the translation is marked approximate
 * and made *permissive*, because a pattern that wrongly rejects a correct value teaches a beginner
 * something false, while one that wrongly accepts merely fails to help.
 *
 * The same AST drives `sampleFor`, which produces "like `AB123456`" — worth more to a beginner than
 * the pattern itself.
 */

const MAX_CODEPOINT = 0x10ffff;

export interface TranslatedPattern {
  readonly source: string;
  readonly regex: RegExp | null;
  /** Set when the translation could not be exact; such a pattern never rejects a value. */
  readonly approximate: boolean;
  readonly error: string | null;
}

export function translatePattern(source: string): TranslatedPattern {
  let ast: Node;
  try {
    ast = new PatternParser(source).parse();
  } catch (error) {
    return {
      source,
      regex: null,
      approximate: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const emitter = new Emitter();
  const body = emitter.emit(ast);
  const flags = emitter.needsSetNotation ? 'uv' : 'u';

  try {
    // The `v` flag subsumes `u`; keep them separate so the fallback below is a plain retry.
    const regex = new RegExp(`^(?:${body})$`, emitter.needsSetNotation ? 'v' : 'u');
    return { source, regex, approximate: emitter.approximate, error: null };
  } catch {
    if (!emitter.needsSetNotation) {
      return { source, regex: null, approximate: true, error: `Could not translate: ${flags}` };
    }
    // No `v` support in this engine. Emit the permissive form rather than a wrong one.
    const permissive = new Emitter({ dropSubtraction: true });
    try {
      return {
        source,
        regex: new RegExp(`^(?:${permissive.emit(ast)})$`, 'u'),
        approximate: true,
        error: null,
      };
    } catch (error) {
      return {
        source,
        regex: null,
        approximate: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// --- character sets -----------------------------------------------------

type Range = readonly [number, number];

interface PropertyRef {
  readonly name: string;
  readonly negated: boolean;
}

/**
 * A set of codepoints: the union of `ranges`, `properties` and `nested`, complemented if `negated`.
 *
 * `nested` exists for one case JavaScript cannot spell under the `u` flag — a complemented union of
 * properties appearing *inside* another class, which is exactly what `[\w-[_]]` needs. Those go out
 * as nested classes under the ES2024 `v` flag.
 */
export interface CharSet {
  readonly ranges: readonly Range[];
  readonly properties: readonly PropertyRef[];
  readonly nested: readonly CharSet[];
  readonly negated: boolean;
}

function charSet(
  ranges: readonly Range[],
  properties: readonly PropertyRef[] = [],
  negated = false,
  nested: readonly CharSet[] = [],
): CharSet {
  return { ranges: normalizeRanges(ranges), properties, nested, negated };
}

/** Enumerable means the exact codepoints are known here, so set arithmetic can be done directly. */
function enumerable(set: CharSet): boolean {
  return set.properties.length === 0 && set.nested.length === 0;
}

function normalizeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].filter(([lo, hi]) => lo <= hi).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && lo <= last[1] + 1) {
      if (hi > last[1]) out[out.length - 1] = [last[0], hi];
    } else {
      out.push([lo, hi]);
    }
  }
  return out;
}

function complementRanges(ranges: readonly Range[]): Range[] {
  const out: Range[] = [];
  let cursor = 0;
  for (const [lo, hi] of normalizeRanges(ranges)) {
    if (lo > cursor) out.push([cursor, lo - 1]);
    cursor = Math.max(cursor, hi + 1);
  }
  if (cursor <= MAX_CODEPOINT) out.push([cursor, MAX_CODEPOINT]);
  return out;
}

/** The concrete ranges of an enumerable set, with negation already applied. */
function resolvedRanges(set: CharSet): Range[] {
  return set.negated ? complementRanges(set.ranges) : normalizeRanges(set.ranges);
}

function subtractSets(a: CharSet, b: CharSet): CharSet | null {
  if (!enumerable(a) || !enumerable(b)) return null; // caller falls back to set notation
  const remove = resolvedRanges(b);
  let current = resolvedRanges(a);
  for (const [lo, hi] of remove) {
    const next: Range[] = [];
    for (const [start, end] of current) {
      if (end < lo || start > hi) {
        next.push([start, end]);
        continue;
      }
      if (start < lo) next.push([start, lo - 1]);
      if (end > hi) next.push([hi + 1, end]);
    }
    current = next;
  }
  return charSet(current);
}

// --- the XSD shorthand escapes -----------------------------------------

/** XML 1.0 (5th ed) NameStartChar — `\i`. JavaScript has no equivalent, so it is spelled out. */
const NAME_START_CHAR: Range[] = [
  [0x3a, 0x3a],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
];

/** XML NameChar — `\c`. */
const NAME_CHAR: Range[] = [
  ...NAME_START_CHAR,
  [0x2d, 0x2e],
  [0x30, 0x39],
  [0xb7, 0xb7],
  [0x300, 0x36f],
  [0x203f, 0x2040],
];

/** XSD `\s` is exactly these four. JavaScript's `\s` is much larger. */
const XSD_SPACE: Range[] = [
  [0x09, 0x0a],
  [0x0d, 0x0d],
  [0x20, 0x20],
];

const PUNCTUATION_SEPARATOR_OTHER: readonly PropertyRef[] = [
  { name: 'P', negated: false },
  { name: 'Z', negated: false },
  { name: 'C', negated: false },
];

function shorthand(letter: string): CharSet | null {
  switch (letter) {
    case 's':
      return charSet(XSD_SPACE);
    case 'S':
      return charSet(XSD_SPACE, [], true);
    case 'i':
      return charSet(NAME_START_CHAR);
    case 'I':
      return charSet(NAME_START_CHAR, [], true);
    case 'c':
      return charSet(NAME_CHAR);
    case 'C':
      return charSet(NAME_CHAR, [], true);
    case 'd':
      return charSet([], [{ name: 'Nd', negated: false }]);
    case 'D':
      return charSet([], [{ name: 'Nd', negated: true }]);
    // XSD's `\w` is the *complement of the union* of punctuation, separators and "other" — not
    // JavaScript's [A-Za-z0-9_], which would reject every accented letter in a European name, and
    // not a union of complements, which would match very nearly everything.
    case 'w':
      return charSet([], PUNCTUATION_SEPARATOR_OTHER, true);
    case 'W':
      return charSet([], PUNCTUATION_SEPARATOR_OTHER, false);
    default:
      return null;
  }
}

// --- AST ----------------------------------------------------------------

/**
 * A character class with XSD's subtraction. Kept as a tree rather than a flat list of subtrahends
 * because subtraction is right-nested: `[a-z-[b-d-[c]]]` is `[a-z] - ([b-d] - [c])`, which contains
 * `c`, whereas flattening it to `[a-z] - [b-d] - [c]` does not.
 */
interface ClassExpr {
  readonly base: CharSet;
  readonly subtract: ClassExpr | null;
}

/** The exact set, or null when a Unicode property blocks the arithmetic. */
function resolveClass(expr: ClassExpr): CharSet | null {
  if (expr.subtract === null) return enumerable(expr.base) ? expr.base : null;
  const subtrahend = resolveClass(expr.subtract);
  if (subtrahend === null) return null;
  return subtractSets(expr.base, subtrahend);
}

type Node =
  | { kind: 'empty' }
  | { kind: 'char'; codepoint: number }
  | { kind: 'set'; expr: ClassExpr }
  | { kind: 'any' }
  | { kind: 'concat'; items: Node[] }
  | { kind: 'alternate'; items: Node[] }
  | { kind: 'repeat'; item: Node; min: number; max: number };

const SINGLE_ESCAPES: Readonly<Record<string, number>> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  '\\': 0x5c,
  '|': 0x7c,
  '.': 0x2e,
  '-': 0x2d,
  '^': 0x5e,
  '?': 0x3f,
  '*': 0x2a,
  '+': 0x2b,
  '{': 0x7b,
  '}': 0x7d,
  '(': 0x28,
  ')': 0x29,
  '[': 0x5b,
  ']': 0x5d,
};

class PatternParser {
  private index = 0;
  private readonly chars: string[];

  constructor(private readonly source: string) {
    // Split by codepoint, so astral characters in a class range behave.
    this.chars = [...source];
  }

  parse(): Node {
    const node = this.parseAlternation();
    if (this.index < this.chars.length) {
      throw new Error(`Unexpected "${this.chars[this.index]!}" at position ${this.index}.`);
    }
    return node;
  }

  private peek(): string | undefined {
    return this.chars[this.index];
  }

  private next(): string {
    const char = this.chars[this.index];
    if (char === undefined) throw new Error('The pattern ends unexpectedly.');
    this.index++;
    return char;
  }

  private parseAlternation(): Node {
    const items: Node[] = [this.parseSequence()];
    while (this.peek() === '|') {
      this.index++;
      items.push(this.parseSequence());
    }
    return items.length === 1 ? items[0]! : { kind: 'alternate', items };
  }

  private parseSequence(): Node {
    const items: Node[] = [];
    while (this.index < this.chars.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseQuantified());
    }
    if (items.length === 0) return { kind: 'empty' };
    return items.length === 1 ? items[0]! : { kind: 'concat', items };
  }

  private parseQuantified(): Node {
    const atom = this.parseAtom();
    const quantifier = this.peek();

    if (quantifier === '?') {
      this.index++;
      return { kind: 'repeat', item: atom, min: 0, max: 1 };
    }
    if (quantifier === '*') {
      this.index++;
      return { kind: 'repeat', item: atom, min: 0, max: Infinity };
    }
    if (quantifier === '+') {
      this.index++;
      return { kind: 'repeat', item: atom, min: 1, max: Infinity };
    }
    if (quantifier === '{') {
      this.index++;
      return this.parseBounds(atom);
    }
    return atom;
  }

  private parseBounds(atom: Node): Node {
    let text = '';
    while (this.peek() !== '}') text += this.next();
    this.index++;

    const match = /^(\d+)(,(\d*)?)?$/.exec(text);
    if (match === null) throw new Error(`"{${text}}" is not a valid quantifier.`);
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === undefined || match[3] === '' ? Infinity : Number(match[3]);
    if (max < min) throw new Error(`"{${text}}" has an upper bound below its lower bound.`);
    return { kind: 'repeat', item: atom, min, max };
  }

  private parseAtom(): Node {
    const char = this.next();

    if (char === '(') {
      const inner = this.parseAlternation();
      if (this.peek() !== ')') throw new Error('A group is not closed.');
      this.index++;
      return inner;
    }
    if (char === '[') return this.parseClass();
    if (char === '.') return { kind: 'any' };
    if (char === '\\') return this.parseEscape();
    if (char === ']' || char === '}') {
      // Unlike JavaScript, XSD does not permit these bare. Reported rather than silently accepted.
      throw new Error(`"${char}" must be escaped in an XSD pattern.`);
    }
    return { kind: 'char', codepoint: char.codePointAt(0)! };
  }

  private parseEscape(): Node {
    const char = this.next();
    const single = SINGLE_ESCAPES[char];
    if (single !== undefined) return { kind: 'char', codepoint: single };

    const short = shorthand(char);
    if (short !== null) return { kind: 'set', expr: { base: short, subtract: null } };

    if (char === 'p' || char === 'P') {
      return { kind: 'set', expr: { base: this.parseProperty(char === 'P'), subtract: null } };
    }
    throw new Error(`"\\${char}" is not a valid XSD escape.`);
  }

  private parseProperty(negated: boolean): CharSet {
    if (this.next() !== '{') throw new Error('\\p must be followed by {…}.');
    let name = '';
    while (this.peek() !== '}') name += this.next();
    this.index++;
    return charSet([], [{ name, negated }]);
  }

  /**
   * `[...]`, with XSD's class subtraction: `[a-z-[aeiou]]`. The trailing `-[` is what distinguishes
   * subtraction from a literal hyphen, and it may nest.
   */
  private parseClass(): Node {
    const negatedClass = this.peek() === '^';
    if (negatedClass) this.index++;

    const ranges: Range[] = [];
    const properties: PropertyRef[] = [];
    const nested: CharSet[] = [];
    let subtract: ClassExpr | null = null;
    let first = true;

    while (true) {
      const char = this.peek();
      if (char === undefined) throw new Error('A character class is not closed.');

      if (char === ']' && !first) {
        this.index++;
        break;
      }

      // Subtraction: a `-` immediately followed by `[`. It is always the last thing in the class.
      if (char === '-' && this.chars[this.index + 1] === '[') {
        this.index += 2;
        const inner = this.parseClass();
        if (inner.kind !== 'set') throw new Error('A class subtraction must be a class.');
        subtract = inner.expr;
        if (this.peek() !== ']') throw new Error('A character class is not closed.');
        this.index++;
        break;
      }

      first = false;
      const item = this.parseClassItem();
      if (item.kind === 'set') {
        if (enumerable(item.set)) {
          // `\S` and friends: expand the complement now, while the ranges are still known.
          ranges.push(...resolvedRanges(item.set));
        } else if (item.set.negated) {
          // A complemented property union — `\w` — cannot be flattened into an enclosing class
          // under the `u` flag, so it stays whole and goes out as a nested class.
          nested.push(item.set);
        } else {
          properties.push(...item.set.properties);
          ranges.push(...item.set.ranges);
        }
        continue;
      }

      // A range, if the next character is `-` and not the start of a subtraction or the class end.
      const lo = item.codepoint;
      if (this.peek() === '-' && this.chars[this.index + 1] !== '[' && this.chars[this.index + 1] !== ']') {
        this.index++;
        const upper = this.parseClassItem();
        if (upper.kind !== 'char') throw new Error('A class range must end with a single character.');
        if (upper.codepoint < lo) throw new Error('A class range is inverted.');
        ranges.push([lo, upper.codepoint]);
      } else {
        ranges.push([lo, lo]);
      }
    }

    // A class whose only content is one nested set is that set — `[\w]` is just `\w`.
    const base =
      !negatedClass && ranges.length === 0 && properties.length === 0 && nested.length === 1
        ? nested[0]!
        : charSet(ranges, properties, negatedClass, nested);

    return { kind: 'set', expr: { base, subtract } };
  }

  private parseClassItem(): { kind: 'char'; codepoint: number } | { kind: 'set'; set: CharSet } {
    const char = this.next();
    if (char !== '\\') return { kind: 'char', codepoint: char.codePointAt(0)! };

    const escaped = this.next();
    const single = SINGLE_ESCAPES[escaped];
    if (single !== undefined) return { kind: 'char', codepoint: single };

    const short = shorthand(escaped);
    if (short !== null) return { kind: 'set', set: short };

    if (escaped === 'p' || escaped === 'P') {
      return { kind: 'set', set: this.parseProperty(escaped === 'P') };
    }
    throw new Error(`"\\${escaped}" is not a valid XSD escape.`);
  }
}

// --- emission -----------------------------------------------------------

class Emitter {
  needsSetNotation = false;
  approximate = false;

  constructor(private readonly options: { dropSubtraction?: boolean } = {}) {}

  emit(node: Node): string {
    switch (node.kind) {
      case 'empty':
        return '';
      case 'char':
        return escapeLiteral(node.codepoint);
      case 'any':
        // XSD's `.` is everything but LF and CR — narrower than JavaScript's, which also excludes
        // the line and paragraph separators.
        return '[^\\n\\r]';
      case 'set':
        return this.emitSet(node.expr);
      case 'concat':
        return node.items.map((item) => this.emit(item)).join('');
      case 'alternate':
        return node.items.map((item) => this.emit(item)).join('|');
      case 'repeat': {
        const inner = this.emit(node.item);
        const atom = needsGrouping(node.item) ? `(?:${inner})` : inner;
        if (node.min === 0 && node.max === Infinity) return `${atom}*`;
        if (node.min === 1 && node.max === Infinity) return `${atom}+`;
        if (node.min === 0 && node.max === 1) return `${atom}?`;
        if (node.max === Infinity) return `${atom}{${node.min},}`;
        if (node.min === node.max) return `${atom}{${node.min}}`;
        return `${atom}{${node.min},${node.max}}`;
      }
    }
  }

  private emitSet(expr: ClassExpr): string {
    const exact = resolveClass(expr);
    if (exact !== null) return this.renderClass(exact);

    if (expr.subtract === null) return this.renderClass(expr.base);

    if (this.options.dropSubtraction === true) {
      // Permissive rather than wrong: a pattern that over-accepts fails to help, one that
      // over-rejects teaches a beginner that a correct value is invalid.
      this.approximate = true;
      return this.renderClass(expr.base);
    }

    this.needsSetNotation = true;
    return `[${this.renderClassBody(expr.base)}--${this.emitSet(expr.subtract)}]`;
  }

  private renderClass(set: CharSet): string {
    const body = this.renderClassBody(set);
    if (body === '') return set.negated ? '[\\s\\S]' : '[^\\s\\S]';
    return set.negated ? `[^${body}]` : `[${body}]`;
  }

  private renderClassBody(set: CharSet): string {
    const parts: string[] = [];
    for (const [lo, hi] of set.ranges) {
      parts.push(lo === hi ? escapeInClass(lo) : `${escapeInClass(lo)}-${escapeInClass(hi)}`);
    }
    for (const property of set.properties) {
      parts.push(`\\${property.negated ? 'P' : 'p'}{${property.name}}`);
    }
    for (const inner of set.nested) {
      this.needsSetNotation = true;
      parts.push(this.renderClass(inner));
    }
    return parts.join('');
  }
}

function needsGrouping(node: Node): boolean {
  return node.kind === 'concat' || node.kind === 'alternate' || node.kind === 'repeat';
}

const LITERAL_SPECIALS = new Set('\\^$.|?*+()[]{}/'.split('').map((c) => c.codePointAt(0)!));

function escapeLiteral(codepoint: number): string {
  if (LITERAL_SPECIALS.has(codepoint)) return `\\${String.fromCodePoint(codepoint)}`;
  return unicodeEscape(codepoint);
}

function escapeInClass(codepoint: number): string {
  const char = String.fromCodePoint(codepoint);
  if (char === '\\' || char === ']' || char === '^' || char === '-' || char === '[') return `\\${char}`;
  return unicodeEscape(codepoint);
}

function unicodeEscape(codepoint: number): string {
  if (codepoint >= 0x20 && codepoint < 0x7f) return String.fromCodePoint(codepoint);
  return `\\u{${codepoint.toString(16)}}`;
}

// --- sample generation --------------------------------------------------

/**
 * A shortest string the pattern accepts, or null when it cannot be produced.
 *
 * Shown as "like `AB123456`" beside a pattern facet. `docs/schema-engine.md` §3.5 makes the case
 * that this is worth more to a beginner than the pattern is: nobody learns what
 * `[A-Z]{2}\d{6}` means from reading it, and everybody learns it from one example.
 */
export function sampleFor(source: string): string | null {
  let ast: Node;
  try {
    ast = new PatternParser(source).parse();
  } catch {
    return null;
  }
  const sample = sampleNode(ast, 0);
  return sample;
}

function sampleNode(node: Node, depth: number): string | null {
  if (depth > 20) return null;

  switch (node.kind) {
    case 'empty':
      return '';
    case 'char':
      return String.fromCodePoint(node.codepoint);
    case 'any':
      return 'x';
    case 'set':
      return sampleSet(node.expr);
    case 'concat': {
      let out = '';
      for (const item of node.items) {
        const part = sampleNode(item, depth + 1);
        if (part === null) return null;
        out += part;
      }
      return out;
    }
    case 'alternate': {
      for (const item of node.items) {
        const part = sampleNode(item, depth + 1);
        if (part !== null) return part;
      }
      return null;
    }
    case 'repeat': {
      if (node.min === 0) return '';
      const part = sampleNode(node.item, depth + 1);
      if (part === null) return null;
      // Cap the repetition so `\d{1,50}` illustrates rather than overwhelms.
      return part.repeat(Math.min(node.min, 12));
    }
  }
}

/** Prefer a memorable representative — `A`, `1` — over the numerically first codepoint. */
const PREFERRED_SAMPLES = [
  0x41, 0x42, 0x61, 0x30, 0x31, 0x32, 0x20, 0x2d,
];

function sampleSet(expr: ClassExpr): string | null {
  const effective = resolveClass(expr) ?? expr.base;

  if (!enumerable(effective)) {
    // Property-based classes: pick a plausible member rather than admitting defeat.
    const property = effective.properties[0] ?? effective.nested[0]?.properties[0];
    if (property === undefined) return 'x';
    if (property.name === 'Nd') return effective.negated ? 'x' : '0';
    if (property.name.startsWith('L')) return effective.negated ? '0' : 'A';
    return 'x';
  }

  const ranges = resolvedRanges(effective);
  if (ranges.length === 0) return null;

  for (const preferred of PREFERRED_SAMPLES) {
    if (ranges.some(([lo, hi]) => preferred >= lo && preferred <= hi)) {
      return String.fromCodePoint(preferred);
    }
  }
  return String.fromCodePoint(ranges[0]![0]);
}
