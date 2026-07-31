import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT_ID, XmlDocument, isElement, type NodeId } from '@x-editor/xml-core';
import {
  checkExpression,
  evaluateBoolean,
  evaluateNodes,
  evaluateString,
  loadXPath,
} from '../src/xpath.js';

const DOC = `<?xml version="1.0"?>
<order xmlns="urn:t" xmlns:m="urn:meta" id="A1" m:rev="3">
  <!-- a comment -->
  <line sku="AB1"><qty>2</qty><price>10.00</price></line>
  <line sku="AB2"><qty>1</qty><price>5.50</price></line>
  <note>see <em>this</em> please</note>
</order>`;

const document = XmlDocument.parse(DOC);
const root = document.documentElement()!;

const NS = { t: 'urn:t', m: 'urn:meta' };

const boolean = (expression: string, context: NodeId = root): boolean => {
  const outcome = evaluateBoolean(document, context, expression, { namespaces: NS });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
};

const nodes = (expression: string, context: NodeId = root): string[] => {
  const outcome = evaluateNodes(document, context, expression, { namespaces: NS });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value.map((ref) => {
    const node = document.node(ref.node)!;
    if (ref.attribute !== undefined && isElement(node)) {
      return `@${node.attributes[ref.attribute]!.name.localName}`;
    }
    return isElement(node) ? node.name.localName : node.kind;
  });
};

const text = (expression: string, context: NodeId = root): string => {
  const outcome = evaluateString(document, context, expression, { namespaces: NS });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
};

// The XPath engine is loaded on demand rather than imported, so the app never pays for it
// unless a schema actually needs it. Tests have to ask for it explicitly too.
beforeAll(async () => {
  await loadXPath();
});

describe('navigating the CST directly', () => {
  it('selects children by name', () => {
    expect(nodes('t:line')).toEqual(['line', 'line']);
  });

  it('walks descendants', () => {
    expect(nodes('.//t:qty')).toEqual(['qty', 'qty']);
  });

  it('reads attributes, including namespaced ones', () => {
    expect(text('@id')).toBe('A1');
    expect(text('@m:rev')).toBe('3');
    // An attribute is its own answer, not its owner element — Schematron selects attributes all
    // the time, and collapsing them would turn "this attribute is wrong" into "this element is".
    expect(nodes('t:line/@sku')).toEqual(['@sku', '@sku']);
  });

  it('leaves namespace declarations out of @*, where no XPath author expects them', () => {
    // Two real attributes on <order>; the two xmlns declarations are not attributes in the data
    // model and must not be counted.
    expect(text('count(@*)')).toBe('2');
    expect(nodes('@*')).toEqual(['@id', '@rev']);
  });

  it('walks back up through parent and ancestor', () => {
    const qty = evaluateNodes(document, root, '(.//t:qty)[1]', { namespaces: NS });
    if (!qty.ok) throw new Error();
    expect(nodes('..', qty.value[0]!.node)).toEqual(['line']);
    expect(nodes('ancestor::t:order', qty.value[0]!.node)).toEqual(['order']);
  });

  it('walks siblings, skipping nodes with no place in the data model', () => {
    const first = evaluateNodes(document, root, '(t:line)[1]', { namespaces: NS });
    if (!first.ok) throw new Error();
    expect(nodes('following-sibling::t:line', first.value[0]!.node)).toEqual(['line']);
  });

  it('reaches comments and text, which are nodes here too', () => {
    expect(text('string(comment())').trim()).toBe('a comment');
    expect(text('string(t:note)')).toBe('see this please');
  });
});

describe('the sort of expression an xs:assert actually contains', () => {
  it('compares values across children', () => {
    expect(boolean('every $l in t:line satisfies $l/t:qty > 0')).toBe(true);
    expect(boolean('sum(t:line/t:price) = 15.50')).toBe(true);
  });

  it('counts', () => {
    expect(boolean('count(t:line) = 2')).toBe(true);
    expect(boolean('count(t:line) = 3')).toBe(false);
  });

  it('tests an attribute against content', () => {
    expect(boolean('t:line[1]/@sku = "AB1"')).toBe(true);
  });
});

describe('namespace handling', () => {
  it('resolves an unprefixed name through xpathDefaultNamespace', () => {
    const outcome = evaluateBoolean(document, root, 'count(line) = 2', {
      defaultNamespace: 'urn:t',
    });
    expect(outcome).toEqual({ ok: true, value: true });
  });

  it('leaves an unprefixed name in no namespace without one', () => {
    const outcome = evaluateBoolean(document, root, 'count(line) = 0', {});
    expect(outcome).toEqual({ ok: true, value: true });
  });
});

describe('failure is reported, not thrown', () => {
  it('returns an error for a syntactically broken expression', () => {
    // A broken XPath in a schema is a schema problem to report. Throwing would lose the whole
    // validation pass over one bad assertion.
    const outcome = evaluateBoolean(document, root, 'this is not xpath((', {});
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error();
    expect(outcome.error.message.length).toBeGreaterThan(0);
  });

  it('returns an error for an unbound prefix', () => {
    expect(evaluateBoolean(document, root, 'count(nope:x) = 0', {}).ok).toBe(false);
  });

  it('checks an expression without needing a document', () => {
    expect(checkExpression('count(*) > 0')).toBeNull();
    expect(checkExpression('((')).not.toBeNull();
  });
});

describe('node identity', () => {
  it('gives the same node once, however many paths reach it', () => {
    // XPath deduplicates by node identity; adapters that were minted fresh each time would make
    // this return four.
    expect(text('count(t:line | t:line)')).toBe('2');
  });

  it('keeps document order', () => {
    expect(text('string((.//t:qty)[1])')).toBe('2');
    expect(text('string((.//t:qty)[2])')).toBe('1');
  });
});

describe('what the engine cannot reach', () => {
  it('fails doc() loudly when no documents were supplied, so a hostile expression reads nothing', () => {
    // The safety property the plan relies on for xs:assert: no documents map is passed, so doc()
    // throws rather than resolving — there is no filesystem or network access to be had.
    const outcome = evaluateBoolean(document, ROOT_ID, 'boolean(doc("file:///etc/passwd"))', {});
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('not available');
  });
});

describe('doc(), scoped to the workspace', () => {
  const codes = XmlDocument.parse('<codes><code>GB</code><code>FR</code></codes>');
  const documents = new Map([
    ['codes.xml', codes],
    ['self.xml', document],
  ]);

  it('reads a value from another open document', () => {
    const outcome = evaluateString(document, root, 'string(doc("codes.xml")/codes/code[1])', {
      namespaces: NS,
      documents,
    });
    expect(outcome).toEqual({ ok: true, value: 'GB' });
  });

  it('resolves document() the same way, for rules written against the XSLT binding', () => {
    const outcome = evaluateString(document, root, 'string(document("codes.xml")/codes/code[2])', {
      namespaces: NS,
      documents,
    });
    expect(outcome).toEqual({ ok: true, value: 'FR' });
  });

  it('compares a value in the instance against the other document', () => {
    const outcome = evaluateBoolean(
      document,
      root,
      'doc("codes.xml")/codes/code[. = "GB"] and not(doc("codes.xml")/codes/code[. = "DE"])',
      { namespaces: NS, documents },
    );
    expect(outcome).toEqual({ ok: true, value: true });
  });

  it('fails loudly on a file that is not open, not with an empty sequence', () => {
    // Empty would make not(doc(...)/...) quietly true — the worst reading of a typo.
    const outcome = evaluateBoolean(document, root, 'boolean(doc("closed.xml"))', {
      namespaces: NS,
      documents,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('does not name an open file');
  });

  it('names the document a foreign node came from, so refs cannot misbind onto the instance', () => {
    const outcome = evaluateNodes(document, root, 'doc("codes.xml")/codes/code', {
      namespaces: NS,
      documents,
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value).toHaveLength(2);
    for (const ref of outcome.value) expect(ref.documentName).toBe('codes.xml');
  });

  it('leaves refs into the instance unnamed, even when doc() reaches it by name', () => {
    const outcome = evaluateNodes(document, root, 'doc("self.xml")//t:line', {
      namespaces: NS,
      documents,
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value).toHaveLength(2);
    for (const ref of outcome.value) expect(ref.documentName).toBeUndefined();
  });

  it('keeps node identity within the foreign document', () => {
    const outcome = evaluateString(
      document,
      root,
      'string(count(doc("codes.xml")/codes/code | doc("codes.xml")/codes/code))',
      { namespaces: NS, documents },
    );
    expect(outcome).toEqual({ ok: true, value: '2' });
  });

  it('does not let an isolated node of the instance isolate its twin in the other document', () => {
    // The isolate is a node of the facade's own document; the node with the same id in codes.xml
    // is a different node and must still see its parent.
    const firstCode = evaluateNodes(document, root, 'doc("codes.xml")/codes/code[1]', {
      namespaces: NS,
      documents,
    });
    if (!firstCode.ok) throw new Error(firstCode.error.message);
    const outcome = evaluateBoolean(document, root, 'boolean(doc("codes.xml")/codes/code[1]/..)', {
      namespaces: NS,
      documents,
      isolate: firstCode.value[0]!.node,
    });
    expect(outcome).toEqual({ ok: true, value: true });
  });
});
