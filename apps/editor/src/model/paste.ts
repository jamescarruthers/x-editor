import {
  XmlDocument,
  insertElement,
  insertText,
  isElement,
  type Command,
  type ElementNode,
  type NamespaceDeclaration,
  type NodeId,
  type XmlNode,
} from '@x-editor/xml-core';
import {
  allIsValid,
  elementContext,
  insertCandidates,
  isValidSequence,
  modelChildNames,
  type ElementName,
  type SchemaModel,
} from '@x-editor/xsd';
import { compose } from './insert.js';
import { store } from '../state/store.js';

/**
 * Smart paste.
 *
 * Pasting XML is the single most error-prone thing a beginner does, and every editor answers it the
 * same way: drop the text in, then report four errors. The information needed to do better is
 * already here — the content model knows whether the fragment fits, and where else it would. So the
 * question changes from "did that work?" to "which of these did you mean?", with the consequence of
 * each option measured rather than guessed at.
 *
 * Options are ranked by validity, not by likelihood. A ranking based on where the caret happened to
 * be would put the option the user clicked nearest at the top, which is exactly the option that just
 * failed.
 */

export interface PasteOption {
  readonly id: string;
  readonly title: string;
  /** The consequence, measured: how many new errors this lands the document with. */
  readonly errors: number;
  readonly parent: NodeId;
  readonly index: number;
  /** Set when the fragment has to be changed to fit — namespaces stripped, wrapped in text. */
  readonly transform: 'none' | 'strip-namespaces' | 'as-text';
  readonly preview: string;
}

export interface PasteAnalysis {
  readonly fragment: XmlDocument | null;
  readonly parseError: string | null;
  readonly options: readonly PasteOption[];
}

/**
 * Work out where a pasted fragment could go, and what each choice would cost.
 *
 * Called on every paste, so it is bounded: the caret's parent, its parent, and the position after
 * the selection. Searching the whole document for the best home would be slow and would also be
 * wrong — a paste that lands three levels away from where someone was looking reads as a bug even
 * when it is valid.
 */
export function analysePaste(
  document: XmlDocument,
  model: SchemaModel | null,
  at: NodeId,
  text: string,
): PasteAnalysis {
  const trimmed = text.trim();
  if (trimmed === '' || !trimmed.startsWith('<')) {
    return { fragment: null, parseError: null, options: [textOption(document, at, text)] };
  }

  const fragment = XmlDocument.parse(trimmed);
  const rootId = fragment.documentElement();
  if (rootId === undefined || fragment.parseErrors.length > 0) {
    return {
      fragment: null,
      parseError:
        fragment.parseErrors[0]?.message ??
        'That does not look like XML — it will be pasted as text.',
      options: [textOption(document, at, text)],
    };
  }

  const names = topLevelNames(fragment);
  const options: PasteOption[] = [];

  const inside = at;
  const parent = document.parentOf(at);

  options.push(
    describeOption(document, model, {
      id: 'inside',
      title: `Paste inside <${labelOf(document, inside)}>`,
      parent: inside,
      index: elementChildren(document, inside).length,
      transform: 'none',
      names,
      preview: trimmed,
    }),
  );

  if (parent !== undefined && document.node(parent)?.kind !== 'document') {
    options.push(
      describeOption(document, model, {
        id: 'sibling',
        title: `Paste after <${labelOf(document, at)}>`,
        parent,
        index: elementChildren(document, parent).indexOf(at) + 1,
        transform: 'none',
        names,
        preview: trimmed,
      }),
    );
  }

  // The stripped variant is only worth offering when it changes the answer. A document with no
  // namespaces anywhere would otherwise get an option that does nothing, described as if it did.
  if (names.some((name) => name.namespaceUri !== null)) {
    const stripped = names.map((name) => ({ namespaceUri: null, localName: name.localName }));
    options.push(
      describeOption(document, model, {
        id: 'strip',
        title: `Strip namespace prefixes and paste inside <${labelOf(document, inside)}>`,
        parent: inside,
        index: elementChildren(document, inside).length,
        transform: 'strip-namespaces',
        names: stripped,
        preview: stripNamespaces(trimmed),
      }),
    );
  }

  options.push(textOption(document, at, trimmed));

  // Stable sort by error count: equal-cost options keep the order above, which runs from the
  // caret outwards. Ranking is by consequence first and proximity second, never the reverse.
  return {
    fragment,
    parseError: null,
    options: options
      .map((option, position) => ({ option, position }))
      .sort((a, b) => a.option.errors - b.option.errors || a.position - b.position)
      .map((entry) => entry.option),
  };
}

function textOption(document: XmlDocument, at: NodeId, text: string): PasteOption {
  return {
    id: 'text',
    title: 'Paste as text content',
    // Always legal as far as structure goes; whether the type accepts it is checked on the way in
    // by the normal value validation, which is the right place for it.
    errors: 0,
    parent: at,
    index: document.childrenOf(at).length,
    transform: 'as-text',
    preview: text,
  };
}

function describeOption(
  document: XmlDocument,
  model: SchemaModel | null,
  spec: {
    id: string;
    title: string;
    parent: NodeId;
    index: number;
    transform: PasteOption['transform'];
    names: readonly ElementName[];
    preview: string;
  },
): PasteOption {
  return {
    id: spec.id,
    title: spec.title,
    errors: countErrors(document, model, spec.parent, spec.names),
    parent: spec.parent,
    index: spec.index,
    transform: spec.transform,
    preview: spec.preview,
  };
}

/**
 * How many of the pasted elements the parent's content model would reject.
 *
 * Counted against the child list the paste would produce, not against the fragment on its own — a
 * `<line>` is perfectly legal and still wrong after the twelfth one when the model allows ten.
 */
function countErrors(
  document: XmlDocument,
  model: SchemaModel | null,
  parent: NodeId,
  names: readonly ElementName[],
): number {
  if (model === null) return 0;

  const context = elementContext(model, document, parent);
  if (context === null || context.type.form !== 'complex') return names.length;

  const content = model.contentModel(context.type);
  if (content.kind === 'any') return 0;
  if (content.kind === 'empty') return names.length;

  const combined = [...modelChildNames(context), ...names];
  const valid =
    content.kind === 'all'
      ? allIsValid(content.model, combined)
      : isValidSequence(content.model, combined);
  if (valid) return 0;

  // Not valid as a whole: count the names the model has no place for at all, which is the number a
  // user can act on. "This sequence is wrong somewhere" is true and useless.
  //
  // Asked through the same function the palette uses, so the two never disagree: a name the palette
  // would offer here is never counted as an error, and one it would not always is.
  const allowed = new Set(
    insertCandidates(model, context, context.children.length).map(
      (candidate) => `${candidate.name.namespaceUri ?? ''}|${candidate.name.localName}`,
    ),
  );
  const unknown = names.filter(
    (name) => !allowed.has(`${name.namespaceUri ?? ''}|${name.localName}`),
  ).length;
  return unknown > 0 ? unknown : 1;
}

/**
 * Turn the chosen option into the edit it describes.
 *
 * The fragment is *reconstructed*, not regenerated. An earlier version built a skeleton from the
 * schema for each pasted element's name, which produced a structurally correct element containing
 * none of what was on the clipboard — a paste that quietly throws away the pasted content is worse
 * than one that fails.
 */
export function applyPaste(
  document: XmlDocument,
  option: PasteOption,
  fragment: XmlDocument | null,
  text: string,
): Command | null {
  if (option.transform === 'as-text' || fragment === null) {
    return insertText(document, option.parent, document.childrenOf(option.parent).length, text);
  }

  const rootId = fragment.documentElement();
  if (rootId === undefined) return null;

  const strip = option.transform === 'strip-namespaces';
  const commands = rebuild(document, fragment, rootId, option.parent, option.index, strip, true);
  if (commands.length === 0) return null;

  const name = topLevelNames(fragment)[0];
  return compose(name === undefined ? 'Pasted' : `Pasted <${name.localName}>`, commands);
}

/**
 * Rebuild a fragment subtree as commands against the target document.
 *
 * Prefixes are preserved exactly as they were written, and the fragment's namespace bindings are
 * declared on the pasted element itself. That keeps the paste self-contained: it never rewrites a
 * prefix on an ancestor the user did not touch, and it cannot silently rebind an existing one.
 */
function rebuild(
  document: XmlDocument,
  fragment: XmlDocument,
  sourceId: NodeId,
  parentId: NodeId,
  index: number,
  strip: boolean,
  top: boolean,
): Command[] {
  const node = fragment.node(sourceId);
  if (node === undefined) return [];

  if (node.kind === 'text' || node.kind === 'cdata') {
    return [insertText(document, parentId, index, node.value)];
  }
  if (!isElement(node)) return [];

  const declarations = top && !strip ? bindingsOf(fragment, sourceId) : ownDeclarations(node, strip);

  const attributes = node.attributes
    .filter((attribute) => attribute.name.prefix !== 'xmlns' && attribute.name.localName !== 'xmlns')
    .map((attribute) => ({
      name: strip
        ? { prefix: '', localName: attribute.name.localName, namespaceUri: null }
        : attribute.name,
      value: attribute.value,
    }));

  const command = insertElement(document, parentId, index, {
    name: strip
      ? { prefix: '', localName: node.name.localName, namespaceUri: null }
      : node.name,
    attributes,
    namespaceDeclarations: declarations,
  });

  const commands: Command[] = [command];
  let childIndex = 0;
  for (const childId of fragment.childrenOf(sourceId)) {
    const sub = rebuild(document, fragment, childId, command.affected, childIndex, strip, false);
    if (sub.length > 0) {
      commands.push(...sub);
      childIndex++;
    }
  }
  return commands;
}

function bindingsOf(fragment: XmlDocument, id: NodeId): NamespaceDeclaration[] {
  return [...fragment.inScopeNamespaces(id)].map(([prefix, uri]) => ({ prefix, uri }));
}

function ownDeclarations(node: ElementNode, strip: boolean): NamespaceDeclaration[] {
  if (strip) return [];
  return node.attributes
    .filter((attribute) => attribute.name.prefix === 'xmlns' || attribute.name.localName === 'xmlns')
    .map((attribute) => ({
      prefix: attribute.name.prefix === 'xmlns' ? attribute.name.localName : '',
      uri: attribute.value,
    }));
}

function topLevelNames(fragment: XmlDocument): ElementName[] {
  const rootId = fragment.documentElement();
  if (rootId === undefined) return [];
  const root = fragment.node(rootId);
  if (root === undefined || !isElement(root)) return [];
  return [{ namespaceUri: root.name.namespaceUri, localName: root.name.localName }];
}

function elementChildren(document: XmlDocument, id: NodeId): NodeId[] {
  return document.childrenOf(id).filter((childId) => {
    const node = document.node(childId);
    return node !== undefined && isElement(node);
  });
}

function labelOf(document: XmlDocument, id: NodeId): string {
  const node: XmlNode | undefined = document.node(id);
  return node !== undefined && isElement(node) ? node.name.localName : 'the document';
}

/** Drop prefixes and namespace declarations, for the "strip and paste" option's preview. */
export function stripNamespaces(source: string): string {
  return source
    .replace(/\sxmlns(:[\w.-]+)?="[^"]*"/g, '')
    .replace(/<(\/?)[\w.-]+:/g, '<$1')
    .replace(/\s[\w.-]+:([\w.-]+)=/g, ' $1=');
}

/** The store-facing entry point, so the paste handler stays a one-liner. */
export function pasteInto(text: string): PasteAnalysis {
  return analysePaste(store.document, store.schema.model, store.selected, text);
}
