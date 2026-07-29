import { useMemo } from 'react';
import {
  attributeStatuses,
  describeAttribute,
  describeElement,
  firstProblemIndex,
  insertionPlan,
  requiredMissing,
  textTypeOf,
  validateDocument,
  validateText,
  widgetFor,
  type AttributeStatus,
  type ElementContext,
  type SchemaModel,
  type Widget,
} from '@x-editor/xsd';
import { setAttribute, setTextValue, type NodeId, type QName } from '@x-editor/xml-core';
import { store, useEditor } from '../state/store.js';
import { applyFix } from '../model/fixes.js';

/**
 * The schema-aware half of the Inspector.
 *
 * Sections appear in the order the UX spec fixes: what is this → attributes (required first) →
 * value → what may go here → problems with this node. The order is the point. A beginner's
 * questions arrive in that sequence, and a panel that answers "what may I add?" above "what even is
 * this?" reads as an expert tool.
 */

export function SchemaIdentity({
  context,
  model,
}: {
  context: ElementContext;
  model: SchemaModel;
}): React.JSX.Element {
  const declaration = context.declaration;
  const description =
    declaration === null
      ? null
      : describeElement(declaration, model.typeOf(declaration));

  return (
    <>
      <Section title="What is this?">
        {description === null ? (
          <p style={{ color: 'var(--text-tertiary)' }}>
            The schema does not declare an element called{' '}
            <span className="font-mono">{context.name.localName}</span> here.
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--text-secondary)' }}>{rich(description.text)}</p>
            {!description.authored && <AutoBadge />}
          </>
        )}
        <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          Type: <span className="font-mono">{context.type.name?.localName ?? 'anonymous'}</span>
          {context.typeOverridden && ' (from xsi:type)'}
        </div>
      </Section>
    </>
  );
}

export function SchemaAttributes({ context }: { context: ElementContext }): React.JSX.Element {
  useEditor();
  const doc = store.document;
  const statuses = attributeStatuses(doc, context);
  if (statuses.length === 0) return <></>;

  const missing = statuses.filter((s) => s.use.use === 'required' && !s.present).length;

  return (
    <Section title={`Attributes (${statuses.length})`}>
      {missing > 0 && (
        <p className="mb-2 text-[11px]" style={{ color: 'var(--error)' }}>
          {missing} required {missing === 1 ? 'attribute is' : 'attributes are'} missing.
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        {statuses.map((status) => (
          <AttributeRow key={status.use.name.localName} status={status} nodeId={context.nodeId} />
        ))}
      </div>
    </Section>
  );
}

function AttributeRow({
  status,
  nodeId,
}: {
  status: AttributeStatus;
  nodeId: NodeId;
}): React.JSX.Element {
  const doc = store.document;
  const description = describeAttribute(status.use);
  const widget = widgetFor(status.use.type);
  const label = status.use.name.localName;

  const commit = (value: string): void => {
    const name: QName = {
      prefix: '',
      localName: label,
      namespaceUri: status.use.name.namespaceUri,
    };
    store.run(setAttribute(doc, nodeId, name, value));
  };

  return (
    <div>
      <div className="mb-0.5 flex items-baseline gap-1.5">
        <label className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
        {status.use.use === 'required' && (
          <span
            className="rounded px-1 text-[10px]"
            style={{
              background: status.present ? 'var(--surface-2)' : 'var(--error-soft)',
              color: status.present ? 'var(--text-tertiary)' : 'var(--error)',
            }}
          >
            required
          </span>
        )}
      </div>

      <WidgetInput
        widget={widget}
        value={status.value ?? ''}
        onCommit={commit}
        placeholder={status.use.defaultValue}
      />

      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        {rich(description.text)}
      </p>

      {status.problems.map((problem) => (
        <p key={problem.code} className="mt-0.5 text-[11px]" style={{ color: 'var(--error)' }}>
          {problem.message}
        </p>
      ))}
    </div>
  );
}

/**
 * The control the type asks for.
 *
 * A closed enumeration renders as radios or a select rather than a text box the user can get wrong,
 * which is the single highest-value thing the schema can do for someone typing a value.
 */
function WidgetInput({
  widget,
  value,
  onCommit,
  placeholder,
}: {
  widget: Widget;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string | null;
}): React.JSX.Element {
  const style = {
    borderColor: 'var(--border-default)',
    background: 'var(--surface-0)',
    color: 'var(--text-primary)',
  } as const;

  switch (widget.kind) {
    case 'radio':
      return (
        <div className="flex flex-wrap gap-1">
          {widget.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onCommit(option)}
              className="rounded border px-1.5 py-0.5 font-mono text-[11px]"
              style={{
                borderColor: option === value ? 'var(--accent)' : 'var(--border-default)',
                background: option === value ? 'var(--accent-soft)' : 'var(--surface-0)',
                color: option === value ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {option}
            </button>
          ))}
        </div>
      );

    case 'select':
      return (
        <select
          value={value}
          onChange={(event) => onCommit(event.target.value)}
          className="w-full rounded border px-1.5 py-1 font-mono text-[12px]"
          style={style}
        >
          <option value="">—</option>
          {widget.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={value === 'true' || value === '1'}
          onChange={(event) => onCommit(event.target.checked ? 'true' : 'false')}
        />
      );

    default:
      return (
        <CommitInput
          value={value}
          onCommit={onCommit}
          placeholder={
            widget.kind === 'text' ? (widget.placeholder ?? placeholder ?? undefined) : (placeholder ?? undefined)
          }
          type={
            widget.kind === 'number'
              ? 'number'
              : widget.kind === 'date'
                ? 'date'
                : widget.kind === 'time'
                  ? 'time'
                  : widget.kind === 'datetime'
                    ? 'datetime-local'
                    : widget.kind === 'url'
                      ? 'url'
                      : 'text'
          }
        />
      );
  }
}

export function SchemaValue({ context }: { context: ElementContext }): React.JSX.Element {
  useEditor();
  const doc = store.document;
  const type = textTypeOf(context);
  if (type === null) return <></>;

  const textNodes = doc
    .childrenOf(context.nodeId)
    .map((id) => doc.node(id))
    .filter((node) => node !== undefined)
    .filter((node) => node.kind === 'text' || node.kind === 'cdata');

  const current = textNodes.map((node) => node.value).join('');
  const problems = validateText(context, current);

  return (
    <Section title="Value">
      <WidgetInput
        widget={widgetFor(type)}
        value={current}
        onCommit={(value) => {
          const first = textNodes[0];
          if (first !== undefined) store.run(setTextValue(doc, first.id, value));
        }}
      />
      {problems.map((problem) => (
        <p key={problem.code} className="mt-1 text-[11px]" style={{ color: 'var(--error)' }}>
          {problem.message}
        </p>
      ))}
      {problems.length === 0 && current !== '' && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--ok)' }}>
          Valid.
        </p>
      )}
    </Section>
  );
}

export function AllowedHere({
  context,
  model,
  onOpenPalette,
}: {
  context: ElementContext;
  model: SchemaModel;
  onOpenPalette: () => void;
}): React.JSX.Element {
  useEditor();
  const plan = insertionPlan(model, context);
  const missing = requiredMissing(model, context);
  const problem = firstProblemIndex(model, context);

  return (
    <Section title="Allowed here">
      {problem !== null && (
        <p className="mb-1.5 text-[11px]" style={{ color: 'var(--error)' }}>
          The children stop matching the schema at position {problem + 1}
          {context.children[problem] !== undefined && (
            <>
              {' '}
              (<span className="font-mono">{context.children[problem]!.name.localName}</span>)
            </>
          )}
          .
        </p>
      )}

      {missing.length > 0 && (
        <p className="mb-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Still needed:{' '}
          {missing.map((name, index) => (
            <span key={`${name.localName}-${index}`}>
              {index > 0 && ', '}
              <span className="font-mono">{name.localName}</span>
            </span>
          ))}
        </p>
      )}

      {plan.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)' }}>
          Nothing may be added inside this element.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {plan.slice(0, 8).map((candidate) => (
            <li key={candidate.name.localName} className="flex items-baseline gap-1.5 text-[12px]">
              <span className="font-mono">{candidate.name.localName}</span>
              <span
                className="tnum rounded px-1 text-[10px]"
                style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
              >
                {candidate.cardinality}
              </span>
              {candidate.group === 'required-missing' && (
                <span className="text-[10px]" style={{ color: 'var(--error)' }}>
                  required
                </span>
              )}
            </li>
          ))}
          {plan.length > 8 && (
            <li className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              …and {plan.length - 8} more
            </li>
          )}
        </ul>
      )}

      <button
        type="button"
        onClick={onOpenPalette}
        className="mt-2 rounded border px-2 py-1 text-[12px]"
        style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
      >
        Insert… <kbd className="ml-1 text-[10px]">Ctrl+Space</kbd>
      </button>
    </Section>
  );
}

/**
 * "Why is this invalid?" — everything wrong with the selected node, and what to do about it.
 *
 * Placed last in the Inspector on purpose. A beginner's questions arrive in order — what is this,
 * what can it hold, what is wrong with it — and answering the third above the first reads as an
 * expert tool. It is also the only section that is empty most of the time, so it stays out of the
 * way until it has something to say.
 */
export function ProblemsWithThisNode({
  context,
  model,
}: {
  context: ElementContext;
  model: SchemaModel;
}): React.JSX.Element {
  useEditor();
  const diagnostics = useMemo(
    () =>
      validateDocument(model, store.document).filter(
        (diagnostic) => diagnostic.node === context.nodeId,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getSnapshot(), context.nodeId, model],
  );

  const verdict = store.verdict.state;
  const engineFindings = verdict.findings.filter((finding) => finding.node === context.nodeId);

  if (diagnostics.length === 0 && engineFindings.length === 0) {
    return (
      <Section title="Problems with this node">
        <p style={{ color: 'var(--text-tertiary)' }}>Nothing wrong here.</p>
      </Section>
    );
  }

  return (
    <Section title={`Problems with this node (${diagnostics.length + engineFindings.length})`}>
      <div className="flex flex-col gap-2.5">
        {diagnostics.map((diagnostic, index) => (
          <div key={`${diagnostic.code}-${index}`}>
            <p style={{ color: 'var(--text-secondary)' }}>{diagnostic.message}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {diagnostic.fixes.map((fix) => (
                <button
                  key={fix.title}
                  type="button"
                  onClick={() => applyFix(fix.edit)}
                  title={fix.preview === undefined ? undefined : `Result: ${fix.preview}`}
                  className="rounded border px-1.5 py-0.5 text-[11px]"
                  style={{
                    borderColor: 'var(--border-default)',
                    background: 'var(--surface-0)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {fix.title}
                  {fix.speculative === true && (
                    <span
                      className="ml-1"
                      style={{ color: 'var(--text-tertiary)' }}
                      title="A guess — check the result"
                    >
                      ?
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        {engineFindings.length > 0 && (
          <div style={{ opacity: verdict.stale ? 0.55 : 1 }}>
            <div className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
              libxml2 says
            </div>
            {engineFindings.map((finding, index) => (
              <p key={index} className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {finding.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

// --- shared bits --------------------------------------------------------

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

function AutoBadge(): React.JSX.Element {
  return (
    <span
      className="mt-1.5 inline-block rounded px-1 text-[11px]"
      style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
      title="Worked out from the schema, not written by its author"
    >
      auto
    </span>
  );
}

/** Descriptions mark the subject with `*asterisks*`; render that as emphasis rather than literally. */
function rich(text: string): React.ReactNode {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, index) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
      <em key={index} className="font-medium not-italic" style={{ color: 'var(--text-primary)' }}>
        {part.slice(1, -1)}
      </em>
    ) : (
      part
    ),
  );
}

function CommitInput({
  value,
  onCommit,
  placeholder,
  type,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string | undefined;
  type: string;
}): React.JSX.Element {
  return (
    <input
      type={type}
      defaultValue={value}
      key={value}
      placeholder={placeholder}
      onBlur={(event) => {
        if (event.target.value !== value) onCommit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="w-full rounded border px-1.5 py-1 font-mono text-[12px]"
      style={{
        borderColor: 'var(--border-default)',
        background: 'var(--surface-0)',
        color: 'var(--text-primary)',
      }}
    />
  );
}
