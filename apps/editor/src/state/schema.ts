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

  private sources: Record<string, string> = {};

  attach(fileName: string, source: string): SchemaDiagnostic[] {
    this.sources = { ...this.sources, [fileName]: source };
    this.name = fileName;
    this.model = new SchemaModel(assembleSchema(fileName, catalogueFrom(this.sources)));
    return this.model.allDiagnostics();
  }

  /** Adds a supporting document — one an `include` or `import` referenced — without re-rooting. */
  addSupporting(fileName: string, source: string): void {
    this.sources = { ...this.sources, [fileName]: source };
    if (this.name !== null) this.attach(this.name, this.sources[this.name]!);
  }

  detach(): void {
    this.model = null;
    this.name = null;
    this.sources = {};
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
