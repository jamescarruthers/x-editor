import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { insertElement, removeNode, ROOT_ID } from '@x-editor/xml-core';
import { store, useEditor } from './state/store.js';
import { Tree } from './components/Tree.js';
import { Inspector } from './components/Inspector.js';
import { HistoryPanel, ProblemsPanel, SourcePanel } from './components/Panels.js';
import { InsertPaletteHost } from './components/InsertPalette.js';
import { declaredSchemaLocation } from './state/schema.js';
import { documentProblems } from './model/problems.js';
import { isSchemaDocument } from './model/componentTree.js';
import { EXAMPLE_SCHEMA, EXAMPLE_SCHEMA_NAME } from './examples/purchaseOrder.js';
import { StartScreen } from './components/StartScreen.js';

type RightTab = 'source' | 'history';

export function App(): React.JSX.Element {
  useEditor();
  const [rightTab, setRightTab] = useState<RightTab>('source');
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [announcement, setAnnounce] = useState('');
  // Shown once, dismissed for the session. Gated in memory rather than in storage: a first-run
  // screen that will not stay dismissed is worse than one that never appears.
  const [startOpen, setStartOpen] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const schemaInput = useRef<HTMLInputElement>(null);
  const sampleInput = useRef<HTMLInputElement>(null);

  const announce = useCallback((message: string) => setAnnounce(message), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' ||
          event.target.tagName === 'TEXTAREA' ||
          event.target.isContentEditable);

      // Insertion is rendered several ways at once so it cannot be missed: a toolbar button, the
      // Inspector's "Allowed here" section, and these bindings.
      if (!typing && store.schema.model !== null) {
        if (
          (event.ctrlKey && event.key === ' ') ||
          (!event.ctrlKey && !event.metaKey && (event.key === '/' || event.key === '+' || event.key === 'Insert'))
        ) {
          event.preventDefault();
          setPaletteOpen(true);
          return;
        }
      }

      // Stepping the values the scaffolder invented. Bound without a modifier because it is the
      // main loop after a wizard run, not an occasional command.
      if (!typing && event.key === 'F7') {
        event.preventDefault();
        const moved = store.stepPlaceholder(event.shiftKey ? -1 : 1);
        announce(moved ? 'Moved to the next value to review.' : 'No values left to review.');
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        store.undo();
        announce(`Undo. ${store.document.canUndo ? '' : 'Nothing left to undo.'}`);
      } else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault();
        store.redo();
        announce('Redo.');
      } else if (event.key === 'e') {
        event.preventDefault();
        setRightTab((t) => (t === 'source' ? 'history' : 'source'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [announce]);

  const doc = store.document;
  const schemaName = store.schema.name;
  const model = store.schema.model;

  // The badge counts what the guidance engine can see as well as well-formedness. It is explicitly
  // not the authoritative verdict — libxml2 arrives in Phase 4 — so the label says "matches the
  // schema", not "valid".
  const schemaIssues = useMemo(
    () => (model === null ? 0 : documentProblems(model, doc).filter((p) => p.severity === 'error').length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getSnapshot(), model],
  );
  const problemCount = store.problems.length + schemaIssues;
  const pending = store.pending.length;
  const verdict = store.verdict.state;
  const suggestedSchema = schemaName === null ? declaredSchemaLocation(doc) : null;

  const useExampleSchema = (): void => {
    store.attachSchema(EXAMPLE_SCHEMA_NAME, EXAMPLE_SCHEMA);
    announce('Attached the example schema.');
  };

  const addChild = (): void => {
    const target = store.selected;
    const node = doc.node(target);
    const parent = node?.kind === 'element' || node?.kind === 'document' ? target : ROOT_ID;
    const command = insertElement(doc, parent, doc.childrenOf(parent).length, {
      name: { prefix: '', localName: 'newElement', namespaceUri: null },
    });
    store.run(command);
    announce(`Added newElement inside ${parent === ROOT_ID ? 'the document' : 'the selected element'}.`);
  };

  const deleteSelected = (): void => {
    const target = store.selected;
    if (target === ROOT_ID || doc.parentOf(target) === undefined) return;
    const command = removeNode(doc, target);
    store.run(command);
    announce(command.label);
  };

  const openFile = (file: File): void => {
    void file.text().then((text) => {
      store.load(text, file.name);
      setStartOpen(false);
      announce(`Opened ${file.name}.`);
    });
  };

  const save = (): void => {
    // Download rather than the File System Access API: that API is Chromium-only (Firefox has
    // called it harmful, Safari does not implement it), so the universal path is the primary one
    // and save-in-place becomes progressive enhancement later.
    const blob = new Blob([doc.serialize()], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = store.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative flex h-full flex-col" style={{ background: 'var(--surface-1)' }}>
      {startOpen && (
        <StartScreen
          onDismiss={() => setStartOpen(false)}
          onOpenFile={() => fileInput.current?.click()}
        />
      )}
      <header
        className="flex h-10 shrink-0 items-center gap-2 border-b px-3"
        style={{ borderColor: 'var(--border-default)', background: 'var(--surface-2)' }}
      >
        <span className="font-semibold">x-editor</span>
        <span className="truncate text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          {store.fileName}
        </span>

        <span
          className="ml-1 rounded px-1.5 py-0.5 text-[11px]"
          style={{
            background: problemCount === 0 ? 'var(--ok-soft)' : 'var(--error-soft)',
            color: problemCount === 0 ? 'var(--ok)' : 'var(--error)',
          }}
        >
          {problemCount > 0
            ? `${problemCount} problem${problemCount === 1 ? '' : 's'}`
            : model === null
              ? 'Well-formed'
              : verdict.valid === true && !verdict.stale
                ? 'Valid'
                : 'Matches the schema'}
        </span>

        {pending > 0 && (
          // "Valid but meaningless" is the failure mode of every document generator, and it is
          // invisible without this: the badge above says green while every date reads 2026-01-01.
          <button
            type="button"
            onClick={() => store.stepPlaceholder(1)}
            className="tnum rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}
            title="Values the wizard invented, which nobody has confirmed yet (F7)"
          >
            {pending} to review
          </button>
        )}

        {model !== null && (
          // The second opinion gets its own indicator rather than being folded into the badge
          // above: "our engine is happy" and "libxml2 is happy" are different claims, and merging
          // them would hide exactly the disagreement worth seeing.
          <span
            className="text-[11px]"
            style={{ color: 'var(--text-tertiary)', opacity: verdict.stale ? 0.6 : 1 }}
            title="The authoritative verdict, from libxml2 in a worker"
          >
            {verdict.status === 'failed'
              ? `libxml2: ${verdict.message ?? 'failed'}`
              : verdict.status === 'compiling'
                  ? 'libxml2: compiling…'
                  : verdict.status === 'validating' || verdict.stale
                    ? 'libxml2: checking…'
                    : verdict.valid === null
                      ? ''
                      : verdict.valid
                        ? 'libxml2: valid'
                        : `libxml2: ${verdict.findings.length} error${verdict.findings.length === 1 ? '' : 's'}`}
          </span>
        )}

        <div className="flex-1" />

        {store.schematron.active && (
          // Schematron mode. The rules cannot be tried without something to try them against, so
          // attaching a sample document is the first thing the toolbar offers.
          <ToolbarButton
            onClick={() => sampleInput.current?.click()}
            title={
              store.schematron.sampleName === null
                ? 'Attach an XML document to try these rules against'
                : `Trying rules against ${store.schematron.sampleName}`
            }
          >
            {store.schematron.sampleName === null
              ? 'Attach sample'
              : `Sample: ${store.schematron.sampleName}`}
          </ToolbarButton>
        )}

        {isSchemaDocument(doc) && (
          // Both views address the same nodes, so this is a lens rather than a mode: selection,
          // undo and the Inspector all survive the toggle with nothing to synchronise.
          <ToolbarButton
            onClick={() => store.setComponentView(!store.componentView)}
            title={
              store.componentView
                ? 'Showing components grouped by kind. Switch to the literal document order.'
                : 'Showing the document as written. Switch to components grouped by kind.'
            }
          >
            {store.componentView ? 'Components' : 'Source order'}
          </ToolbarButton>
        )}

        {schemaName === null ? (
          <ToolbarButton onClick={() => schemaInput.current?.click()}>Attach schema</ToolbarButton>
        ) : (
          <ToolbarButton onClick={() => store.detachSchema()} title={`Attached: ${schemaName}`}>
            Schema: {schemaName}
          </ToolbarButton>
        )}
        <ToolbarButton
          onClick={() => setPaletteOpen(true)}
          disabled={store.schema.model === null}
          title={
            store.schema.model === null
              ? 'Attach a schema to see what may be inserted'
              : 'Insert an element (Ctrl+Space)'
          }
        >
          + Insert
        </ToolbarButton>
        <ToolbarButton onClick={addChild}>+ Add element</ToolbarButton>
        <ToolbarButton onClick={deleteSelected}>Delete</ToolbarButton>
        <ToolbarButton onClick={() => store.undo()} disabled={!doc.canUndo}>
          Undo
        </ToolbarButton>
        <ToolbarButton onClick={() => store.redo()} disabled={!doc.canRedo}>
          Redo
        </ToolbarButton>
        <ToolbarButton onClick={() => fileInput.current?.click()}>Open</ToolbarButton>
        <ToolbarButton onClick={save}>Save</ToolbarButton>
        <input
          ref={sampleInput}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) {
              void file.text().then((text) => {
                store.attachSample(text, file.name);
                announce(`Trying the rules against ${file.name}.`);
              });
            }
            e.target.value = '';
          }}
        />
        <input
          ref={schemaInput}
          type="file"
          accept=".xsd,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) {
              void file.text().then((text) => {
                store.attachSchema(file.name, text);
                const errors = store.schemaProblems.filter((p) => p.severity === 'error').length;
                announce(
                  errors === 0
                    ? `Attached ${file.name}.`
                    : `Attached ${file.name} with ${errors} problem${errors === 1 ? '' : 's'}.`,
                );
              });
            }
            e.target.value = '';
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".xml,.xsd,.sch,.rng,.svg,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) openFile(file);
            e.target.value = '';
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Derived views: read-only projections of the same model, so they sit away from the
            controls that change it. */}
        <aside
          className="flex w-[380px] shrink-0 flex-col border-r"
          style={{ borderColor: 'var(--border-default)', background: 'var(--surface-1)' }}
        >
          <div
            className="flex h-8 shrink-0 items-center gap-1 border-b px-2"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <Tab active={rightTab === 'source'} onClick={() => setRightTab('source')}>
              Source
            </Tab>
            <Tab active={rightTab === 'history'} onClick={() => setRightTab('history')}>
              History
            </Tab>
          </div>
          <div className="min-h-0 flex-1">
            {rightTab === 'source' ? <SourcePanel /> : <HistoryPanel />}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {isSchemaDocument(doc) && (
            // A schema is checked against itself as it is edited, which is the closest thing this
            // editor has to "run it and see". Saying so is worth a line: otherwise the findings on
            // the schema element look like they arrived from somewhere else.
            <div
              className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[12px]"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                This is an XSD schema. It is compiled against itself as you type — select the schema
                element for dangling references and ambiguous content models.
              </span>
              <button
                type="button"
                onClick={() => {
                  const root = doc.documentElement();
                  if (root !== undefined) store.select(root);
                }}
                className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                Check this schema
              </button>
            </div>
          )}
          {schemaName === null && !store.schematron.active && !isSchemaDocument(doc) && (
            <div
              className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[12px]"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                No schema attached, so anything is allowed here.
              </span>
              <button
                type="button"
                onClick={useExampleSchema}
                className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                Try the example schema
              </button>
            </div>
          )}
          {store.schematron.active && store.schematron.sampleName === null && (
            <div
              className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[12px]"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                This is a Schematron schema. Attach a sample document to see which rules fire.
              </span>
              <button
                type="button"
                onClick={() => sampleInput.current?.click()}
                className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                Attach a sample document
              </button>
            </div>
          )}
          {suggestedSchema !== null && (
            // The document names a schema. The URL is shown, never followed: auto-fetching a remote
            // schemaLocation would hand a hostile document the user's network position.
            <div
              className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[12px]"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                This document names a schema:
              </span>
              <span className="truncate font-mono" style={{ color: 'var(--text-tertiary)' }}>
                {suggestedSchema}
              </span>
              <button
                type="button"
                onClick={() => schemaInput.current?.click()}
                className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                Attach it from a file
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <Tree />
          </div>
          <Breadcrumb />
        </main>

        {/* The selection inspector, on the right where this class of panel conventionally lives. */}
        <aside
          className="w-[360px] shrink-0 border-l"
          style={{ borderColor: 'var(--border-default)', background: 'var(--surface-1)' }}
        >
          <Inspector onOpenPalette={() => setPaletteOpen(true)} />
        </aside>
      </div>

      <footer
        className="shrink-0 border-t"
        style={{ borderColor: 'var(--border-default)', background: 'var(--surface-2)' }}
      >
        <button
          type="button"
          onClick={() => setProblemsOpen((v) => !v)}
          className="flex h-7 w-full items-center gap-2 px-3 text-left"
          aria-expanded={problemsOpen}
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 10 10"
            style={{
              transform: problemsOpen ? 'rotate(90deg)' : 'none',
              color: 'var(--text-tertiary)',
            }}
            aria-hidden
          >
            <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            Problems
          </span>
          {problemCount > 0 && (
            <span
              className="tnum rounded px-1 text-[11px]"
              style={{ background: 'var(--error-soft)', color: 'var(--error)' }}
            >
              {problemCount}
            </span>
          )}
        </button>
        {problemsOpen && (
          <div className="h-[180px] border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <ProblemsPanel />
          </div>
        )}
      </footer>

      <InsertPaletteHost
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onAnnounce={announce}
      />

      {/*
        One polite live region, written through one place, so ordering and debouncing stay in one
        spot rather than being reinvented per component.
      */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function Breadcrumb(): React.JSX.Element {
  useEditor();
  const doc = store.document;
  const chain = [store.selected, ...doc.ancestorsOf(store.selected)].reverse();

  return (
    <nav
      className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-t px-3 text-[11px]"
      style={{ borderColor: 'var(--border-default)', background: 'var(--surface-1)' }}
      aria-label="Path to selected node"
    >
      {chain.map((id, i) => {
        const node = doc.node(id);
        if (node === undefined) return null;
        const label = node.kind === 'element' ? node.name.localName : node.kind;
        return (
          <span key={id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}>›</span>}
            <button
              type="button"
              onClick={() => store.select(id)}
              className="hover:underline"
              style={{
                color: i === chain.length - 1 ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
            >
              {label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border px-2 py-1 text-[12px] disabled:opacity-40"
      style={{
        borderColor: 'var(--border-default)',
        background: 'var(--surface-0)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
  );
}

function Tab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2 py-0.5 text-[12px]"
      style={{
        background: active ? 'var(--surface-0)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
