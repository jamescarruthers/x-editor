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

  /** The document the rules are tried against — the first `.xml` file, for the harness display. */
  sample: XmlDocument | null = null;
  sampleName: string | null = null;

  /**
   * The run against the sample, which is what the authoring harness shows: match counts, per-rule
   * statistics, shadowing. One document, because those numbers only mean anything about one.
   */
  result: SchematronResult | null = null;

  /**
   * Findings per instance document, which is what the problems list and the file counts read.
   *
   * Separate from `result` on purpose. The harness answers "what do these rules do?" about a single
   * sample; the corpus answers "which of my documents fail?" across all of them, and collapsing the
   * two would make the statistics meaningless the moment a second file opened.
   */
  private byDocument = new Map<number, SchematronResult>();

  /**
   * One parsed rule set per `.sch` file, keyed by file id.
   *
   * Rule sets are independent by construction — Schematron's first-match-wins is *per pattern*, so
   * two files never shadow each other and running them separately is the correct semantics rather
   * than a convenience. Merging them into one schema would invent shadowing that ISO does not
   * describe, and quietly silence rules.
   */
  private ruleSets = new Map<number, { schema: SchSchema; source: string; problems: readonly SchDiagnostic[] }>();

  /**
   * Per rule set, what its rules did against the sample: matched, fired, shadowed, broken.
   *
   * Kept per set rather than concatenated, because these are the findings about the *rules* rather
   * than about a document, and every one of them names a file to go and fix. A broken expression in
   * the second rule set read from the first set's statistics is simply not reported — which is the
   * failure a test caught here, and the quietest kind: a rule that checks nothing and says nothing.
   */
  private statsBySet = new Map<number, SchematronResult>();

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

  /** Findings for one instance document, from every open rule set. */
  findingsFor(id: number): readonly SchematronResult['findings'][number][] {
    return this.byDocument.get(id)?.findings ?? [];
  }

  /** Parse problems for one rule set, so a broken rule is blamed on the file that holds it. */
  problemsFor(ruleSetId: number): readonly SchDiagnostic[] {
    return this.ruleSets.get(ruleSetId)?.problems ?? [];
  }

  /** What one rule set's rules did against the sample — shadowing, dead contexts, broken tests. */
  statisticsFor(ruleSetId: number): readonly SchematronResult['statistics'][number][] {
    return this.statsBySet.get(ruleSetId)?.statistics ?? [];
  }

  /**
   * Re-read every open rule set, dropping any whose file has closed.
   *
   * Guarded per file on its serialized source, so editing one rule set does not reparse the others.
   */
  setAllRules(files: readonly { id: number; doc: XmlDocument }[]): void {
    const live = new Set(files.map((file) => file.id));
    for (const id of [...this.ruleSets.keys()]) if (!live.has(id)) this.ruleSets.delete(id);

    for (const file of files) {
      if (!isSchematronDocument(file.doc)) {
        this.ruleSets.delete(file.id);
        continue;
      }
      const source = file.doc.serialize();
      if (this.ruleSets.get(file.id)?.source === source) continue;
      const parsed = parseSchematron(file.doc);
      this.ruleSets.set(file.id, { schema: parsed.schema, source, problems: parsed.problems });
    }

    // The harness and the Inspector still speak about one rule set: the one being edited, or the
    // first open. Those views are about authoring a single file and mean nothing averaged.
    const first = files.find((file) => this.ruleSets.has(file.id));
    const primary = first === undefined ? null : this.ruleSets.get(first.id)!;
    this.schema = primary?.schema ?? null;
    this.problems = primary?.problems ?? [];
    if (primary === null) this.result = null;
  }

  /**
   * Runs every rule set over every instance. Cheap: interpretation is in-process, no worker.
   *
   * Findings from all rule sets are concatenated per document, because the document's author cares
   * that it failed, not which file the rule came from. Which file is *wrong* is a different
   * question, answered by `problemsFor`.
   */
  runAll(documents: readonly { id: number; doc: XmlDocument }[]): void {
    this.byDocument.clear();
    this.statsBySet.clear();
    if (this.ruleSets.size === 0) return;

    for (const entry of documents) {
      const findings: SchematronResult['findings'][number][] = [];
      const statistics: SchematronResult['statistics'][number][] = [];
      for (const [setId, set] of this.ruleSets) {
        const result = runSchematron(set.schema, entry.doc);
        findings.push(...result.findings);
        statistics.push(...result.statistics);
        // Statistics come from the first document only: "does this context match anything?" is a
        // question about one sample, and averaging it over a corpus makes it meaningless.
        if (!this.statsBySet.has(setId)) this.statsBySet.set(setId, result);
      }
      this.byDocument.set(entry.id, { findings, statistics, problems: [] });
    }
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
