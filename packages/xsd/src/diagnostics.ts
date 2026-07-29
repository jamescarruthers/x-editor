/**
 * Diagnostics and quick fixes.
 *
 * Two rules shape this file.
 *
 * **Produce diagnostics structurally. Never parse validator message strings.** libxml2's text is
 * excellent spec-ese and useless to a beginner, and scraping it would couple us to the wording of a
 * C library. Everything here is derived from the compiled schema, so the plain-English message and
 * the fix come from the same knowledge — which is also why a fix can be *offered* rather than
 * guessed at.
 *
 * **A fix is data, not a closure.** It has to survive a structured-clone across the worker boundary,
 * it should be testable without a document in hand, and Schematron Quick Fixes (`docs/schema-engine.md`
 * §5.2) are themselves declarative. A closure would make all three awkward and buy nothing.
 */

import { isElement, qnameToString, type NodeId, type XmlDocument } from '@x-editor/xml-core';
import { formatQName, qnameKey, type Origin, type XsdQName } from './ast.js';
import {
  elementNameEquals,
  elementNameKey,
  formatElementName,
  namespaceAllowed,
  type ElementName,
} from './particles.js';
import type { AllContentModel } from './allModel.js';
import {
  alignToModel,
  describeEdit,
  isPlausibleRename,
  nameDistance,
  type EditOperation,
} from './alignment.js';
import { applyWhiteSpace, matchesLexicalSpace } from './builtins.js';
import { validateSimpleValue, type CompiledSimpleType } from './simpleTypes.js';
import { sampleFor } from './xsdRegex.js';
import type { AttributeUse, CompiledElement, CompiledType, SchemaModel } from './model.js';
import {
  attributeStatuses,
  elementContext,
  insertionPlan,
  modelChildNames,
  requiredMissing,
  textTypeOf,
  type ElementContext,
} from './query.js';
import { describeFacets, humaniseName } from './describe.js';
import { evaluateBoolean } from './xpath.js';

// --- the fix vocabulary -------------------------------------------------

export type FixEdit =
  | { readonly kind: 'insert-element'; readonly parent: NodeId; readonly index: number; readonly name: ElementName }
  | { readonly kind: 'delete-node'; readonly node: NodeId }
  | { readonly kind: 'rename-element'; readonly node: NodeId; readonly name: ElementName }
  | { readonly kind: 'set-attribute'; readonly node: NodeId; readonly name: XsdQName; readonly value: string }
  | { readonly kind: 'remove-attribute'; readonly node: NodeId; readonly name: XsdQName }
  | { readonly kind: 'rename-attribute'; readonly node: NodeId; readonly from: XsdQName; readonly to: XsdQName }
  | { readonly kind: 'set-text'; readonly node: NodeId; readonly value: string }
  | { readonly kind: 'clear-children'; readonly node: NodeId }
  /** A whole alignment, applied as one undoable step. */
  | {
      readonly kind: 'apply-alignment';
      readonly parent: NodeId;
      readonly operations: readonly EditOperation[];
    };

export interface QuickFix {
  readonly title: string;
  readonly edit: FixEdit;
  /** Shown before committing, so a fix is never a leap of faith. */
  readonly preview?: string;
  /**
   * True when the fix guesses at intent rather than following from the schema — clamping a number
   * to its maximum, say. The UI marks these, because a fix that quietly invents data is the one way
   * this feature could make things worse.
   */
  readonly speculative?: boolean;
}

export type DiagnosticAnchor = 'element' | 'attribute' | 'text' | 'childGap';

export interface Diagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly node: NodeId;
  readonly anchor: DiagnosticAnchor;
  readonly attributeName?: XsdQName;
  readonly gapIndex?: number;
  /** Plain English, rendered from structured parameters. */
  readonly message: string;
  /** The spec-ese, behind "show details". */
  readonly technical: string;
  /** Where in the schema the governing rule lives, so the user can go and read it. */
  readonly schemaComponent?: Origin;
  readonly path: string;
  readonly fixes: readonly QuickFix[];
}

export interface ValidateOptions {
  /** Beyond this the list stops being a list and becomes a wall. */
  readonly limit?: number;
}

// --- the walk -----------------------------------------------------------

export function validateDocument(
  model: SchemaModel,
  document: XmlDocument,
  options: ValidateOptions = {},
): Diagnostic[] {
  const limit = options.limit ?? 500;
  const out: Diagnostic[] = [];

  const visit = (id: NodeId, path: string, depth: number): void => {
    if (out.length >= limit) return;
    const node = document.node(id);
    if (node === undefined || !isElement(node)) return;

    const here = `${path}/${qnameToString(node.name)}`;
    const context = elementContext(model, document, id);
    if (context !== null) {
      out.push(...diagnoseElement(model, document, context, here, depth));
    }

    for (const child of document.childrenOf(id)) visit(child, here, depth + 1);
  };

  for (const child of document.childrenOf(ROOT_CHILDREN_OF)) visit(child, '', 0);
  return out.slice(0, limit);
}

const ROOT_CHILDREN_OF = 0 as NodeId;

/** Whether the document satisfies the guidance engine. The differential harness's yes/no. */
export function isDocumentValid(model: SchemaModel, document: XmlDocument): boolean {
  return validateDocument(model, document, { limit: 1 }).every(
    (diagnostic) => diagnostic.severity !== 'error',
  );
}

function diagnoseElement(
  model: SchemaModel,
  document: XmlDocument,
  context: ElementContext,
  path: string,
  depth: number,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  out.push(...diagnoseDeclaration(model, document, context, path, depth));
  out.push(...diagnoseAbstract(model, context, path));
  out.push(...diagnoseAttributes(model, document, context, path));
  out.push(...diagnoseChildren(model, document, context, path));
  out.push(...diagnoseText(model, document, context, path));
  out.push(...diagnoseAssertions(model, document, context, path));
  return out;
}

// --- XSD 1.1: xs:assert -------------------------------------------------

/**
 * `xs:assert` — an XPath 2.0 expression the element has to satisfy.
 *
 * This is the 1.1 feature that pays for the whole XPath layer, and it is where co-occurrence rules
 * live: "a discount needs a reason", "the end date is after the start date". XSD 1.0 cannot express
 * either, which is why so many schemas that need them ship a Schematron file alongside.
 *
 * Two rules from the spec are load-bearing rather than pedantic. The element is evaluated **in
 * isolation** — an assertion may not look at its ancestors, so that an element is checkable
 * wherever it ends up. And a *failing* assertion and a *broken* assertion are different problems:
 * the first is the user's, the second is the schema author's, and reporting them the same way sends
 * the user hunting for a mistake they did not make.
 */
function diagnoseAssertions(
  model: SchemaModel,
  document: XmlDocument,
  context: ElementContext,
  path: string,
): Diagnostic[] {
  if (context.type.form !== 'complex' || context.type.assertions.length === 0) return [];
  const out: Diagnostic[] = [];

  for (const assertion of context.type.assertions) {
    const outcome = evaluateBoolean(document, context.nodeId, assertion.test, {
      namespaces: assertion.namespaces,
      defaultNamespace: assertion.xpathDefaultNamespace,
      isolate: context.nodeId,
    });

    if (!outcome.ok) {
      // Not yet loaded is not a finding: the assertion will be checked as soon as the engine
      // arrives, and claiming a problem in the meantime would be a lie that clears itself.
      if (outcome.error.notLoaded === true) continue;
      out.push({
        code: 'schema-assert-broken',
        severity: 'warning',
        node: context.nodeId,
        anchor: 'element',
        path,
        message: `A rule on <${context.name.localName}> could not be checked, because the schema's own expression does not work: ${outcome.error.message}`,
        technical: `The xs:assert test "${assertion.test}" failed to evaluate.`,
        schemaComponent: assertion.origin,
        fixes: [],
      });
      continue;
    }

    if (outcome.value) continue;

    // The author's own words if they wrote any — they know their domain and we do not — falling
    // back to the expression, which at least says precisely what was checked.
    const authored = assertion.annotation?.documentation ?? '';
    out.push({
      code: 'cvc-assertion-valid',
      severity: 'error',
      node: context.nodeId,
      anchor: 'element',
      path,
      message:
        authored === ''
          ? `<${context.name.localName}> breaks a rule in the schema: ${assertion.test}`
          : authored,
      technical: `cvc-assertion-valid: the xs:assert test "${assertion.test}" is false.`,
      schemaComponent: assertion.origin,
      // An assertion is arbitrary logic, so there is nothing general to offer. Guessing an edit that
      // might satisfy it would be exactly the "quietly invents data" failure the fix system avoids.
      fixes: [],
    });
  }

  return out;
}

// --- 16, 17: no declaration, and namespace mismatch ---------------------

function diagnoseDeclaration(
  model: SchemaModel,
  document: XmlDocument,
  context: ElementContext,
  path: string,
  depth: number,
): Diagnostic[] {
  if (context.declaration !== null) return [];
  // Deeper down, an element the parent's content model rejects is already reported there; repeating
  // it here would double-count every stray element.
  if (depth > 0) return [];

  const name = context.name;
  const globals = model.globalElements();

  /**
   * A namespace mismatch deserves its own diagnostic (`docs/schema-engine.md` §4.3): the element is
   * named right and simply lives in the wrong namespace, which is the single most confusing failure
   * in XSD and reads as gibberish when reported as "no declaration found".
   */
  const sameLocalName = globals.filter(
    (candidate) => candidate.name.localName === name.localName && candidate.name.namespaceUri !== name.namespaceUri,
  );
  if (sameLocalName.length > 0) {
    const intended = sameLocalName[0]!;
    return [
      {
        code: 'namespace-mismatch',
        severity: 'error',
        node: context.nodeId,
        anchor: 'element',
        path,
        message:
          name.namespaceUri === null
            ? `<${name.localName}> is in no namespace, but the schema declares it in ${intended.name.namespaceUri}.`
            : `<${name.localName}> is in ${name.namespaceUri}, but the schema declares it in ${intended.name.namespaceUri ?? 'no namespace'}.`,
        technical: `cvc-elt.1.a: no global element declaration matches ${formatQName(name)}.`,
        schemaComponent: intended.origin,
        fixes:
          intended.name.namespaceUri === null
            ? []
            : [
                {
                  title: `Add xmlns="${intended.name.namespaceUri}"`,
                  edit: {
                    kind: 'set-attribute',
                    node: context.nodeId,
                    name: { namespaceUri: null, localName: 'xmlns' },
                    value: intended.name.namespaceUri,
                  },
                  preview: `<${name.localName} xmlns="${intended.name.namespaceUri}">`,
                },
              ],
      },
    ];
  }

  const suggestion = globals
    .filter((candidate) => isPlausibleRename(name, candidate.name))
    .sort((a, b) => nameDistance(name, a.name) - nameDistance(name, b.name))[0];

  return [
    {
      code: 'cvc-elt.1',
      severity: 'error',
      node: context.nodeId,
      anchor: 'element',
      path,
      message:
        globals.length === 0
          ? `The schema declares no elements, so <${name.localName}> cannot be checked.`
          : `The schema has no element called <${name.localName}> at the top level.`,
      technical: `cvc-elt.1.a: no global element declaration matches ${formatQName(name)}.`,
      fixes:
        suggestion === undefined
          ? []
          : [
              {
                title: `Did you mean <${suggestion.name.localName}>?`,
                edit: { kind: 'rename-element', node: context.nodeId, name: suggestion.name },
              },
            ],
    },
  ];
}

// --- 11: an abstract element used directly ------------------------------

function diagnoseAbstract(
  model: SchemaModel,
  context: ElementContext,
  path: string,
): Diagnostic[] {
  const declaration = context.declaration;
  if (declaration === null || !declaration.abstract) return [];

  const members = model.substitutionMembers(declaration.name);
  return [
    {
      code: 'cvc-elt.2',
      severity: 'error',
      node: context.nodeId,
      anchor: 'element',
      path,
      message:
        members.length === 0
          ? `<${declaration.name.localName}> is abstract, so it cannot be used directly — and the schema declares nothing that can stand in for it.`
          : `<${declaration.name.localName}> is abstract. Use one of the elements that can stand in for it.`,
      technical: `cvc-elt.2: the element declaration ${formatQName(declaration.name)} is abstract.`,
      schemaComponent: declaration.origin,
      fixes: members.map((member) => ({
        title: `Use <${member.localName}> instead`,
        edit: { kind: 'rename-element', node: context.nodeId, name: member },
      })),
    },
  ];
}

// --- 4, 5, 6, 7, 8, 9, 19: attributes -----------------------------------

function diagnoseAttributes(
  model: SchemaModel,
  document: XmlDocument,
  context: ElementContext,
  path: string,
): Diagnostic[] {
  if (context.type.form !== 'complex') return [];
  const out: Diagnostic[] = [];
  const node = document.node(context.nodeId);
  if (node === undefined || !isElement(node)) return [];

  const declared = new Map(context.type.attributes.map((use) => [qnameKey(use.name), use]));

  for (const status of attributeStatuses(document, context)) {
    const use = status.use;

    // 4: required and missing.
    if (use.use === 'required' && !status.present) {
      out.push({
        code: 'cvc-complex-type.4',
        severity: 'error',
        node: context.nodeId,
        anchor: 'attribute',
        attributeName: use.name,
        path,
        message: `<${context.name.localName}> must have ${use.name.localName}.`,
        technical: `cvc-complex-type.4: the attribute use ${formatQName(use.name)} is required.`,
        schemaComponent: use.origin,
        fixes: [
          {
            title: `Add ${use.name.localName}`,
            edit: {
              kind: 'set-attribute',
              node: context.nodeId,
              name: use.name,
              value: prefillFor(use),
            },
            preview: `${use.name.localName}="${prefillFor(use)}"`,
            ...(prefillFor(use) === '' ? {} : { speculative: use.fixedValue === null && use.defaultValue === null }),
          },
        ],
      });
      continue;
    }

    if (!status.present || status.value === null) continue;

    // 19: a fixed value that does not match.
    if (use.fixedValue !== null && status.value !== use.fixedValue) {
      out.push({
        code: 'cvc-attribute.4',
        severity: 'error',
        node: context.nodeId,
        anchor: 'attribute',
        attributeName: use.name,
        path,
        message: `${use.name.localName} must be exactly "${use.fixedValue}".`,
        technical: `cvc-attribute.4: the attribute has a fixed value constraint of "${use.fixedValue}".`,
        schemaComponent: use.origin,
        fixes: [
          {
            title: `Set to "${use.fixedValue}"`,
            edit: { kind: 'set-attribute', node: context.nodeId, name: use.name, value: use.fixedValue },
          },
        ],
      });
      continue;
    }

    // 6, 7, 8, 9: value problems, each with its own coercion.
    for (const problem of status.problems) {
      out.push({
        code: problem.code,
        severity: 'error',
        node: context.nodeId,
        anchor: 'attribute',
        attributeName: use.name,
        path,
        message: `${use.name.localName}: ${problem.message}`,
        technical: `${problem.code} on attribute ${formatQName(use.name)}.`,
        schemaComponent: use.origin,
        fixes: valueFixes(use.type, status.value, (value) => ({
          kind: 'set-attribute',
          node: context.nodeId,
          name: use.name,
          value,
        })),
      });
    }
  }

  // 5: an attribute the type does not allow.
  const wildcard = context.type.anyAttribute;
  for (const attribute of node.attributes) {
    if (attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns') continue;
    const name: XsdQName = {
      namespaceUri: attribute.name.namespaceUri,
      localName: attribute.name.localName,
    };
    // `xsi:*` is always permitted on any element.
    if (name.namespaceUri === 'http://www.w3.org/2001/XMLSchema-instance') continue;
    if (declared.has(qnameKey(name))) continue;
    if (wildcard !== null) continue;

    const suggestion = [...declared.values()]
      .filter((use) => isPlausibleRename(asElementName(use.name), asElementName(name)))
      .sort(
        (a, b) =>
          nameDistance(asElementName(name), asElementName(a.name)) -
          nameDistance(asElementName(name), asElementName(b.name)),
      )[0];

    const fixes: QuickFix[] = [];
    if (suggestion !== undefined) {
      fixes.push({
        title: `Rename to ${suggestion.name.localName}`,
        edit: {
          kind: 'rename-attribute',
          node: context.nodeId,
          from: name,
          to: suggestion.name,
        },
      });
    }
    fixes.push({
      title: `Remove ${attribute.name.localName}`,
      edit: { kind: 'remove-attribute', node: context.nodeId, name },
    });

    out.push({
      code: 'cvc-complex-type.3.2.2',
      severity: 'error',
      node: context.nodeId,
      anchor: 'attribute',
      attributeName: name,
      path,
      message: `<${context.name.localName}> is not allowed to have ${attribute.name.localName}.`,
      technical: `cvc-complex-type.3.2.2: attribute ${formatQName(name)} is not permitted by the type.`,
      fixes,
    });
  }

  return out;
}

function asElementName(name: XsdQName): ElementName {
  return { namespaceUri: name.namespaceUri, localName: name.localName };
}

/** A required attribute's best starting value: fixed, else default, else a sole enumeration. */
function prefillFor(use: AttributeUse): string {
  if (use.fixedValue !== null) return use.fixedValue;
  if (use.defaultValue !== null) return use.defaultValue;
  const enumeration = use.type.facets.enumeration;
  if (enumeration !== null && enumeration.length === 1) return enumeration[0]!;
  return '';
}

// --- 1, 2, 3, 15: children ----------------------------------------------

function diagnoseChildren(
  model: SchemaModel,
  document: XmlDocument,
  context: ElementContext,
  path: string,
): Diagnostic[] {
  if (context.type.form !== 'complex') return [];
  const content = model.contentModel(context.type);
  const childNames = modelChildNames(context);

  if (content.kind === 'empty' && childNames.length > 0) {
    return [
      {
        code: 'cvc-complex-type.2.1',
        severity: 'error',
        node: context.nodeId,
        anchor: 'element',
        path,
        message: `<${context.name.localName}> cannot contain anything.`,
        technical: 'cvc-complex-type.2.1: the type has empty content.',
        fixes: [
          {
            title: 'Remove everything inside it',
            edit: { kind: 'clear-children', node: context.nodeId },
          },
        ],
      },
    ];
  }

  // `xs:all` is not an automaton, so it cannot be aligned — order is meaningless by definition and
  // the only failures are "not a member" and "too many of one". Handled directly rather than being
  // folded into the automaton path, where it would have to pretend order mattered.
  if (content.kind === 'all') {
    return [
      ...diagnoseAllContent(model, context, content.model, path),
      ...missingChildrenDiagnostic(model, context, path),
    ];
  }

  if (content.kind !== 'automaton') return missingChildrenDiagnostic(model, context, path);

  const alignment = alignToModel(content.model, childNames);
  if (alignment === null || alignment.cost === 0) {
    return missingChildrenDiagnostic(model, context, path);
  }

  // Every edit becomes its own diagnostic, anchored where the user can see the problem, plus a
  // single "fix all" that applies the whole alignment as one undoable step.
  const fixAll: QuickFix = {
    title:
      alignment.operations.length === 1
        ? describeEdit(alignment.operations[0]!)
        : `Fix all ${alignment.operations.length} problems here`,
    edit: {
      kind: 'apply-alignment',
      parent: context.nodeId,
      operations: alignment.operations,
    },
  };

  return alignment.operations.map((operation) =>
    diagnosticForEdit(model, context, operation, path, fixAll),
  );
}

function diagnosticForEdit(
  model: SchemaModel,
  context: ElementContext,
  operation: EditOperation,
  path: string,
  fixAll: QuickFix,
): Diagnostic {
  const parent = context.name.localName;
  const target = context.children[operation.index];
  const declaration =
    operation.name === undefined || context.type.form !== 'complex'
      ? null
      : model.elementDeclarationIn(context.type, operation.name);

  const single: QuickFix = {
    title: describeEdit(operation),
    edit: singleEdit(context, operation),
  };
  const fixes = fixAll.edit.kind === 'apply-alignment' &&
    (fixAll.edit.operations.length > 1)
    ? [single, fixAll]
    : [single];

  switch (operation.kind) {
    case 'insert':
      return {
        code: 'cvc-complex-type.2.4.b',
        severity: 'error',
        node: target?.id ?? context.nodeId,
        anchor: 'childGap',
        gapIndex: operation.index,
        path,
        message: `<${parent}> still needs a <${formatElementName(operation.name!)}>${
          target === undefined ? '' : ` before <${target.name.localName}>`
        }.`,
        technical: 'cvc-complex-type.2.4.b: the content is not complete.',
        ...(declaration === null ? {} : { schemaComponent: declaration.origin }),
        fixes,
      };

    case 'delete':
      return {
        code: 'cvc-complex-type.2.4.d',
        severity: 'error',
        node: target?.id ?? context.nodeId,
        anchor: 'element',
        path,
        message: `<${formatElementName(operation.existing!)}> is not allowed inside <${parent}>.`,
        technical: 'cvc-complex-type.2.4.d: no matching particle accepts this element.',
        fixes,
      };

    case 'replace':
      return {
        code: 'cvc-complex-type.2.4.a',
        severity: 'error',
        node: target?.id ?? context.nodeId,
        anchor: 'element',
        path,
        message: `<${parent}> expects <${formatElementName(operation.name!)}> here, not <${formatElementName(operation.existing!)}>.`,
        technical: 'cvc-complex-type.2.4.a: the element does not match the expected particle.',
        ...(declaration === null ? {} : { schemaComponent: declaration.origin }),
        fixes,
      };

    case 'transpose':
      return {
        code: 'cvc-complex-type.2.4.a',
        severity: 'error',
        node: target?.id ?? context.nodeId,
        anchor: 'element',
        path,
        message: `<${formatElementName(operation.existing!)}> and <${formatElementName(operation.name!)}> are the wrong way round.`,
        technical: 'cvc-complex-type.2.4.a: the elements appear in an order the model does not allow.',
        fixes,
      };
  }
}

function singleEdit(context: ElementContext, operation: EditOperation): FixEdit {
  const target = context.children[operation.index];

  switch (operation.kind) {
    case 'insert':
      return {
        kind: 'insert-element',
        parent: context.nodeId,
        index: operation.index,
        name: operation.name!,
      };
    case 'delete':
      return { kind: 'delete-node', node: target?.id ?? context.nodeId };
    case 'replace':
      return { kind: 'rename-element', node: target?.id ?? context.nodeId, name: operation.name! };
    case 'transpose':
      return {
        kind: 'apply-alignment',
        parent: context.nodeId,
        operations: [operation],
      };
  }
}

function diagnoseAllContent(
  model: SchemaModel,
  context: ElementContext,
  all: AllContentModel,
  path: string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const used = new Map<string, number>();

  for (const child of context.children) {
    const member = all.members.find((candidate) => elementNameEquals(candidate.name, child.name));

    if (member === undefined) {
      const admitted = all.wildcards.some((wildcard) =>
        namespaceAllowed(wildcard.namespaceConstraint, child.name.namespaceUri),
      );
      if (admitted) continue;

      const suggestion = all.members
        .filter((candidate) => isPlausibleRename(child.name, candidate.name))
        .sort((a, b) => nameDistance(child.name, a.name) - nameDistance(child.name, b.name))[0];

      out.push({
        code: 'cvc-complex-type.2.4.d',
        severity: 'error',
        node: child.id,
        anchor: 'element',
        path,
        message: `<${child.name.localName}> is not allowed inside <${context.name.localName}>.`,
        technical: 'cvc-complex-type.2.4.d: the element is not a member of the xs:all group.',
        fixes: [
          ...(suggestion === undefined
            ? []
            : [
                {
                  title: `Change to <${suggestion.name.localName}>`,
                  edit: { kind: 'rename-element' as const, node: child.id, name: suggestion.name },
                },
              ]),
          { title: `Remove <${child.name.localName}>`, edit: { kind: 'delete-node', node: child.id } },
        ],
      });
      continue;
    }

    const key = elementNameKey(child.name);
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);

    if (count > member.occurs.max) {
      out.push({
        code: 'cvc-complex-type.2.4.b',
        severity: 'error',
        node: child.id,
        anchor: 'element',
        path,
        message:
          member.occurs.max === 1
            ? `<${context.name.localName}> can only have one <${child.name.localName}>.`
            : `<${context.name.localName}> can have at most ${member.occurs.max} of <${child.name.localName}>.`,
        technical: `cvc-complex-type.2.4.b: the xs:all member allows at most ${member.occurs.max}.`,
        fixes: [
          {
            title: `Remove this <${child.name.localName}>`,
            edit: { kind: 'delete-node', node: child.id },
          },
        ],
      });
    }
  }

  return out;
}

/** The "still needs" case, when nothing is actually wrong — only incomplete. */
function missingChildrenDiagnostic(
  model: SchemaModel,
  context: ElementContext,
  path: string,
): Diagnostic[] {
  const missing = requiredMissing(model, context);
  if (missing.length === 0) return [];

  const plan = insertionPlan(model, context);
  const fixes: QuickFix[] = missing.slice(0, 4).map((name) => {
    const planned = plan.find(
      (candidate) =>
        candidate.name.localName === name.localName &&
        candidate.name.namespaceUri === name.namespaceUri,
    );
    return {
      title: `Add <${name.localName}>`,
      edit: {
        kind: 'insert-element',
        parent: context.nodeId,
        index: planned?.index ?? context.children.length,
        name,
      },
    };
  });

  if (missing.length > 1) {
    fixes.push({
      title: `Add all ${missing.length} missing`,
      edit: {
        kind: 'apply-alignment',
        parent: context.nodeId,
        operations: missing.map((name, offset) => ({
          kind: 'insert' as const,
          index: context.children.length + offset,
          name,
        })),
      },
    });
  }

  return [
    {
      code: 'cvc-complex-type.2.4.b',
      severity: 'error',
      node: context.nodeId,
      anchor: 'element',
      path,
      message: `<${context.name.localName}> still needs ${missing
        .map((name) => `<${name.localName}>`)
        .join(', ')}.`,
      technical: 'cvc-complex-type.2.4.b: the content is not complete.',
      fixes,
    },
  ];
}

// --- 6–9, 12, 15, 19: text ----------------------------------------------

function diagnoseText(
  model: SchemaModel,
  document: XmlDocument,
  context: ElementContext,
  path: string,
): Diagnostic[] {
  const text = textOf(document, context.nodeId);
  const type = textTypeOf(context);

  // 15: text where the content model allows none.
  if (type === null) {
    if (text.trim() === '') return [];
    if (context.type.form !== 'complex') return [];
    if (context.type.contentKind === 'mixed') return [];

    return [
      {
        code: 'cvc-complex-type.2.3',
        severity: 'error',
        node: context.nodeId,
        anchor: 'text',
        path,
        message: `<${context.name.localName}> holds other elements, so it cannot contain text of its own.`,
        technical: 'cvc-complex-type.2.3: element-only content cannot contain character information.',
        fixes: [
          {
            title: 'Remove the text',
            edit: { kind: 'set-text', node: context.nodeId, value: '' },
            preview: text.trim().slice(0, 60),
          },
        ],
      },
    ];
  }

  const declaration = context.declaration;

  // 19: a fixed value on the element.
  if (declaration?.fixedValue != null && applyWhiteSpace(text, type.facets.whiteSpace) !== declaration.fixedValue) {
    return [
      {
        code: 'cvc-elt.5.2.2.2.1',
        severity: 'error',
        node: context.nodeId,
        anchor: 'text',
        path,
        message: `<${context.name.localName}> must be exactly "${declaration.fixedValue}".`,
        technical: `cvc-elt.5.2.2.2.1: the element declaration fixes the value to "${declaration.fixedValue}".`,
        schemaComponent: declaration.origin,
        fixes: [
          {
            title: `Set to "${declaration.fixedValue}"`,
            edit: { kind: 'set-text', node: context.nodeId, value: declaration.fixedValue },
          },
        ],
      },
    ];
  }

  const problems = validateSimpleValue(type, text);
  if (problems.length === 0) return [];

  return problems.map((problem) => ({
    code: problem.code,
    severity: 'error' as const,
    node: context.nodeId,
    anchor: 'text' as const,
    path,
    message: explainValue(context.name.localName, type, problem.message),
    technical: `${problem.code} on the value of ${formatElementName(context.name)}.`,
    ...(declaration === null ? {} : { schemaComponent: declaration.origin }),
    fixes: valueFixes(type, text, (value) => ({
      kind: 'set-text',
      node: context.nodeId,
      value,
    })),
  }));
}

/** Lead with the human name of the thing, then the constraint. */
function explainValue(localName: string, type: CompiledSimpleType, message: string): string {
  const label = humaniseName(localName);
  return `${label}: ${message}`;
}

// --- coercions ----------------------------------------------------------

/**
 * Fixes for a value that breaks its type.
 *
 * Every candidate is re-validated before being offered. A quick fix that leaves the value still
 * invalid is worse than no fix at all — it teaches the user that the button does not work.
 */
function valueFixes(
  type: CompiledSimpleType,
  value: string,
  toEdit: (value: string) => FixEdit,
): QuickFix[] {
  const fixes: QuickFix[] = [];
  const seen = new Set<string>([value]);

  const offer = (candidate: string, title: string, speculative = false): void => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (validateSimpleValue(type, candidate).length > 0) return;
    fixes.push({ title, edit: toEdit(candidate), preview: candidate, ...(speculative ? { speculative } : {}) });
  };

  const trimmed = value.trim();
  offer(trimmed, `Trim to "${trimmed}"`);

  // 7: an enumeration near-miss — case, spacing, or a small typo.
  const enumeration = type.facets.enumeration;
  if (enumeration !== null) {
    const folded = trimmed.toLowerCase();
    const exact = enumeration.find((option) => option.toLowerCase() === folded);
    if (exact !== undefined) offer(exact, `Change to "${exact}"`);

    const nearest = [...enumeration]
      .map((option) => ({ option, distance: nameDistance({ namespaceUri: null, localName: trimmed }, { namespaceUri: null, localName: option }) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest !== undefined && nearest.distance <= 3) {
      offer(nearest.option, `Change to "${nearest.option}"`, true);
    }
  }

  // 8: a pattern near-miss. Uppercasing and stripping separators covers most real cases —
  // reference codes typed in lower case, or with the hyphens the user expected to be optional.
  if (type.facets.patterns.length > 0) {
    offer(trimmed.toUpperCase(), `Change to "${trimmed.toUpperCase()}"`, true);
    const stripped = trimmed.replace(/[\s-]/g, '');
    offer(stripped, `Remove the separators`, true);
    const sample = sampleFor(type.facets.patterns.at(-1)?.alternatives[0]?.source ?? '');
    if (sample !== null && sample !== '') offer(sample, `Use the example "${sample}"`, true);
  }

  // 9: a length facet — truncation, with the result shown so it is never a surprise.
  const maxLength = type.facets.maxLength ?? type.facets.length;
  if (maxLength !== null && [...trimmed].length > maxLength) {
    const truncated = [...trimmed].slice(0, maxLength).join('');
    offer(truncated, `Shorten to "${truncated}"`, true);
  }

  // 6: a numeric value out of range — clamp to the bound it broke.
  for (const bound of [type.facets.minInclusive, type.facets.maxInclusive]) {
    if (bound !== null) offer(bound.lexical, `Change to ${bound.lexical}`, true);
  }

  // 6: an obvious numeric coercion — "12.0" where a whole number is wanted.
  if (type.primitive === 'decimal' && /^[+-]?\d+\.0*$/.test(trimmed)) {
    offer(trimmed.replace(/\.0*$/, ''), 'Drop the decimal part');
  }

  return fixes.slice(0, 4);
}

function textOf(document: XmlDocument, id: NodeId): string {
  let text = '';
  for (const childId of document.childrenOf(id)) {
    const child = document.node(childId);
    if (child?.kind === 'text' || child?.kind === 'cdata') text += child.value;
  }
  return text;
}

/** A one-line "why is this invalid?" for the Inspector, assembled from the type's own constraints. */
export function explainType(type: CompiledSimpleType): string {
  const facets = describeFacets(type);
  return facets === '' ? `It holds ${type.documentation}.` : `It holds ${type.documentation}. ${facets}`;
}

/** Whether a value would be accepted, without producing messages. Used for fix previews. */
export function wouldBeValid(type: CompiledSimpleType, value: string): boolean {
  if (type.primitive !== null && !matchesLexicalSpace(type.primitive, applyWhiteSpace(value, type.facets.whiteSpace))) {
    return false;
  }
  return validateSimpleValue(type, value).length === 0;
}

export type { CompiledElement, CompiledType };
