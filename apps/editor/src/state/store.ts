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
import { SchematronStore } from './schematron.js';

/**
 * The document lives outside React.
 *
 * It is a mutable graph with stable node ids — deliberately, because selection, expansion state and
 * (later) validation diagnostics are all keyed by those ids and must survive edits elsewhere in the
 * tree. Cloning it into React state on every keystroke would defeat that and would not scale to the
 * 50k-node target. Instead React subscribes through `useSyncExternalStore` and re-reads on a version
 * bump.
 */
class EditorStore {
  private doc: XmlDocument;
  private version = 0;
  private listeners = new Set<() => void>();

  selected: NodeId = ROOT_ID;
  expanded = new Set<NodeId>();
  fileName = 'untitled.xml';
  readonly schema = new SchemaStore();
  schemaProblems: readonly SchemaDiagnostic[] = [];
  /** The second opinion, from libxml2 in a worker. See `validation.ts` for why it is separate. */
  readonly verdict = new ValidationClient(() => this.emit());
  /** Schematron mode: the schema being edited, and the sample document it is tried against. */
  readonly schematron = new SchematronStore();

  constructor(source: string, fileName: string) {
    this.doc = XmlDocument.parse(source);
    this.fileName = fileName;
    this.expandInitial();
  }

  private expandInitial(): void {
    // Open the document element and its immediate children, so the first screen is never a single
    // collapsed row.
    this.expanded.add(ROOT_ID);
    const root = this.doc.documentElement();
    if (root !== undefined) {
      this.expanded.add(root);
      this.selected = root;
      for (const child of this.doc.childrenOf(root)) this.expanded.add(child);
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  get document(): XmlDocument {
    return this.doc;
  }

  load(source: string, fileName: string): void {
    this.doc = XmlDocument.parse(source);
    this.verdict.request(this.doc);
    this.schematron.refresh(this.doc);
    this.fileName = fileName;
    this.expanded = new Set();
    this.selected = ROOT_ID;
    this.expandInitial();
    this.emit();
  }

  run(command: Command): void {
    this.doc.run(command);
    this.verdict.request(this.doc);
    this.schematron.refresh(this.doc);
    this.selected = command.affected;
    // Reveal the affected node — an edit whose result is hidden inside a collapsed parent reads as
    // nothing having happened.
    for (const ancestor of this.doc.ancestorsOf(command.affected)) this.expanded.add(ancestor);
    this.emit();
  }

  undo(): void {
    const command = this.doc.undo();
    if (command === undefined) return;
    this.focusAfterHistory(command);
  }

  redo(): void {
    const command = this.doc.redo();
    if (command === undefined) return;
    this.focusAfterHistory(command);
  }

  /**
   * Undo must always move focus to what changed. Silent undo is disorienting, and is the top
   * complaint about every editor in the prior art.
   */
  private focusAfterHistory(command: Command): void {
    this.verdict.request(this.doc);
    this.schematron.refresh(this.doc);
    const target = this.doc.node(command.affected) !== undefined ? command.affected : ROOT_ID;
    this.selected = target;
    for (const ancestor of this.doc.ancestorsOf(target)) this.expanded.add(ancestor);
    this.emit();
  }

  select(id: NodeId): void {
    if (this.selected === id) return;
    this.selected = id;
    this.emit();
  }

  toggleExpanded(id: NodeId): void {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.emit();
  }

  setExpanded(id: NodeId, open: boolean): void {
    const had = this.expanded.has(id);
    if (had === open) return;
    if (open) this.expanded.add(id);
    else this.expanded.delete(id);
    this.emit();
  }

  expandAll(): void {
    const walk = (id: NodeId): void => {
      this.expanded.add(id);
      for (const child of this.doc.childrenOf(id)) walk(child);
    };
    walk(ROOT_ID);
    this.emit();
  }

  collapseAll(): void {
    this.expanded = new Set([ROOT_ID]);
    const root = this.doc.documentElement();
    if (root !== undefined) this.expanded.add(root);
    this.emit();
  }

  get problems(): readonly ParseError[] {
    return this.doc.parseErrors;
  }

  // --- schema ------------------------------------------------------------

  attachSchema(fileName: string, source: string): void {
    this.schemaProblems = this.schema.attach(fileName, source);
    this.verdict.setSchema(this.schema.sources(), fileName);
    this.verdict.request(this.doc);
    this.emit();

    // A 1.1 schema needs XPath to check its assertions. Fetching it here rather than at startup is
    // why a 1.0 user never downloads it; re-emitting afterwards is what makes the assertions appear
    // once it lands, instead of staying invisible until the next edit.
    if (this.schema.needsXPath) {
      void loadXPath().then(() => this.emit());
    }
  }

  detachSchema(): void {
    this.schema.detach();
    this.schemaProblems = [];
    this.verdict.setSchema([], '');
    this.emit();
  }

  /**
   * The schema context for a node, recomputed rather than cached.
   *
   * Caching would need invalidating on every edit that changes an ancestor's shape, and the walk is
   * proportional to depth rather than document size — cheap enough that a cache would cost more in
   * staleness bugs than it saves.
   */
  attachSample(source: string, name: string): void {
    this.schematron.setSample(source, name);
    this.emit();
  }

  contextFor(id: NodeId): ElementContext | null {
    return this.schema.contextFor(this.doc, id);
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
