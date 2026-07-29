/**
 * The guidance engine's verdict on a whole document.
 *
 * Deliberately *not* called "validation". libxml2 is the authoritative verdict (PLAN.md §5), and
 * this is the same engine that drives the Insert palette reporting what it already knows. Keeping
 * the two apart is the point: when they disagree, the differential harness has to be able to say
 * which one was wrong, and one merged verdict would hide exactly the drift the plan names as the
 * top project risk.
 *
 * It is still worth having on its own terms — it runs in a keystroke with no worker, no WASM and no
 * 6MB download, so the tree can show a missing-children badge while the user types.
 */

import { ROOT_ID, isElement, type NodeId, type XmlDocument } from '@x-editor/xml-core';
import {
  attributeStatuses,
  elementContext,
  firstProblemIndex,
  missingRequiredAttributes,
  requiredMissing,
  textTypeOf,
  validateText,
} from './query.js';
import type { SchemaModel } from './model.js';

export interface DocumentProblem {
  readonly nodeId: NodeId;
  readonly severity: 'error' | 'warning';
  /** The `cvc-*` code from the XSD spec, so messages can be matched against an oracle's. */
  readonly code: string;
  readonly message: string;
  /** An element path, for the Problems panel's second line. */
  readonly path: string;
}

export interface ValidateOptions {
  /** Beyond this the list stops being a list and becomes a wall. */
  readonly limit?: number;
}

export function validateDocument(
  model: SchemaModel,
  document: XmlDocument,
  options: ValidateOptions = {},
): DocumentProblem[] {
  const limit = options.limit ?? 500;
  const problems: DocumentProblem[] = [];

  const visit = (id: NodeId, path: string, depth: number): void => {
    if (problems.length >= limit) return;
    const node = document.node(id);
    if (node === undefined || !isElement(node)) return;

    const here = `${path}/${node.name.localName}`;
    const context = elementContext(model, document, id);
    if (context === null) return;

    // An undeclared *root* is a hard error — the schema does not describe this document at all.
    // Deeper down, an undeclared element is already reported structurally by its parent's content
    // model, so repeating it here would double-count every stray element.
    if (context.declaration === null && depth === 0) {
      problems.push({
        nodeId: id,
        severity: 'error',
        code: 'cvc-elt.1.a',
        message: `The schema has no global declaration for <${node.name.localName}>.`,
        path: here,
      });
    }

    for (const attribute of missingRequiredAttributes(document, context)) {
      problems.push({
        nodeId: id,
        severity: 'error',
        code: 'cvc-complex-type.4',
        message: `<${node.name.localName}> is missing the required attribute ${attribute.name.localName}.`,
        path: here,
      });
    }

    for (const status of attributeStatuses(document, context)) {
      for (const problem of status.problems) {
        problems.push({
          nodeId: id,
          severity: 'error',
          code: problem.code,
          message: `${status.use.name.localName}: ${problem.message}`,
          path: here,
        });
      }
    }

    const invalidAt = firstProblemIndex(model, context);
    if (invalidAt !== null) {
      const child = context.children[invalidAt];
      problems.push({
        nodeId: child?.id ?? id,
        severity: 'error',
        code: 'cvc-complex-type.2.4.a',
        message:
          child === undefined
            ? `The children of <${node.name.localName}> do not match the schema.`
            : `<${child.name.localName}> cannot appear here inside <${node.name.localName}>.`,
        path: here,
      });
    } else {
      const missing = requiredMissing(model, context);
      if (missing.length > 0) {
        problems.push({
          nodeId: id,
          severity: 'error',
          code: 'cvc-complex-type.2.4.b',
          message: `<${node.name.localName}> is missing ${missing
            .map((name) => `<${name.localName}>`)
            .join(', ')}.`,
          path: here,
        });
      }
    }

    if (textTypeOf(context) !== null) {
      for (const problem of validateText(context, textOf(document, id))) {
        problems.push({
          nodeId: id,
          severity: 'error',
          code: problem.code,
          message: problem.message,
          path: here,
        });
      }
    }

    for (const child of document.childrenOf(id)) visit(child, here, depth + 1);
  };

  for (const child of document.childrenOf(ROOT_ID)) visit(child, '', 0);
  return problems;
}

/** The yes/no answer, for the differential harness. */
export function isDocumentValid(model: SchemaModel, document: XmlDocument): boolean {
  return validateDocument(model, document, { limit: 1 }).every(
    (problem) => problem.severity !== 'error',
  );
}

function textOf(document: XmlDocument, id: NodeId): string {
  let text = '';
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child?.kind === 'text' || child?.kind === 'cdata') text += child.value;
  }
  return text;
}
