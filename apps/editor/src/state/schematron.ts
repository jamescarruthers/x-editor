import { XmlDocument, isElement, type NodeId } from '@x-editor/xml-core';
import { loadXPath } from '@x-editor/xsd';
import {
  SCH_NS,
  SCH_NS_OLD,
  parseSchematron,
  runSchematron,
  type SchDiagnostic,
  type SchSchema,
  type SchematronResult,
} from '@x-editor/schematron';

/**
 * Schematron rules, and the document they are run against.
 *
 * The harness is the point. A Schematron rule is a piece of XPath whose effect you cannot see by
 * reading it — "does this context match anything?" and "does this assert ever fire?" are the two
 * questions every author has, and neither is answerable without running the rules against a real
 * document.
 *
 * Rules and sample are set **separately**, from two different workspace files. An earlier version
 * derived the rules from whichever document was being edited, which made the harness work only
 * while a `.sch` was in front of you — an XML author with rules open alongside got no findings at
 * all, and the bundled example built to demonstrate a failing business rule demonstrated nothing.
 * Keeping the two inputs independent is what makes rules apply to the document rather than to the
 * editor's current focus.
 *
 * The sample is never modified.
 */
export class SchematronStore {
  /** The parsed rules, from the `.sch` file in the workspace. */
  schema: SchSchema | null = null;
  problems: readonly SchDiagnostic[] = [];

  /** The document the rules are tried against — the `.xml` file in the workspace. */
  sample: XmlDocument | null = null;
  sampleName: string | null = null;

  result: SchematronResult | null = null;

  /** The source the rules were last parsed from, so an unrelated edit does not reparse. */
  private rulesSource: string | null = null;

  /** True when there are rules to run. */
  get active(): boolean {
    return this.schema !== null;
  }

  /**
   * Re-read the rules.
   *
   * Guarded on the serialized source rather than reparsing unconditionally: this is called on every
   * edit to any file in the workspace, and reparsing a `.sch` because someone typed in the `.xml`
   * would be work for nothing. Parsing is otherwise cheap — Schematron documents are small and
   * shallow — so there is no incremental path to get wrong beyond this guard.
   */
  setRules(document: XmlDocument | null): void {
    if (document === null || !isSchematronDocument(document)) {
      this.schema = null;
      this.problems = [];
      this.rulesSource = null;
      this.result = null;
      return;
    }

    const source = document.serialize();
    if (source === this.rulesSource) return;
    this.rulesSource = source;

    const parsed = parseSchematron(document);
    this.schema = parsed.schema;
    this.problems = parsed.problems;
  }

  setSample(document: XmlDocument | null, name: string | null): void {
    this.sample = document;
    this.sampleName = name;
    // The rules cannot run without XPath, and a workspace holding a `.sch` has certainly reached the
    // point of needing it — so this is where the engine is fetched.
    if (document !== null && this.schema !== null) void loadXPath().then(() => this.run());
  }

  run(): void {
    if (this.schema === null || this.sample === null) {
      this.result = null;
      return;
    }
    this.result = runSchematron(this.schema, this.sample);
  }

  /** What a rule did, found by the node it was written at. */
  statisticsForRule(node: NodeId) {
    return this.result?.statistics.find((entry) => entry.origin === node) ?? null;
  }
}

export function isSchematronDocument(document: XmlDocument): boolean {
  const rootId = document.documentElement();
  if (rootId === undefined) return false;
  const root = document.node(rootId);
  if (root === undefined || !isElement(root)) return false;
  return (
    (root.name.namespaceUri === SCH_NS || root.name.namespaceUri === SCH_NS_OLD) &&
    root.name.localName === 'schema'
  );
}

/** The Schematron element a node is, if any — what the Inspector switches on. */
export function schematronRole(
  document: XmlDocument,
  id: NodeId,
): 'rule' | 'assert' | 'report' | 'pattern' | 'schema' | null {
  const node = document.node(id);
  if (node === undefined || !isElement(node)) return null;
  if (node.name.namespaceUri !== SCH_NS && node.name.namespaceUri !== SCH_NS_OLD) return null;

  switch (node.name.localName) {
    case 'rule':
    case 'assert':
    case 'report':
    case 'pattern':
    case 'schema':
      return node.name.localName;
    default:
      return null;
  }
}

/** The enclosing `sch:rule` of an assert or report. */
export function enclosingRule(document: XmlDocument, id: NodeId): NodeId | null {
  for (const ancestor of document.ancestorsOf(id)) {
    if (schematronRole(document, ancestor) === 'rule') return ancestor;
  }
  return null;
}
