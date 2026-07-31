import { useState } from 'react';
import {
  isValidName,
  qnameToString,
  removeAttribute,
  renameElement,
  setAttribute,
  setTextValue,
  type NodeId,
  type QName,
} from '@x-editor/xml-core';
import { store, useEditor } from '../state/store.js';
import { describe, humanise } from '../model/describe.js';
import { SchematronInspector } from './SchematronSections.js';
import { XsdInspector } from './XsdSections.js';
import { FlowEditor } from './FlowEditor.js';
import { isSchemaDocument } from '../model/componentTree.js';
import {
  AllowedHere,
  ProblemsWithThisNode,
  SchemaAttributes,
  SchemaIdentity,
  SchemaValue,
  XsiType,
} from './SchemaSections.js';

/**
 * The right panel.
 *
 * More than an attributes grid: it is the *selection inspector*, holding everything about the
 * selected node in one fixed place, which is the property beginners rely on most. Sections are
 * ordered so the question "what even is this?" is answered above the controls that change it.
 */
export function Inspector({
  onOpenPalette,
}: {
  onOpenPalette: () => void;
}): React.JSX.Element {
  useEditor();
  const doc = store.document;
  const id = store.selected;
  const node = doc.node(id);

  if (node === undefined) {
    return <Empty>Nothing selected.</Empty>;
  }

  const model = store.schema.model;
  const context = node.kind === 'element' ? store.contextFor(id) : null;
  const description = describe(doc, id);
  // Schematron mode replaces the attributes-first layout entirely: the document is shallow and all
  // the difficulty is in two attributes, so a generic grid would bury the only thing that matters.
  const schematronMode = store.schematron.active;
  // XSD mode adds to the layout rather than replacing it. An author editing a schema still wants
  // the raw attributes — `minOccurs`, `use`, `fixed` — and the authoring sections sit above them.
  const xsdMode = isSchemaDocument(doc);

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto">
      <header
        className="sticky top-0 z-10 border-b px-3 py-2.5"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
      >
        <div className="flex items-center gap-2">
          {node.kind === 'element' ? (
            <ElementName id={id} name={node.name} />
          ) : (
            <span className="truncate text-[15px] font-semibold">{node.kind}</span>
          )}
        </div>
        {node.kind === 'element' && (
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {humanise(node.name.localName)}
          </div>
        )}
      </header>

      {model !== null && context !== null ? (
        <>
          <SchemaIdentity context={context} model={model} />
          <XsiType context={context} />
        </>
      ) : (
        <Section title="What is this?">
          <p style={{ color: 'var(--text-secondary)' }}>{description.text}</p>
          {description.source !== 'schema' && (
            // Users must always be able to tell a rule from a guess.
            <span
              className="mt-1.5 inline-block rounded px-1 text-[11px]"
              style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}
              title="Worked out from your document, not from a schema"
            >
              auto
            </span>
          )}
        </Section>
      )}

      {xsdMode && <XsdInspector />}

      {/* Above the attribute grid: for a paragraph, the flow *is* the content, and having to scroll
          past six settings to reach it would be the same mistake the tree makes. */}
      {node.kind === 'element' && <FlowEditor id={id} />}

      {/* The schema-driven attributes editor replaces the raw one entirely rather than sitting
          beside it: two attribute lists on one panel is the sort of thing that reads as a bug. */}
      {context !== null && <SchemaAttributes context={context} />}
      {node.kind === 'element' && context === null && <Attributes id={id} />}

      {context !== null && <SchemaValue context={context} />}
      {node.kind === 'element' && context === null && <ValueEditor id={id} />}

      {(node.kind === 'text' || node.kind === 'cdata' || node.kind === 'comment') && (
        <Section title="Content">
          <TextArea
            value={node.value}
            onCommit={(v) => store.run(setTextValue(doc, id, v))}
          />
        </Section>
      )}

      {schematronMode && <SchematronInspector />}

      {model !== null && context !== null && (
        <ProblemsWithThisNode context={context} model={model} />
      )}

      {model !== null && context !== null ? (
        <AllowedHere context={context} model={model} onOpenPalette={onOpenPalette} />
      ) : (
        <Section title="Allowed here">
          <p style={{ color: 'var(--text-tertiary)' }}>
            No schema is attached, so anything is allowed. Attach an XSD to see what belongs here and
            what is missing.
          </p>
        </Section>
      )}
    </div>
  );
}

/**
 * The element's name, editable in place.
 *
 * It reads as a heading and behaves as one until you click it, because that is where everyone looks
 * for the name — and before this the only way to reach `renameElement` was a quick fix the schema
 * offered when it recognised a near-miss. Renaming was therefore possible exactly when the editor
 * thought you had made a typo, and impossible when you had simply changed your mind; the workaround
 * was delete-and-reinsert, which throws the children away.
 *
 * Withheld in a schema, and only there. `xs:complexType` is structure rather than content: nobody
 * means to rename it, and the name an author wants is the `name=` attribute, which the XSD
 * Inspector already edits with reference rewriting behind it. Editing this field instead would
 * silently produce a schema that no longer declares what it used to.
 *
 * A rules file is the opposite case, which is why it is allowed. Turning an `sch:assert` into an
 * `sch:report` — the same test, reported the other way round — is ordinary Schematron authoring,
 * and without this the only route was deleting it and retyping the expression and message.
 *
 * While you type, a name that will not work is shown in red with the reason on the field — that is
 * where the feedback is useful, because it arrives before you commit to it. Committing one anyway
 * reverts to the current name rather than leaving the bad text in place: the field is a statement
 * about what the element *is* called, and the alternative is a heading that disagrees with the
 * document until someone notices.
 */
function ElementName({ id, name }: { id: NodeId; name: QName }): React.JSX.Element {
  const current = qnameToString(name);
  const [draft, setDraft] = useState(current);
  const [editing, setEditing] = useState(false);

  // Only a schema's tag names are structure. In a rules file they are the edit: turning an assert
  // into a report, or a rule into a pattern, is ordinary Schematron authoring, and the alternative
  // was delete-and-rewrite with the expression and message retyped by hand.
  if (store.active === 'xsd') {
    return <span className="truncate text-[15px] font-semibold">{current}</span>;
  }

  const trimmed = draft.trim();
  const scope = store.document.inScopeNamespaces(id);
  const problem = trimmed === current ? null : nameProblem(trimmed, scope);

  const commit = (): void => {
    setEditing(false);
    if (trimmed === current || problem !== null) {
      setDraft(current);
      return;
    }

    const colon = trimmed.indexOf(':');
    const prefix = colon === -1 ? '' : trimmed.slice(0, colon);
    const localName = colon === -1 ? trimmed : trimmed.slice(colon + 1);
    // A prefix means whatever it is bound to *here*, so it resolves against the bindings in scope at
    // this element. `nameProblem` has already refused an unbound one, so this lookup cannot miss.
    const namespaceUri = colon === -1 ? (scope.get('') ?? null) : scope.get(prefix)!;

    store.run(renameElement(store.document, id, { prefix, localName, namespaceUri }));
  };

  return (
    <input
      value={editing ? draft : current}
      onFocus={() => {
        setDraft(current);
        setEditing(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(current);
          setEditing(false);
          event.currentTarget.blur();
        }
      }}
      aria-label="Element name"
      aria-invalid={editing && problem !== null}
      title={editing && problem !== null ? problem : 'Rename this element'}
      spellCheck={false}
      className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold focus:outline-none"
      style={{
        color: editing && problem !== null ? 'var(--error)' : 'var(--text-primary)',
        borderColor: editing && problem !== null ? 'var(--error)' : undefined,
      }}
    />
  );
}

/**
 * Why a typed name cannot be used, or null when it can.
 *
 * Two questions, not one. Well-formedness — would `<name>` parse as one element with that name —
 * and namespaces: a colon is a legal name character, so `x:thing` is a perfectly good XML `Name`
 * while `x` may mean nothing here. Writing an unbound prefix produces a document that no longer
 * parses, so this refuses rather than guessing a namespace, on the same grounds the schema
 * refactorings refuse to invent reference text they cannot write correctly.
 */
export function nameProblem(candidate: string, scope: ReadonlyMap<string, string>): string | null {
  if (candidate === '') return 'A name cannot be empty.';
  if (!isValidName(candidate)) return `"${candidate}" is not a valid XML name.`;

  const colon = candidate.indexOf(':');
  if (colon === -1) return null;

  const prefix = candidate.slice(0, colon);
  const localName = candidate.slice(colon + 1);
  if (localName.includes(':')) return 'A name may have at most one colon in it.';
  if (localName === '') return 'A prefix needs a name after the colon.';
  if (!scope.has(prefix)) {
    return `The prefix "${prefix}" is not declared here, so this name would not parse.`;
  }
  return null;
}

function Attributes({ id }: { id: NodeId }): React.JSX.Element {
  const doc = store.document;
  const node = doc.node(id);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  if (node?.kind !== 'element') return <></>;

  // Namespace declarations are shown separately: they are not really settings on this element, and
  // mixing them into the list is a reliable way to confuse a beginner.
  const nsDecls = node.attributes.filter(
    (a) => a.name.prefix === 'xmlns' || a.name.localName === 'xmlns',
  );
  const attrs = node.attributes.filter(
    (a) => a.name.prefix !== 'xmlns' && a.name.localName !== 'xmlns',
  );

  const commit = (name: QName, value: string): void => {
    store.run(setAttribute(doc, id, name, value));
  };

  return (
    <>
      <Section title={`Attributes${attrs.length > 0 ? ` (${attrs.length})` : ''}`}>
        {attrs.length === 0 && !adding && (
          <p style={{ color: 'var(--text-tertiary)' }}>No attributes.</p>
        )}

        <div className="flex flex-col gap-2">
          {attrs.map((attribute) => {
            const label = qnameToString(attribute.name);
            return (
              <div key={label}>
                <div className="mb-0.5 flex items-baseline justify-between gap-2">
                  <label
                    className="font-mono text-[11px]"
                    style={{ color: 'var(--text-secondary)' }}
                    htmlFor={`attr-${id}-${label}`}
                  >
                    {label}
                  </label>
                  <button
                    type="button"
                    className="text-[11px] hover:underline"
                    style={{ color: 'var(--text-tertiary)' }}
                    onClick={() => store.run(removeAttribute(doc, id, attribute.name))}
                  >
                    remove
                  </button>
                </div>
                <Input
                  id={`attr-${id}-${label}`}
                  value={attribute.value}
                  onCommit={(v) => commit(attribute.name, v)}
                />
              </div>
            );
          })}
        </div>

        {adding ? (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = newName.trim();
              if (trimmed !== '') {
                const colon = trimmed.indexOf(':');
                commit(
                  colon === -1
                    ? { prefix: '', localName: trimmed, namespaceUri: null }
                    : {
                        prefix: trimmed.slice(0, colon),
                        localName: trimmed.slice(colon + 1),
                        namespaceUri: null,
                      },
                  '',
                );
              }
              setNewName('');
              setAdding(false);
            }}
          >
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => setAdding(false)}
              placeholder="attribute name"
              className="min-w-0 flex-1 rounded border px-1.5 py-1 font-mono text-[12px]"
              style={{
                borderColor: 'var(--border-default)',
                background: 'var(--surface-0)',
                color: 'var(--text-primary)',
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 rounded border px-2 py-1 text-[12px]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            + Add attribute
          </button>
        )}
      </Section>

      {nsDecls.length > 0 && (
        <Section title="Namespaces">
          <div className="flex flex-col gap-1">
            {nsDecls.map((a) => (
              <div key={qnameToString(a.name)} className="flex gap-2 text-[12px]">
                <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {a.name.localName === 'xmlns' ? '(default)' : a.name.localName}
                </span>
                <span className="truncate font-mono" style={{ color: 'var(--text-tertiary)' }}>
                  {a.value}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** Edits an element's simple text content, when it has exactly one text child and no elements. */
function ValueEditor({ id }: { id: NodeId }): React.JSX.Element {
  const doc = store.document;
  const children = doc.childrenOf(id);
  const nodes = children.map((c) => doc.node(c)).filter((n) => n !== undefined);

  if (nodes.some((n) => n.kind === 'element')) return <></>;
  const textNodes = nodes.filter((n) => n.kind === 'text' || n.kind === 'cdata');
  if (textNodes.length !== 1) return <></>;
  const textNode = textNodes[0]!;

  return (
    <Section title="Value">
      <Input
        value={textNode.value}
        onCommit={(v) => store.run(setTextValue(doc, textNode.id, v))}
      />
    </Section>
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

/** Commits on blur and on Enter, so a half-typed value never lands in the undo history. */
function Input({
  value,
  onCommit,
  id,
}: {
  value: string;
  onCommit: (value: string) => void;
  id?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  return (
    <input
      id={id}
      value={editing ? draft : value}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
          e.currentTarget.blur();
        }
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

function TextArea({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  return (
    <textarea
      rows={4}
      value={editing ? draft : value}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
      className="scroll-thin w-full resize-y rounded border px-1.5 py-1 font-mono text-[12px]"
      style={{
        borderColor: 'var(--border-default)',
        background: 'var(--surface-0)',
        color: 'var(--text-primary)',
      }}
    />
  );
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="p-3" style={{ color: 'var(--text-tertiary)' }}>
      {children}
    </div>
  );
}
