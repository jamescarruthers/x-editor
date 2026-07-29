import {
  SchemaModel,
  assembleSchema,
  catalogueFrom,
  elementContext,
  type ElementContext,
  type SchemaDiagnostic,
} from '@x-editor/xsd';
import { XSI_NS } from '@x-editor/xsd';
import { isElement, type NodeId, type XmlDocument } from '@x-editor/xml-core';

/**
 * The attached schema, and everything derived from it.
 *
 * Held as a plain catalogue of source buffers rather than anything that can fetch. A document that
 * names `http://evil.example/x.xsd` in its `xsi:schemaLocation` gets its URL *shown*, never
 * followed — the plan names auto-fetching as the most likely place a convenience `fetch()` gets
 * added later, so the seam is here where adding one would be a deliberate act.
 */
export class SchemaStore {
  model: SchemaModel | null = null;
  /** File name of the schema the user attached, for the toolbar. */
  name: string | null = null;

  private catalogue: Record<string, string> = {};

  /**
   * @param supporting Documents the schema's own `include`/`import` will reach for, added in the
   * same step. Attaching them afterwards would compile the schema once with them missing, which
   * shows the user a burst of errors that resolve themselves a moment later.
   */
  attach(
    fileName: string,
    source: string,
    supporting: Readonly<Record<string, string>> = {},
  ): SchemaDiagnostic[] {
    this.catalogue = { ...this.catalogue, ...supporting, [fileName]: source };
    this.name = fileName;
    const set = assembleSchema(fileName, catalogueFrom(this.catalogue));
    this.model = new SchemaModel(set);
    this.needsXPath = set.declaredVersion === '1.1';
    return this.model.allDiagnostics();
  }

  /**
   * True when the schema uses XSD 1.1 constructs, which are the only thing that needs XPath.
   *
   * The engine is ~330KB and most schemas are 1.0, so it is fetched on demand rather than shipped
   * to everyone — the lazy-loading discipline PLAN.md §11 risk 4 asks for.
   */
  needsXPath = false;

  /** Adds a supporting document — one an `include` or `import` referenced — without re-rooting. */
  addSupporting(fileName: string, source: string): void {
    this.catalogue = { ...this.catalogue, [fileName]: source };
    if (this.name !== null) this.attach(this.name, this.catalogue[this.name]!);
  }

  /** The catalogue, for the worker. Buffers only — the worker resolves nothing itself. */
  sources(): { uri: string; text: string }[] {
    return Object.entries(this.catalogue).map(([uri, text]) => ({ uri, text }));
  }

  detach(): void {
    this.model = null;
    this.name = null;
    this.catalogue = {};
  }

  contextFor(document: XmlDocument, id: NodeId): ElementContext | null {
    if (this.model === null) return null;
    return elementContext(this.model, document, id);
  }
}

/**
 * A schema the document says it wants, if any.
 *
 * Shown to the user as an offer, never acted on. `xsi:schemaLocation` alternates namespace and
 * location, which is a shape people get wrong often enough to be worth parsing carefully rather
 * than splitting on whitespace and hoping.
 */
export function declaredSchemaLocation(document: XmlDocument): string | null {
  const rootId = document.documentElement();
  if (rootId === undefined) return null;
  const root = document.node(rootId);
  if (root === undefined || !isElement(root)) return null;

  for (const attribute of root.attributes) {
    if (attribute.name.namespaceUri !== XSI_NS) continue;
    if (attribute.name.localName === 'noNamespaceSchemaLocation') return attribute.value.trim();
    if (attribute.name.localName === 'schemaLocation') {
      const tokens = attribute.value.trim().split(/\s+/).filter((token) => token !== '');
      // Pairs of (namespace, location); the location is the second of each pair.
      return tokens[1] ?? null;
    }
  }
  return null;
}
