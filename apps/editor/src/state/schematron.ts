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
 * Schematron mode, and its live test harness.
 *
 * The harness is the point. A Schematron rule is a piece of XPath whose effect you cannot see by
 * reading it — "does this context match anything?" and "does this assert ever fire?" are the two
 * questions every author has, and neither is answerable without running the rules against a real
 * document. Binding the schema being edited to a sample instance and showing the counts live is
 * what turns Schematron from an expert-only format into something a beginner can iterate on.
 *
 * The sample instance is a second document held beside the one being edited. It is never modified.
 */
export class SchematronStore {
  /** The parsed schema, when the open document is Schematron. */
  schema: SchSchema | null = null;
  problems: readonly SchDiagnostic[] = [];

  /** The document the rules are being tried against. */
  sample: XmlDocument | null = null;
  sampleName: string | null = null;

  result: SchematronResult | null = null;

  /** True when the open document is a Schematron schema. */
  get active(): boolean {
    return this.schema !== null;
  }

  /**
   * Re-read the schema from the document being edited.
   *
   * Called on every edit. Parsing is cheap — Schematron documents are small and shallow — so there
   * is no incremental path to get wrong.
   */
  refresh(document: XmlDocument): void {
    if (!isSchematronDocument(document)) {
      this.schema = null;
      this.problems = [];
      this.result = null;
      return;
    }

    const parsed = parseSchematron(document);
    this.schema = parsed.schema;
    this.problems = parsed.problems;
    this.run();
  }

  setSample(source: string, name: string): void {
    this.sample = XmlDocument.parse(source);
    this.sampleName = name;
    // The rules cannot run without XPath, and a Schematron author has certainly reached the point
    // of needing it — so this is where the engine is fetched.
    void loadXPath().then(() => this.run());
    this.run();
  }

  clearSample(): void {
    this.sample = null;
    this.sampleName = null;
    this.result = null;
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

  /** What one assert or report did, found by the node it was written at. */
  statisticsForAssertion(node: NodeId, ruleNode: NodeId) {
    const rule = this.statisticsForRule(ruleNode);
    if (rule === null) return null;
    const findings = this.result?.findings.filter((finding) => finding.origin === node) ?? [];
    // Matched by position within the rule, since the statistics carry the assertion's id and test
    // rather than its node.
    return { rule, findings };
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
