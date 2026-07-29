import { ROOT_ID, isElement, type NodeId, type XmlDocument } from '@x-editor/xml-core';
import {
  elementContext,
  firstProblemIndex,
  missingRequiredAttributes,
  requiredMissing,
  attributeStatuses,
  validateText,
  textTypeOf,
  type SchemaModel,
} from '@x-editor/xsd';

/**
 * Document problems as the *guidance engine* sees them.
 *
 * Deliberately not called validation. libxml2 is the authoritative verdict and arrives in Phase 4;
 * this is the same engine that drives the palette, reporting what it already knows. Keeping the two
 * separate is the point — when they eventually disagree, the differential harness has to be able to
 * say which one was wrong, and a single merged "problems" list would hide that.
 */
export interface DocumentProblem {
  readonly nodeId: NodeId;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly code: string;
  readonly path: string;
}

/** Beyond this the list stops being a list and starts being a wall. */
const LIMIT = 500;

export function documentProblems(
  model: SchemaModel,
  document: XmlDocument,
): DocumentProblem[] {
  const problems: DocumentProblem[] = [];

  const visit = (id: NodeId, path: string): void => {
    if (problems.length >= LIMIT) return;
    const node = document.node(id);
    if (node === undefined || !isElement(node)) return;

    const here = `${path}/${node.name.localName}`;
    const context = elementContext(model, document, id);

    if (context !== null) {
      if (context.declaration === null && context.type.name?.localName === 'anyType') {
        problems.push({
          nodeId: id,
          severity: 'warning',
          code: 'cvc-elt.1',
          message: `The schema does not declare <${node.name.localName}> here.`,
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
        const text = document
          .childrenOf(id)
          .map((child) => document.node(child))
          .filter((child) => child !== undefined)
          .filter((child) => child.kind === 'text' || child.kind === 'cdata')
          .map((child) => child.value)
          .join('');
        for (const problem of validateText(context, text)) {
          problems.push({
            nodeId: id,
            severity: 'error',
            code: problem.code,
            message: problem.message,
            path: here,
          });
        }
      }
    }

    for (const child of document.childrenOf(id)) visit(child, here);
  };

  for (const child of document.childrenOf(ROOT_ID)) visit(child, '');
  return problems;
}
