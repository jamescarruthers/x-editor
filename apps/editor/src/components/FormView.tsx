import { useState } from 'react';
import {
  insertText,
  removeNode,
  setAttribute,
  setTextValue,
  type NodeId,
  type QName,
} from '@x-editor/xml-core';
import {
  attributeStatuses,
  describeAttribute,
  describeElement,
  humaniseName,
  textTypeOf,
  validateText,
  widgetFor,
  type AttributeStatus,
  type ElementContext,
  type SchemaModel,
} from '@x-editor/xsd';
import { store, useEditor } from '../state/store.js';
import { WidgetInput } from './SchemaSections.js';
import { buildInsertCommands } from '../model/insert.js';
import { compose } from '../model/insert.js';

/**
 * Form view — the same model, rendered as a form.
 *
 * The tree teaches XML; the form gets the work done. Someone filling in the fortieth purchase order
 * of the week does not need to be taught that elements nest, and making them navigate a tree to
 * type six values is a tax. So this is a lens over the same document, not a mode with its own state:
 * every control dispatches exactly the commands the tree does, against the same node ids, and undo
 * does not notice which view produced an edit.
 *
 * There is deliberately no form library. The XML model is the single source of truth, and a
 * controlled-form abstraction would introduce a second one — the project would then be spent
 * reconciling them, which is the failure mode this whole codebase is arranged to avoid.
 */
export function FormView({ rootId }: { rootId: NodeId }): React.JSX.Element {
  useEditor();
  const model = store.schema.model;
  const context = store.contextFor(rootId);

  if (model === null || context === null) {
    return (
      <div className="p-4 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
        A form is built from the schema, so there is nothing to build one from yet. Attach an XSD and
        this becomes a labelled form over the same document.
      </div>
    );
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto px-4 py-3">
      <FormNode context={context} model={model} depth={0} />
    </div>
  );
}

function FormNode({
  context,
  model,
  depth,
}: {
  context: ElementContext;
  model: SchemaModel;
  depth: number;
}): React.JSX.Element {
  const document = store.document;
  const type = context.type;

  // Mixed content is not form-renderable and pretending otherwise produces a control that silently
  // eats the markup between the text runs.
  if (type.form === 'complex' && type.contentKind === 'mixed') {
    return (
      <Field label={label(context, model)} hint={hint(context, model)} required={false}>
        <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          This element mixes text and elements — edit it in the tree.
        </p>
      </Field>
    );
  }

  const attributes = attributeStatuses(document, context);
  const valueType = textTypeOf(context);
  const groups = childGroups(context);

  return (
    <>
      {valueType !== null && <ValueField context={context} model={model} />}

      {attributes.length > 0 && (
        // A visually distinct subsection rather than mixed in with the elements: the
        // element/attribute distinction is a real thing about XML, and a form that hides it teaches
        // someone a model that breaks the first time they look at the source.
        <fieldset
          className="mb-3 rounded border px-3 py-2"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
        >
          <legend className="px-1 text-[11px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
            Settings
          </legend>
          {attributes.map((status) => (
            <AttributeField
              key={status.use.name.localName}
              status={status}
              nodeId={context.nodeId}
            />
          ))}
        </fieldset>
      )}

      {groups.map((group) => (
        <ChildGroup
          key={group.key}
          group={group}
          parent={context}
          model={model}
          depth={depth}
        />
      ))}
    </>
  );
}

// --- fields -------------------------------------------------------------

function ValueField({
  context,
  model,
}: {
  context: ElementContext;
  model: SchemaModel;
}): React.JSX.Element {
  const document = store.document;
  const type = textTypeOf(context);
  if (type === null) return <></>;

  const textNodes = document
    .childrenOf(context.nodeId)
    .map((id) => document.node(id))
    .filter((node) => node !== undefined)
    .filter((node) => node.kind === 'text' || node.kind === 'cdata');

  const current = textNodes.map((node) => node.value).join('');
  const problems = validateText(context, current);

  return (
    <Field
      label={label(context, model)}
      hint={hint(context, model)}
      required={context.declaration?.occurs.min !== 0}
      problems={problems.map((problem) => problem.message)}
    >
      <WidgetInput
        widget={widgetFor(type)}
        value={current}
        onCommit={(value) => {
          const first = textNodes[0];
          if (first !== undefined) {
            store.run(setTextValue(document, first.id, value));
          } else {
            // No text child yet — the scaffolder emits `<note/>` for an unfaceted string, and
            // typing into its field has to create the node rather than silently do nothing.
            store.run(insertText(document, context.nodeId, 0, value));
          }
        }}
      />
    </Field>
  );
}

function AttributeField({
  status,
  nodeId,
}: {
  status: AttributeStatus;
  nodeId: NodeId;
}): React.JSX.Element {
  const description = describeAttribute(status.use);
  const name: QName = {
    prefix: '',
    localName: status.use.name.localName,
    namespaceUri: status.use.name.namespaceUri,
  };

  return (
    <Field
      label={humaniseName(status.use.name.localName)}
      hint={description.text}
      required={status.use.use === 'required'}
      problems={status.problems.map((problem) => problem.message)}
    >
      <WidgetInput
        widget={widgetFor(status.use.type)}
        value={status.value ?? ''}
        onCommit={(value) => store.run(setAttribute(store.document, nodeId, name, value))}
      />
    </Field>
  );
}

/**
 * A group of same-named children, with Add and Remove.
 *
 * The repeat count is shown against its bounds — *2 of 1–10* — because "how many of these am I
 * allowed?" is a question the tree answers only by trying and being told no.
 */
function ChildGroup({
  group,
  parent,
  model,
  depth,
}: {
  group: ChildGroupSpec;
  parent: ElementContext;
  model: SchemaModel;
  depth: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const document = store.document;

  const declaration =
    parent.type.form === 'complex'
      ? model.elementDeclarationIn(parent.type, group.name)
      : null;
  const min = declaration?.occurs.min ?? 0;
  const max = declaration?.occurs.max ?? 1;
  const bounded = max === Number.MAX_SAFE_INTEGER || max > 1_000_000;
  const range = min === max ? `${min}` : `${min}–${bounded ? 'many' : max}`;

  const add = (): void => {
    const index = parent.children.length;
    const commands = buildInsertCommands(document, parent.nodeId, index, group.name);
    const command = compose(`Added <${group.name.localName}>`, commands);
    if (command !== null) store.run(command);
  };

  const repeats = group.ids.length > 1 || max > 1;

  return (
    <fieldset
      className="mb-3 rounded border px-3 py-2"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <legend className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-[12px] font-semibold"
        >
          {open ? '▾' : '▸'} {humaniseName(group.name.localName)}
        </button>
        {repeats && (
          <span className="tnum text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {group.ids.length} of {range}
          </span>
        )}
      </legend>

      {open &&
        group.ids.map((id, index) => {
          const context = store.contextFor(id);
          if (context === null) return null;
          return (
            <div key={id} className="mb-2 border-l pl-3" style={{ borderColor: 'var(--border-subtle)' }}>
              {repeats && (
                <div className="mb-1 flex items-center gap-2">
                  <span className="tnum text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    disabled={group.ids.length <= min}
                    onClick={() => store.run(removeNode(document, id))}
                    className="text-[11px] hover:underline disabled:opacity-40"
                    style={{ color: 'var(--text-tertiary)' }}
                    title={
                      group.ids.length <= min
                        ? `The schema requires at least ${min}`
                        : 'Remove this one'
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
              <FormNode context={context} model={model} depth={depth + 1} />
            </div>
          );
        })}

      {open && (max > group.ids.length || group.ids.length === 0) && (
        <button
          type="button"
          onClick={add}
          className="rounded border px-2 py-0.5 text-[11px]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          + Add {humaniseName(group.name.localName).toLowerCase()}
        </button>
      )}
    </fieldset>
  );
}

// --- plumbing -----------------------------------------------------------

interface ChildGroupSpec {
  readonly key: string;
  readonly name: { namespaceUri: string | null; localName: string };
  readonly ids: NodeId[];
}

/**
 * Group children by name, keeping the order they first appear in.
 *
 * Grouping by name rather than by position is what turns twelve `<item>` rows into one repeatable
 * field group. It is only wrong for a model that genuinely interleaves two names, which a form is
 * the wrong view for anyway — and the tree is one keystroke away.
 */
function childGroups(context: ElementContext): ChildGroupSpec[] {
  const groups = new Map<string, ChildGroupSpec>();
  for (const child of context.children) {
    const key = `${child.name.namespaceUri ?? ''}|${child.name.localName}`;
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { key, name: child.name, ids: [child.id] });
    else existing.ids.push(child.id);
  }
  return [...groups.values()];
}

function label(context: ElementContext, model: SchemaModel): string {
  const declaration = context.declaration;
  if (declaration === null) return humaniseName(context.name.localName);
  const description = describeElement(declaration, model.typeOf(declaration));
  // The first sentence of the documentation is the label; the rest is the hint. An author who wrote
  // a paragraph gets a usable field name out of it rather than a paragraph in a <label>.
  if (description.authored) {
    const stop = description.text.indexOf('. ');
    if (stop > 0 && stop < 60) return description.text.slice(0, stop);
  }
  return humaniseName(context.name.localName);
}

function hint(context: ElementContext, model: SchemaModel): string {
  const declaration = context.declaration;
  if (declaration === null) return '';
  const description = describeElement(declaration, model.typeOf(declaration));
  if (!description.authored) return description.text.replace(/\*/g, '');
  const stop = description.text.indexOf('. ');
  return stop > 0 && stop < 60 ? description.text.slice(stop + 2) : description.text;
}

function Field({
  label,
  hint,
  required,
  problems = [],
  children,
}: {
  label: string;
  hint: string;
  required: boolean;
  problems?: readonly string[];
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-2.5">
      <div className="mb-0.5 flex items-baseline gap-1.5">
        <span className="text-[12px] font-medium">{label}</span>
        {required && (
          // The asterisk *and* the word: an asterisk alone is a convention people have to already
          // know, and it is invisible to a screen reader without the word beside it.
          <span className="text-[11px]" style={{ color: 'var(--error)' }}>
            * required
          </span>
        )}
      </div>
      {hint !== '' && (
        <div className="mb-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </div>
      )}
      {children}
      {problems.map((problem) => (
        <div key={problem} className="mt-0.5 text-[11px]" style={{ color: 'var(--error)' }}>
          {problem}
        </div>
      ))}
    </div>
  );
}
