/**
 * Entity handling.
 *
 * The rule that matters for fidelity: we decode the five predefined entities and numeric character
 * references, and we leave everything else — `&mydash;`, `&nbsp;`, anything declared in a DOCTYPE
 * internal subset — as a literal `&name;` in the decoded value. Re-encoding then escapes a bare `&`
 * only when it does not already begin a syntactically valid reference, so unknown entities survive a
 * decode/encode round trip untouched.
 *
 * This is deliberate. Expanding author-declared entities is how DocBook, TEI and JATS documents get
 * silently destroyed by editors, and those authors notice. The cost is a narrow ambiguity: text that
 * literally contains the characters `&mydash;` is treated as a reference rather than as five
 * literal characters. That trade is worth taking, and it is why the serializer prefers slicing
 * original bytes over re-encoding wherever it can.
 */

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  apos: "'",
  quot: '"',
};

/** Matches a syntactically valid entity or character reference at a given position. */
const REFERENCE = /^&(?:#(?:[0-9]+|x[0-9a-fA-F]+)|[A-Za-z_:][A-Za-z0-9_:.·-]*);/;

export function decodeText(raw: string): string {
  if (!raw.includes('&')) return raw;

  let out = '';
  let i = 0;
  while (i < raw.length) {
    const amp = raw.indexOf('&', i);
    if (amp === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, amp);

    const match = REFERENCE.exec(raw.slice(amp));
    if (match === null) {
      // A bare '&' that begins nothing valid. Invalid XML, but common mid-edit; keep it.
      out += '&';
      i = amp + 1;
      continue;
    }

    const ref = match[0];
    const body = ref.slice(1, -1);

    if (body.startsWith('#')) {
      const codePoint = body.startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      out +=
        Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : ref;
    } else if (body in PREDEFINED) {
      out += PREDEFINED[body]!;
    } else {
      // Unknown — very likely declared in the internal subset. Preserve verbatim.
      out += ref;
    }

    i = amp + ref.length;
  }
  return out;
}

function escapeAmpersands(value: string): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const amp = value.indexOf('&', i);
    if (amp === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, amp);
    const match = REFERENCE.exec(value.slice(amp));
    if (match === null) {
      out += '&amp;';
      i = amp + 1;
    } else {
      out += match[0];
      i = amp + match[0].length;
    }
  }
  return out;
}

export function encodeText(value: string): string {
  return escapeAmpersands(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function encodeAttributeValue(value: string, quote: '"' | "'"): string {
  const escaped = escapeAmpersands(value)
    .replace(/</g, '&lt;')
    // Tab, newline and carriage return must be escaped in attribute values or the parser's
    // attribute-value normalisation would turn them into spaces on the next read.
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&apos;');
}

/**
 * Attribute-value normalisation, per XML 1.0 §3.3.3: literal tab, newline and carriage return in the
 * *source* become spaces. Escaped forms (`&#10;`) survive, which is why decoding happens after.
 */
export function normalizeAttributeValue(raw: string): string {
  return decodeText(raw.replace(/\r\n/g, ' ').replace(/[\t\n\r]/g, ' '));
}
