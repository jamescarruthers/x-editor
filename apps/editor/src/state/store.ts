import { useSyncExternalStore } from 'react';
import {
  ROOT_ID,
  XmlDocument,
  type Command,
  type NodeId,
  type ParseError,
} from '@x-editor/xml-core';
import { loadXPath, type ElementContext, type SchemaDiagnostic } from '@x-editor/xsd';
import { SchemaStore } from './schema.js';
import { ValidationClient } from './validation.js';
import { SchematronStore, isSchematronDocument } from './schematron.js';
import { isSchemaDocument } from '../model/componentTree.js';
import { NEW_SCH, NEW_XML, NEW_XSD } from './templates.js';
import {
  nextPlaceholder,
  pendingPlaceholders,
  resolvePlaceholders,
  type Placeholder,
  type Scaffold,
} from '../model/scaffold.js';

/**
 * A workspace of up to three files — the instance, its schema, and its business rules.
 *
 * The three are one job. A schema exists to constrain a document; rules exist to constrain it
 * further; and the interesting errors are the ones that only appear when you look at more than one
 * of them at a time. Holding them separately — attach a schema *file*, edit a schema *document* —
 * meant the editor could never show that: an XML author had rules they could not run, and a rule
 * author had a sample they could not edit.
 *
 * So there is one slot per kind, at most one file each, and every edit to any of them re-derives
 * everything downstream. The slot a file lands in is decided by its root element, not its
 * extension, because a `.txt` full of `xs:schema` is still a schema and a `.xsd` full of nonsense
 * is not.
 */
export type FileKind = 'xml' | 'xsd' | 'sch';

export const FILE_KINDS: readonly FileKind[] = ['xml', 'xsd', 'sch'];

export const FILE_LABELS: Readonly<Record<FileKind, string>> = {
  xml: 'XML',
  xsd: 'XSD',
  sch: 'Rules',
};

/**
 * One open file.
 *
 * Selection and expansion live here rather than on the store, so switching tabs returns you to
 * where you were. A workspace that forgets your position every time you check the schema is one you
 * stop checking the schema in.
 */
export type FileId = number & { readonly __fileId: unique symbol };

interface WorkspaceFile {
  readonly id: FileId;
  readonly kind: FileKind;
  name: string;
  doc: XmlDocument;
  selected: NodeId;
  expanded: Set<NodeId>;
  componentView: boolean;
  placeholders: readonly Placeholder[];
}

/**
 * The document lives outside React.
 *
 * It is a mutable graph with stable node ids — deliberately, because selection, expansion state and
 * validation diagnostics are all keyed by those ids and must survive edits elsewhere in the tree.
 * Cloning it into React state on every keystroke would defeat that and would not scale to the
 * 50k-node target. Instead React subscribes through `useSyncExternalStore` and re-reads on a version
 * bump.
 */
class EditorStore {
  /**
   * Every open file, in open order.
   *
   * A list rather than one slot per kind, because the instance documents are the evidence about the
   * schema being written and there is never only one piece of evidence worth keeping. A workspace
   * that evicts the last document when you open the next cannot show a known-good and a known-bad
   * file reacting to the same edit, which is the whole reason someone would open two.
   *
   * Phase 9 step 1: many XML, still one XSD and one SCH. See PLAN.md §6.2.
   */
  private files: WorkspaceFile[] = [];
  private nextFileId = 1;
  private activeFileId: FileId = 1 as FileId;
  private version = 0;
  private listeners = new Set<() => void>();

  readonly schema = new SchemaStore();
  schemaProblems: readonly SchemaDiagnostic[] = [];
  /** The second opinion, from libxml2 in a worker. See `validation.ts` for why it is separate. */
  readonly verdict = new ValidationClient(() => this.emit());
  /** The rules from the `.sch` slot, run against the `.xml` slot. */
  readonly schematron = new SchematronStore();

  /** The XSD source the guidance engine was last compiled from, so typing elsewhere is free. */
  private compiledFrom: string | null = null;
  /**
   * Recompiling libxml2's schema means terminating and respawning the worker, so it is debounced
   * separately and much harder than the in-process engine. Editing a schema live is worth the cost;
   * paying it on every keystroke is not.
   */
  private engineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(source: string, fileName: string) {
    this.openFile(fileName, source, { silent: true });
  }

  // --- subscription ------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  // --- the active file ---------------------------------------------------

  /**
   * The file the tree and Inspector are editing.
   *
   * Every existing component reads `store.document`, `store.selected` and so on, and continues to —
   * the accessors below are the whole of the multi-file change as far as they are concerned.
   */
  private get current(): WorkspaceFile {
    const file = this.files.find((entry) => entry.id === this.activeFileId);
    if (file !== undefined) return file;
    // Only reachable if a file was closed, in which case another is chosen immediately. Belt and
    // braces so a render can never see a missing document.
    const first = this.files[0];
    if (first === undefined) throw new Error('The workspace has no files');
    this.activeFileId = first.id;
    return first;
  }

  /** The kind of the file being edited. Kept as `active` so kind-based checks read unchanged. */
  get active(): FileKind {
    return this.current.kind;
  }

  get activeId(): FileId {
    return this.current.id;
  }

  get document(): XmlDocument {
    return this.current.doc;
  }

  get fileName(): string {
    return this.current.name;
  }

  get selected(): NodeId {
    return this.current.selected;
  }

  set selected(id: NodeId) {
    this.current.selected = id;
  }

  get expanded(): Set<NodeId> {
    return this.current.expanded;
  }

  get componentView(): boolean {
    return this.current.componentView;
  }

  get placeholders(): readonly Placeholder[] {
    return this.current.placeholders;
  }

  setComponentView(on: boolean): void {
    if (this.current.componentView === on) return;
    this.current.componentView = on;
    this.emit();
  }

  // --- the workspace -----------------------------------------------------

  /** Every open file, grouped by kind so the tabs never reshuffle as documents are added. */
  get openFiles(): readonly { id: FileId; kind: FileKind; name: string }[] {
    return FILE_KINDS.flatMap((kind) =>
      this.files
        .filter((file) => file.kind === kind)
        .map((file) => ({ id: file.id, kind: file.kind, name: file.name })),
    );
  }

  filesOfKind(kind: FileKind): readonly { id: FileId; name: string; doc: XmlDocument }[] {
    return this.files.filter((file) => file.kind === kind);
  }

  has(kind: FileKind): boolean {
    return this.files.some((file) => file.kind === kind);
  }

  /** The first file of a kind. Exact for xsd and sch, which are still single. */
  documentFor(kind: FileKind): XmlDocument | null {
    return this.files.find((file) => file.kind === kind)?.doc ?? null;
  }

  nameFor(kind: FileKind): string | null {
    return this.files.find((file) => file.kind === kind)?.name ?? null;
  }

  documentById(id: FileId): XmlDocument | null {
    return this.files.find((file) => file.id === id)?.doc ?? null;
  }

  nameById(id: FileId): string | null {
    return this.files.find((file) => file.id === id)?.name ?? null;
  }

  /** Activates the single file of a kind. Well-defined while xsd and sch remain single. */
  activateKind(kind: FileKind): void {
    const file = this.files.find((entry) => entry.kind === kind);
    if (file !== undefined) this.activate(file.id);
  }

  activate(id: FileId): void {
    if (this.activeFileId === id || !this.files.some((file) => file.id === id)) return;
    this.activeFileId = id;
    this.emit();
  }

  /**
   * Which slot a source belongs in, decided by its root element.
   *
   * By content rather than by extension, because the extension is a claim and the root element is a
   * fact — and someone who has been handed `rules.xml` should not have to rename it before the
   * editor will run it.
   */
  static kindOf(document: XmlDocument): FileKind {
    if (isSchemaDocument(document)) return 'xsd';
    if (isSchematronDocument(document)) return 'sch';
    return 'xml';
  }

  /**
   * @param options.focus Whether to switch to the file. False when a schema arrives *because of*
   * the document being edited — yanking someone into a schema they did not ask to look at is the
   * behaviour that made "attach" and "open" feel like different things in the first place.
   */
  openFile(
    fileName: string,
    source: string,
    options: { silent?: boolean; focus?: boolean } = {},
  ): FileKind {
    const doc = XmlDocument.parse(source);
    const kind = EditorStore.kindOf(doc);

    const file: WorkspaceFile = {
      id: this.nextFileId++ as FileId,
      kind,
      name: fileName,
      doc,
      selected: ROOT_ID,
      expanded: new Set(),
      // A schema opens in the component view, an instance in the literal one.
      componentView: kind === 'xsd',
      placeholders: [],
    };
    // An instance document joins the corpus; a schema or a rule set replaces the one before it.
    // Steps 2 and 3 of PLAN.md §6.2 lift that restriction; step 1 deliberately does not, so the
    // validation-scaling problem is met with one schema rather than several at once.
    if (kind === 'xml') {
      const sameName = this.files.findIndex((entry) => entry.kind === 'xml' && entry.name === fileName);
      if (sameName === -1) this.files.push(file);
      else this.files[sameName] = file;
    } else {
      const existing = this.files.findIndex((entry) => entry.kind === kind);
      if (existing === -1) this.files.push(file);
      else this.files[existing] = file;
    }
    if (options.focus !== false) this.activeFileId = file.id;
    expandInitial(file);

    this.sync();
    if (options.silent !== true) this.emit();
    return kind;
  }

  /** Start a file of a given kind from a template. */
  newFile(kind: FileKind): void {
    const [name, source] =
      kind === 'xsd'
        ? ['untitled.xsd', NEW_XSD]
        : kind === 'sch'
          ? ['untitled.sch', NEW_SCH]
          : ['untitled.xml', NEW_XML];
    this.openFile(name, source);
  }

  closeFile(id: FileId): void {
    const index = this.files.findIndex((file) => file.id === id);
    if (index === -1) return;
    if (this.files.length === 1) return; // never leave the workspace empty
    this.files.splice(index, 1);
    if (this.activeFileId === id) this.activeFileId = this.files[Math.min(index, this.files.length - 1)]!.id;
    this.sync();
    this.emit();
  }

  /** Closes the single file of a kind. What the schema and rules tab chips use. */
  closeKind(kind: FileKind): void {
    const file = this.files.find((entry) => entry.kind === kind);
    if (file !== undefined) this.closeFile(file.id);
  }

  /** Replaces the whole workspace — what the start screen's examples do. */
  openWorkspace(files: readonly { name: string; source: string }[], active: FileKind = 'xml'): void {
    this.files = [];
    this.compiledFrom = null;
    this.schema.detach();
    for (const file of files) this.openFile(file.name, file.source, { silent: true });
    const first = this.files.find((file) => file.kind === active) ?? this.files[0];
    if (first !== undefined) this.activeFileId = first.id;
    this.sync();
    this.emit();
  }

  // --- cross-file derivation ---------------------------------------------

  /**
   * Re-derive everything that depends on more than one file.
   *
   * Called after every edit and every workspace change. The guidance engine recompiles in-process
   * and is cheap enough to do synchronously; libxml2's schema and the Schematron run are the
   * expensive halves and are guarded or debounced.
   */
  private sync(): void {
    const xsd = this.files.find((file) => file.kind === 'xsd');
    const sch = this.files.find((file) => file.kind === 'sch');
    const xmlFiles = this.files.filter((file) => file.kind === 'xml');
    // The active document first when it is an instance: a verdict someone is waiting for should not
    // queue behind nine they are not looking at.
    const ordered = [...xmlFiles].sort((a, b) =>
      a.id === this.activeFileId ? -1 : b.id === this.activeFileId ? 1 : 0,
    );
    const xml = ordered[0];

    if (xsd === undefined) {
      if (this.compiledFrom !== null) {
        this.compiledFrom = null;
        this.schema.detach();
        this.schemaProblems = [];
        this.verdict.setSchema([], '');
      }
    } else {
      const source = xsd.doc.serialize();
      if (source !== this.compiledFrom) {
        this.compiledFrom = source;
        // The guidance engine is in-process and lazy, so this is affordable per keystroke — and it
        // is what makes editing a schema show up in the other file immediately.
        this.schemaProblems = this.schema.attach(xsd.name, source);
        if (this.schema.needsXPath) void loadXPath().then(() => this.emit());
        this.scheduleEngineRecompile(xsd.name);
      }
    }

    this.schematron.setRules(sch?.doc ?? null);
    this.schematron.setSample(xml?.doc ?? null, xml?.name ?? null);
    this.schematron.run();
    this.schematron.runAll(ordered);

    // Every instance, queued foreground-first against the schema already compiled into the worker.
    if (ordered.length > 0) this.verdict.requestAll(ordered);
  }

  /**
   * Hand the schema to libxml2, debounced.
   *
   * `setSchema` terminates and respawns the worker — the only way to interrupt a WASM call — so
   * doing it per keystroke while someone edits a schema would spend the whole session starting
   * workers. Half a second is long enough that a burst of typing costs one respawn and short enough
   * that the authoritative verdict still feels like it is keeping up.
   */
  private scheduleEngineRecompile(rootUri: string): void {
    if (this.engineTimer !== null) clearTimeout(this.engineTimer);
    this.engineTimer = setTimeout(() => {
      this.engineTimer = null;
      this.verdict.setSchema(this.schema.sources(), rootUri);
      const instances = this.files.filter((file) => file.kind === 'xml');
      if (instances.length > 0) this.verdict.requestAll(instances);
    }, 500);
  }

  // --- editing -----------------------------------------------------------

  run(command: Command): void {
    const file = this.current;
    file.doc.run(command);
    file.selected = command.affected;
    // Reveal the affected node — an edit whose result is hidden inside a collapsed parent reads as
    // nothing having happened.
    for (const ancestor of file.doc.ancestorsOf(command.affected)) file.expanded.add(ancestor);
    this.sync();
    this.emit();
  }

  undo(): void {
    const command = this.current.doc.undo();
    if (command === undefined) return;
    this.focusAfterHistory(command);
  }

  redo(): void {
    const command = this.current.doc.redo();
    if (command === undefined) return;
    this.focusAfterHistory(command);
  }

  /**
   * Undo must always move focus to what changed. Silent undo is disorienting, and is the top
   * complaint about every editor in the prior art.
   */
  private focusAfterHistory(command: Command): void {
    const file = this.current;
    const target = file.doc.node(command.affected) !== undefined ? command.affected : ROOT_ID;
    file.selected = target;
    for (const ancestor of file.doc.ancestorsOf(target)) file.expanded.add(ancestor);
    this.sync();
    this.emit();
  }

  select(id: NodeId): void {
    if (this.current.selected === id) return;
    this.current.selected = id;
    this.emit();
  }

  /**
   * Selects a node in another file, switching to it. What a cross-file problem row does.
   *
   * Addressed by file id rather than kind: with several instance documents open, "the XML" is no
   * longer a destination, and a row that jumped to the wrong one would be worse than inert.
   */
  reveal(fileId: FileId, id: NodeId): void {
    const file = this.files.find((entry) => entry.id === fileId);
    if (file === undefined) return;
    this.activeFileId = file.id;
    file.selected = id;
    for (const ancestor of file.doc.ancestorsOf(id)) file.expanded.add(ancestor);
    this.emit();
  }

  toggleExpanded(id: NodeId): void {
    const { expanded } = this.current;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    this.emit();
  }

  setExpanded(id: NodeId, open: boolean): void {
    const { expanded } = this.current;
    if (expanded.has(id) === open) return;
    if (open) expanded.add(id);
    else expanded.delete(id);
    this.emit();
  }

  expandAll(): void {
    const file = this.current;
    const walk = (id: NodeId): void => {
      file.expanded.add(id);
      for (const child of file.doc.childrenOf(id)) walk(child);
    };
    walk(ROOT_ID);
    this.emit();
  }

  collapseAll(): void {
    const file = this.current;
    file.expanded = new Set([ROOT_ID]);
    const root = file.doc.documentElement();
    if (root !== undefined) file.expanded.add(root);
    this.emit();
  }

  get problems(): readonly ParseError[] {
    return this.current.doc.parseErrors;
  }

  // --- generated documents -----------------------------------------------

  /**
   * Load a document the wizard generated, keeping track of what it invented.
   *
   * Separate from `openFile` because the placeholder paths are only meaningful against the text that
   * produced them — resolving them anywhere else would bind them to whatever happens to sit at those
   * indices.
   */
  loadScaffold(scaffold: Scaffold, fileName: string): void {
    this.openFile(fileName, scaffold.source, { silent: true });
    const file = this.files.find((entry) => entry.kind === 'xml');
    if (file !== undefined) {
      file.placeholders = resolvePlaceholders(file.doc, scaffold.placeholders);
      const first = pendingPlaceholders(file.doc, file.placeholders)[0];
      if (first !== undefined) {
        file.selected = first.node;
        for (const ancestor of file.doc.ancestorsOf(first.node)) file.expanded.add(ancestor);
      }
    }
    this.emit();
  }

  /** The generated values nobody has looked at yet, in the active file. */
  get pending(): readonly Placeholder[] {
    return pendingPlaceholders(this.current.doc, this.current.placeholders);
  }

  /** Steps to the next unreviewed generated value. Bound to F7 / Shift+F7. */
  stepPlaceholder(direction: 1 | -1): boolean {
    const file = this.current;
    const target = nextPlaceholder(file.doc, file.placeholders, file.selected, direction);
    if (target === null) return false;
    file.selected = target;
    for (const ancestor of file.doc.ancestorsOf(target)) file.expanded.add(ancestor);
    this.emit();
    return true;
  }

  // --- schema ------------------------------------------------------------

  /**
   * Attaching a schema *is* opening it.
   *
   * They were two mechanisms doing one thing, and keeping them apart is what stopped the editor
   * showing an error that spans two files. Supporting documents an `include` reaches for stay a
   * separate catalogue, because they are not being edited.
   */
  attachSchema(
    fileName: string,
    source: string,
    supporting: Readonly<Record<string, string>> = {},
  ): void {
    for (const [name, text] of Object.entries(supporting)) this.schema.addSupporting(name, text);
    this.openFile(fileName, source, { focus: false });
  }

  detachSchema(): void {
    this.closeKind('xsd');
  }

  /** Opening an XML document to try the rules against. */
  attachSample(source: string, name: string): void {
    this.openFile(name, source, { focus: false });
  }

  contextFor(id: NodeId): ElementContext | null {
    // Guidance is about the instance document; asking for it inside a schema would answer against
    // the schema-for-schemas, which nobody attached and nobody wants to see.
    if (this.active !== 'xml') return null;
    return this.schema.contextFor(this.current.doc, id);
  }
}

function expandInitial(file: WorkspaceFile): void {
  // Open the document element and its immediate children, so the first screen is never a single
  // collapsed row.
  file.expanded.add(ROOT_ID);
  const root = file.doc.documentElement();
  if (root !== undefined) {
    file.expanded.add(root);
    file.selected = root;
    for (const child of file.doc.childrenOf(root)) file.expanded.add(child);
  }
}

export const store = new EditorStore(
  `<?xml version="1.0" encoding="UTF-8"?>\n<purchaseOrder orderDate="2026-07-29">\n  <shipTo country="GB">\n    <name>Alice Smith</name>\n    <street>123 Maple Street</street>\n    <city>Cambridge</city>\n    <postcode>CB1 2AB</postcode>\n  </shipTo>\n  <items>\n    <item partNum="872-AA">\n      <productName>Lawnmower</productName>\n      <quantity>1</quantity>\n      <price>148.95</price>\n      <comment>Confirm this is electric</comment>\n    </item>\n    <item partNum="926-AA">\n      <productName>Baby Monitor</productName>\n      <quantity>2</quantity>\n      <price>39.98</price>\n    </item>\n  </items>\n</purchaseOrder>\n`,
  'purchase-order.xml',
);

/** Subscribes a component to document changes. Returns the current version, which changes on edit. */
export function useEditor(): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
