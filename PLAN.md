# x-editor — Implementation Plan

A browser-based, tree-node editor for **XML**, **XSD** and **Schematron**, with XSD and Schematron
validation running client-side, designed so that someone who does not already know the schema can
still produce a valid document.

**Status:** Phases 0–7 implemented. `packages/xml-core` (lossless CST, command log, splice
serializer), `packages/xsd` (schema front end, simple- and complex-type compilers, Glushkov
automaton, query API) and `apps/editor` (four-region shell, virtualized tree, Insert palette,
schema-driven Inspector, XSD component view and refactorings, form view, new-document wizard, smart
paste, schema inference), `packages/validation-protocol` and `packages/xsd-libxml2` (the
authoritative verdict, in a worker) and `packages/schematron` (a direct interpreter over fontoxpath,
with the live test harness) are in place, with ~550 tests. Every verdict is checked against an
independent implementation: `libxml2-wasm` for XSD 1.0, `xmlschema` for 1.1, and the ISO Schematron
reference for Schematron. All five spikes are answered — see [`docs/spikes.md`](docs/spikes.md).
**Phase 8 is ongoing**; its two risk-carrying items (mixed content, the table view) are done, and
what remains there is listed honestly in §10. See §10 for the roadmap and the per-phase *done when*.

**Companion documents**

| Document | Contents |
|---|---|
| [`docs/schema-engine.md`](docs/schema-engine.md) | The guidance core: XSD component model, content-model automaton, `whatCanGoHere`, quick fixes |
| [`docs/validation.md`](docs/validation.md) | XSD and Schematron validation architecture, error→node mapping, the security model |
| [`docs/ux-spec.md`](docs/ux-spec.md) | Layout, tree anatomy, the Insert palette, keyboard map, design tokens, accessibility |
| [`docs/spikes.md`](docs/spikes.md) | Answers to SPIKE-0…4, and what the differential harness has caught |

---

## 1. The product thesis

Every existing XML editor answers the question *"is this document valid?"*. That is an expert's
question — it is only useful once you already know what the document is supposed to look like.

A beginner has a different question: ***"what am I allowed to put here, and what does it mean?"***

No validator answers that. libxml2, Xerces and Saxon are all yes/no oracles over a *complete*
document; none of them expose the content-model state machine that would let you ask about a
position mid-edit. This is the single most important fact in this plan, and it drives most of the
architecture: **the guidance engine is a separate thing from the validator, we have to write it, and
it is the product.** A team that treats guidance as a thin layer over a validator discovers in month
five that it cannot be built that way, and ships an expert tool by accident.

So the design commits to three things:

1. **A schema-aware guidance engine** we own, which can answer position-sensitive questions about a
   half-finished document (§4, [`docs/schema-engine.md`](docs/schema-engine.md)).
2. **Independent authoritative validators** — libxml2 for XSD, our own Schematron interpreter — which
   provide the real verdict and continuously cross-check the guidance engine in CI (§5).
3. **A UI whose primary affordance is insertion, not inspection** (§6,
   [`docs/ux-spec.md`](docs/ux-spec.md)).

### Non-goals (stated so they are decisions, not omissions)

- **Phones.** Tablet is degraded-but-usable; phone is out of scope.
- **Real-time collaboration.** Single-user. The edit layer is command-shaped so a CRDT backend could
  be added later, but nothing else accommodates it.
- **Being a text editor.** There is a source view with two-way sync, but the tree is the primary
  interaction. We are not competing with Oxygen's text mode.
- **Server-side anything.** The app is a static SPA. Documents never leave the browser (§8).

---

## 2. Verification status of this plan

This plan was researched by six parallel agents and then fact-checked against primary sources (npm
registry, project repositories, official documentation, caniuse, W3C/ISO). **The research agents
themselves had no network access** — a broken permission handler in their sandbox blocked every tool
call — so their package claims were model recall. Everything load-bearing was therefore re-verified
directly. The table below is the audit trail; anything marked *unverified* is a spike, not a
decision.

| Claim | Status | Source |
|---|---|---|
| `libxml2-wasm` exists, MIT, exposes `XsdValidator.fromDoc()` / `validate()` | **Verified** — v0.7.1 | [npm](https://registry.npmjs.org/libxml2-wasm/latest), [API docs](https://jameslan.github.io/libxml2-wasm/dev/classes/libxml2-wasm.XsdValidator.html) |
| `libxml2-wasm` XSD `include`/`import` support | **Verified as EXPERIMENTAL** — a real risk, see SPIKE-2 | [README](https://github.com/jameslan/libxml2-wasm) |
| libxml2 is XSD **1.0 only**, no `xs:assert`; 1.1 not planned | **Verified** | [libxml2 maintainer, xml list](https://mail.gnome.org/archives/xml/2011-November/msg00047.html) |
| No JavaScript XSD 1.1 validator exists, browser or Node | **Verified** — every candidate is 1.0, or shells out to Java | search of npm + the XSD 1.1 tooling landscape |
| `xmlschema` — MIT, **pure Python**, XSD 1.1 via `XMLSchema11`, only depends on `elementpath` (also pure Python) → installs under Pyodide | **Verified** — v4.3.2 | [PyPI](https://pypi.org/pypi/xmlschema/json) |
| `fontoxpath` — XPath 3.1 in pure JS, MIT | **Verified** — v3.34.0 | [npm](https://registry.npmjs.org/fontoxpath/latest) |
| `fontoxpath` supports a custom node model via `IDomFacade` | **Verified** | [GitHub](https://github.com/FontoXML/fontoxpath) |
| `node-schematron` — pure-JS Schematron for browsers, MIT, built on fontoxpath + slimdom | **Verified** — v2.1.0 | [npm](https://registry.npmjs.org/node-schematron/latest) |
| `slimdom` — standards-compliant XML DOM, MIT | **Verified** — v4.3.5 | [npm](https://registry.npmjs.org/slimdom/latest) |
| `saxes` — streaming XML parser, ISC | **Verified** — v6.0.0 | [npm](https://registry.npmjs.org/saxes/latest) |
| `@headless-tree/react` exists, MIT, virtualization-compatible | **Verified** — v1.7.0 | [npm](https://registry.npmjs.org/@headless-tree/react/latest) |
| SchXslt2 — MIT, XSLT 3.0, covers ISO Schematron **2025** edition | **Verified** | [Codeberg](https://codeberg.org/schxslt/schxslt2) |
| ISO/IEC 19757-3:**2025** (Edition 4) published Sept 2025 | **Verified** — supersedes the 2020 edition | [ISO](https://www.iso.org/standard/85625.html) |
| SaxonJS 2 is free-of-charge but **proprietary**; its Node package `xslt3` *does* include an XSLT compiler, so Saxon-EE is **not** required to produce SEF | **Verified — corrects a common misconception** | [Saxonica](https://www.saxonica.com/saxonjs/index.xml) |
| **Chrome removes XSLT in v158 (17 Nov 2026)**; Firefox and WebKit intend to follow | **Verified** | [Chrome for Developers](https://developer.chrome.com/docs/web-platform/deprecating-xslt) |
| File System Access API: Chromium only. Firefox position "harmful", Safari no support | **Verified** — ~28% global | [caniuse](https://caniuse.com/native-filesystem-api) |
| No npm package exposes an XSD *component model* | **Unverified as an exhaustive claim**, but structurally sound: libxml2 keeps particles in private headers, and the code generators are lossy by construction | SPIKE-0 |
| `libxml2-wasm` error granularity — all errors or first-only, with line numbers? | **Unverified — documentation is silent** | SPIKE-1 |
| Effort estimate: 7,000–11,000 LOC for the XSD engine | **Unverified estimate.** Treat as an order of magnitude | — |

---

## 3. Stack

Boring, well-supported choices. The novelty budget is spent entirely on the schema engine.

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript, `strict` | A discriminated-union CST, a typed worker protocol and a command layer with inverses are exactly where this pays |
| Framework | React 19 | Chosen for ecosystem depth in the three things we need: virtualized tree, accessible overlays, command palette |
| Build | Vite | First-class module-worker and WASM handling, which the validators need |
| Repo | pnpm workspaces | `packages/xml-core`, `packages/xsd`, `packages/xsd-libxml2`, `packages/validation-protocol`, `packages/schematron`, `apps/editor` |
| UI kit | shadcn/ui on Radix Primitives + Tailwind v4 | Copy-in source, so a 24px density mode is an edit rather than a fight with a theme API |
| Tree | `@headless-tree/react` + `@tanstack/react-virtual` | Headless, correct ARIA, DnD/typeahead/search as feature flags; virtualization is mandatory at 50k nodes |
| Editor widgets | CodeMirror 6 | Source view and the Schematron XPath field. ~10× smaller than Monaco |
| State | Zustand (UI) + a bespoke command log (document) | See §4.3 |
| Testing | Vitest, Playwright, fast-check | Property-based testing of the automaton is the highest-value test in the project |
| Deploy | Static host, no backend | Optional ~50-line CORS-proxy worker for remote schema fetch, off by default |

Rejected: **Next.js** (no server, so SSR is irrelevant); **Redux Toolkit** (mandates immutable
serialisable state, wrong for the document model); **MUI/Mantine** (Emotion runtime cost at 10k
virtualized rows; neither ships a virtualized tree, which is the one component we actually needed);
**Monaco** (multi-MB for a secondary view); **react-arborist** (owns row rendering, and our rows are
bespoke).

---

## 4. Architecture

### 4.1 Document model — a lossless CST, not the DOM

**Decision: do not build on `DOMParser`/`XMLSerializer`.**

Users keep these files in git. A tool that reformats the document on save produces a 4,000-line diff
on every commit and gets banned by the team. Worse, the browser DOM destroys data *silently*: it
expands entity references (so `&mydash;`, ubiquitous in DocBook/TEI/JATS internal subsets, comes back
as its replacement text and the user's macros vanish), drops the DOCTYPE internal subset, never emits
the XML declaration, rewrites `<a></a>` to `<a/>`, normalises attribute quoting, and applies
namespace prefix fixup that invents prefixes.

Instead: **a custom concrete syntax tree in `packages/xml-core`, parsed with `saxes`.**

Every node carries a `span` into the original source buffer plus a `dirty` flag. Serialisation
**slices the original bytes verbatim for any clean subtree** and re-emits only dirty nodes. This
makes byte-exact round-tripping *structural* rather than a matter of getting a hundred formatting
details right, and makes serialisation O(changed) rather than O(document).

Preserved explicitly: original encoding and BOM, line-ending style, XML declaration form, DOCTYPE and
internal subset verbatim, entity references as first-class nodes (never auto-expanded), CDATA as a
distinct node kind, comments, PIs, and attribute order.

```ts
type NodeId = number & { readonly __brand: 'NodeId' };

interface XmlNodeBase {
  id: NodeId;
  span: { start: number; end: number } | null;  // null once dirty
  dirty: boolean;
}

type XmlNode =
  | ElementNode | TextNode | CommentNode | PiNode
  | CdataNode | EntityRefNode | DoctypeNode;

interface ElementNode extends XmlNodeBase {
  kind: 'element';
  name: QName;
  attributes: AttributeNode[];        // order preserved
  nsDeclarations: NsDeclaration[];
  children: NodeId[];
}
```

Serialisation policy, stated as a rule table in the plan so it is testable: never re-indent inside
`xml:space="preserve"`, inside mixed content, or inside simple-content elements.

### 4.2 Undo — a labelled command log

Every mutation is a command object, not a snapshot:

```ts
interface Command {
  id: string;
  label: string;              // 'Added <item> (3rd)', 'Changed @currency to EUR'
  affectedPath: NodePath;
  apply(doc: Document): void;
  invert(doc: Document): void;
}
```

Human-readable labels are generated at construction time, which is what makes the **visible History
panel** possible. Rapid typing coalesces on a 500ms idle; a drag-reorder coalesces into one entry.
Undo always moves focus and scrolls to the affected node — silent undo is the top complaint about
every editor in the prior art.

Quick fixes return commands too, so a fix is atomically undoable as one step rather than unwinding in
pieces.

### 4.3 State

- **Document model:** the command log above, outside React. Stable `NodeId`s mean selection,
  expansion state and validation results survive edits.
- **UI state:** Zustand (panel sizes, selection, expansion, expert mode, filter).
- **Editing modes:** XState, used narrowly for exactly three flows where boolean-flag soup would
  otherwise emerge — the new-document wizard, drag-and-drop, and the validation lifecycle.

### 4.4 Workers

Validation and schema compilation run in a dedicated module worker. Hand-rolled typed message
protocol rather than Comlink: we need revision tagging and terminate-and-respawn cancellation, which
Comlink's transparent-proxy model hides.

```ts
type WorkerRequest =
  | { type: 'compileSchema'; revision: number; sources: SchemaSource[] }
  | { type: 'validate'; revision: number; text: string; lineMap: NodeId[] }
  | { type: 'cancel'; revision: number };
```

Results carry the revision they were computed for; stale results are rendered dimmed rather than
cleared, so the UI never flickers to "no problems" mid-edit.

---

## 5. Validation

Full detail in [`docs/validation.md`](docs/validation.md).

### 5.1 XSD — our engine targets 1.1; two oracles check it

**XSD 1.1 is in scope** (confirmed decision). That changes the validator layer, because **no
JavaScript XSD 1.1 validator exists, in the browser or out of it** — libxml2 is 1.0-only and its
maintainer has said 1.1 is not planned; Saxon-EE does 1.1 properly but is a commercial per-seat Java
product with no browser story.

The saving grace is that **we were always writing the schema engine ourselves** (§4, and
[`docs/schema-engine.md`](docs/schema-engine.md)), so 1.1 is an *extension* of that work rather than a
different architecture. Better, the two headline 1.1 features are XPath-shaped: `xs:assert` is
literally an XPath 2.0 expression and `xs:alternative` (conditional type assignment) is an XPath
predicate. **fontoxpath is already a mandatory dependency** for Schematron and the XPath editor, so the
marginal cost of 1.1 assertions is small. The remaining 1.1 work is `openContent`, `xs:override`, the
relaxed `xs:all` (unbounded members, wildcards inside), and relaxed UPA.

So the layering is:

| Role | Engine | Scope |
|---|---|---|
| **Guidance + primary verdict** | our engine (`packages/xsd`) | XSD 1.0 **and** 1.1 |
| Fast differential oracle | `libxml2-wasm` (MIT, v0.7.1) | the 1.0 subset — still most real schemas |
| Authoritative 1.1 oracle | `xmlschema` (MIT, v4.3.2) under Pyodide | full 1.1, CI always + an in-app "full conformance check" |

`xmlschema` is **pure Python** — its only dependency is `elementpath`, also pure Python — so micropip
installs it under Pyodide with no C extensions to cross-compile. It is heavy (Pyodide is ~6–10MB), so
it loads lazily in its own worker, never on the critical path, behind an explicit user action. In CI it
runs under plain CPython, where it costs nothing.

Two further consequences:

- **A 1.1-legal schema can be UPA-invalid under 1.0.** So when the 1.0 oracle disagrees with our
  engine on a 1.1 schema, that is expected, not a bug — the differential harness must know which
  version a schema declares and pick its oracle accordingly, or it will drown in false failures.
- **`xs:import`/`xs:include` support in `libxml2-wasm` is flagged experimental.** We resolve the schema
  graph ourselves in JavaScript before calling into WASM — walk it, resolve every `schemaLocation`
  through an in-app catalogue, rewrite to flat deterministic filenames, and materialise the closure
  into the WASM virtual FS. libxml2 never attempts a fetch. This is SPIKE-2.

Schematron remains valuable rather than redundant: co-occurrence rules are often *more* readable as
Schematron asserts with human-authored messages than as `xs:assert`, and Schematron messages are what
give the Problems panel its plain English.

**Error→node mapping.** Rather than guessing from line/column, *own the serializer*: emit exactly one
element start-tag per line when serialising for validation, and return a `lineMap: NodeId[]`
alongside the text. libxml2's "line 42" becomes an O(1) array lookup, and column numbers — which
libxml2 often reports as 0 for schema errors — become irrelevant.

### 5.2 Schematron — our own interpreter, not XSLT

**This is the most consequential correction the verification pass produced.**

The classical route is to compile Schematron to XSLT and run it. That route is now closed on a clock:
**Chrome removes XSLT entirely in v158 (17 November 2026), and Firefox and WebKit have both signalled
they will follow.** Any design depending on the browser's `XSLTProcessor` has a hard expiry date four
months from now. The alternative XSLT runtime, SaxonJS 2, is free of charge but **proprietary and not
open source** — an easy trap to walk into, since "free" reads as "open source", and a licence review
item if x-editor is ever distributed commercially.

**Decision: write a direct Schematron interpreter over `fontoxpath`, starting from `node-schematron`
(MIT, already exactly this design — fontoxpath + slimdom) rather than greenfield.**

This is not a compromise; it is better on four independent axes:

1. **No XSLT engine at all**, so nothing to break in November.
2. **fontoxpath is a mandatory dependency regardless** — a Schematron *editor* for beginners has to
   evaluate XPath live for autocomplete, "what does this context match", and per-rule testing. So the
   interpreter's marginal cost is roughly one module, whereas SaxonJS would be pure additional cost.
3. **Findings bind to nodes by identity.** We hold the actual node object when an assert fails. The
   SVRL route hands back a `@location` XPath string that then has to be resolved back onto the tree.
4. **Per-rule statistics become possible** — fire counts, shadowing detection, per-assertion pass/fail
   — which is the single best beginner feature in the Schematron editor (§7.2) and is impossible
   through a compiled SVRL pipeline.

Via fontoxpath's `IDomFacade`, **our own CST is the XPath data model** — no second DOM, no sync
problem.

Accepted limitation, detected and reported rather than silently mis-validated: schemas embedding
foreign XSLT (`xsl:function`, `xsl:key`, `xsl:template`) cannot run. These get an explicit "this
schema needs a full XSLT engine" message. Real-world healthcare and DITA Schematron does sometimes use
these.

**SchXslt2 (MIT) + `xslt3` under Node is retained in CI as a differential oracle**, never shipped to
the browser. Note it targets ISO Schematron's **2025 edition** (Edition 4, published Sept 2025) — our
interpreter should target the same edition.

### 5.3 Guidance vs. verdict, and the drift risk

The guidance engine and libxml2 are two independent implementations of XSD semantics. If they
disagree — the palette offers an element libxml2 then rejects, or vice versa — the product actively
teaches beginners wrong things, which destroys the entire value proposition.

This is the top project risk (§11) and is mitigated structurally: **differential testing in CI over
the W3C XML Schema Test Collection plus real-world schemas** (UBL 2.1, GML 3.2, HL7 CDA, DocBook,
SEPA pain.001), with a published pass-rate figure so nobody can quietly claim the engine "works".

---

## 6. The interface

Full specification in [`docs/ux-spec.md`](docs/ux-spec.md). The essentials:

**Four-region shell.** App bar (40px) / left Derived views (Source, Diagram, History; 380px) /
**centre Tree** (flexible, min 480) / **right Inspector** (360px, resizable 280–560) / bottom Problems
strip.

The **Inspector** holds the attributes editor and sits on the right, where this class of panel
conventionally lives — Figma, Xcode and Sanity all put it there, and so does every IDE property
pane. The generalisation worth holding onto is that it is the *selection inspector*, not merely an
attributes grid: everything about the selected node in one fixed place, which is the property
beginners rely on most. Sections, in order: identity header with validity badge → *What is this?*
documentation → **Attributes** (required first, then set, then unset) → value editor → *Allowed here*
content-model summary → *Problems with this node*. Sections come from a per-document-kind registry so
XSD and Schematron swap sections in without a second layout.

The read-only projections — source text, schema diagram, history — go on the left, deliberately away
from the controls that change the document.

**The Insert palette is the most important screen in the product.** A popover listing only what is
legal at the caret, grouped in fixed order: **Required — missing (n)** with an `Add all required`
button / **Suggested next** / **Optional (n)** / **Repeat this** / **Templates**. Every row carries the
element name, a cardinality chip reading literally (`2 of 1–3`), and a one-line plain-English
description. Fuzzy search matches documentation text as well as element names, so typing "price"
surfaces an element named `amt` documented as "unit price". A preview pane shows the exact XML to be
inserted.

Insertion is rendered three ways at once so it cannot be missed: a persistent ghost `+ Add …` row in
the tree, a primary toolbar button, and four key bindings (`Ctrl+Space`, `/`, `+`, `Insert`).

**The teaching promise cannot depend on schema authors having written documentation.** Most schemas a
beginner meets have no annotations at all. `describe.ts` therefore *always* returns a sentence,
falling back to one generated from the compiled model: humanise the element name, add the base-type
description from a hand-written map of the ~45 built-in types, add a cardinality clause, add a facet
clause — "*Ship date* holds a date. Exactly one is required here." Generated descriptions are marked
`auto` so users learn to distinguish authored guidance from inferred.

**Accessibility.** `role="tree"` with `aria-activedescendant` — deliberately *not* `treegrid`, whose
screen-reader support is inconsistent and whose column model breaks on our variable-width rows.
Virtualization unmounts rows, which would destroy DOM focus, so `activedescendant` is forced. Colour
is never the only signal of validity. A single polite live region announces every structural change.

**Expert mode removes chrome, never capability.** Ship the toggle on day one and make every UI
decision answer "which side of the toggle?", or beginner scaffolding accretes until the tool is slow
for everyone.

---

## 7. The three document kinds

One model, three projections. The XSD "component tree" and the Schematron "semantic tree" are
*derived projections over the same CST*, never a second editable model — that is where every sync bug
in this class of tool lives.

### 7.1 XSD mode

Semantic component tree by default (Global Elements / Types / Groups / Imports), literal source tree
as a toggle, sharing one selection addressed by `NodeId`. `minOccurs`/`maxOccurs` render as a single
friendly `0..∞` cardinality control rather than two attributes buried in a list. The Inspector gains a
**Facets** section with a live "test a value against this type" box, and its documentation card becomes
*editable* — writing `xs:documentation` is the highest-leverage thing an XSD author can do for
downstream users of this very editor, so the UI nudges it.

The Altova-style SVG box diagram is deferred to Phase 5: beginners cannot read that notation, so it is
not the beginner win it appears to be.

**`xs:pattern` needs a dedicated translator.** XSD regex is not JavaScript regex: it is implicitly
anchored, supports character-class subtraction (`[a-z-[aeiou]]`) which JS lacks entirely, has the
`\i \I \c \C` XML-name escapes, and lacks JS's backreferences and lazy quantifiers. Treating them as
interchangeable corrupts validation silently. ~400 LOC, plus a string generator over the same AST so
the UI can show "like `AB123456`" — worth more to a beginner than the pattern itself.

### 7.2 Schematron mode — the live test harness is the killer feature

The document is shallow (`schema > pattern > rule[@context] > assert|report[@test]`); the real work is
in expressions. So the Inspector swaps its attributes-first layout for an **XPath editor** on
CodeMirror 6, with namespace-aware completion drawn from `sch:ns` declarations and from the associated
XSD.

Bound live to a sample instance document open in another tab:

- "this context matches **14 nodes**", updating as you type
- per-rule fire counts and **shadowing detection** (rule 2 never fires because rule 1 claims its
  context first — first-match-wins is the Schematron semantic beginners trip over most)
- per-assertion pass/fail lists, clickable through to the instance
- message preview with `sch:value-of` interpolation resolved against real nodes

That live binding is what turns Schematron from an expert-only format into something a beginner can
iterate on.

Schematron also gives the product its plain-English layer for free: `sch:assert` messages are
human-authored, `sch:diagnostic` carries "how to fix this" text, and `@role` carries severity. The
authoring UI should flag assertions that lack a diagnostic, because those are the rules whose failures
read badly downstream.

Pleasing reuse: Schematron is itself defined by a schema, so the same content-model engine drives its
palette with no special-casing.

### 7.3 Cross-document workflows

- **Infer an XSD from sample documents** — SOA→SORE inference (Bex, Neven & Vansummeren, VLDB 2007;
  roughly what Trang does). Framed as a *draft* with per-decision evidence, never as authoritative.
- **Generate a sample instance from an XSD** — required-only / recommended / everything.
- **Associate documents** — `xsi:schemaLocation`, the `xml-model` PI for Schematron, and a
  project-level association when the file says nothing.
- **"Explain my document"** — a read-only guided walkthrough for a beginner opening an unfamiliar XML.

---

## 8. Security model

Client-side is not a security property. Three exposures, each with a named mitigation:

**A malicious `.sch` is arbitrary code execution against a confidential document.** Classical
Schematron compiles to XSLT, which is Turing-complete and has `fn:doc()`/`unparsed-text()`. A rule
could exfiltrate the entire document from inside the user's browser, with the user's network position.
Our fontoxpath interpreter is **safe by construction** — fontoxpath has no `fn:doc()` unless you supply
a resolver, and no filesystem or network access. This is a second, independent reason for the §5.2
decision. Embedded Schematron inside `xs:appinfo` (a common real-world pattern the user never
consciously ran) is covered by the same interpreter.

**libxml2 entity and network exposure.** Named flag policy, asserted by unit test:
`XML_PARSE_NONET`, and **never** `NOENT`, `DTDLOAD`, `DTDATTR`, `XINCLUDE` or `HUGE`. A test that feeds
billion-laughs and a `file:///etc/passwd` XXE payload and asserts failure. All resource resolution goes
through one choke point that only serves buffers already in the catalogue; there is no `fetch` anywhere
in the validation path.

**Never auto-fetch a remote `schemaLocation`.** A document asking to load `http://evil.example/x.xsd`
gets a prompt showing the full URL. This is the most likely place someone adds a convenience `fetch()`
later, so it is a named rule.

**Privacy:** no telemetry in v1, and the plan should say so plainly — a promise that is enforceable
because there is no server to send anything to.

---

## 9. Testing

| Layer | Approach |
|---|---|
| Well-formedness | W3C XML Conformance Test Suite against the saxes-based parser, with a documented known-fail list |
| XSD conformance | W3C XML Schema Test Collection (~30k cases), **both the 1.0 and 1.1 test sets**. **Publish the pass rate internally** so claims stay honest |
| Guidance vs. verdict | Differential testing over UBL 2.1, GML 3.2, HL7 CDA, DocBook, SEPA pain.001 — against `libxml2-wasm` for 1.0 schemas and `xmlschema` (CPython, no Pyodide needed in CI) for 1.1. **The harness must dispatch on the schema's declared version**, or 1.1 schemas produce a flood of false failures from the 1.0 oracle |
| Content-model automaton | **Property-based (fast-check): generate random particle trees, compare `whatCanGoHere` against a naive backtracking reference matcher.** This is the single highest-value test in the project — it catches the Glushkov follow-set and counter-clamping bugs that would otherwise reach users as "the editor says I can't add this but the validator says it's fine" |
| Schematron | Differential against SchXslt2 + `xslt3` under Node |
| Round-trip | Golden-file byte-identity tests over a corpus with CRLF, BOMs, entity refs, CDATA, internal subsets |
| Accessibility | `@axe-core/playwright`, plus tests asserting the ARIA tree contract (`aria-level`, `aria-setsize`, `aria-posinset`) which silently regresses |
| E2E | Playwright across Chromium/Firefox/WebKit — mandatory, not optional, because the File System Access tiering differs per engine |

---

## 10. Roadmap

Each phase is independently demo-able and ends with an explicit *done when*. No calendar dates;
phases are ordered and relatively sized.

### Phase 0 — Spikes (small) — **done, bar SPIKE-4**
Resolve SPIKE-0…3 (§12) before the architecture is fixed.
**Done when:** each spike has a written answer and the affected decisions are confirmed or changed.
Answers in [`docs/spikes.md`](docs/spikes.md). SPIKE-0…3 are resolved and every affected decision
held. SPIKE-4 (mixed content) stays open and is scheduled where the plan put it, in Phase 8.

### Phase 1 — Lossless core (medium) — **done**
`packages/xml-core`: saxes-based CST, spans, command log with inverses, splice serializer. No UI
beyond a debug view.
**Done when:** the golden-file corpus round-trips byte-identically, and property tests confirm
`apply`→`invert` is the identity over random edit sequences.

### Phase 2 — Tree editor, no schema (medium) — **done**
The four-region shell, virtualized tree, right-hand Inspector with a raw attributes editor, source view,
undo/redo with the History panel, open/save. Schema-less editing only.
**Done when:** a 50k-node document opens, edits and saves with no reformatting, entirely by keyboard.

### Phase 3 — The guidance engine (large — this is the product) — **done, bar the differential corpus**
`packages/xsd`: parse → assemble → resolve → simple types → complex types → particle automaton →
substitution indices → query API. Then the Insert palette, `describe.ts`, required-missing badges,
skeleton generation.
**Done when:** given an unfamiliar schema, a user who has never seen it can build a valid document
using only the palette — and the palette's answers agree with libxml2 across the differential corpus.

Both halves hold on the corpus that exists. The palette places each element where the content model
expects it, fills in required attributes and children, and "Add all required" turns an invalid
element into a valid one in one undoable step. `packages/xsd/test/differential.test.ts` checks every
verdict against `libxml2-wasm` and fails the build on a disagreement — it caught one on its first
run (see [`docs/spikes.md`](docs/spikes.md)). What remains is *breadth*: the real corpora named in §9
(the W3C Schema Test Collection, UBL 2.1, GML 3.2, HL7 CDA, DocBook, SEPA) are not yet vendored.

### Phase 4 — Validation and quick fixes (medium) — **done, bar four classes with named reasons**
libxml2-wasm in a worker, the `lineMap` error→node mapping, the `cvc-*` message catalogue, the
"Why is this invalid?" explainer, the edit-distance repair algorithm behind quick fixes.
**Done when:** every one of the 20 error classes in [`docs/schema-engine.md`](docs/schema-engine.md)
renders in plain English with at least one working one-click fix.

16 of the 20 do, and `packages/xsd/test/taxonomy.test.ts` is the evidence — it asserts, class by
class, that the message carries no `cvc-` spec-ese, that at least one fix exists, and that the fix
reads as an instruction. The four outstanding are named rather than quietly omitted: **13 and 14**
(ID/IDREF and identity constraints) need P8, which this plan defers; **18** (well-formedness) belongs
to `xml-core` and is reported before this engine runs; **20** (Schematron) is Phase 5.

The repair algorithm is Oflazer error-tolerant alignment, as specified, and a property test checks
that every alignment it proposes produces a child list the reference matcher accepts — a quick fix
that leaves the document invalid would be worse than none.

### Phase 4b — XSD 1.1 (medium) — **done, bar the conformance rate**
`xs:assert` and `xs:alternative` evaluated through fontoxpath (already present), `openContent`,
`xs:override`, relaxed `xs:all`, relaxed UPA. Version dispatch on the schema's `vc:minVersion` /
declared version. `xmlschema`-under-Pyodide wired in as the lazily-loaded conformance check, and as
the CI oracle for 1.1.
**Done when:** the W3C XSD 1.1 test set passes at a published rate, and a schema using `xs:assert`
gives guidance and a verdict that agree with `xmlschema`.

The second half holds: `packages/xsd/test/differential11.test.ts` checks every 1.1 verdict against
`xmlschema` 4.3.2 under CPython, in CI. The first half waits on the same thing Phase 3's does — the
W3C test collection is not yet vendored, so there is no rate to publish and none is claimed.

Two things came out differently from the plan's expectation, both for the better. **`xs:openContent`
never reaches the automaton**: interleaved open content would mean interleaving the whole model with
a wildcard loop, an explosion in states, when the same semantics fall out of removing the
wildcard-matched children before the model runs. And **version dispatch does not trust
`vc:minVersion`** — a schema using 1.1 constructs *is* 1.1 whether or not it says so, and detecting
that structurally is what stops the 1.0 oracle being pointed at a 1.1 schema.

The XPath layer is the phase's real asset: `packages/xsd/src/xpath.ts` makes the CST itself the
XPath data model through fontoxpath's `IDomFacade`, so there is no second DOM to keep in sync.
Phase 5's Schematron interpreter and its live XPath editor both sit directly on it.

### Phase 5 — Schematron (medium) — **done, with the oracle substituted**
The fontoxpath interpreter (from `node-schematron`), the Schematron editor mode, the live test
harness, SchXslt2 differential CI.
**Done when:** a beginner can write a working rule against a sample document and see it fire, and our
findings match SchXslt2 across the corpus.

Both halves hold. Attaching a sample document to a `.sch` file gives live counts beside every
expression — how many nodes a context matches, how many it fires on, per-assertion pass and fail
counts, the rendered message with `sch:value-of` resolved, and a named warning when a rule is
shadowed and never runs.

**The oracle is substituted and the substitution is stated.** SchXslt2 is not on npm and vendoring a
third-party XSLT distribution is a larger step than it looks, so `lxml.isoschematron` stands in — it
bundles the ISO skeleton XSLT and is genuinely independent, working by compile-to-XSLT where we
interpret. Its real limit is that libxslt is XSLT 1.0, so the corpus sticks to expressions that mean
the same under XPath 1.0 and 3.1; `queryBinding="xslt2"` features are unchecked by it.

Written from scratch rather than forked from `node-schematron`: the parts that would have been
reused are the parts our own CST and XPath facade already provide, and what remains — first-match-
wins claiming, the statistics, abstract-pattern expansion — is the substance of the phase.

### Phase 6 — XSD authoring (medium) — **done**
Component tree, facets editor with live type testing, XSD regex translator, refactorings (rename with
ref updates, extract/inline type), schema self-validation including UPA warnings.
**Done when:** a schema author can rename a type, extract an anonymous one, and be told their content
model is ambiguous, without leaving the editor or breaking the file.

All three hold, and the phase is built on one decision worth stating: **a schema is a graph written
as a tree**, and the tree view is structurally incapable of showing the edges. `type="Address"` is a
reference the outline cannot draw, which is why every operation here exists — each one is something
that means "find all the edges yourself, and get none of them wrong".

The component view (`apps/editor/src/model/componentTree.ts`) is a *projection* over the same CST,
not a second model. Rows address the same `NodeId`s, so selection, the Inspector and undo all work
across the toggle with nothing to synchronise — every sync bug in this class of tool lives in the gap
between two representations of one document. Heading rows are synthetic and their collapsed state is
encoded outside the real `NodeId` range, so collapsing "Simple types" does not collapse the schema
element it hangs from.

Rename, extract and inline are in `apps/editor/src/model/xsdAuthoring.ts`, and none of them consults
the compiled model to find references. That is deliberate: renaming has to work on a schema that does
not currently compile, which is the state a schema is in for most of the time anyone is editing it.
References are found syntactically from a table of the twelve QName-valued attributes in XSD, kept in
their six symbol spaces — `ref` means three different things depending on the element it sits on, so
a generic rule would silently merge a group and a type of the same name.

Three things the refactorings refuse to do, each because the alternative is a confident wrong answer:
inline a type more than one declaration shares; extract under a name already taken; and extract when
no correct reference text exists at all (no target namespace, but a default `xmlns` in scope, so
"a name in no namespace" cannot be written in an attribute value). A round-trip test asserts that
extract-then-inline returns the file byte-for-byte, including indentation — both operations move a
subtree between depths, and a reformat nobody asked for is the fastest way to get a tool banned.

Self-validation reports what parses and is still wrong: dangling references and ambiguous content
models. The dangling-reference check stays quiet when the schema has an `include` or `import`,
because the missing component may well be in a document this editor was never given. Its most useful
output is the hint on the commonest XSD bug of all — a `targetNamespace` with no matching default
`xmlns`, so every unprefixed reference means a name in no namespace while pointing at a declaration
sitting visibly two lines below.

The facets panel is built around a live test box rather than a form. A facet list tells an author
what they wrote; typing a value that ought to be legal and watching it fail tells them what they
*meant*. It surfaces the XSD regex translator directly, including its two honest failure modes — a
pattern that could not be read, and one checked loosely because it uses a Unicode property inside a
subtraction.

### Phase 7 — Beginner scaffolding (medium) — **done, bar coach marks and expert mode**
Form view, the new-document wizard, onboarding empty states and the three bundled examples, smart
paste, "explain my document", schema inference.
**Done when:** someone who has never seen the schema can go from an `.xsd` to a valid document, and
someone who has never seen the document can find out what it is.

Both hold. The wizard's three questions — which schema, which root, how much — produce a document
already shaped like the answer, and the "how much" step measures both options by generating them
rather than describing them: *142 elements, 9 values to review* beats "this may be large".

The single decision the phase turns on is that **a generated document is valid and meaningless**.
That is the failure mode of every document generator and it is invisible without help: the badge
reads green while every date says `2026-01-01`. So the scaffolder marks every value it had to invent,
the app bar counts them, `F7` steps through them and the tree dots them where they sit. Values from
`fixed` and `default` are not marked — the schema author already decided those, and listing them
would pad the to-do list with items nobody can act on.

Whether a generated value has been reviewed is derived by comparing it against the document rather
than tracked through the edit that changed it. That is exact, costs one pass over the placeholder
list, and gets undo right for free; an intercept-the-edit scheme silently loses entries, and there is
a test pinning that case specifically.

**Smart paste** asks before the edit instead of reporting errors after it, with each option's cost
measured — *paste inside: adds 2 errors* — and ranked by consequence first, proximity second. A plain
`Ctrl+V` still goes straight through when exactly one option is valid, because turning an expert's
paste into a dialogue is its own kind of failure. The fragment is reconstructed node by node rather
than regenerated from the schema: an earlier version built a skeleton per pasted name and produced
structurally correct elements containing none of what was on the clipboard, which a test now forbids.

**Schema inference** is permissive where the evidence is thin and exact where it is not. Anything
seen twice is written `unbounded` — permitting one more than the file showed is a smaller mistake
than rejecting the next file — while every value stays `xs:string`, because guessing `xs:date` from
one date-shaped string rejects documents the author would have accepted. The caveats are part of the
output, not a disclaimer around it.

The three bundled examples are chosen for one lesson each: the purchase order teaches the core loop,
the topic teaches prefixes and mixed content across two namespaces and an import, and the invoice is
structurally perfect and wrong — its total is 120.00 against lines summing to 140.00. A test asserts
it fails exactly one rule and goes green when corrected, so if the first-minute demo of error →
explanation → fix → green ever stops working, CI says so rather than a user.

Two items from the UX spec are **not** done and are not claimed: first-run coach marks, and expert
mode's chrome removal. Both are presentation-only and neither changes what the tool can do.

### Phase 8 — Polish (ongoing) — **the two that carried risk are done**
Mixed-content editor, XSD diagram, table view for repeated siblings, PWA/offline, i18n.

**Mixed content — SPIKE-4, and §11 risk 3 — is answered, and the spike asked the wrong question.**
Both of its candidate answers (ProseMirror with a generated schema; a scoped CodeMirror) are
*editors*, and the unusable part was never the editing — it was the **display**. `<p>See
<emph>this</emph> for details.</p>` is five unreadable rows before anyone types anything. So a mixed
element is now **one tree row carrying its flow**, with marked-up runs shown as `⟨…⟩` rather than
stripped, so it is never a surprise that half a sentence is tagged. The children stay reachable.

Editing is then a much smaller problem, answered with a scoped source snippet: the inner XML in a
textarea, the schema's permitted inline elements as wrap buttons, and nothing committed until it
parses — refusing a broken commit matters more here than anywhere else, because the alternative is
discarding a paragraph someone was midway through typing. ProseMirror was declined deliberately: it
costs ~150 KB in the entry chunk plus a second document model to keep in step with the CST, which is
the exact two-representations problem this codebase is arranged around, bought for a minority of
documents. The seam is `FlowEditor`; `flowSource` and `setFlow` are the whole interface, so a WYSIWYG
surface can replace it later without anything else moving. What is given up is WYSIWYG, and someone
editing a 200-paragraph DITA topic all day will want it.

**The table view** turns twelve `<line>` elements with four children each — 60 tree rows — into
twelve rows and four columns. Reading *down* a column is the question a tree makes hard and a grid
makes free. It is offered only where a list actually exists, columns accumulate across rows so one
row missing an optional child does not lose the column for the rest, and a cell whose element is
absent creates it on first edit rather than being a hole. Nested children never become columns: they
would produce a grid whose columns mean different things at different depths.

**Not done, and not claimed:** the XSD box diagram (deferred in §7 on the grounds that beginners
cannot read that notation, and unchanged), PWA/offline, i18n, first-run coach marks, and expert
mode's chrome removal. None changes what the tool can do.

---

## 11. Risks, ordered by likelihood of sinking the project

1. **Guidance/verdict drift** (§5.3). The tool confidently teaches a beginner something the validator
   then rejects. *Mitigation:* differential CI from Phase 3 day one; property-based automaton tests;
   published pass rate. Never ship a palette suggestion the oracle disagrees with.
2. **The XSD engine is underestimated** — and XSD 1.1 being in scope makes this worse, since we now own
   the *only* 1.1 implementation in the stack rather than checking ourselves against a mature one.
   7,000–11,000 LOC was an unverified estimate for 1.0 alone, and the simple-type compiler is the
   sleeper (44 built-in types, 12 facets, plus the regex translator). *Mitigation:* the phased split in
   [`docs/schema-engine.md`](docs/schema-engine.md) has a usable ~3,500-LOC v1; sequence the automaton
   and query API *early* because they are the differentiator; treat 1.1 features as a distinct later
   phase so 1.0 documents are never blocked on them, and lean on `xmlschema` hard in CI.
3. **Mixed content.** A row per node turns `<p>See <emph>this</emph> for details.</p>` into five rows —
   unusable. This is the entire DocBook/DITA/TEI/JATS world, exactly the audience a beginner-friendly
   XML editor attracts. *Mitigation:* decide in Phase 0, implement in Phase 8. Recommended: an inline
   flow editor (ProseMirror with a schema generated from the content model) for `mixed="true"` elements;
   cheaper fallback is a scoped CodeMirror snippet editor.
   *Status:* **addressed, and the recommendation was not taken.** The diagnosis was right and the
   prescription was aimed at the wrong half: five rows is unreadable before any editing happens, so
   the fix is that a flow is one row. Editing is a scoped source snippet with schema-driven wrap
   buttons; ProseMirror was declined for the entry-chunk cost and the second document model. See
   SPIKE-4 in [`docs/spikes.md`](docs/spikes.md).
4. **Bundle weight.** Two engines plus CodeMirror plus fontoxpath is multiple MB. *Mitigation:*
   rigorous lazy loading per mode, `size-limit` failing the build on regression. A stray top-level
   import pulling a validator into the main chunk is the failure mode.
   *Status:* **this has already happened once** — adding XSD 1.1 assertions statically imported
   fontoxpath and put 330KB into the entry chunk. `scripts/check-bundle.mjs` now runs in CI and
   fails the build on both the size and the chunk separation, since a one-line mistake that looks
   like nothing has to be caught mechanically rather than remembered.
5. **`libxml2-wasm` is pre-1.0** and its schema import/include support is experimental. *Mitigation:*
   pin exactly, wrap behind the `XsdEngine` interface, keep `xmllint-wasm` working in CI.
6. **Memory, not CPU, is the ceiling.** A 50MB instance expands to 400–600MB inside the wasm32 heap and
   browsers OOM well below the 4GB limit. *Mitigation:* a stated threshold policy with graceful
   degradation ("validation off above N MB"), not "we'll optimise later".
7. **File System Access is Chromium-only** (~28% of users get save-in-place; Firefox calls it
   "harmful"). *Mitigation:* design the download/upload path as the *primary* one with FSA as
   progressive enhancement, not the reverse. OPFS for autosave works everywhere.
8. **`saxes` is mature but low-activity.** *Mitigation:* it is ~40KB of ISC-licensed pure JS; vendoring
   and patching it is a viable last resort.

---

## 12. Spikes to resolve before the architecture is fixed

| ID | Question | Success criterion |
|---|---|---|
| **SPIKE-0** | Does *any* library expose an XSD component model with content-model particles intact? | **Answered: no, build it.** Survey in [`docs/spikes.md`](docs/spikes.md); the architecture stands |
| **SPIKE-1** | Does `libxml2-wasm` report *all* validation errors with line numbers, or throw on the first? | **Answered: all of them, with line numbers; columns are always 0.** No need for `xmllint-wasm`, and the `lineMap` design is confirmed |
| **SPIKE-2** | Can we drive multi-file schema sets through `libxml2-wasm`'s experimental import/include, or must we flatten into the virtual FS? | **Answered: they work through a registered input provider**, which is also the security boundary — libxml2 never resolves anything itself. Still to re-run on UBL 2.1 |
| **SPIKE-3** | Does the Glushkov automaton meet the interactive latency budget on real schemas? | **Partially answered: sub-millisecond on every schema built so far.** The UBL 2.1 / GML 3.2 criterion waits on the corpus |
| **SPIKE-4** | Mixed content: ProseMirror-with-generated-schema, or scoped CodeMirror? | A working prototype editing a DocBook `<para>` with inline `<emphasis>`, with undo and validation mapping intact |

---

## 13. Decisions

**Answered:**

1. ~~Is XSD 1.1 in or out?~~ **In.** Folded into §5.1 — our engine targets 1.1, with `xmlschema` under
   Pyodide as the authoritative oracle. Adds roughly one phase of work to `packages/xsd` and makes
   fontoxpath load-bearing for XSD as well as Schematron.
2. ~~Is this destined to be commercial?~~ **No.** Every shipped dependency is MIT/ISC/Apache regardless,
   so nothing changes structurally; it does mean the proprietary SaxonJS fallback stays off the table
   permanently rather than merely being unattractive, which is fine — Chrome's XSLT removal had already
   settled that.

**Still open:**

3. **Do you need to open DTD- or RELAX NG-based documents?** Common in the documentation-schema world.
   Currently out of scope; opening one should at minimum give a clear "not supported" rather than a
   confusing parse error.
4. **How large are the documents you actually care about?** The design targets 50k nodes comfortably.
   50MB+ files change the architecture (streaming, partial loading) rather than just the tuning.
