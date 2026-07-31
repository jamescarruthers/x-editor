import { ROOT_ID, type NodeId } from '@x-editor/xml-core';
import { store, type FileId, type FileKind } from '../state/store.js';
import { documentProblems } from './problems.js';
import { selfProblems } from './xsdAuthoring.js';

/**
 * Problems across the whole workspace, attributed to the file they belong in.
 *
 * The attribution is the point. "This document is invalid" is a statement about the XML, but the
 * *cause* is often in the XSD — a type nobody meant to make required — and a panel that shows the
 * symptom without a way to reach the cause makes people fix the wrong file. So every finding
 * carries the file it lives in, and clicking one switches to that file and selects the node.
 *
 * Derived on every read rather than cached. Everything it reads from is already memoised or cheap,
 * and a cache here would need invalidating on edits to three documents plus two compiled models —
 * which is exactly the kind of bookkeeping that goes wrong quietly.
 */

export type ProblemSeverity = 'error' | 'warning';

export interface WorkspaceProblem {
  /** The document this belongs in. A kind is no longer an address — several XML files may be open. */
  readonly fileId: FileId;
  readonly file: FileKind;
  readonly node: NodeId;
  readonly severity: ProblemSeverity;
  readonly message: string;
  /** Where the finding came from, kept visible rather than merged into one list. */
  readonly source: 'well-formedness' | 'schema' | 'libxml2' | 'rules' | 'schema-health';
}

export function workspaceProblems(): WorkspaceProblem[] {
  const out: WorkspaceProblem[] = [];

  // Well-formedness, per file. A file that does not parse makes every other check about it
  // meaningless, so it is reported first and reported for all three.
  for (const { id, kind } of store.openFiles) {
    const document = store.documentById(id);
    if (document === null) continue;
    for (const error of document.parseErrors) {
      out.push({
        fileId: id,
        // A well-formedness error is a position in the text, not a node — the tree could not be
        // built, which is what the error says. It anchors to the document so clicking still
        // switches you to the right file.
        file: kind,
        node: ROOT_ID,
        severity: 'error',
        message: error.message,
        source: 'well-formedness',
      });
    }
  }

  // The schema itself: compilation diagnostics, plus dangling references and ambiguous content
  // models. These belong to the XSD even though they are usually noticed in the XML.
  // The schemas: compilation diagnostics land on whichever document declared the component, which
  // `origin.documentUri` names — with two schemas open, attributing everything to the first would
  // send an author editing a file they had not broken. Dangling references and ambiguous content
  // models are found per document because they are questions about one file's text.
  const schemaFiles = store.filesOfKind('xsd');
  const byName = new Map(schemaFiles.map((file) => [file.name, file] as const));
  if (schemaFiles.length > 0) {
    for (const diagnostic of store.schemaProblems) {
      const owner = byName.get(diagnostic.origin.documentUri) ?? schemaFiles[0]!;
      out.push({
        fileId: owner.id,
        file: 'xsd',
        node: diagnostic.origin.node,
        severity: diagnostic.severity === 'error' ? 'error' : 'warning',
        message: diagnostic.message,
        source: 'schema',
      });
    }
    for (const file of schemaFiles) {
      for (const problem of selfProblems(file.doc, store.schema.model)) {
        out.push({
          fileId: file.id,
          file: 'xsd',
          node: problem.node,
          severity: problem.severity,
          message: problem.hint === null ? problem.message : `${problem.message} ${problem.hint}`,
          source: 'schema-health',
        });
      }
    }
  }

  // The instance half, per document. This is the corpus: one schema and one rule set, checked
  // against every instance that is open, so a known-good and a known-bad file both react to the
  // same edit. `documentProblems` is in-process and memoised, so N documents is N cheap queries.
  for (const xmlFile of store.filesOfKind('xml')) {
    if (store.schema.model !== null) {
      for (const diagnostic of documentProblems(store.schema.model, xmlFile.doc)) {
        out.push({
          fileId: xmlFile.id,
          file: 'xml',
          node: diagnostic.node,
          severity: diagnostic.severity === 'error' ? 'error' : 'warning',
          message: diagnostic.message,
          source: 'schema',
        });
      }
    }

    // libxml2's verdict for this document specifically. One worker validates the corpus in turn, so
    // a file that has not come round yet simply has no second opinion rather than borrowing one.
    const engineVerdict = store.verdict.stateFor(xmlFile.id);
    if (engineVerdict !== null && !engineVerdict.stale) {
      for (const finding of engineVerdict.findings) {
        out.push({
          fileId: xmlFile.id,
          file: 'xml',
          node: finding.node,
          severity: 'error',
          message: finding.message,
          source: 'libxml2',
        });
      }
    }

    for (const finding of store.schematron.findingsFor(xmlFile.id)) {
      out.push({
        fileId: xmlFile.id,
        file: 'xml',
        node: finding.node,
        severity: finding.role === 'warning' ? 'warning' : 'error',
        message: finding.message,
        source: 'rules',
      });
    }
  }

  const schFile = store.filesOfKind('sch')[0];
  const sch = schFile?.doc ?? null;
  const result = store.schematron.result;
  if (sch !== null && schFile !== undefined) {
    for (const problem of store.schematron.problems) {
      out.push({
        fileId: schFile.id,
        file: 'sch',
        node: problem.origin.node,
        severity: problem.severity === 'error' ? 'error' : 'warning',
        message: problem.message,
        source: 'rules',
      });
    }
    for (const statistic of result?.statistics ?? []) {
      if (statistic.shadowedBy !== null) {
        out.push({
          fileId: schFile.id,
          file: 'sch',
          node: statistic.origin,
          severity: 'warning',
          message: `This rule never runs: ${statistic.shadowedBy} claims all its nodes first.`,
          source: 'rules',
        });
      }
      // An expression that does not evaluate is the author's problem, not the document's — and it
      // is the quietest failure in Schematron, because a broken assert checks nothing and reports
      // nothing. It is the whole reason the harness exists, so it belongs in the problems list and
      // not only in the Inspector.
      for (const assertion of statistic.assertions) {
        if (assertion.broken === null) continue;
        out.push({
          fileId: schFile.id,
          file: 'sch',
          node: statistic.origin,
          severity: 'error',
          message: `This test could not be evaluated, so it checks nothing: ${assertion.broken}`,
          source: 'rules',
        });
      }
    }

    // A rule that matches nothing is worth saying too, but only once there is something to match
    // against — otherwise every rule reports it the moment the workspace has no XML.
    if (store.has('xml')) {
      for (const statistic of result?.statistics ?? []) {
        if (statistic.matched > 0 || statistic.shadowedBy !== null) continue;
        out.push({
          fileId: schFile.id,
          file: 'sch',
          node: statistic.origin,
          severity: 'warning',
          message: `Nothing in ${store.nameFor('xml')} matches this rule's context.`,
          source: 'rules',
        });
      }
    }
  }

  return out;
}

export interface Counts {
  readonly errors: number;
  readonly warnings: number;
}

const NONE: Counts = { errors: 0, warnings: 0 };

/**
 * Error and warning counts per document, for the file list.
 *
 * Per document rather than per kind, because with a corpus open the number beside each file *is*
 * the feature: `invoice-bad.xml 3` next to `invoice-good.xml ✓`, both moving when the rules change.
 */
export function countsByFile(problems: readonly WorkspaceProblem[]): Map<FileId, Counts> {
  const counts = new Map<FileId, Counts>();
  for (const problem of problems) {
    const current = counts.get(problem.fileId) ?? NONE;
    counts.set(
      problem.fileId,
      problem.severity === 'error'
        ? { errors: current.errors + 1, warnings: current.warnings }
        : { errors: current.errors, warnings: current.warnings + 1 },
    );
  }
  return counts;
}

export function countsFor(counts: Map<FileId, Counts>, id: FileId): Counts {
  return counts.get(id) ?? NONE;
}
