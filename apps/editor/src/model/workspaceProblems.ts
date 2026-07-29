import { ROOT_ID, type NodeId } from '@x-editor/xml-core';
import { store, type FileKind } from '../state/store.js';
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
  for (const { kind } of store.openFiles) {
    const document = store.documentFor(kind);
    if (document === null) continue;
    for (const error of document.parseErrors) {
      out.push({
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
  const xsd = store.documentFor('xsd');
  if (xsd !== null) {
    for (const diagnostic of store.schemaProblems) {
      out.push({
        file: 'xsd',
        node: diagnostic.origin.node,
        severity: diagnostic.severity === 'error' ? 'error' : 'warning',
        message: diagnostic.message,
        source: 'schema',
      });
    }
    for (const problem of selfProblems(xsd, store.schema.model)) {
      out.push({
        file: 'xsd',
        node: problem.node,
        severity: problem.severity,
        message: problem.hint === null ? problem.message : `${problem.message} ${problem.hint}`,
        source: 'schema-health',
      });
    }
  }

  // The instance against the schema, from our engine and from libxml2 — kept apart, because when
  // they disagree that is the finding rather than a nuisance.
  const xml = store.documentFor('xml');
  if (xml !== null && store.schema.model !== null) {
    for (const diagnostic of documentProblems(store.schema.model, xml)) {
      out.push({
        file: 'xml',
        node: diagnostic.node,
        severity: diagnostic.severity === 'error' ? 'error' : 'warning',
        message: diagnostic.message,
        source: 'schema',
      });
    }
  }

  const verdict = store.verdict.state;
  if (xml !== null && !verdict.stale) {
    for (const finding of verdict.findings) {
      out.push({
        file: 'xml',
        node: finding.node,
        severity: 'error',
        message: finding.message,
        source: 'libxml2',
      });
    }
  }

  // Rule problems land on the XML — that is the document that is wrong — while problems *with* a
  // rule land on the `.sch`. Putting a failing assert on the rule that raised it would be a list of
  // the author's own rules rather than a list of what to fix.
  const result = store.schematron.result;
  if (result !== null) {
    for (const finding of result.findings) {
      out.push({
        file: 'xml',
        node: finding.node,
        severity: finding.role === 'warning' ? 'warning' : 'error',
        message: finding.message,
        source: 'rules',
      });
    }
  }

  const sch = store.documentFor('sch');
  if (sch !== null) {
    for (const problem of store.schematron.problems) {
      out.push({
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

/** Error and warning counts per file, for the tab chips. */
export function countsByFile(
  problems: readonly WorkspaceProblem[],
): Record<FileKind, { errors: number; warnings: number }> {
  const counts: Record<FileKind, { errors: number; warnings: number }> = {
    xml: { errors: 0, warnings: 0 },
    xsd: { errors: 0, warnings: 0 },
    sch: { errors: 0, warnings: 0 },
  };
  for (const problem of problems) {
    if (problem.severity === 'error') counts[problem.file].errors++;
    else counts[problem.file].warnings++;
  }
  return counts;
}
