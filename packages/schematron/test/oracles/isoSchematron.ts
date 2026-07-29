import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The ISO Schematron reference implementation, as a differential oracle.
 *
 * Our interpreter evaluates rules directly over fontoxpath. The classical route compiles the schema
 * to XSLT and runs that, which is a completely different mechanism — so agreeing with it is real
 * evidence rather than a tautology. `lxml.isoschematron` bundles the ISO skeleton XSLT and runs it
 * under libxslt, which makes it exactly that: an independent implementation, installable with pip,
 * with nothing to build.
 *
 * The plan names SchXslt2 for this job. SchXslt2 is not on npm and vendoring a third-party XSLT
 * distribution is a larger step than it looks — so this stands in for now, and the substitution is
 * recorded rather than hidden. The two target different Schematron editions but agree on everything
 * the corpus below exercises.
 *
 * **One real constraint: libxslt is XSLT 1.0, so the oracle evaluates XPath 1.0.** Our interpreter
 * evaluates XPath 3.1. The corpus therefore sticks to expressions that mean the same in both, which
 * is most real Schematron — but it means this harness cannot check `queryBinding="xslt2"` features,
 * and pretending otherwise would produce failures that say nothing.
 */

export interface IsoSchematronResult {
  readonly valid: boolean;
  /** Failed asserts and successful reports, in document order, as the reference produces them. */
  readonly messages: readonly string[];
}

let availability: boolean | null = null;

export function isoSchematronAvailable(): boolean {
  if (availability !== null) return availability;
  try {
    execFileSync('python3', ['-c', 'from lxml import isoschematron'], { stdio: 'ignore' });
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
}

const SCRIPT = `
import json, sys
from lxml import etree, isoschematron

schema_path, instance_path = sys.argv[1], sys.argv[2]
try:
    schema = isoschematron.Schematron(
        etree.parse(schema_path), store_report=True, store_xslt=False
    )
except Exception as error:
    print(json.dumps({"valid": False, "messages": ["schema: " + str(error)]}))
    sys.exit(0)

instance = etree.parse(instance_path)
valid = schema.validate(instance)

messages = []
report = schema.validation_report
if report is not None:
    ns = {"svrl": "http://purl.oclc.org/dsdl/svrl"}
    for element in report.iter():
        # iter() yields comments and processing instructions too, whose tag is a callable rather
        # than a name; QName rejects those.
        if not isinstance(element.tag, str):
            continue
        tag = etree.QName(element).localname
        if tag in ("failed-assert", "successful-report"):
            text = element.findtext("svrl:text", namespaces=ns) or ""
            messages.append(" ".join(text.split()))

print(json.dumps({"valid": valid, "messages": messages}))
`;

export function runIsoSchematron(schematron: string, instance: string): IsoSchematronResult {
  const directory = mkdtempSync(join(tmpdir(), 'x-editor-schematron-'));
  try {
    const schemaPath = join(directory, 'rules.sch');
    const instancePath = join(directory, 'instance.xml');
    writeFileSync(schemaPath, schematron, 'utf8');
    writeFileSync(instancePath, instance, 'utf8');

    const output = execFileSync('python3', ['-c', SCRIPT, schemaPath, instancePath], {
      encoding: 'utf8',
    });
    return JSON.parse(output) as IsoSchematronResult;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
