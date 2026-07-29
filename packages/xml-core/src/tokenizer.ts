/**
 * An exact-span XML tokenizer.
 *
 * Every byte of the source belongs to exactly one token, and tokens are contiguous and ordered.
 * That invariant is what makes lossless round-tripping structural rather than a matter of
 * reproducing a hundred formatting details: a clean subtree is re-emitted by slicing the original
 * bytes.
 *
 * This deliberately does *not* validate. Well-formedness is checked separately (see `wellformed.ts`)
 * by an independent parser, so a tokenizer bug cannot silently make an invalid document look valid.
 * The tokenizer's only job is to find exact boundaries, and to be recoverable enough that a
 * malformed document still produces a usable tree — a beginner's document is malformed most of the
 * time it is being edited.
 */

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** An attribute exactly as it appeared, including its quote style and surrounding whitespace. */
export interface RawAttribute {
  /** Span of the whole `name="value"` construct. */
  readonly span: Span;
  readonly nameSpan: Span;
  readonly name: string;
  /** Span of the value *excluding* quotes. Null for a valueless attribute (malformed XML). */
  readonly valueSpan: Span | null;
  /** Raw, still-escaped value text. Null for a valueless attribute. */
  readonly rawValue: string | null;
  readonly quote: '"' | "'" | null;
  /** Whitespace between the previous item and this attribute — preserved for round-tripping. */
  readonly leadingWhitespace: string;
}

export type Token =
  | { kind: 'xmldecl'; span: Span }
  | { kind: 'doctype'; span: Span }
  | { kind: 'comment'; span: Span; contentSpan: Span }
  | { kind: 'pi'; span: Span; target: string; contentSpan: Span }
  | { kind: 'cdata'; span: Span; contentSpan: Span }
  | {
      kind: 'startTag';
      span: Span;
      name: string;
      nameSpan: Span;
      attributes: RawAttribute[];
      selfClosing: boolean;
      /** Whitespace/junk between the last attribute and `>` or `/>`. */
      trailingWhitespace: string;
    }
  | { kind: 'endTag'; span: Span; name: string; nameSpan: Span; trailingWhitespace: string }
  | { kind: 'text'; span: Span };

export interface TokenizeResult {
  readonly tokens: Token[];
  /** Problems the tokenizer itself hit. Not a well-formedness verdict — see `wellformed.ts`. */
  readonly errors: TokenizerError[];
}

export interface TokenizerError {
  readonly message: string;
  readonly offset: number;
}

const NAME_START =
  /[A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
const NAME_CHAR =
  /[A-Za-z0-9_:.·À-ÖØ-öø-˿̀-ͯͰ-ͽͿ-῿‌-‍‿-⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�-]/;

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const errors: TokenizerError[] = [];
  const len = source.length;
  let i = 0;

  const error = (message: string, offset: number): void => {
    errors.push({ message, offset });
  };

  /** Reads a Name production starting at `from`. Returns the end offset (exclusive). */
  const readName = (from: number): number => {
    let j = from;
    if (j < len && NAME_START.test(source[j]!)) {
      j++;
      while (j < len && NAME_CHAR.test(source[j]!)) j++;
    }
    return j;
  };

  const skipWhitespace = (from: number): number => {
    let j = from;
    while (j < len && isWhitespace(source[j]!)) j++;
    return j;
  };

  while (i < len) {
    const lt = source.indexOf('<', i);

    // Text runs up to the next '<', or to end of input.
    if (lt === -1) {
      tokens.push({ kind: 'text', span: { start: i, end: len } });
      break;
    }
    if (lt > i) {
      tokens.push({ kind: 'text', span: { start: i, end: lt } });
      i = lt;
    }

    const next = source[i + 1];

    // --- <!-- comment --> -------------------------------------------------
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      if (close === -1) {
        error('Unterminated comment', i);
        tokens.push({
          kind: 'comment',
          span: { start: i, end: len },
          contentSpan: { start: i + 4, end: len },
        });
        i = len;
        continue;
      }
      tokens.push({
        kind: 'comment',
        span: { start: i, end: close + 3 },
        contentSpan: { start: i + 4, end: close },
      });
      i = close + 3;
      continue;
    }

    // --- <![CDATA[ ... ]]> ------------------------------------------------
    if (source.startsWith('<![CDATA[', i)) {
      const close = source.indexOf(']]>', i + 9);
      if (close === -1) {
        error('Unterminated CDATA section', i);
        tokens.push({
          kind: 'cdata',
          span: { start: i, end: len },
          contentSpan: { start: i + 9, end: len },
        });
        i = len;
        continue;
      }
      tokens.push({
        kind: 'cdata',
        span: { start: i, end: close + 3 },
        contentSpan: { start: i + 9, end: close },
      });
      i = close + 3;
      continue;
    }

    // --- <!DOCTYPE ... [ internal subset ]> -------------------------------
    if (source.startsWith('<!DOCTYPE', i)) {
      const end = scanDoctype(source, i, error);
      tokens.push({ kind: 'doctype', span: { start: i, end } });
      i = end;
      continue;
    }

    // --- <?xml ... ?> and <?target ... ?> ---------------------------------
    if (next === '?') {
      const close = source.indexOf('?>', i + 2);
      const end = close === -1 ? len : close + 2;
      if (close === -1) error('Unterminated processing instruction', i);

      const targetEnd = readName(i + 2);
      const target = source.slice(i + 2, targetEnd);
      // The XML declaration is a PI-shaped construct but is not a PI; it may only appear first.
      if (target === 'xml' && tokens.every((t) => t.kind === 'text' && isBlank(source, t.span))) {
        tokens.push({ kind: 'xmldecl', span: { start: i, end } });
      } else {
        const contentStart = skipWhitespace(targetEnd);
        tokens.push({
          kind: 'pi',
          span: { start: i, end },
          target,
          contentSpan: { start: contentStart, end: close === -1 ? len : close },
        });
      }
      i = end;
      continue;
    }

    // --- </name> ----------------------------------------------------------
    if (next === '/') {
      const nameStart = i + 2;
      const nameEnd = readName(nameStart);
      const wsEnd = skipWhitespace(nameEnd);
      let end = source.indexOf('>', wsEnd);
      if (end === -1) {
        error('Unterminated end tag', i);
        end = len;
      } else {
        end += 1;
      }
      if (nameEnd === nameStart) error('End tag has no name', i);
      tokens.push({
        kind: 'endTag',
        span: { start: i, end },
        name: source.slice(nameStart, nameEnd),
        nameSpan: { start: nameStart, end: nameEnd },
        trailingWhitespace: source.slice(nameEnd, wsEnd),
      });
      i = end;
      continue;
    }

    // --- <name attr="v" ...> or <name/> -----------------------------------
    if (next !== undefined && NAME_START.test(next)) {
      const token = scanStartTag(source, i, readName, error);
      tokens.push(token);
      i = token.span.end;
      continue;
    }

    // A stray '<' that begins nothing recognisable. Treat it as text so the document still
    // produces a tree — refusing to open a broken file is a product failure for our user.
    error('Unexpected "<"', i);
    const nextLt = source.indexOf('<', i + 1);
    const textEnd = nextLt === -1 ? len : nextLt;
    tokens.push({ kind: 'text', span: { start: i, end: textEnd } });
    i = textEnd;
  }

  return { tokens, errors };
}

function isBlank(source: string, span: Span): boolean {
  for (let j = span.start; j < span.end; j++) {
    if (!isWhitespace(source[j]!)) return false;
  }
  return true;
}

/**
 * DOCTYPE needs bracket matching for the internal subset, and the subset may contain '>' inside
 * entity declarations and quoted literals. Preserving it verbatim matters: DocBook, TEI and JATS
 * documents routinely declare entities there, and expanding or dropping them destroys the author's
 * macros.
 */
function scanDoctype(
  source: string,
  start: number,
  error: (message: string, offset: number) => void,
): number {
  const len = source.length;
  let j = start + 9;
  let quote: string | null = null;

  while (j < len) {
    const ch = source[j]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      j++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      j++;
      continue;
    }
    if (ch === '[') {
      // Internal subset: scan to the matching ']', respecting quotes and comments.
      j++;
      let depth = 1;
      while (j < len && depth > 0) {
        const c = source[j]!;
        if (quote !== null) {
          if (c === quote) quote = null;
          j++;
        } else if (c === '"' || c === "'") {
          quote = c;
          j++;
        } else if (source.startsWith('<!--', j)) {
          const close = source.indexOf('-->', j + 4);
          j = close === -1 ? len : close + 3;
        } else if (c === '[') {
          depth++;
          j++;
        } else if (c === ']') {
          depth--;
          j++;
        } else {
          j++;
        }
      }
      continue;
    }
    if (ch === '>') return j + 1;
    j++;
  }
  error('Unterminated DOCTYPE', start);
  return len;
}

function scanStartTag(
  source: string,
  start: number,
  readName: (from: number) => number,
  error: (message: string, offset: number) => void,
): Extract<Token, { kind: 'startTag' }> {
  const len = source.length;
  const nameStart = start + 1;
  const nameEnd = readName(nameStart);
  const name = source.slice(nameStart, nameEnd);

  const attributes: RawAttribute[] = [];
  let j = nameEnd;
  let selfClosing = false;
  let end = len;
  let trailingWhitespace = '';

  for (;;) {
    const wsStart = j;
    while (j < len && isWhitespace(source[j]!)) j++;
    const leadingWhitespace = source.slice(wsStart, j);

    if (j >= len) {
      error('Unterminated start tag', start);
      trailingWhitespace = leadingWhitespace;
      break;
    }

    const ch = source[j]!;

    if (ch === '>') {
      trailingWhitespace = leadingWhitespace;
      end = j + 1;
      break;
    }
    if (ch === '/' && source[j + 1] === '>') {
      selfClosing = true;
      trailingWhitespace = leadingWhitespace;
      end = j + 2;
      break;
    }

    // An attribute must start here.
    const attrNameStart = j;
    const attrNameEnd = readName(j);
    if (attrNameEnd === attrNameStart) {
      // Junk inside the tag. Skip a character so we always make progress, and keep going —
      // recovery beats bailing out on a half-typed tag.
      error('Unexpected character in start tag', j);
      j++;
      continue;
    }

    j = attrNameEnd;
    const afterName = j;
    while (j < len && isWhitespace(source[j]!)) j++;

    if (source[j] !== '=') {
      // Valueless attribute — invalid XML, but common mid-edit.
      error(`Attribute "${source.slice(attrNameStart, attrNameEnd)}" has no value`, attrNameStart);
      attributes.push({
        span: { start: attrNameStart, end: attrNameEnd },
        nameSpan: { start: attrNameStart, end: attrNameEnd },
        name: source.slice(attrNameStart, attrNameEnd),
        valueSpan: null,
        rawValue: null,
        quote: null,
        leadingWhitespace,
      });
      j = afterName;
      continue;
    }

    j++; // consume '='
    while (j < len && isWhitespace(source[j]!)) j++;

    const q = source[j];
    if (q !== '"' && q !== "'") {
      error('Attribute value is not quoted', j);
      attributes.push({
        span: { start: attrNameStart, end: j },
        nameSpan: { start: attrNameStart, end: attrNameEnd },
        name: source.slice(attrNameStart, attrNameEnd),
        valueSpan: null,
        rawValue: null,
        quote: null,
        leadingWhitespace,
      });
      continue;
    }

    const valueStart = j + 1;
    let valueEnd = source.indexOf(q, valueStart);
    if (valueEnd === -1) {
      error('Unterminated attribute value', valueStart);
      valueEnd = len;
    }
    attributes.push({
      span: { start: attrNameStart, end: Math.min(valueEnd + 1, len) },
      nameSpan: { start: attrNameStart, end: attrNameEnd },
      name: source.slice(attrNameStart, attrNameEnd),
      valueSpan: { start: valueStart, end: valueEnd },
      rawValue: source.slice(valueStart, valueEnd),
      quote: q,
      leadingWhitespace,
    });
    j = Math.min(valueEnd + 1, len);
  }

  if (nameEnd === nameStart) error('Start tag has no name', start);

  return {
    kind: 'startTag',
    span: { start, end },
    name,
    nameSpan: { start: nameStart, end: nameEnd },
    attributes,
    selfClosing,
    trailingWhitespace,
  };
}
