# x-editor — Implementation Plan

A browser-based, tree-node editor for **XML**, **XSD** and **Schematron**, with XSD and Schematron
validation running client-side, designed so that someone who does not already know the schema can
still produce a valid document.

**Status:** plan, pre-implementation. The repository is empty apart from this document.

**Companion documents**

| Document | Contents |
|---|---|
| [`docs/schema-engine.md`](docs/schema-engine.md) | The guidance core: XSD component model, content-model automaton, `whatCanGoHere`, quick fixes |
| [`docs/validation.md`](docs/validation.md) | XSD and Schematron validation architecture, error→node mapping, the security model |
| [`docs/ux-spec.md`](docs/ux-spec.md) | Layout, tree anatomy, the Insert palette, keyboard map, design tokens, accessibility |

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
- **XSD 1.1 authoring and validation** in v1 — see §5.1 for why, and the mitigation.
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
| Repo | pnpm workspaces | `packages/xml-core`, `packages/xsd`, `packages/schematron`, `packages/validation-protocol`, `apps/editor` |
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

### 5.1 XSD — libxml2 via WASM

`libxml2-wasm` (MIT, v0.7.1) as primary, `xmllint-wasm` as a named fallback behind an `XsdEngine`
interface — same underlying engine, so switching is a driver swap, not a rewrite.

Two consequences must be stated in the product, not buried:

- **XSD 1.0 only.** libxml2 has no 1.1 and its maintainer has said it is not planned: no `xs:assert`,
  `xs:alternative`, `openContent` or `xs:override`. The mitigation is pleasing, because it is the
  historical one: *the recommended answer to "I need assertions in XSD 1.0" has always been
  Schematron* — which this product also ships. A 1.1 schema that fails to compile gets an explicit
  "this schema uses XSD 1.1 features" message, not a generic parse error.
- **`xs:import`/`xs:include` support in `libxml2-wasm` is flagged experimental.** We therefore resolve
  the schema graph ourselves in JavaScript before calling into WASM — walk it, resolve every
  `schemaLocation` through an in-app catalogue, rewrite to flat deterministic filenames, and
  materialise the closure into the WASM virtual FS. libxml2 never attempts a fetch. This is SPIKE-2.

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

**Four-region shell.** App bar (40px) / **left Inspector** (360px, resizable 280–560) / **centre
Tree** (flexible, min 480) / right Derived views (Source, Diagram, History) / bottom Problems strip.

The brief mandates the attributes editor on the left. The correct generalisation is that the left
panel is the **selection inspector** — everything about the selected node in one fixed place, which is
the property beginners rely on most. Its sections, in order: identity header with validity badge →
*What is this?* documentation → **Attributes** (required first, then set, then unset) → value editor →
*Allowed here* content-model summary → *Problems with this node*. Sections come from a per-document-kind
registry so XSD and Schematron swap sections in without a second layout.

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
| XSD conformance | W3C XML Schema Test Collection (~30k cases). **Publish the pass rate internally** so claims stay honest |
| Guidance vs. verdict | Differential testing against libxml2-wasm over UBL 2.1, GML 3.2, HL7 CDA, DocBook, SEPA pain.001 |
| Content-model automaton | **Property-based (fast-check): generate random particle trees, compare `whatCanGoHere` against a naive backtracking reference matcher.** This is the single highest-value test in the project — it catches the Glushkov follow-set and counter-clamping bugs that would otherwise reach users as "the editor says I can't add this but the validator says it's fine" |
| Schematron | Differential against SchXslt2 + `xslt3` under Node |
| Round-trip | Golden-file byte-identity tests over a corpus with CRLF, BOMs, entity refs, CDATA, internal subsets |
| Accessibility | `@axe-core/playwright`, plus tests asserting the ARIA tree contract (`aria-level`, `aria-setsize`, `aria-posinset`) which silently regresses |
| E2E | Playwright across Chromium/Firefox/WebKit — mandatory, not optional, because the File System Access tiering differs per engine |

---

## 10. Roadmap

Each phase is independently demo-able and ends with an explicit *done when*. No calendar dates;
phases are ordered and relatively sized.

### Phase 0 — Spikes (small)
Resolve SPIKE-0…3 (§12) before the architecture is fixed.
**Done when:** each spike has a written answer and the affected decisions are confirmed or changed.

### Phase 1 — Lossless core (medium)
`packages/xml-core`: saxes-based CST, spans, command log with inverses, splice serializer. No UI
beyond a debug view.
**Done when:** the golden-file corpus round-trips byte-identically, and property tests confirm
`apply`→`invert` is the identity over random edit sequences.

### Phase 2 — Tree editor, no schema (medium)
The four-region shell, virtualized tree, left Inspector with a raw attributes editor, source view,
undo/redo with the History panel, open/save. Schema-less editing only.
**Done when:** a 50k-node document opens, edits and saves with no reformatting, entirely by keyboard.

### Phase 3 — The guidance engine (large — this is the product)
`packages/xsd`: parse → assemble → resolve → simple types → complex types → particle automaton →
substitution indices → query API. Then the Insert palette, `describe.ts`, required-missing badges,
skeleton generation.
**Done when:** given an unfamiliar schema, a user who has never seen it can build a valid document
using only the palette — and the palette's answers agree with libxml2 across the differential corpus.

### Phase 4 — Validation and quick fixes (medium)
libxml2-wasm in a worker, the `lineMap` error→node mapping, the `cvc-*` message catalogue, the
"Why is this invalid?" explainer, the edit-distance repair algorithm behind quick fixes.
**Done when:** every one of the 20 error classes in [`docs/schema-engine.md`](docs/schema-engine.md)
renders in plain English with at least one working one-click fix.

### Phase 5 — Schematron (medium)
The fontoxpath interpreter (from `node-schematron`), the Schematron editor mode, the live test
harness, SchXslt2 differential CI.
**Done when:** a beginner can write a working rule against a sample document and see it fire, and our
findings match SchXslt2 across the corpus.

### Phase 6 — XSD authoring (medium)
Component tree, facets editor with live type testing, XSD regex translator, refactorings (rename with
ref updates, extract/inline type), schema self-validation including UPA warnings.

### Phase 7 — Beginner scaffolding (medium)
Form view, the new-document wizard, onboarding empty states and the three bundled examples, smart
paste, "explain my document", schema inference.

### Phase 8 — Polish (ongoing)
Mixed-content editor, XSD diagram, table view for repeated siblings, PWA/offline, i18n.

---

## 11. Risks, ordered by likelihood of sinking the project

1. **Guidance/verdict drift** (§5.3). The tool confidently teaches a beginner something the validator
   then rejects. *Mitigation:* differential CI from Phase 3 day one; property-based automaton tests;
   published pass rate. Never ship a palette suggestion the oracle disagrees with.
2. **The XSD engine is underestimated.** 7,000–11,000 LOC is an unverified estimate and the simple-type
   compiler is the sleeper (44 built-in types, 12 facets, plus the regex translator). *Mitigation:* the
   phased split in [`docs/schema-engine.md`](docs/schema-engine.md) has a usable ~3,500-LOC v1 that
   drops identity constraints and restriction-legality checking; sequence the automaton and query API
   *early* because they are the differentiator.
3. **Mixed content.** A row per node turns `<p>See <emph>this</emph> for details.</p>` into five rows —
   unusable. This is the entire DocBook/DITA/TEI/JATS world, exactly the audience a beginner-friendly
   XML editor attracts. *Mitigation:* decide in Phase 0, implement in Phase 8. Recommended: an inline
   flow editor (ProseMirror with a schema generated from the content model) for `mixed="true"` elements;
   cheaper fallback is a scoped CodeMirror snippet editor.
4. **Bundle weight.** Two engines plus CodeMirror plus fontoxpath is multiple MB. *Mitigation:*
   rigorous lazy loading per mode, `size-limit` failing the build on regression. A stray top-level
   import pulling a validator into the main chunk is the failure mode.
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
| **SPIKE-0** | Does *any* library expose an XSD component model with content-model particles intact? | A written survey of npm + the libxml2/Xerces public APIs concluding adopt-or-build, with evidence. Kills ~40% of the engineering budget if something is found |
| **SPIKE-1** | Does `libxml2-wasm` report *all* validation errors with line numbers, or throw on the first? | A harness validating a document with 5 distinct errors. If first-only, switch to `xmllint-wasm`, whose CLI-shaped output lists all errors |
| **SPIKE-2** | Can we drive multi-file schema sets through `libxml2-wasm`'s experimental import/include, or must we flatten into the virtual FS? | UBL 2.1 (many files, deep imports) validates correctly and identically to command-line `xmllint` |
| **SPIKE-3** | Does the Glushkov automaton meet the interactive latency budget on real schemas? | `whatCanGoHere` under 16ms on UBL 2.1 and GML 3.2 content models. If not, the derivative-based alternative is the documented fallback |
| **SPIKE-4** | Mixed content: ProseMirror-with-generated-schema, or scoped CodeMirror? | A working prototype editing a DocBook `<para>` with inline `<emphasis>`, with undo and validation mapping intact |

---

## 13. Decisions I need from you

These change the shape of the work and I did not want to assume:

1. **Is XSD 1.1 in or out?** Out is the plan's assumption (libxml2 cannot do it; Schematron covers the
   assertion use case). If any target user needs it, the only browser-viable route is the Python
   `xmlschema` library under Pyodide — a ~6–10MB lazily-loaded escape hatch, which is a real cost.
2. **Do you need to open DTD- or RELAX NG-based documents?** They are common in the documentation-schema
   world. Currently out of scope; opening one should at minimum give a clear "not supported" rather
   than a confusing parse error.
3. **How large are the documents you actually care about?** The design targets 50k nodes comfortably.
   50MB+ files change the architecture (streaming, partial loading) rather than just the tuning.
4. **Is this destined to be a commercial product?** It affects nothing in the current plan — every
   shipped dependency is MIT/ISC/Apache — but it makes the SaxonJS fallback permanently off the table
   rather than merely unattractive.
