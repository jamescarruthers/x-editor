import { useState } from 'react';
import { setAttribute, type NodeId, type QName } from '@x-editor/xml-core';
import { checkExpression } from '@x-editor/xsd';
import { store, useEditor } from '../state/store.js';
import { enclosingRule, schematronRole } from '../state/schematron.js';

/**
 * The Schematron half of the Inspector — the live test harness.
 *
 * A Schematron rule is XPath whose effect you cannot see by reading it. Two questions dominate:
 * *does this context match anything?* and *does this assert ever fire?* Neither is answerable
 * without running the rules against a real document, which is why the counts sit right beside the
 * expression rather than in a results panel somewhere else.
 *
 * The whole section is empty and says so when no sample instance is attached, because the honest
 * answer to "how many nodes does this match" without one is "nothing has been tried".
 */
export function SchematronInspector(): React.JSX.Element {
  useEditor();
  const document = store.document;
  const id = store.selected;
  const role = schematronRole(document, id);

  if (role === null) return <></>;

  return (
    <>
      <SampleBanner />
      {role === 'rule' && <RuleSection id={id} />}
      {(role === 'assert' || role === 'report') && <AssertionSection id={id} kind={role} />}
      {role === 'schema' && <SchemaOverview />}
    </>
  );
}

function SampleBanner(): React.JSX.Element {
  const schematron = store.schematron;
  if (schematron.sample !== null) return <></>;

  return (
    <Section title="Sample document">
      <p style={{ color: 'var(--text-tertiary)' }}>
        Attach an XML document to try these rules against. Until then nothing has been run, so there
        are no counts to show.
      </p>
    </Section>
  );
}

function RuleSection({ id }: { id: NodeId }): React.JSX.Element {
  const document = store.document;
  const stats = store.schematron.statisticsForRule(id);
  const context = attributeValue(document, id, 'context') ?? '';
  const namespaces = Object.fromEntries(store.schematron.schema?.namespaces ?? new Map());
  const syntax = context === '' ? null : checkExpression(context, { namespaces });

  return (
    <Section title="Context">
      <ExpressionInput
        value={context}
        onCommit={(value) => commitAttribute(id, 'context', value)}
        error={syntax?.message ?? null}
      />

      {stats === null ? (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          No sample document attached.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-col gap-0.5 text-[12px]">
          <div style={{ color: 'var(--text-secondary)' }}>
            This context matches{' '}
            <strong className="tnum">{stats.matched}</strong>{' '}
            {stats.matched === 1 ? 'node' : 'nodes'}.
          </div>
          {stats.fired !== stats.matched && (
            <div style={{ color: 'var(--text-secondary)' }}>
              It fires on <strong className="tnum">{stats.fired}</strong> of them.
            </div>
          )}
          {stats.shadowedBy !== null && (
            // The single most useful thing this panel says. First-match-wins is per pattern, and a
            // rule that silently never runs is otherwise almost impossible to notice.
            <div
              className="mt-1 rounded px-1.5 py-1"
              style={{ background: 'var(--error-soft)', color: 'var(--error)' }}
            >
              This rule never runs: <strong>{stats.shadowedBy}</strong> claims all its nodes first.
              Only the first matching rule in a pattern fires for each node.
            </div>
          )}
          {stats.matched === 0 && (
            <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Nothing in the sample document matches this context.
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function AssertionSection({
  id,
  kind,
}: {
  id: NodeId;
  kind: 'assert' | 'report';
}): React.JSX.Element {
  const document = store.document;
  const ruleNode = enclosingRule(document, id);
  const test = attributeValue(document, id, 'test') ?? '';
  const namespaces = Object.fromEntries(store.schematron.schema?.namespaces ?? new Map());
  const syntax = test === '' ? null : checkExpression(test, { namespaces });

  const rule = ruleNode === null ? null : store.schematron.statisticsForRule(ruleNode);
  const stats = rule?.assertions.find((entry) => entry.test === test) ?? null;
  const findings = (store.schematron.result?.findings ?? []).filter(
    (finding) => finding.origin === id,
  );

  return (
    <>
      <Section title={kind === 'assert' ? 'Test (must be true)' : 'Test (fires when true)'}>
        <ExpressionInput
          value={test}
          onCommit={(value) => commitAttribute(id, 'test', value)}
          error={syntax?.message ?? null}
        />
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {kind === 'assert'
            ? 'An assert reports a problem when this is false.'
            : 'A report reports a problem when this is true.'}
        </p>

        {stats !== null && (
          <div className="mt-1.5 flex gap-3 text-[12px]">
            <span style={{ color: 'var(--ok)' }}>
              <strong className="tnum">{stats.passed}</strong> passed
            </span>
            <span style={{ color: stats.failed > 0 ? 'var(--error)' : 'var(--text-tertiary)' }}>
              <strong className="tnum">{stats.failed}</strong> failed
            </span>
          </div>
        )}

        {stats?.broken != null && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--error)' }}>
            This expression could not be evaluated: {stats.broken}
          </p>
        )}

        {stats !== null && stats.passed === 0 && stats.failed === 0 && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Never checked — the rule this belongs to did not fire on anything.
          </p>
        )}

        {stats !== null && !stats.hasDiagnostic && (
          // An assert with no diagnostic reads badly wherever it eventually surfaces, and the
          // author is the only person who can fix that.
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            No diagnostic attached. A `sch:diagnostic` gives the reader a "how to fix this".
          </p>
        )}
      </Section>

      {findings.length > 0 && (
        <Section title={`Fires on ${findings.length} ${findings.length === 1 ? 'node' : 'nodes'}`}>
          <ul className="flex flex-col gap-1">
            {findings.slice(0, 10).map((finding, index) => (
              <li key={index} className="text-[12px]">
                {/* The message as the reader will see it, with sch:value-of already resolved —
                    which is the only way to tell whether it actually reads well. */}
                <div style={{ color: 'var(--text-secondary)' }}>{finding.message}</div>
                {finding.diagnostics.map((diagnostic, position) => (
                  <div
                    key={position}
                    className="text-[11px]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {diagnostic}
                  </div>
                ))}
              </li>
            ))}
            {findings.length > 10 && (
              <li className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                …and {findings.length - 10} more
              </li>
            )}
          </ul>
        </Section>
      )}
    </>
  );
}

function SchemaOverview(): React.JSX.Element {
  const schematron = store.schematron;
  const schema = schematron.schema;
  if (schema === null) return <></>;

  const stats = schematron.result?.statistics ?? [];
  const shadowed = stats.filter((entry) => entry.shadowedBy !== null);
  const dead = stats.filter((entry) => entry.matched === 0);

  return (
    <Section title="This schema">
      <div className="flex flex-col gap-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <div>
          {schema.patterns.length} {schema.patterns.length === 1 ? 'pattern' : 'patterns'},{' '}
          {stats.length} {stats.length === 1 ? 'rule' : 'rules'}
        </div>
        {schematron.sample !== null && (
          <>
            <div>{schematron.result?.findings.length ?? 0} findings on the sample document</div>
            {shadowed.length > 0 && (
              <div style={{ color: 'var(--error)' }}>
                {shadowed.length} {shadowed.length === 1 ? 'rule' : 'rules'} never run — shadowed by
                an earlier rule
              </div>
            )}
            {dead.length > 0 && (
              <div style={{ color: 'var(--text-tertiary)' }}>
                {dead.length} {dead.length === 1 ? 'rule matches' : 'rules match'} nothing in the
                sample
              </div>
            )}
          </>
        )}
      </div>

      {schema.namespaces.size > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
            Prefixes
          </div>
          {[...schema.namespaces].map(([prefix, uri]) => (
            <div key={prefix} className="flex gap-2 font-mono text-[11px]">
              <span style={{ color: 'var(--text-secondary)' }}>{prefix}</span>
              <span className="truncate" style={{ color: 'var(--text-tertiary)' }}>
                {uri}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// --- shared bits --------------------------------------------------------

function attributeValue(
  document: typeof store.document,
  id: NodeId,
  name: string,
): string | null {
  const node = document.node(id);
  if (node === undefined || node.kind !== 'element') return null;
  for (const attribute of node.attributes) {
    if (attribute.name.prefix === '' && attribute.name.localName === name) return attribute.value;
  }
  return null;
}

function commitAttribute(id: NodeId, name: string, value: string): void {
  const qname: QName = { prefix: '', localName: name, namespaceUri: null };
  store.run(setAttribute(store.document, id, qname, value));
}

/**
 * An expression field that reports syntax errors as you leave it.
 *
 * Checked rather than merely typed: a Schematron expression that does not parse fails silently at
 * validation time, and finding that out later is the difference between a rule that works and one
 * the author believes works.
 */
function ExpressionInput({
  value,
  onCommit,
  error,
}: {
  value: string;
  onCommit: (value: string) => void;
  error: string | null;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  return (
    <>
      <textarea
        rows={2}
        value={editing ? draft : value}
        onFocus={() => {
          setDraft(value);
          setEditing(true);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onCommit(draft);
        }}
        className="scroll-thin w-full resize-y rounded border px-1.5 py-1 font-mono text-[12px]"
        style={{
          borderColor: error === null ? 'var(--border-default)' : 'var(--error)',
          background: 'var(--surface-0)',
          color: 'var(--text-primary)',
        }}
        spellCheck={false}
      />
      {error !== null && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="border-b px-3 py-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
      <h2
        className="mb-1.5 text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
