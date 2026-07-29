/**
 * `describe` — the promise that every element, attribute and value in the tree can explain itself.
 *
 * The teaching promise cannot depend on schema authors having written documentation. Most schemas a
 * beginner meets carry no `xs:annotation` at all: UBL is heavily documented, a hand-written internal
 * schema almost never is, and the beginner is far more likely to be handed the second. So this
 * *always* returns a sentence, falling back to one assembled from the compiled model — humanise the
 * name, add the type's description, add a cardinality clause, add a facet clause.
 *
 * Generated text is marked `authored: false` so the UI can distinguish inferred guidance from what
 * the schema actually says. Presenting a guess in the same voice as an author's documentation would
 * teach beginners to distrust both.
 */

import { UNBOUNDED, type ElementName, type Occurs } from './particles.js';
import type { CompiledSimpleType } from './simpleTypes.js';
import type { AttributeUse, CompiledElement, CompiledType } from './model.js';
import { sampleFor } from './xsdRegex.js';

export interface Description {
  readonly text: string;
  /** True when the text came from `xs:documentation` rather than being inferred. */
  readonly authored: boolean;
}

/**
 * `shipDate` → "Ship date". Handles camelCase, PascalCase, snake_case, kebab-case and screaming
 * caps, and leaves an already-spaced label alone.
 */
export function humaniseName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // Split a run of capitals followed by a word: "XMLDocument" → "XML Document".
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  if (spaced === '') return name;

  // A name that is entirely capitals is shouting, not an acronym: AMOUNT → Amount.
  const words = (name === name.toUpperCase() ? spaced.toLowerCase() : spaced).split(' ');

  return words
    .map((word, index) => {
      // A genuine acronym keeps its capitals wherever it appears: XMLDocument → XML document.
      if (word.length > 1 && word === word.toUpperCase()) return word;
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase();
    })
    .join(' ');
}

/** "Exactly one is required here." and friends, in the voice of the palette. */
export function describeCardinality(occurs: Occurs): string {
  const { min, max } = occurs;
  if (min === 0 && max === 0) return 'This is not allowed here.';
  if (min === 1 && max === 1) return 'Exactly one is required here.';
  if (min === 0 && max === 1) return 'This is optional.';
  if (min === 0 && max === UNBOUNDED) return 'Any number may appear, including none.';
  if (min === 1 && max === UNBOUNDED) return 'At least one is required; there may be more.';
  if (max === UNBOUNDED) return `At least ${min} are required; there may be more.`;
  if (min === max) return `Exactly ${min} are required here.`;
  if (min === 0) return `Up to ${max} may appear.`;
  return `Between ${min} and ${max} are required here.`;
}

/** The compact chip the palette shows against a row: `2 of 1–3`. Reads literally, on purpose. */
export function cardinalityChip(occurs: Occurs, present: number): string {
  const { min, max } = occurs;
  const bound =
    min === max ? `${min}` : max === UNBOUNDED ? `${min}+` : `${min}–${max}`;
  return `${present} of ${bound}`;
}

/** A clause describing what values a simple type will accept, or '' when there is nothing to add. */
export function describeFacets(type: CompiledSimpleType): string {
  const { facets } = type;
  const clauses: string[] = [];

  if (facets.enumeration !== null && facets.enumeration.length > 0) {
    const shown = facets.enumeration.slice(0, 6).join(', ');
    const more = facets.enumeration.length > 6 ? `, or ${facets.enumeration.length - 6} others` : '';
    return `It must be one of: ${shown}${more}.`;
  }

  if (facets.length !== null) clauses.push(`exactly ${facets.length} characters`);
  else {
    if (facets.minLength !== null) clauses.push(`at least ${facets.minLength} characters`);
    if (facets.maxLength !== null) clauses.push(`at most ${facets.maxLength} characters`);
  }

  if (facets.minInclusive !== null) clauses.push(`${facets.minInclusive.lexical} or more`);
  if (facets.minExclusive !== null) clauses.push(`more than ${facets.minExclusive.lexical}`);
  if (facets.maxInclusive !== null) clauses.push(`${facets.maxInclusive.lexical} or less`);
  if (facets.maxExclusive !== null) clauses.push(`less than ${facets.maxExclusive.lexical}`);

  // The example is worth more than the pattern: nobody learns what [A-Z]{2}\d{6} means by reading
  // it, and everybody learns it from one example.
  const pattern = facets.patterns.at(-1)?.alternatives[0];
  if (pattern !== undefined) {
    const sample = sampleFor(pattern.source);
    if (sample !== null && sample !== '') clauses.push(`in the form "${sample}"`);
  }

  if (clauses.length === 0) return '';
  return `It must be ${joinClauses(clauses)}.`;
}

function joinClauses(clauses: readonly string[]): string {
  if (clauses.length === 1) return clauses[0]!;
  return `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)!}`;
}

/** A noun phrase for a type, for use inside a longer sentence. */
export function describeType(type: CompiledType): string {
  if (type.form === 'simple') return type.documentation;
  if (type.documentation !== '') return type.documentation;
  switch (type.contentKind) {
    case 'empty':
      return 'no content — only attributes';
    case 'simple':
      return type.simpleType?.documentation ?? 'a value';
    case 'mixed':
      return 'text with elements mixed in';
    case 'element-only':
      return 'other elements';
  }
}

export function describeElement(
  element: CompiledElement,
  type: CompiledType,
  occurs: Occurs = element.occurs,
): Description {
  if (element.documentation !== '') return { text: element.documentation, authored: true };

  const label = humaniseName(element.name.localName);
  const sentences = [`*${label}* holds ${describeType(type)}.`];

  if (type.form === 'simple') {
    const facets = describeFacets(type);
    if (facets !== '') sentences.push(facets);
  } else if (type.contentKind === 'simple' && type.simpleType !== null) {
    const facets = describeFacets(type.simpleType);
    if (facets !== '') sentences.push(facets);
  }

  sentences.push(describeCardinality(occurs));
  if (element.fixedValue !== null) sentences.push(`It must be "${element.fixedValue}".`);
  else if (element.defaultValue !== null) {
    sentences.push(`If left out, it is taken to be "${element.defaultValue}".`);
  }
  if (element.abstract) {
    sentences.push('This element is abstract: use one of the elements that substitute for it.');
  }

  return { text: sentences.join(' '), authored: false };
}

export function describeAttribute(attribute: AttributeUse): Description {
  if (attribute.documentation !== '') return { text: attribute.documentation, authored: true };

  const label = humaniseName(attribute.name.localName);
  const sentences = [`*${label}* holds ${attribute.type.documentation}.`];

  const facets = describeFacets(attribute.type);
  if (facets !== '') sentences.push(facets);

  sentences.push(
    attribute.use === 'required' ? 'It is required.' : 'It is optional.',
  );
  if (attribute.fixedValue !== null) sentences.push(`It must be "${attribute.fixedValue}".`);
  else if (attribute.defaultValue !== null) {
    sentences.push(`If left out, it is taken to be "${attribute.defaultValue}".`);
  }

  return { text: sentences.join(' '), authored: false };
}

/** For a wildcard, where there is no declaration at all to describe. */
export function describeWildcard(name: ElementName | null): Description {
  return {
    text:
      name === null
        ? 'Any element is allowed here.'
        : `*${humaniseName(name.localName)}* is allowed here by a wildcard, so the schema does not describe it.`,
    authored: false,
  };
}
