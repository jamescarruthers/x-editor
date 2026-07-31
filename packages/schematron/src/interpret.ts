/**
 * The Schematron interpreter.
 *
 * Classical Schematron compiles to XSLT and runs that. **Chrome removes XSLT entirely in v158
 * (17 November 2026)**, with Firefox and WebKit signalling they will follow, so that route has a
 * hard expiry date; and the one remaining browser XSLT 3.0 engine, SaxonJS 2, is free of charge but
 * proprietary. So this evaluates the rules directly over `fontoxpath`, against our own CST.
 *
 * That is better rather than merely safer, on four counts the plan sets out:
 *
 * 1. No XSLT engine at all, so nothing breaks in November.
 * 2. fontoxpath is a mandatory dependency regardless — XSD 1.1 assertions and the live XPath editor
 *    both need it — so the interpreter's marginal cost is roughly one module.
 * 3. **Findings bind to nodes by identity.** We hold the actual node when an assert fails. The SVRL
 *    route hands back a `@location` XPath string that then has to be resolved back onto the tree.
 * 4. Per-rule statistics become possible — fire counts, shadowing detection, per-assertion pass and
 *    fail lists — which is impossible through a compiled SVRL pipeline, and is the single best
 *    beginner feature in the Schematron editor.
 *
 * Safety comes almost free: fontoxpath does not implement `fn:doc()` and has no filesystem or
 * network access. The `doc()` our XPath layer registers resolves only against documents the caller
 * passes in — the open workspace, nothing else — so a malicious `.sch` is still *not* arbitrary
 * code execution against a confidential document, which is what it is under the XSLT route: a rule
 * can read exactly the files the user already opened, and nothing reachable from a rule touches
 * the disk or the network.
 */

import { ROOT_ID, isElement, qnameToString, type NodeId, type XmlDocument } from '@x-editor/xml-core';
import { evaluateBoolean, evaluateNodes, evaluateString, xpathReady } from '@x-editor/xsd';
import {
  expandPatterns,
  type SchAssertion,
  type SchDiagnostic,
  type SchLet,
  type SchMessagePart,
  type SchPattern,
  type SchRule,
  type SchSchema,
} from './parse.js';

export interface SchematronFinding {
  readonly kind: 'assert' | 'report';
  /** The node the rule fired on — held by identity, not resolved from a location string. */
  readonly node: NodeId;
  readonly attribute?: number;
  readonly patternId: string | null;
  readonly ruleId: string | null;
  readonly assertionId: string | null;
  /** `@role` — the author's own severity. Not interpreted, only surfaced. */
  readonly role: string | null;
  readonly flag: string | null;
  readonly test: string;
  /** The author's message, with `sch:value-of` resolved against the failing node. */
  readonly message: string;
  /** `sch:diagnostic` text — the "how to fix this" the author wrote. */
  readonly diagnostics: readonly string[];
  readonly origin: NodeId;
}

/**
 * What a rule actually did.
 *
 * The fire count is what turns Schematron from a black box into something a beginner can iterate
 * on: "this rule matched 14 nodes" answers the question they actually have, and "this rule never
 * fires because that one claims its context first" answers the one they do not yet know to ask.
 */
export interface RuleStatistics {
  readonly patternId: string | null;
  readonly ruleId: string | null;
  readonly context: string;
  readonly origin: NodeId;
  /** Nodes the context selected, before first-match-wins was applied. */
  readonly matched: number;
  /** Nodes this rule actually fired on. */
  readonly fired: number;
  /**
   * Set when every node this rule matches was already claimed by an earlier rule in the same
   * pattern. First-match-wins is the Schematron semantic beginners trip over most, and a rule that
   * silently never runs is the worst way to find out about it.
   */
  readonly shadowedBy: string | null;
  /** Per-assertion counts, so the editor can show which checks are doing any work. */
  readonly assertions: readonly AssertionStatistics[];
}

export interface AssertionStatistics {
  readonly assertionId: string | null;
  readonly test: string;
  readonly kind: 'assert' | 'report';
  readonly passed: number;
  readonly failed: number;
  /** True when the expression itself is broken — the author's problem, not the document's. */
  readonly broken: string | null;
  /** An assert with no diagnostic reads badly downstream; the authoring UI flags it. */
  readonly hasDiagnostic: boolean;
}

export interface SchematronResult {
  readonly findings: readonly SchematronFinding[];
  readonly statistics: readonly RuleStatistics[];
  readonly problems: readonly SchDiagnostic[];
}

export interface RunOptions {
  /** Restrict to the patterns a phase activates. Defaults to the schema's `defaultPhase`. */
  readonly phase?: string;
  /**
   * What `doc()` / `document()` in a rule may reach, by file name — the open workspace. A rule uses
   * it inside a `test=` to look a value up in another open document; the assertion still fires on a
   * node of the document being validated. Left unset, `doc()` fails loudly.
   */
  readonly documents?: ReadonlyMap<string, XmlDocument>;
}

const EMPTY: SchematronResult = { findings: [], statistics: [], problems: [] };

export function runSchematron(
  schema: SchSchema,
  document: XmlDocument,
  options: RunOptions = {},
): SchematronResult {
  if (!xpathReady()) {
    return {
      ...EMPTY,
      problems: [
        {
          severity: 'warning',
          code: 'xpath-not-loaded',
          message: 'The XPath engine has not finished loading, so no rules have run yet.',
          origin: schema.origin,
        },
      ],
    };
  }

  const expansion = expandPatterns(schema);
  const problems: SchDiagnostic[] = [...expansion.problems];
  const findings: SchematronFinding[] = [];
  const statistics: RuleStatistics[] = [];

  const namespaces = Object.fromEntries(schema.namespaces);
  const active = activePatterns(schema, expansion.patterns, options.phase);

  const order = documentOrder(document);

  for (const pattern of active) {
    const rules = pattern.rules.filter((rule) => !rule.abstract);
    const matches = rules.map((rule) =>
      selectContext(document, rule, namespaces, problems, options.documents),
    );

    // First-match-wins is per pattern, not per schema: a node claimed by a rule in one pattern is
    // still available to rules in the next. Getting this wrong makes half a schema silently inert.
    const claimed = new Map<string, { ruleIndex: number; target: NodeRef }>();
    for (let index = 0; index < rules.length; index++) {
      for (const target of matches[index]!) {
        const key = `${target.node}:${target.attribute ?? ''}`;
        if (claimed.has(key)) continue;
        claimed.set(key, { ruleIndex: index, target });
      }
    }

    // Findings come out in *document* order, not rule order. The two differ whenever a later rule
    // claims an earlier node, and document order is what a Problems panel has to show — a list that
    // jumps around the file because of how the schema happens to be written is unreadable. The
    // differential harness caught this: the ISO reference walks the document, we walked the rules.
    const claims = [...claimed.values()].sort(
      (a, b) => positionOf(order, a.target) - positionOf(order, b.target),
    );

    const inheritedLets = [...schema.lets, ...pattern.lets];
    const stats = rules.map(() => new Map<SchAssertion, AssertionCounts>());
    for (let index = 0; index < rules.length; index++) {
      for (const assertion of rules[index]!.assertions) {
        stats[index]!.set(assertion, { passed: 0, failed: 0, broken: null });
      }
    }

    for (const claim of claims) {
      const rule = rules[claim.ruleIndex]!;
      const target = claim.target;
      const variables = bindLets(
        document,
        target.node,
        [...inheritedLets, ...rule.lets],
        namespaces,
        options.documents,
      );

      for (const assertion of rule.assertions) {
        const counts = stats[claim.ruleIndex]!.get(assertion)!;
        const outcome = evaluateBoolean(document, target.node, assertion.test, {
          namespaces,
          variables,
          documents: options.documents,
        });

        if (!outcome.ok) {
          counts.broken ??= outcome.error.message;
          continue;
        }

        // An `assert` fires when its test is FALSE; a `report` fires when it is TRUE. Getting this
        // the wrong way round inverts a whole schema, silently.
        const fires = assertion.kind === 'assert' ? !outcome.value : outcome.value;
        if (!fires) {
          counts.passed++;
          continue;
        }
        counts.failed++;

        findings.push({
          kind: assertion.kind,
          node: target.node,
          ...(target.attribute === undefined ? {} : { attribute: target.attribute }),
          patternId: pattern.id,
          ruleId: rule.id,
          assertionId: assertion.id,
          role: assertion.role,
          flag: assertion.flag,
          test: assertion.test,
          message: renderMessage(
            document,
            target.node,
            assertion.message,
            namespaces,
            variables,
            options.documents,
          ),
          diagnostics: assertion.diagnostics
            .map((id) => schema.diagnostics.get(id))
            .filter((entry) => entry !== undefined)
            .map((entry) =>
              renderMessage(document, target.node, entry.message, namespaces, variables, options.documents),
            ),
          origin: assertion.origin.node,
        });
      }
    }

    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index]!;
      const fired = claims.filter((claim) => claim.ruleIndex === index).length;
      statistics.push({
        patternId: pattern.id,
        ruleId: rule.id,
        context: rule.context,
        origin: rule.origin.node,
        matched: matches[index]!.length,
        fired,
        shadowedBy: matches[index]!.length > 0 && fired === 0 ? shadowingRule(rules, index) : null,
        assertions: rule.assertions.map((assertion) => {
          const counts = stats[index]!.get(assertion)!;
          return {
            assertionId: assertion.id,
            test: assertion.test,
            kind: assertion.kind,
            passed: counts.passed,
            failed: counts.failed,
            broken: counts.broken,
            hasDiagnostic: assertion.diagnostics.length > 0,
          };
        }),
      });
    }
  }

  return { findings, statistics, problems };
}

function activePatterns(
  schema: SchSchema,
  patterns: readonly SchPattern[],
  requested: string | undefined,
): SchPattern[] {
  const phaseId = requested ?? schema.defaultPhase;
  if (phaseId === null || phaseId === undefined || phaseId === '#ALL') return [...patterns];

  const phase = schema.phases.find((candidate) => candidate.id === phaseId);
  if (phase === undefined) return [...patterns];

  const active = new Set(phase.activePatterns);
  return patterns.filter((pattern) => pattern.id !== null && active.has(pattern.id));
}

/**
 * The nodes a rule's `@context` matches.
 *
 * `@context` is an XSLT *match pattern*, not a path: `line` means "any element called line
 * anywhere", not "a line child of the root". The standard translation to a selection is to walk
 * every node and apply the pattern relatively — `descendant-or-self::node()/(pattern)` — and the
 * parentheses matter, because without them a union pattern like `a|b` would parse as
 * `(//a) | (b)` and quietly select the wrong thing.
 */
function selectContext(
  document: XmlDocument,
  rule: SchRule,
  namespaces: Readonly<Record<string, string>>,
  problems: SchDiagnostic[],
  documents: ReadonlyMap<string, XmlDocument> | undefined,
): { node: NodeId; attribute?: number }[] {
  if (rule.context.trim() === '') return [];

  const expression = rule.context.trimStart().startsWith('/')
    ? rule.context
    : `descendant-or-self::node()/(${rule.context})`;

  const outcome = evaluateNodes(document, ROOT_ID, expression, { namespaces, documents });
  if (!outcome.ok) {
    problems.push({
      severity: 'error',
      code: 'bad-context',
      message: `The context "${rule.context}" is not a valid expression: ${outcome.error.message}`,
      origin: rule.origin,
    });
    return [];
  }
  // Findings stay bound to the instance. A context that reaches into another open document through
  // doc() selects nodes this run cannot attribute — a finding on codes.xml pinned to whatever node
  // shares that id in the instance would be the silent misbinding this feature was staged to avoid.
  return outcome.value.filter((ref) => ref.documentName === undefined);
}

interface NodeRef {
  readonly node: NodeId;
  readonly attribute?: number;
}

interface AssertionCounts {
  passed: number;
  failed: number;
  broken: string | null;
}

/**
 * Pre-order position of every node, so findings can be sorted the way a reader sees them.
 *
 * Node ids are minted in parse order, which matches document order for a freshly parsed file and
 * stops matching it the moment anything is inserted — so sorting by id would be right in tests and
 * wrong in the editor, which is the worst combination.
 */
function documentOrder(document: XmlDocument): Map<NodeId, number> {
  const order = new Map<NodeId, number>();
  let position = 0;
  const visit = (id: NodeId): void => {
    order.set(id, position++);
    for (const child of document.childrenOf(id)) visit(child);
  };
  visit(ROOT_ID);
  return order;
}

function positionOf(order: Map<NodeId, number>, target: NodeRef): number {
  const base = order.get(target.node) ?? Number.MAX_SAFE_INTEGER;
  // An attribute sorts immediately after its element, in the order it was written.
  return base * 1000 + (target.attribute ?? 0);
}

/** Which earlier rule in the pattern claimed everything this one matches. */
function shadowingRule(rules: readonly SchRule[], index: number): string {
  const last = rules[index - 1];
  if (last === undefined) return 'an earlier rule';
  return last.id ?? `the rule matching "${last.context}"`;
}

function bindLets(
  document: XmlDocument,
  context: NodeId,
  lets: readonly SchLet[],
  namespaces: Readonly<Record<string, string>>,
  documents: ReadonlyMap<string, XmlDocument> | undefined,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  for (const binding of lets) {
    if (binding.name === '' || binding.value === null) continue;
    const outcome = evaluateString(document, context, binding.value, {
      namespaces,
      variables,
      documents,
    });
    // A broken `let` is the author's problem; leaving the variable unbound produces a clearer
    // downstream error than substituting a wrong value would.
    if (outcome.ok) variables[binding.name] = outcome.value;
  }
  return variables;
}

/**
 * The author's message, with `sch:value-of` resolved.
 *
 * This is why Schematron messages read better than anything a validator can synthesise: they are
 * written by someone who knows the domain, and they can quote the actual offending value.
 */
export function renderMessage(
  document: XmlDocument,
  context: NodeId,
  parts: readonly SchMessagePart[],
  namespaces: Readonly<Record<string, string>>,
  variables: Record<string, unknown> = {},
  documents?: ReadonlyMap<string, XmlDocument>,
): string {
  let out = '';

  for (const part of parts) {
    switch (part.kind) {
      case 'text':
      case 'emphasis':
        out += part.text;
        break;
      case 'value-of': {
        const outcome = evaluateString(document, context, part.select, {
          namespaces,
          variables,
          documents,
        });
        out += outcome.ok ? outcome.value : `[${part.select}?]`;
        break;
      }
      case 'name': {
        if (part.path === null) {
          const node = document.node(context);
          out += node !== undefined && isElement(node) ? qnameToString(node.name) : '';
        } else {
          const outcome = evaluateNodes(document, context, part.path, {
            namespaces,
            variables,
            documents,
          });
          // A ref naming another document must not be looked up in this one — same id, different
          // node — so a name path landing in doc() output renders as nothing rather than as the
          // instance node that happens to share the id.
          const first = outcome.ok
            ? outcome.value.find((ref) => ref.documentName === undefined)
            : undefined;
          const node = first === undefined ? undefined : document.node(first.node);
          out += node !== undefined && isElement(node) ? qnameToString(node.name) : '';
        }
        break;
      }
    }
  }

  // Schematron messages are written as mixed content across several lines of the schema, so the
  // source indentation would otherwise land in the user's message.
  return out.replace(/\s+/g, ' ').trim();
}
