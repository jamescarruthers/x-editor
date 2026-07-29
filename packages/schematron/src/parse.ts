/**
 * Schematron documents → an AST.
 *
 * Schematron is a small language, and almost all of it is XPath: the document is
 * `schema > pattern > rule[@context] > assert|report[@test]`, and everything interesting lives in
 * those two attributes. That shallowness is why the *editor* for it can be so much better than a
 * generic tree editor — there is very little structure to get lost in, and the whole difficulty is
 * in the expressions.
 *
 * Targets ISO/IEC 19757-3:2025 (Edition 4). The parser is deliberately forgiving in the same way
 * the XSD one is: a half-written schema still parses, because the Schematron editing mode is driven
 * by the same AST.
 */

import {
  XmlDocument,
  isElement,
  qnameToString,
  type NodeId,
} from '@x-editor/xml-core';

/** Both the current and the 2006 namespace, since real files in the wild still use the old one. */
export const SCH_NS = 'http://purl.oclc.org/dsdl/schematron';
export const SCH_NS_OLD = 'http://www.ascc.net/xml/schematron';

export interface SchOrigin {
  readonly node: NodeId;
}

export interface SchDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly origin: SchOrigin;
}

/** A `sch:let` binding — a named variable available to the expressions below it. */
export interface SchLet {
  readonly origin: SchOrigin;
  readonly name: string;
  /** An XPath expression, or null when the value is given as literal content. */
  readonly value: string | null;
}

/**
 * The text of an assert or report, kept as parts rather than a string.
 *
 * `sch:value-of` interpolates a value from the failing node, which is what makes a Schematron
 * message concrete — "the total is 12, but the lines add up to 15" rather than "the total is
 * wrong". Flattening the message to a string at parse time would throw that away.
 */
export type SchMessagePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value-of'; readonly select: string }
  | { readonly kind: 'name'; readonly path: string | null }
  /** `sch:emph`, `sch:span`, `sch:dir` — presentation, kept flat with their text. */
  | { readonly kind: 'emphasis'; readonly text: string };

export interface SchAssertion {
  readonly origin: SchOrigin;
  /** `assert` fires when the test is false; `report` fires when it is true. */
  readonly kind: 'assert' | 'report';
  readonly id: string | null;
  readonly test: string;
  readonly role: string | null;
  readonly flag: string | null;
  readonly diagnostics: readonly string[];
  readonly message: readonly SchMessagePart[];
}

export interface SchRule {
  readonly origin: SchOrigin;
  readonly id: string | null;
  readonly context: string;
  readonly abstract: boolean;
  readonly extends: readonly string[];
  readonly lets: readonly SchLet[];
  readonly assertions: readonly SchAssertion[];
}

export interface SchPattern {
  readonly origin: SchOrigin;
  readonly id: string | null;
  readonly abstract: boolean;
  /** `sch:pattern is-a="…"` — an instantiation of an abstract pattern. */
  readonly isA: string | null;
  readonly params: ReadonlyMap<string, string>;
  readonly lets: readonly SchLet[];
  readonly rules: readonly SchRule[];
  readonly documentation: string;
}

export interface SchPhase {
  readonly origin: SchOrigin;
  readonly id: string;
  readonly activePatterns: readonly string[];
}

export interface SchDiagnosticText {
  readonly id: string;
  readonly message: readonly SchMessagePart[];
}

export interface SchSchema {
  readonly origin: SchOrigin;
  readonly title: string;
  /** prefix → URI, from `sch:ns`. The only namespace context the expressions have. */
  readonly namespaces: ReadonlyMap<string, string>;
  readonly lets: readonly SchLet[];
  readonly patterns: readonly SchPattern[];
  readonly phases: readonly SchPhase[];
  readonly diagnostics: ReadonlyMap<string, SchDiagnosticText>;
  readonly defaultPhase: string | null;
  readonly queryBinding: string;
}

export interface ParseSchematronResult {
  readonly schema: SchSchema;
  readonly problems: readonly SchDiagnostic[];
  readonly document: XmlDocument;
}

export function parseSchematronSource(source: string): ParseSchematronResult {
  return parseSchematron(XmlDocument.parse(source));
}

export function parseSchematron(document: XmlDocument): ParseSchematronResult {
  const parser = new SchematronParser(document);
  return { schema: parser.parse(), problems: parser.problems, document };
}

class SchematronParser {
  readonly problems: SchDiagnostic[] = [];

  constructor(private readonly doc: XmlDocument) {}

  private error(node: NodeId, code: string, message: string): void {
    this.problems.push({ severity: 'error', code, message, origin: { node } });
  }

  private warn(node: NodeId, code: string, message: string): void {
    this.problems.push({ severity: 'warning', code, message, origin: { node } });
  }

  /** Schematron-namespace children. Both the current namespace and the 2006 one are accepted. */
  private children(id: NodeId): { id: NodeId; name: string }[] {
    const out: { id: NodeId; name: string }[] = [];
    for (const childId of this.doc.childrenOf(id)) {
      const child = this.doc.node(childId);
      if (child === undefined || !isElement(child)) continue;
      if (child.name.namespaceUri !== SCH_NS && child.name.namespaceUri !== SCH_NS_OLD) continue;
      out.push({ id: childId, name: child.name.localName });
    }
    return out;
  }

  private attr(id: NodeId, name: string): string | null {
    const node = this.doc.node(id);
    if (node === undefined || !isElement(node)) return null;
    for (const attribute of node.attributes) {
      if (attribute.name.prefix === '' && attribute.name.localName === name) return attribute.value;
    }
    return null;
  }

  private boolAttr(id: NodeId, name: string): boolean {
    return this.attr(id, name) === 'true';
  }

  private tokens(id: NodeId, name: string): string[] {
    const raw = this.attr(id, name);
    if (raw === null) return [];
    return raw.trim().split(/\s+/).filter((token) => token !== '');
  }

  parse(): SchSchema {
    const rootId = this.doc.documentElement();
    const root = rootId === undefined ? undefined : this.doc.node(rootId);

    if (rootId === undefined || root === undefined || !isElement(root)) {
      this.error(0 as NodeId, 'no-schema', 'This file has no root element.');
      return this.empty(0 as NodeId);
    }
    if (
      (root.name.namespaceUri !== SCH_NS && root.name.namespaceUri !== SCH_NS_OLD) ||
      root.name.localName !== 'schema'
    ) {
      this.error(
        rootId,
        'not-schematron',
        `Expected <sch:schema> at the top level, found <${qnameToString(root.name)}>.`,
      );
      return this.empty(rootId);
    }

    const namespaces = new Map<string, string>();
    const lets: SchLet[] = [];
    const patterns: SchPattern[] = [];
    const phases: SchPhase[] = [];
    const diagnostics = new Map<string, SchDiagnosticText>();
    let title = '';

    for (const child of this.children(rootId)) {
      switch (child.name) {
        case 'ns': {
          const prefix = this.attr(child.id, 'prefix');
          const uri = this.attr(child.id, 'uri');
          if (prefix === null || uri === null) {
            this.error(child.id, 'bad-ns', '<sch:ns> needs both @prefix and @uri.');
          } else {
            namespaces.set(prefix, uri);
          }
          break;
        }
        case 'let':
          lets.push(this.let(child.id));
          break;
        case 'pattern':
          patterns.push(this.pattern(child.id));
          break;
        case 'phase':
          phases.push(this.phase(child.id));
          break;
        case 'diagnostics':
          for (const entry of this.children(child.id)) {
            if (entry.name !== 'diagnostic') continue;
            const id = this.attr(entry.id, 'id');
            if (id === null) {
              this.error(entry.id, 'missing-id', '<sch:diagnostic> needs an @id.');
              continue;
            }
            diagnostics.set(id, { id, message: this.message(entry.id) });
          }
          break;
        case 'title':
          title = this.textOf(child.id).trim();
          break;
        default:
          break;
      }
    }

    // The `xslt2` and `xslt3` bindings are what real files use; `xpath2` is the pure-XPath one.
    // We evaluate XPath 3.1 throughout, which is a superset, so the binding is recorded rather than
    // enforced — except that `xslt` (1.0) has genuinely different semantics worth warning about.
    const queryBinding = (this.attr(rootId, 'queryBinding') ?? 'xslt').toLowerCase();
    if (queryBinding === 'xslt' || queryBinding === 'xpath') {
      this.warn(
        rootId,
        'old-query-binding',
        `This schema uses queryBinding="${queryBinding}" (XPath 1.0). Expressions are evaluated as XPath 3.1, which differs in a few places — notably that "=" on node sets and number formatting behave differently.`,
      );
    }

    return {
      origin: { node: rootId },
      title,
      namespaces,
      lets,
      patterns,
      phases,
      diagnostics,
      defaultPhase: this.attr(rootId, 'defaultPhase'),
      queryBinding,
    };
  }

  private empty(node: NodeId): SchSchema {
    return {
      origin: { node },
      title: '',
      namespaces: new Map(),
      lets: [],
      patterns: [],
      phases: [],
      diagnostics: new Map(),
      defaultPhase: null,
      queryBinding: 'xslt2',
    };
  }

  private let(id: NodeId): SchLet {
    const name = this.attr(id, 'name');
    if (name === null) this.error(id, 'missing-name', '<sch:let> needs a @name.');
    return { origin: { node: id }, name: name ?? '', value: this.attr(id, 'value') };
  }

  private phase(id: NodeId): SchPhase {
    const active: string[] = [];
    for (const child of this.children(id)) {
      if (child.name !== 'active') continue;
      const pattern = this.attr(child.id, 'pattern');
      if (pattern !== null) active.push(pattern);
    }
    return { origin: { node: id }, id: this.attr(id, 'id') ?? '', activePatterns: active };
  }

  private pattern(id: NodeId): SchPattern {
    const lets: SchLet[] = [];
    const rules: SchRule[] = [];
    const params = new Map<string, string>();
    let documentation = '';

    for (const child of this.children(id)) {
      switch (child.name) {
        case 'let':
          lets.push(this.let(child.id));
          break;
        case 'rule':
          rules.push(this.rule(child.id));
          break;
        case 'param': {
          const name = this.attr(child.id, 'name');
          const value = this.attr(child.id, 'value');
          if (name !== null && value !== null) params.set(name, value);
          break;
        }
        case 'title':
        case 'p':
          documentation += `${this.textOf(child.id).trim()} `;
          break;
        default:
          break;
      }
    }

    return {
      origin: { node: id },
      id: this.attr(id, 'id'),
      abstract: this.boolAttr(id, 'abstract'),
      isA: this.attr(id, 'is-a'),
      params,
      lets,
      rules,
      documentation: documentation.trim(),
    };
  }

  private rule(id: NodeId): SchRule {
    const context = this.attr(id, 'context');
    const abstract = this.boolAttr(id, 'abstract');
    if (context === null && !abstract) {
      this.error(id, 'missing-context', '<sch:rule> needs a @context.');
    }

    const lets: SchLet[] = [];
    const assertions: SchAssertion[] = [];
    const extendsIds: string[] = [];

    for (const child of this.children(id)) {
      switch (child.name) {
        case 'let':
          lets.push(this.let(child.id));
          break;
        case 'assert':
        case 'report':
          assertions.push(this.assertion(child.id, child.name));
          break;
        case 'extends': {
          const ruleId = this.attr(child.id, 'rule');
          if (ruleId !== null) extendsIds.push(ruleId);
          break;
        }
        default:
          break;
      }
    }

    return {
      origin: { node: id },
      id: this.attr(id, 'id'),
      context: context ?? '',
      abstract,
      extends: extendsIds,
      lets,
      assertions,
    };
  }

  private assertion(id: NodeId, kind: 'assert' | 'report'): SchAssertion {
    const test = this.attr(id, 'test');
    if (test === null) this.error(id, 'missing-test', `<sch:${kind}> needs a @test.`);

    return {
      origin: { node: id },
      kind,
      id: this.attr(id, 'id'),
      test: test ?? 'true()',
      role: this.attr(id, 'role'),
      flag: this.attr(id, 'flag'),
      diagnostics: this.tokens(id, 'diagnostics'),
      message: this.message(id),
    };
  }

  /** Mixed content, kept as parts so `sch:value-of` can be interpolated against the failing node. */
  private message(id: NodeId): SchMessagePart[] {
    const parts: SchMessagePart[] = [];

    for (const childId of this.doc.childrenOf(id)) {
      const child = this.doc.node(childId);
      if (child === undefined) continue;

      if (child.kind === 'text' || child.kind === 'cdata') {
        parts.push({ kind: 'text', text: child.value });
        continue;
      }
      if (!isElement(child)) continue;
      if (child.name.namespaceUri !== SCH_NS && child.name.namespaceUri !== SCH_NS_OLD) continue;

      switch (child.name.localName) {
        case 'value-of': {
          const select = this.attr(childId, 'select');
          if (select === null) this.error(childId, 'missing-select', '<sch:value-of> needs @select.');
          else parts.push({ kind: 'value-of', select });
          break;
        }
        case 'name':
          parts.push({ kind: 'name', path: this.attr(childId, 'path') });
          break;
        case 'emph':
        case 'span':
        case 'dir':
          parts.push({ kind: 'emphasis', text: this.textOf(childId) });
          break;
        default:
          parts.push({ kind: 'text', text: this.textOf(childId) });
          break;
      }
    }

    return parts;
  }

  private textOf(id: NodeId): string {
    let out = '';
    const visit = (nodeId: NodeId): void => {
      const node = this.doc.node(nodeId);
      if (node === undefined) return;
      if (node.kind === 'text' || node.kind === 'cdata') out += node.value;
      for (const child of this.doc.childrenOf(nodeId)) visit(child);
    };
    visit(id);
    return out;
  }
}

/**
 * Expand `is-a` pattern instantiations against their abstract definitions.
 *
 * An abstract pattern is a template whose expressions contain `$param` placeholders; an `is-a`
 * pattern supplies the values. Expanding here rather than at evaluation time means the interpreter,
 * the fire counts and the shadowing detection all see one flat list of concrete rules — and the
 * editor can show what a pattern actually does rather than what it is templated from.
 */
export function expandPatterns(schema: SchSchema): {
  patterns: SchPattern[];
  problems: SchDiagnostic[];
} {
  const abstracts = new Map<string, SchPattern>();
  for (const pattern of schema.patterns) {
    if (pattern.abstract && pattern.id !== null) abstracts.set(pattern.id, pattern);
  }

  const problems: SchDiagnostic[] = [];
  const out: SchPattern[] = [];

  for (const pattern of schema.patterns) {
    if (pattern.abstract) continue;

    if (pattern.isA === null) {
      out.push(pattern);
      continue;
    }

    const template = abstracts.get(pattern.isA);
    if (template === undefined) {
      problems.push({
        severity: 'error',
        code: 'unknown-abstract-pattern',
        message: `No abstract pattern with id "${pattern.isA}" is defined.`,
        origin: pattern.origin,
      });
      continue;
    }

    out.push({
      ...template,
      origin: pattern.origin,
      id: pattern.id,
      abstract: false,
      isA: pattern.isA,
      rules: template.rules.map((rule) => substituteInRule(rule, pattern.params)),
      lets: template.lets.map((binding) => ({
        ...binding,
        value: binding.value === null ? null : substitute(binding.value, pattern.params),
      })),
    });
  }

  return { patterns: out, problems };
}

function substituteInRule(rule: SchRule, params: ReadonlyMap<string, string>): SchRule {
  return {
    ...rule,
    context: substitute(rule.context, params),
    lets: rule.lets.map((binding) => ({
      ...binding,
      value: binding.value === null ? null : substitute(binding.value, params),
    })),
    assertions: rule.assertions.map((assertion) => ({
      ...assertion,
      test: substitute(assertion.test, params),
      message: assertion.message.map((part) =>
        part.kind === 'value-of' ? { ...part, select: substitute(part.select, params) } : part,
      ),
    })),
  };
}

/**
 * Replace `$name` with the parameter's value.
 *
 * Longest name first, so `$item` does not eat the start of `$itemTotal` — the sort of substitution
 * bug that produces an expression which parses and means something else entirely.
 */
function substitute(expression: string, params: ReadonlyMap<string, string>): string {
  if (params.size === 0) return expression;
  const names = [...params.keys()].sort((a, b) => b.length - a.length);
  let out = expression;
  for (const name of names) {
    out = out.split(`$${name}`).join(params.get(name)!);
  }
  return out;
}
