import { useMemo, useState } from 'react';
import { ROOT_ID, isElement, type NodeId } from '@x-editor/xml-core';
import {
  SchemaModel,
  XSD_NS,
  assembleSchema,
  catalogueFrom,
  describeFacets,
  sampleFor,
  translatePattern,
  validateSimpleValue,
  type CompiledSimpleType,
} from '@x-editor/xsd';
import { store, useEditor } from '../state/store.js';
import {
  attributeValue,
  documentationOf,
  extractType,
  inlineType,
  isGlobalDeclaration,
  isInlineType,
  referencesTo,
  renameComponent,
  resolveReference,
  selfProblems,
  setDocumentation,
  targetNamespaceOf,
  type SelfProblem,
} from '../model/xsdAuthoring.js';

/**
 * The XSD authoring half of the Inspector.
 *
 * A schema author is a different user from a document author, and the thing they most need is
 * feedback on what they have just written — a facet list is inert until you can try a value against
 * it, and a content model is inert until something tells you it is ambiguous.
 *
 * Everything here compiles the document being edited with the same engine that will later check
 * other people's documents against it. An author sees exactly what their readers will get, which is
 * the only way to close the loop without leaving the editor.
 */

/** Compile the schema currently being edited, so the panel reflects unsaved changes. */
function useSelfModel(): SchemaModel | null {
  useEditor();
  const source = store.document.serialize();

  return useMemo(() => {
    try {
      const set = assembleSchema('self.xsd', catalogueFrom({ 'self.xsd': source }));
      return new SchemaModel(set);
    } catch {
      // A half-written schema is the normal state while editing; the panel simply shows less.
      return null;
    }
  }, [source]);
}

export function XsdInspector(): React.JSX.Element {
  useEditor();
  const document = store.document;
  const id = store.selected;
  const model = useSelfModel();

  const node = document.node(id);
  if (node === undefined || !isElement(node) || node.name.namespaceUri !== XSD_NS) return <></>;

  const kind = node.name.localName;
  if (kind === 'schema') return <SchemaHealthSection model={model} />;

  const named = attributeValue(document, id, 'name') !== null;
  const simple = model === null ? null : resolveSimpleType(model, id);
  const here = selfProblems(document, model).filter((problem) => problem.node === id);

  return (
    <>
      {named && <IdentitySection id={id} />}
      {here.length > 0 && <ProblemsSection problems={here} />}
      <RefactorSection id={id} />
      {simple !== null && <FacetsSection type={simple} />}
      {named && <DocumentationSection id={id} />}
    </>
  );
}

/**
 * Extract and inline, offered only where they are safe.
 *
 * Both are one-click here and a careful multi-step edit by hand, which is exactly the asymmetry a
 * refactoring is for. Neither button appears when the operation would break something — inlining a
 * shared type, or extracting under a name already in use — because a refactoring that sometimes
 * corrupts the document is worse than one that is not offered.
 */
function RefactorSection({ id }: { id: NodeId }): React.JSX.Element {
  const document = store.document;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const canExtract = isInlineType(document, id);
  const inline = inlineType(document, id);
  if (!canExtract && inline === null) return <></>;

  return (
    <Section title="Refactor">
      {canExtract &&
        (naming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const command = extractType(document, id, name);
              setNaming(false);
              setName('');
              if (command !== null) store.run(command);
            }}
          >
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setNaming(false)}
              placeholder="new type name"
              className="w-full rounded border px-1.5 py-1 font-mono text-[12px]"
              style={{
                borderColor: 'var(--border-default)',
                background: 'var(--surface-0)',
                color: 'var(--text-primary)',
              }}
              spellCheck={false}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Press Enter to lift this type to the top level and point the declaration at it.
            </p>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="rounded border px-2 py-1 text-[12px]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            >
              Extract to a named type
            </button>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              An anonymous type can only be used once. Naming it is the first step to reusing it.
            </p>
          </>
        ))}

      {inline !== null && (
        <>
          <button
            type="button"
            onClick={() => store.run(inline)}
            className="rounded border px-2 py-1 text-[12px]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Inline this type
          </button>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Nothing else refers to it, so folding it in here loses nothing.
          </p>
        </>
      )}
    </Section>
  );
}

/** The self-check findings that land on the selected component. */
function ProblemsSection({ problems }: { problems: readonly SelfProblem[] }): React.JSX.Element {
  return (
    <Section title="Problems with this">
      <ul className="flex flex-col gap-1.5">
        {problems.map((problem, index) => (
          <li key={index}>
            <div
              className="text-[12px]"
              style={{ color: problem.severity === 'error' ? 'var(--error)' : 'var(--warning)' }}
            >
              {problem.message}
            </div>
            {problem.hint !== null && (
              <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {problem.hint}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * The name, and what points at it.
 *
 * A schema is a graph written as a tree — `type="Address"` is an edge the tree cannot show — so the
 * reference count is the piece of information the outline is structurally incapable of giving. It
 * also makes renaming safe to offer: an author who can see "7 references" before pressing the button
 * knows what the button is about to do.
 */
function IdentitySection({ id }: { id: NodeId }): React.JSX.Element {
  const document = store.document;
  const name = attributeValue(document, id, 'name') ?? '';
  const global = isGlobalDeclaration(document, id);
  const references = global ? referencesTo(document, id) : [];

  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);

  const commit = (): void => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === name) return;
    // A local declaration takes the same path: `renameComponent` finds no references to it, which
    // is the correct answer rather than a special case.
    const command = renameComponent(document, id, trimmed);
    if (command !== null) store.run(command);
  };

  return (
    <Section title="Name">
      <input
        value={editing ? draft : name}
        onFocus={() => {
          setDraft(name);
          setEditing(true);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(name);
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
        className="w-full rounded border px-1.5 py-1 font-mono text-[12px]"
        style={{
          borderColor: 'var(--border-default)',
          background: 'var(--surface-0)',
          color: 'var(--text-primary)',
        }}
        spellCheck={false}
      />

      {global ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {references.length === 0
            ? 'Nothing refers to this yet.'
            : `Renaming updates ${references.length} ${
                references.length === 1 ? 'reference' : 'references'
              } in the same step.`}
        </p>
      ) : (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          This is a local declaration, so nothing outside its parent can refer to it by name.
        </p>
      )}

      {references.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {references.slice(0, 8).map((reference, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => store.select(reference.node)}
                className="text-left font-mono text-[11px] hover:underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                {referenceLabel(reference.node)} @{reference.attribute}
              </button>
            </li>
          ))}
          {references.length > 8 && (
            <li className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              …and {references.length - 8} more
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

function referenceLabel(id: NodeId): string {
  const node = store.document.node(id);
  if (node === undefined || !isElement(node)) return 'reference';
  const name = attributeValue(store.document, id, 'name');
  return name === null ? node.name.localName : `${node.name.localName} ${name}`;
}

/**
 * Facets, and a box to try a value against them.
 *
 * The test box is the feature. A list of facets tells an author what they wrote; typing a value that
 * ought to be legal and watching it fail tells them what they *meant*, which is a different and much
 * more useful thing.
 */
function FacetsSection({ type }: { type: CompiledSimpleType }): React.JSX.Element {
  const [value, setValue] = useState('');
  const problems = value === '' ? [] : validateSimpleValue(type, value);
  const description = describeFacets(type);

  const pattern = type.facets.patterns.at(-1)?.alternatives[0];
  const translated = pattern === undefined ? null : translatePattern(pattern.source);
  const sample = pattern === undefined ? null : sampleFor(pattern.source);

  return (
    <Section title="Type">
      <p style={{ color: 'var(--text-secondary)' }}>
        {type.documentation !== '' && `${type.documentation} `}
        {description}
      </p>

      {pattern !== undefined && (
        <div className="mt-2">
          <div className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
            Pattern
          </div>
          <div className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {pattern.source}
          </div>
          {/* XSD regex is not JavaScript regex — implicitly anchored, with class subtraction and
              different \w and \s. If the translation could not be exact, the author needs to know
              their pattern is being checked loosely rather than not at all. */}
          {translated?.error != null && (
            <p className="text-[11px]" style={{ color: 'var(--error)' }}>
              This pattern could not be read: {translated.error}
            </p>
          )}
          {translated?.approximate === true && translated.error === null && (
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Checked loosely — this pattern uses a Unicode property in a subtraction, which cannot
              be translated exactly here. Values are never wrongly rejected.
            </p>
          )}
          {sample !== null && (
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              A value in this form looks like <span className="font-mono">{sample}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-2">
        <label
          className="text-[10px] uppercase"
          style={{ color: 'var(--text-tertiary)' }}
          htmlFor="facet-test"
        >
          Try a value
        </label>
        <input
          id="facet-test"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={sample ?? 'type a value'}
          className="mt-0.5 w-full rounded border px-1.5 py-1 font-mono text-[12px]"
          style={{
            borderColor:
              value === ''
                ? 'var(--border-default)'
                : problems.length === 0
                  ? 'var(--ok)'
                  : 'var(--error)',
            background: 'var(--surface-0)',
            color: 'var(--text-primary)',
          }}
          spellCheck={false}
        />
        {value !== '' && problems.length === 0 && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ok)' }}>
            Accepted.
          </p>
        )}
        {problems.map((problem) => (
          <p key={problem.code} className="mt-1 text-[11px]" style={{ color: 'var(--error)' }}>
            {problem.message}
          </p>
        ))}
      </div>

      {type.facets.enumeration !== null && type.facets.enumeration.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
            Allowed values ({type.facets.enumeration.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {type.facets.enumeration.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setValue(option)}
                className="rounded border px-1.5 py-0.5 font-mono text-[11px]"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * The documentation card, editable.
 *
 * Writing `xs:documentation` is the highest-leverage thing an XSD author can do for downstream users
 * of this very editor — it is what `describe()` shows first, and the difference between a palette
 * that explains itself and one that guesses from the element name. So the UI nudges it rather than
 * burying it among the other children.
 */
function DocumentationSection({ id }: { id: NodeId }): React.JSX.Element {
  const document = store.document;
  const existing = documentationOf(document, id) ?? '';
  const [draft, setDraft] = useState(existing);
  const [editing, setEditing] = useState(false);

  return (
    <Section title="Documentation">
      <textarea
        rows={3}
        value={editing ? draft : existing}
        onFocus={() => {
          setDraft(existing);
          setEditing(true);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft === existing) return;
          const command = setDocumentation(document, id, draft);
          if (command !== null) store.run(command);
        }}
        placeholder="What is this for? One sentence is plenty."
        className="scroll-thin w-full resize-y rounded border px-1.5 py-1 text-[12px]"
        style={{
          borderColor: 'var(--border-default)',
          background: 'var(--surface-0)',
          color: 'var(--text-primary)',
        }}
      />
      {existing === '' && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          Anything written here is what people see in the Insert palette when they use this schema.
          It is the highest-leverage thing you can add.
        </p>
      )}
    </Section>
  );
}

/**
 * What is wrong with this schema, shown on the schema element itself.
 *
 * Dangling references and ambiguous content models are both invisible in a tree view and both
 * produce a schema that parses. Surfacing them where the author is working — rather than in a build
 * log a week later — is the whole reason this panel exists.
 */
function SchemaHealthSection({ model }: { model: SchemaModel | null }): React.JSX.Element {
  const document = store.document;
  const problems = selfProblems(document, model);
  const namespace = targetNamespaceOf(document);

  return (
    <Section title="This schema">
      <div className="flex flex-col gap-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <div>
          {namespace === null
            ? 'No target namespace — its components are in no namespace.'
            : `Target namespace ${namespace}`}
        </div>
        {model === null && (
          <div style={{ color: 'var(--text-tertiary)' }}>
            This schema does not currently compile, so type-level checks are paused.
          </div>
        )}
      </div>

      {problems.length === 0 ? (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ok)' }}>
          No dangling references or ambiguous content models.
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {problems.slice(0, 20).map((problem, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => store.select(problem.node)}
                className="text-left text-[12px] hover:underline"
                style={{
                  color: problem.severity === 'error' ? 'var(--error)' : 'var(--warning)',
                }}
              >
                {problem.message}
              </button>
              {problem.hint !== null && (
                <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {problem.hint}
                </div>
              )}
            </li>
          ))}
          {problems.length > 20 && (
            <li className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              …and {problems.length - 20} more
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

// --- helpers ------------------------------------------------------------

/** The simple type a `simpleType` element or a typed declaration resolves to. */
function resolveSimpleType(model: SchemaModel, id: NodeId): CompiledSimpleType | null {
  const document = store.document;
  const node = document.node(id);
  if (node === undefined || !isElement(node)) return null;

  const origin = { documentUri: 'self.xsd', node: ROOT_ID };
  const targetNamespace = targetNamespaceOf(document);

  if (node.name.localName === 'simpleType') {
    const name = attributeValue(document, id, 'name');
    if (name === null) return null;
    const type = model.typeByName({ namespaceUri: targetNamespace, localName: name }, origin);
    return type.form === 'simple' ? type : null;
  }

  if (node.name.localName === 'element' || node.name.localName === 'attribute') {
    const typeName = attributeValue(document, id, 'type');
    if (typeName === null) return null;
    const resolved = resolveReference(document, id, typeName);
    if (resolved === null) return null;
    const type = model.typeByName(resolved, origin);
    return type.form === 'simple' ? type : null;
  }

  return null;
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
