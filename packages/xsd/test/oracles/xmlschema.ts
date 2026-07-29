import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `xmlschema` as the XSD 1.1 oracle.
 *
 * libxml2 is XSD 1.0 only and its maintainer has said 1.1 is not planned, so it cannot check a
 * schema that uses `xs:assert` or `xs:alternative` — it will not even compile one. That leaves our
 * engine as the *only* 1.1 implementation in the stack, which is exactly the situation PLAN.md §11
 * risk 2 warns about, so 1.1 needs its own independent oracle.
 *
 * `xmlschema` is pure Python and depends only on `elementpath`, which is also pure Python. In the
 * browser that means it installs under Pyodide with no C extensions to cross-compile (Phase 4b's
 * lazily-loaded "full conformance check"). Here in CI it runs under plain CPython, where it costs
 * nothing but a subprocess.
 *
 * Test-only, and skipped rather than failed when the module is absent — a contributor without
 * Python should still be able to run the suite.
 */

export interface XmlschemaResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

let availability: boolean | null = null;

export function xmlschemaAvailable(): boolean {
  if (availability !== null) return availability;
  try {
    execFileSync('python3', ['-c', 'import xmlschema'], { stdio: 'ignore' });
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
}

const SCRIPT = `
import json, sys
import xmlschema

schema_path, instance_path = sys.argv[1], sys.argv[2]
try:
    schema = xmlschema.XMLSchema11(schema_path)
except Exception as error:
    print(json.dumps({"valid": False, "errors": ["schema: " + str(error)]}))
    sys.exit(0)

errors = []
for error in schema.iter_errors(instance_path):
    errors.append(error.reason or str(error))
print(json.dumps({"valid": not errors, "errors": errors}))
`;

/**
 * Validate an instance against a 1.1 schema.
 *
 * Files rather than strings because `xmlschema` resolves `schemaLocation` relative to the schema's
 * own path, which is how a multi-file set has to work.
 */
export function validateWithXmlschema(
  files: Readonly<Record<string, string>>,
  rootUri: string,
  instance: string,
): XmlschemaResult {
  const directory = mkdtempSync(join(tmpdir(), 'x-editor-xmlschema-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(directory, name), text, 'utf8');
    }
    const instancePath = join(directory, '__instance.xml');
    writeFileSync(instancePath, instance, 'utf8');

    const output = execFileSync(
      'python3',
      ['-c', SCRIPT, join(directory, rootUri), instancePath],
      { encoding: 'utf8' },
    );
    return JSON.parse(output) as XmlschemaResult;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
