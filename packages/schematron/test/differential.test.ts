import { beforeAll, describe, expect, it } from 'vitest';
import { XmlDocument } from '@x-editor/xml-core';
import { loadXPath } from '@x-editor/xsd';
import { parseSchematronSource } from '../src/parse.js';
import { runSchematron } from '../src/interpret.js';
import { isoSchematronAvailable, runIsoSchematron } from './oracles/isoSchematron.js';

/**
 * Our interpreter versus the ISO reference implementation.
 *
 * The two work by completely different means — we evaluate rules directly over fontoxpath, the
 * reference compiles the schema to XSLT and runs that — so agreement is evidence rather than
 * tautology. This is the Schematron half of the same guidance-versus-verdict discipline the XSD
 * engine has.
 *
 * The corpus sticks to XPath 1.0-compatible expressions, because the reference runs under libxslt
 * and libxslt is XSLT 1.0. That is a real limit on what this harness can check, and it is stated
 * rather than worked around.
 */

const available = isoSchematronAvailable();

beforeAll(async () => {
  await loadXPath();
});

const SCH = 'http://purl.oclc.org/dsdl/schematron';

interface Case {
  readonly name: string;
  readonly rules: string;
  readonly instance: string;
}

const schema = (body: string): string =>
  `<?xml version="1.0"?>
<sch:schema xmlns:sch="${SCH}">
  <sch:ns prefix="t" uri="urn:t"/>
  ${body}
</sch:schema>`;

const ORDER = `<?xml version="1.0"?>
<order xmlns="urn:t" total="15">
  <line qty="2" price="5.00"/>
  <line qty="1" price="5.00"/>
  <line qty="0" price="1.00"/>
</order>`;

const CASES: Case[] = [
  {
    name: 'an assert that holds everywhere',
    rules: schema(`<sch:pattern><sch:rule context="t:line">
      <sch:assert test="@price">every line has a price</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'an assert that fails on some nodes and not others',
    rules: schema(`<sch:pattern><sch:rule context="t:line">
      <sch:assert test="@qty > 0">quantity must be above zero</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'a report, which fires on the opposite condition',
    rules: schema(`<sch:pattern><sch:rule context="t:line">
      <sch:report test="@qty = 0">this line has no quantity</sch:report>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'first-match-wins between two rules in one pattern',
    rules: schema(`<sch:pattern>
      <sch:rule context="t:line[@qty = 0]">
        <sch:assert test="false()">the zero-quantity rule fired</sch:assert>
      </sch:rule>
      <sch:rule context="t:line">
        <sch:assert test="false()">the general rule fired</sch:assert>
      </sch:rule>
    </sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'two patterns both claiming the same nodes',
    rules: schema(`
      <sch:pattern><sch:rule context="t:line">
        <sch:assert test="false()">pattern one</sch:assert>
      </sch:rule></sch:pattern>
      <sch:pattern><sch:rule context="t:line">
        <sch:assert test="false()">pattern two</sch:assert>
      </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'a context with a predicate',
    rules: schema(`<sch:pattern><sch:rule context="t:line[@qty > 1]">
      <sch:assert test="false()">a busy line</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'an absolute context',
    rules: schema(`<sch:pattern><sch:rule context="/t:order">
      <sch:assert test="count(t:line) > 5">not enough lines</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'a message interpolating sch:value-of',
    rules: schema(`<sch:pattern><sch:rule context="t:line">
      <sch:assert test="@qty > 0">quantity is <sch:value-of select="@qty"/></sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'a message using sch:name',
    rules: schema(`<sch:pattern><sch:rule context="t:line">
      <sch:assert test="false()"><sch:name/> is wrong</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'a sum across siblings — the classic Schematron job',
    rules: schema(`<sch:pattern><sch:rule context="t:order">
      <sch:assert test="@total = sum(t:line/@price)">the total does not match the lines</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'a rule that matches nothing at all',
    rules: schema(`<sch:pattern><sch:rule context="t:nonesuch">
      <sch:assert test="false()">never</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
  {
    name: 'multiple assertions in one rule',
    rules: schema(`<sch:pattern><sch:rule context="t:line">
      <sch:assert test="@qty > 0">quantity</sch:assert>
      <sch:assert test="@price > 100">price</sch:assert>
    </sch:rule></sch:pattern>`),
    instance: ORDER,
  },
];

describe.skipIf(!available)('our interpreter and the ISO reference agree', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const parsed = parseSchematronSource(testCase.rules);
      expect(parsed.problems.filter((p) => p.severity === 'error')).toEqual([]);

      const ours = runSchematron(parsed.schema, XmlDocument.parse(testCase.instance));
      const theirs = runIsoSchematron(testCase.rules, testCase.instance);

      // Compared as a list, in order: the *set* of messages matching would hide a rule firing the
      // wrong number of times, which is exactly the first-match-wins bug worth catching.
      expect({
        ours: ours.findings.map((finding) => finding.message),
        theirs: theirs.messages,
      }).toEqual({ ours: theirs.messages, theirs: theirs.messages });
    });
  }
});

describe('the Schematron oracle itself', () => {
  it.skipIf(!available)('is present, so the differential actually ran', () => {
    expect(available).toBe(true);
  });

  it.skipIf(available)('is skipped cleanly when lxml is not installed', () => {
    // A contributor without Python still gets a green suite; CI installs it so the coverage is not
    // quietly lost.
    expect(available).toBe(false);
  });
});
