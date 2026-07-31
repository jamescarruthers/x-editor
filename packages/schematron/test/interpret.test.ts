import { beforeAll, describe, expect, it } from 'vitest';
import { XmlDocument } from '@x-editor/xml-core';
import { loadXPath } from '@x-editor/xsd';
import { parseSchematronSource } from '../src/parse.js';
import { runSchematron } from '../src/interpret.js';

beforeAll(async () => {
  await loadXPath();
});

const SCH = 'http://purl.oclc.org/dsdl/schematron';

function run(
  schematron: string,
  instance: string,
  phase?: string,
  documents?: ReadonlyMap<string, XmlDocument>,
) {
  const parsed = parseSchematronSource(schematron);
  const result = runSchematron(parsed.schema, XmlDocument.parse(instance), {
    ...(phase === undefined ? {} : { phase }),
    ...(documents === undefined ? {} : { documents }),
  });
  return { ...result, parseProblems: parsed.problems };
}

const schema = (body: string, attributes = ''): string =>
  `<sch:schema xmlns:sch="${SCH}" queryBinding="xslt2" ${attributes}>
     <sch:ns prefix="t" uri="urn:t"/>
     ${body}
   </sch:schema>`;

const ORDER = `<order xmlns="urn:t" total="15">
  <line qty="2" price="5.00"/>
  <line qty="1" price="5.00"/>
</order>`;

describe('assert and report', () => {
  it('an assert fires when its test is false', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="@total > 100">The total must be over 100.</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings.map((f) => f.message)).toEqual(['The total must be over 100.']);
  });

  it('an assert is silent when its test is true', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="@total > 1">ok</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings).toEqual([]);
  });

  it('a report fires when its test is TRUE — the opposite of an assert', () => {
    // Getting this the wrong way round inverts a whole schema, silently, so it gets its own test.
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:report test="@total > 1">The total is over one.</sch:report>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings.map((f) => [f.kind, f.message])).toEqual([
      ['report', 'The total is over one.'],
    ]);
  });

  it('binds the finding to the node itself, not to a location string', () => {
    const document = XmlDocument.parse(ORDER);
    const parsed = parseSchematronSource(
      schema(`<sch:pattern><sch:rule context="t:line">
        <sch:assert test="@qty > 5">too few</sch:assert>
      </sch:rule></sch:pattern>`),
    );
    const result = runSchematron(parsed.schema, document);
    expect(result.findings).toHaveLength(2);
    // The node id is usable directly — no XPath string to resolve back onto the tree.
    for (const finding of result.findings) {
      expect(document.node(finding.node)?.kind).toBe('element');
    }
  });
});

describe('first-match-wins', () => {
  const twoRules = schema(`<sch:pattern id="p">
    <sch:rule id="general" context="t:line">
      <sch:assert test="false()">the general rule fired</sch:assert>
    </sch:rule>
    <sch:rule id="specific" context="t:line[@qty > 1]">
      <sch:assert test="false()">the specific rule fired</sch:assert>
    </sch:rule>
  </sch:pattern>`);

  it('only the first matching rule fires for a node', () => {
    const result = run(twoRules, ORDER);
    expect(result.findings.map((f) => f.ruleId)).toEqual(['general', 'general']);
  });

  it('reports a rule that never fires, and names what shadowed it', () => {
    // The semantic beginners trip over most, and a rule that silently never runs is the worst way
    // to discover it.
    const specific = run(twoRules, ORDER).statistics.find((s) => s.ruleId === 'specific')!;
    expect(specific.matched).toBe(1);
    expect(specific.fired).toBe(0);
    expect(specific.shadowedBy).toBe('general');
  });

  it('does not carry the claim across patterns', () => {
    // First-match-wins is per pattern. Applying it schema-wide would make half a schema inert.
    const result = run(
      schema(`
        <sch:pattern id="a"><sch:rule context="t:line">
          <sch:assert test="false()">a</sch:assert>
        </sch:rule></sch:pattern>
        <sch:pattern id="b"><sch:rule context="t:line">
          <sch:assert test="false()">b</sch:assert>
        </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings.map((f) => f.patternId)).toEqual(['a', 'a', 'b', 'b']);
  });
});

describe('statistics', () => {
  // Computed per test rather than once at collection: the describe body runs before beforeAll, so
  // a shared result here would be produced with the XPath engine still unloaded.
  const stats2 = () =>
    run(
      schema(`<sch:pattern id="p">
        <sch:rule id="lines" context="t:line">
          <sch:assert id="positive" test="@qty > 0">qty must be positive</sch:assert>
          <sch:assert id="big" test="@qty > 1">qty must be over one</sch:assert>
        </sch:rule>
      </sch:pattern>`),
      ORDER,
    );

  it('counts what each rule matched and fired on', () => {
    const stats = stats2().statistics[0]!;
    expect(stats.matched).toBe(2);
    expect(stats.fired).toBe(2);
  });

  it('counts passes and failures per assertion', () => {
    // "This check has never failed" is how an author finds out a rule is not doing what they think.
    const [positive, big] = stats2().statistics[0]!.assertions;
    expect([positive?.passed, positive?.failed]).toEqual([2, 0]);
    expect([big?.passed, big?.failed]).toEqual([1, 1]);
  });

  it('flags an assertion with no diagnostic, because those read badly downstream', () => {
    expect(stats2().statistics[0]!.assertions.every((a) => a.hasDiagnostic)).toBe(false);
  });

  it('reports a broken expression as the schema\'s problem, without losing the rest', () => {
    const broken = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="this is not (((xpath">x</sch:assert>
        <sch:assert test="false()">this one still runs</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(broken.statistics[0]!.assertions[0]!.broken).not.toBeNull();
    expect(broken.findings.map((f) => f.message)).toEqual(['this one still runs']);
  });
});

describe('messages', () => {
  it('interpolates sch:value-of against the failing node', () => {
    // The reason Schematron messages beat anything a validator can synthesise: they quote the
    // actual offending value.
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="@total = sum(t:line/(@qty * @price))">
          The total is <sch:value-of select="@total"/> but the lines add up to <sch:value-of select="sum(t:line/(@qty * @price))"/>.
        </sch:assert>
      </sch:rule></sch:pattern>`),
      `<order xmlns="urn:t" total="20">
         <line qty="2" price="5.00"/>
         <line qty="1" price="5.00"/>
       </order>`,
    );
    expect(result.findings[0]?.message).toBe('The total is 20 but the lines add up to 15.');
  });

  it('resolves sch:name to the context element', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:line">
        <sch:assert test="false()"><sch:name/> is wrong</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings[0]?.message).toBe('line is wrong');
  });

  it('attaches the diagnostic — the author\'s "how to fix this"', () => {
    const result = run(
      schema(`
        <sch:pattern><sch:rule context="t:order">
          <sch:assert test="false()" diagnostics="d1">Something is wrong.</sch:assert>
        </sch:rule></sch:pattern>
        <sch:diagnostics>
          <sch:diagnostic id="d1">Check the total against the line items.</sch:diagnostic>
        </sch:diagnostics>`),
      ORDER,
    );
    expect(result.findings[0]?.diagnostics).toEqual([
      'Check the total against the line items.',
    ]);
  });

  it('carries @role through without interpreting it', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="false()" role="warning">careful</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings[0]?.role).toBe('warning');
  });
});

describe('let bindings', () => {
  it('makes a variable available to the tests below it', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:let name="computed" value="sum(t:line/(@qty * @price))"/>
        <sch:assert test="number(@total) = number($computed)">totals differ</sch:assert>
        <sch:report test="number($computed) > 10">the lines add up to <sch:value-of select="$computed"/></sch:report>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings.map((f) => f.message)).toEqual(['the lines add up to 15']);
  });
});

describe('context patterns', () => {
  it('treats @context as a match pattern, not a path', () => {
    // `t:line` means "any line anywhere", not "a line child of the root".
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:line">
        <sch:assert test="false()">x</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings).toHaveLength(2);
  });

  it('handles a union context without misparsing it', () => {
    // Without the parentheses in the translation, `t:order|t:line` would select the wrong nodes.
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order|t:line">
        <sch:assert test="false()">x</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings).toHaveLength(3);
  });

  it('handles an absolute context', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="/t:order">
        <sch:assert test="false()">x</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings).toHaveLength(1);
  });

  it('selects attributes as their own nodes', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:line/@qty">
        <sch:assert test="false()">x</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]?.attribute).toBeTypeOf('number');
  });

  it('reports an unparseable context and carries on', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="((("><sch:assert test="false()">x</sch:assert></sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.problems.map((p) => p.code)).toContain('bad-context');
  });
});

describe('phases', () => {
  const phased = schema(
    `<sch:phase id="quick"><sch:active pattern="fast"/></sch:phase>
     <sch:pattern id="fast"><sch:rule context="t:order">
       <sch:assert test="false()">fast</sch:assert>
     </sch:rule></sch:pattern>
     <sch:pattern id="slow"><sch:rule context="t:order">
       <sch:assert test="false()">slow</sch:assert>
     </sch:rule></sch:pattern>`,
    'defaultPhase="quick"',
  );

  it('runs only the patterns the default phase activates', () => {
    expect(run(phased, ORDER).findings.map((f) => f.message)).toEqual(['fast']);
  });

  it('runs everything when asked for #ALL', () => {
    expect(run(phased, ORDER, '#ALL').findings.map((f) => f.message)).toEqual(['fast', 'slow']);
  });
});

describe('abstract patterns', () => {
  it('expands an is-a instantiation with its parameters', () => {
    const result = run(
      schema(`
        <sch:pattern id="required" abstract="true">
          <sch:rule context="$parent">
            <sch:assert test="$child">A <sch:name/> needs a child.</sch:assert>
          </sch:rule>
        </sch:pattern>
        <sch:pattern id="orderNeedsLine" is-a="required">
          <sch:param name="parent" value="t:order"/>
          <sch:param name="child" value="t:missing"/>
        </sch:pattern>`),
      ORDER,
    );
    expect(result.findings.map((f) => f.message)).toEqual(['A order needs a child.']);
  });

  it('substitutes longer parameter names first', () => {
    // `$item` must not eat the start of `$itemTotal` — that produces an expression which parses and
    // means something else entirely.
    const result = run(
      schema(`
        <sch:pattern id="tpl" abstract="true">
          <sch:rule context="$item"><sch:assert test="$itemTotal">x</sch:assert></sch:rule>
        </sch:pattern>
        <sch:pattern id="use" is-a="tpl">
          <sch:param name="item" value="t:line"/>
          <sch:param name="itemTotal" value="@qty"/>
        </sch:pattern>`),
      ORDER,
    );
    expect(result.statistics[0]?.assertions[0]?.test).toBe('@qty');
  });

  it('reports an is-a pointing at nothing', () => {
    const result = run(
      schema(`<sch:pattern id="x" is-a="nope"/>`),
      ORDER,
    );
    expect(result.problems.map((p) => p.code)).toContain('unknown-abstract-pattern');
  });
});

describe('what a hostile schema cannot do', () => {
  it('doc() with no workspace supplied, so a rule cannot exfiltrate the document it inspects', () => {
    // Under the classical XSLT route this is arbitrary code execution against a confidential
    // document, with the user's network position. Here it is a broken expression: doc() resolves
    // only against documents the caller passed in, and none were.
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="doc('file:///etc/passwd')">x</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
    );
    expect(result.statistics[0]!.assertions[0]!.broken).not.toBeNull();
    expect(result.findings).toEqual([]);
  });

  it('doc() reaches only open files even when a workspace is supplied', () => {
    // The scoping is total: the resolver reads the workspace map, so a path or URL that is not an
    // open file's name is an error, never a fetch.
    const workspace = new Map([['codes.xml', XmlDocument.parse('<codes/>')]]);
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="doc('file:///etc/passwd')">x</sch:assert>
      </sch:rule></sch:pattern>`),
      ORDER,
      undefined,
      workspace,
    );
    expect(result.statistics[0]!.assertions[0]!.broken).toContain('does not name an open file');
    expect(result.findings).toEqual([]);
  });
});

describe('doc(), scoped to the workspace', () => {
  const CODES = XmlDocument.parse('<codes><code>GB</code><code>FR</code></codes>');
  const workspace = new Map([['codes.xml', CODES]]);

  const COUNTRY_RULE = schema(`<sch:pattern><sch:rule context="t:order">
    <sch:assert test="@country = doc('codes.xml')/codes/code">
      The country "<sch:value-of select="@country"/>" is not in the code list.
    </sch:assert>
  </sch:rule></sch:pattern>`);

  it('compares a value in the instance against a value in another open document', () => {
    const good = run(COUNTRY_RULE, '<order xmlns="urn:t" country="GB"/>', undefined, workspace);
    expect(good.findings).toEqual([]);

    const bad = run(COUNTRY_RULE, '<order xmlns="urn:t" country="DE"/>', undefined, workspace);
    expect(bad.findings.map((f) => f.message)).toEqual([
      'The country "DE" is not in the code list.',
    ]);
  });

  it('binds the finding to the instance node, not to the document doc() read', () => {
    const bad = run(COUNTRY_RULE, '<order xmlns="urn:t" country="DE"/>', undefined, workspace);
    const instance = XmlDocument.parse('<order xmlns="urn:t" country="DE"/>');
    // The finding's node id is the instance's root element — resolvable in a fresh parse of the
    // same source, which it would not be if it pointed into codes.xml.
    expect(bad.findings[0]!.node).toBe(instance.documentElement());
  });

  it('fails loudly on a doc() naming a file that is not open', () => {
    const result = run(
      schema(`<sch:pattern><sch:rule context="t:order">
        <sch:assert test="@country = doc('closed.xml')/codes/code">x</sch:assert>
      </sch:rule></sch:pattern>`),
      '<order xmlns="urn:t" country="GB"/>',
      undefined,
      workspace,
    );
    // A broken expression, reported against the rule set — not an empty sequence, which would make
    // the assert quietly fire (or a report quietly pass) on every document.
    expect(result.statistics[0]!.assertions[0]!.broken).toContain('does not name an open file');
    expect(result.findings).toEqual([]);
  });

  it('does not let a context reaching through doc() pin findings onto the instance', () => {
    // A rule whose context selects nodes of codes.xml has nothing this run can attribute: findings
    // stay bound to the instance, so those matches are dropped rather than misbound onto whatever
    // instance node happens to share the id.
    const result = run(
      schema(`<sch:pattern><sch:rule context="doc('codes.xml')/codes/code">
        <sch:assert test="false()">x</sch:assert>
      </sch:rule></sch:pattern>`),
      '<order xmlns="urn:t" country="GB"/>',
      undefined,
      workspace,
    );
    expect(result.findings).toEqual([]);
    expect(result.statistics[0]!.fired).toBe(0);
  });

  it('lets a rule set validate an open schema, because an XSD is XML', () => {
    // The first claim of §6.2: schema-design conventions enforced by pointing rules at the XSD.
    const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="order" type="xs:string"/>
    </xs:schema>`;
    const result = run(
      `<sch:schema xmlns:sch="${SCH}" queryBinding="xslt2">
        <sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
        <sch:pattern><sch:rule context="xs:element">
          <sch:assert test="xs:annotation">Every global element carries documentation.</sch:assert>
        </sch:rule></sch:pattern>
      </sch:schema>`,
      XSD,
    );
    expect(result.findings.map((f) => f.message)).toEqual([
      'Every global element carries documentation.',
    ]);
  });
});
