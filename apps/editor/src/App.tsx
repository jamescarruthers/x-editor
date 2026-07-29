import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { insertElement, removeNode, ROOT_ID } from '@x-editor/xml-core';
import { store, useEditor } from './state/store.js';
import { Tree } from './components/Tree.js';
import { Inspector } from './components/Inspector.js';
import { HistoryPanel, ProblemsPanel, SourcePanel } from './components/Panels.js';
import { InsertPaletteHost } from './components/InsertPalette.js';
import { declaredSchemaLocation } from './state/schema.js';
import { documentProblems } from './model/problems.js';
import { EXAMPLE_SCHEMA, EXAMPLE_SCHEMA_NAME } from './examples/purchaseOrder.js';

type RightTab = 'source' | 'history';

export function App(): React.JSX.Element {
  useEditor();
  const [rightTab, setRightTab] = useState<RightTab>('source');
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [announcement, setAnnounce] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const schemaInput = useRef<HTMLInputElement>(null);

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
    <div className="flex h-full flex-col" style={{ background: 'var(--surface-1)' }}>
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
              : 'Matches the schema'}
        </span>

        <div className="flex-1" />

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
          {schemaName === null && (
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
