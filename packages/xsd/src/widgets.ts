/**
 * `widgetFor` — an explicit decision table from a simple type to the control that should edit it
 * (`docs/schema-engine.md` §3.4).
 *
 * Written as a table rather than a chain of `if`s because the ordering *is* the design: an
 * enumeration of two values wants radio buttons even though it is also a string, and a date with a
 * pattern facet wants a date picker even though it is also patterned. Whichever rule fires first
 * wins, and moving a row changes the product.
 */

import type { CompiledSimpleType } from './simpleTypes.js';
import { sampleFor } from './xsdRegex.js';

export type Widget =
  | { readonly kind: 'radio'; readonly options: readonly string[] }
  | { readonly kind: 'select'; readonly options: readonly string[] }
  | { readonly kind: 'checkbox' }
  | { readonly kind: 'date' }
  | { readonly kind: 'time' }
  | { readonly kind: 'datetime' }
  | {
      readonly kind: 'number';
      readonly min: string | null;
      readonly max: string | null;
      readonly integer: boolean;
    }
  | { readonly kind: 'url' }
  | { readonly kind: 'textarea'; readonly maxLength: number | null }
  | {
      readonly kind: 'text';
      readonly placeholder: string | null;
      readonly maxLength: number | null;
    }
  | { readonly kind: 'list'; readonly item: Widget };

/** Above this many options a dropdown beats a radio group. */
const RADIO_LIMIT = 5;
/** Above this length a single-line input stops being usable. */
const TEXTAREA_THRESHOLD = 120;

export function widgetFor(type: CompiledSimpleType): Widget {
  if (type.variety === 'list') {
    return { kind: 'list', item: type.itemType === null ? { kind: 'text', placeholder: null, maxLength: null } : widgetFor(type.itemType) };
  }
  if (type.variety === 'union') {
    // A union has no single control. The first member is the best guess, and the Inspector offers
    // the others behind a "this can also be…" affordance rather than picking silently.
    const first = type.memberTypes[0];
    return first === undefined ? { kind: 'text', placeholder: null, maxLength: null } : widgetFor(first);
  }

  const { facets, primitive } = type;

  // 1. A closed set of values is always better shown than typed, whatever the base type.
  if (facets.enumeration !== null && facets.enumeration.length > 0) {
    return facets.enumeration.length <= RADIO_LIMIT
      ? { kind: 'radio', options: facets.enumeration }
      : { kind: 'select', options: facets.enumeration };
  }

  // 2. Booleans.
  if (primitive === 'boolean') return { kind: 'checkbox' };

  // 3. Dates and times, before patterns: a pattern on a date still wants a date picker.
  if (primitive === 'date') return { kind: 'date' };
  if (primitive === 'time') return { kind: 'time' };
  if (primitive === 'dateTime') return { kind: 'datetime' };

  // 4. Numbers, carrying their bounds into the control.
  if (primitive === 'decimal' || primitive === 'float' || primitive === 'double') {
    return {
      kind: 'number',
      min: facets.minInclusive?.lexical ?? facets.minExclusive?.lexical ?? null,
      max: facets.maxInclusive?.lexical ?? facets.maxExclusive?.lexical ?? null,
      integer: facets.fractionDigits === 0,
    };
  }

  if (primitive === 'anyURI') return { kind: 'url' };

  // 5. Long text.
  const maxLength = facets.maxLength ?? facets.length ?? null;
  if (maxLength === null && facets.patterns.length === 0 && primitive === 'string') {
    return { kind: 'text', placeholder: null, maxLength: null };
  }
  if (maxLength !== null && maxLength > TEXTAREA_THRESHOLD) {
    return { kind: 'textarea', maxLength };
  }

  // 6. Everything else is a text box, with the pattern turned into a worked example.
  const pattern = facets.patterns.at(-1)?.alternatives[0];
  const sample = pattern === undefined ? null : sampleFor(pattern.source);
  return { kind: 'text', placeholder: sample, maxLength };
}
