# The schema-aware guidance engine

> Companion to [`../PLAN.md`](../PLAN.md). This document specifies the component that makes the
> product usable by a beginner.

## 1. Why this has to be built

The product thesis is *"tell someone who doesn't know the schema what they may put here"*. That
requires answering, at an arbitrary position in a half-finished document:

- What elements may I insert **here** — at this index, inside this parent, given the siblings that
  already exist both before *and after* the caret?
- Which of those are **required and currently missing**?
- What attributes are allowed, which are required, and what are their types, defaults, fixed values
  and enumerations?
- What is the **allowed value space** for this element or attribute?
- What does this element **mean**?
- If I insert it, what must I create inside it to keep the document valid?

No available library answers any of these. The candidates split three ways, and none help:

1. **libxml2 wrappers** (`libxml2-wasm`, `xmllint-wasm`, `libxmljs2`). libxml2 compiles schemas into
   `xmlSchemaParticlePtr`/`xmlSchemaTypePtr` structures declared in *private headers* inside
   `xmlschemas.c`. The public API is `xmlSchemaParse` + `xmlSchemaValidateDoc` and nothing else.
   There is no way to walk the compiled content model, so binding harder does not help.
2. **Code generators** (`cxsd`, `xsd2ts`, `xsd2jsonschema`). These emit TypeScript interfaces or JSON
   Schema, discarding exactly what we need — sequence ordering, occurrence bounds, choice structure,
   substitution groups, mixed content. JSON Schema cannot even express `xs:sequence` ordering, so
   `xsd2jsonschema` is lossy by construction. Most are unmaintained since ~2018.
3. **Real component models** (Apache Xerces2-J `XSModel`, Saxon-EE) are Java/.NET. CheerpJ or TeaVM
   would mean multi-megabyte payloads and painful interop for an engine we would still have to wrap.

This is SPIKE-0: confirm the survey before committing the budget.

**Precedent that the approach is standard, not invented:** Xerces2-J has an interface
`org.apache.xerces.impl.xs.models.XSCMValidator` with the method `int[] whatCanGoHere(int[] state)`,
implemented by `XSDFACM` (DFA content model), `XSAllCM` (the `xs:all` bitset model) and `XSEmptyCM`.
We mirror that three-way split in TypeScript. Xerces is Apache-2.0, so reading it for algorithmic
guidance is legally clean — but **reimplement from the published algorithms** (Brüggemann-Klein &
Wood on 1-unambiguity; Glushkov construction) rather than transliterating, and document that choice.

## 2. The automaton

### 2.1 Glushkov, and why UPA makes it easy

XSD's **Unique Particle Attribution** constraint requires every content model to be 1-unambiguous.
For 1-unambiguous expressions the **Glushkov position automaton is already deterministic** — no
subset construction, no NFA state sets, and the runtime state is a single integer plus a small
counter vector. This collapses the implementation cost dramatically and makes the forward run O(n).

Real-world schemas *do* violate UPA, including hand-written ones a beginner will bring. Detect it at
compile time (any state with two outgoing symbol matchers whose QName sets intersect), surface it as
a **schema warning** in the XSD editor — "this choice is ambiguous, `<a>` could match either branch",
a genuinely valuable feature — and **degrade the runtime to NFA state sets rather than refusing to
open the schema.** Refusing to open a slightly-broken schema is a product failure for our user.

### 2.2 The core query: forward run ∩ backward co-reachability

Precompute per content model: `delta(state, symbol) → state`, `deltaInv` (reverse transitions),
`accepting: Set<state>`, `symbolsFrom(state)`.

To answer *"what may I insert at index `i`?"*:

1. `sPrefix = run(q0, children[0..i))`
2. `CoReach_i = { s : consuming exactly children[i..n) from s lands in an accepting state }`,
   computed by starting from `accepting` and applying `deltaInv` backwards over the suffix
3. valid insertions = `{ sym : delta(sPrefix, sym) ∈ CoReach_i }`

**Step 2 is what makes this genuinely position-aware** rather than merely "children allowed by this
type": a suggestion is only offered if the material already present *after* the caret can still be
completed.

The performance trick: one single backward sweep from `n` down to `0` yields `CoReach_i` for **every
`i` simultaneously**, so all insertion gaps in a parent cost `O(n·|states|)` together, not per gap.
Memoise on `(contentModelId, hash(childNameSequence))`, invalidate on child-list mutation.

### 2.3 Numeric occurrence — a hybrid

Naive Glushkov cannot express `minOccurs="2" maxOccurs="500"`. Three strategies, and the right answer
uses all three:

- **`maxOccurs="unbounded"`**: no counter needed — add follow edges `last(e) × first(e)`, mark
  nullable when `minOccurs=0`.
- **Finite bounds**: unroll into `min` mandatory copies plus `(max−min)` optional copies. Exactly
  correct and trivially debuggable, but blows up (`maxOccurs="1000"` around a 20-leaf sequence gives
  20,000 positions). **Gate on a total-position budget of ~2,000.**
- **Above the budget**: fall back to a counting automaton (Kilpeläinen & Tuhkanen; Gelade, Gyssens &
  Martens on regular expressions with counting). Keep one copy of the sub-automaton, attach a counter
  per numeric-occurrence loop, make the state `(glushkovPosition, Map<loopId, count>)` with counts
  clamped at the loop's bound so the state space stays finite.

In real schemas — UBL, GML, NIEM, XBRL, DocBook, HL7 — `maxOccurs` is essentially always 1 or
unbounded, so the budget is rarely hit. **Instrument it and find out** rather than assuming.

### 2.4 `xs:all` is a bitset, not an automaton

In XSD 1.0 `xs:all` is heavily restricted: every member has `maxOccurs ≤ 1`, it may only be the entire
content model of a type, it cannot nest and it cannot repeat. So build an `AllContentModel` whose
state is a bitset of already-seen members. `whatCanGoHere` = every member not yet present (identical
at every gap, since order is free); required-and-missing = required members minus seen. Simpler and
faster than the automaton path, and it mirrors Xerces's `XSAllCM`.

XSD 1.1 relaxes all of this, so generalise the bitset to a counter vector behind a version flag if
1.1 ever comes into scope.

### 2.5 Substitution groups — symbol matchers, never expansion

Precompute the transitive closure `subsOf(head) = {head} ∪ ⋃ subsOf(member)`. A particle referencing
global element `E` accepts any member `M` where `M` is not `abstract`, `M`'s derivation method is not
excluded by `E`'s `block`/`blockDefault`, and `M`'s type is validly derived from `E`'s without hitting
`final`.

**Do not expand the substitution set into separate automaton positions.** On UBL or GML a head can
have hundreds of members: the position count explodes and — worse — the expansion destroys the
1-unambiguity that gave you a DFA. Keep one position per particle carrying a
`matchesElement(qname) → ElementDecl | null` matcher that consults the closure.

In the UI, present the substitutable set grouped under the head name as a *"which kind of X?"*
sub-picker. On substitution-heavy schemas this is one of the highest-value beginner affordances in the
product.

### 2.6 Effective content models

Compile the *effective* model, not the declared particle:

- **Extension** produces `sequence(baseParticle, extensionParticle)` — with special cases: if base
  content is empty the result is just the extension, and XSD 1.0 forbids most combinations involving
  `xs:all`. Attribute uses are the union, extension winning on conflict.
- **Restriction** replaces the base particle entirely. The "particle valid (restriction)" rules
  (Recurse, RecurseLax, NSRecurseCheckCardinality, MapAndSum…) verify the restriction is *legal* —
  and this is where most homegrown XSD implementations stall. **Decision: skip restriction-legality
  checking in v1** and simply use the restricted particle. It affects schema *authoring* correctness,
  not instance editing; route it to a later schema-lint mode.
- **`xsi:type`** means the effective type is chosen per *instance node*, not per declaration.
  Precompute `subtypesOf(typeDef)` and expose a first-class **Type** dropdown on any node whose
  declared type has non-blocked, non-final derived subtypes. *"Is this a Domestic or an International
  address?"* is exactly the question a beginner needs asked of them.

### 2.7 Wildcards, nillable, mixed

`xs:any` becomes a symbol matcher over a namespace constraint (`##any`, `##other`,
`##targetNamespace`, `##local`, or an explicit list). **`processContents` drives the UI directly:**

| `processContents` | UI |
|---|---|
| `strict` | picker of all global elements in the permitted namespaces |
| `lax` | those, plus a "custom element name…" escape |
| `skip` | free-text name box with a "not checked" badge |

Wildcard suggestions must rank below named elements and sit in a visually separate *"Any element from
namespace X"* section, or a beginner drowns in noise.

`nillable="true"` + `xsi:nil="true"` means content must be empty while attributes and identity
constraints still apply — surface as a "no value" checkbox on the node.

`mixed="true"` leaves the automaton untouched (text is not a symbol) but requires the tree to render
interleaved text-run nodes. See risk 3 in the main plan — this is genuinely hard and is SPIKE-4.

## 3. Derived queries

### 3.1 Required-and-missing — a shortest-path BFS

Two distinct notions, both cheap:

- **Document incomplete:** run `sFinal = run(q0, children)`. If `sFinal ∉ accepting`, BFS from
  `sFinal` to the nearest accepting state — minimising inserted symbols, preferring concrete element
  declarations over wildcards — yields the literal *ordered* list of elements to append. This directly
  powers the **"Add all 3 missing children"** button, inserting each at the automaton-correct position.
- **Mandatory at a gap:** `mandatoryAt(i)` = symbols appearing on every completion. A sound and cheap
  implementation: for each candidate, re-test `canComplete(sPrefix, children[i..n))` with that symbol
  removed from the alphabet. Content-model alphabets are small, so the quadratic cost is irrelevant.

Tri-state badging falls straight out with no extra machinery:

| Badge | Condition |
|---|---|
| 🔴 red | the forward run **dies** on an illegal child |
| 🟠 amber | run survives but is **non-accepting** (incomplete) |
| 🟢 green | accepting, and all attribute and value checks pass |

### 3.2 Quick fixes from error-tolerant alignment

When the prefix already fails, do **not** emit "invalid content" — that is precisely the moment a
beginner needs the most help.

Run an error-tolerant alignment between the observed child-name sequence and the automaton's language:
**Oflazer's error-tolerant recognition algorithm (1996)**, a Wagner–Fischer-style dynamic program over
(input position × automaton state) pruned by an edit-distance cut-off, costing
`O(n·|states|·|alphabet|)` with a small cut-off.

Each edit operation maps one-to-one onto a quick fix:

| Alignment op | Quick fix |
|---|---|
| substitution | "rename `<Ordr>` to `<Order>`" |
| deletion | "remove `<x>`, it isn't allowed here" |
| insertion | "add `<c>` before `<d>`" |
| adjacent transposition | "swap `<b>` and `<a>` — they're the wrong way round" |

**This one algorithm is the highest-leverage piece of the quick-fix system.** Build it deliberately
rather than accreting per-error heuristics.

### 3.3 Skeleton generation

`buildSkeleton(elementDecl, depth)`:

1. Resolve the effective type; if the element or type is abstract, pick a concrete subtype and write
   `xsi:type`, or prompt.
2. Emit required attributes using `fixed`, else `default`, else the sole enumeration value if there
   is one, else a type-appropriate placeholder.
3. Build content as the **minimum accepting word** via BFS from `q0`, breaking ties among equal-length
   choice branches by fewest total descendants, then document order.
4. Recurse with `depth − 1`.

**Placeholder provenance is non-negotiable.** Every auto-filled value carries `unfilled: true` so the
UI shows amber "needs your input" rather than a green tick. Silently generating a document full of
plausible fake data that *validates* is the worst possible outcome for a beginner — it teaches them
the tool's approval is meaningless.

Guards: keep a stack of `(elementDecl, typeDef)` and stop when a type recurs more than once (DocBook
and any nested `<section>` will otherwise never terminate), plus a global node budget (~500) and a
depth cap exposed as a setting.

Offer two commands throughout the UI — "Insert `<foo>`" and "Insert `<foo>` with everything it needs".

### 3.4 `widgetFor(simpleTypeDef)` — an explicit decision table

This is where the beginner actually spends their time, so it is a table, not a heuristic.

| Type / facet | Widget |
|---|---|
| `xs:enumeration` ≤ 12 members | radio group / segmented control, each member's own `xs:documentation` as inline help |
| `xs:enumeration` > 12 | type-ahead combobox with descriptions |
| `xs:boolean` | toggle writing canonical `true`/`false` |
| date/time family | picker emitting canonical lexical forms, explicit timezone control |
| `xs:duration` | Y/M/D/H/M/S spinner builder emitting `P1Y2M3DT4H` |
| numerics | number input wired to min/max inclusive/exclusive (+ slider when the range is small); `totalDigits`/`fractionDigits` drive step and formatting |
| `xs:pattern` | validated input **plus a generated example** and a plain-English gloss |
| `xs:ID` | auto-suggested unique value, live collision checking |
| `xs:IDREF`/`IDREFS`, `keyref` | **picker of existing targets in the document**, showing each target's element name and a summary (requires a live document-wide ID/key index) |
| `xs:QName`/`xs:NOTATION` | namespace-aware prefix dropdown (from in-scope declarations) + local-name field |
| `xs:list` | chip input, each chip validated as the item type |
| `xs:union` | segmented member-type selector, auto-detecting which member the current value matches |
| `base64Binary`/`hexBinary` | file upload |
| has `fixed` | read-only with a "why is this locked?" tooltip |
| has `default` | greyed placeholder text with a "use default" affordance |

### 3.5 XSD regex ≠ JavaScript regex

`xs:pattern` uses the XML Schema regex language, which differs from ECMAScript in ways that **silently
corrupt validation** if ignored:

- implicitly anchored (wrap as `^(?:…)$`)
- character-class **subtraction** `[a-z-[aeiou]]`, which JS lacks entirely
- multi-character escapes `\i \I \c \C` for the XML Name/NameChar productions
- Unicode block/category escapes `\p{L}`, `\p{IsBasicLatin}` needing the `u` flag and a block lookup
- **no** anchors, backreferences or lazy quantifiers

Plan `types/xsdRegex.ts`, ~400 LOC: parse XSD regex to an AST, re-emit ECMAScript `u`-flag source,
handling subtraction by rewriting to a negative lookahead. Pair with a deterministic string generator
over the same AST so the UI can show *"like `AB123456`"* — that example is worth more to a beginner
than the pattern itself.

### 3.6 Documentation extraction, with a guaranteed fallback

Collect `xs:annotation/xs:documentation` from the element declaration, its type definition, the global
declaration when reached via `ref`, and up the restriction/extension base chain (labelling inherited
text "from `BaseType`"). Honour `xml:lang` with BCP-47 lookup against the UI locale. Content is mixed
and frequently contains embedded XHTML, so render as sanitised HTML (DOMPurify), not flattened text.

For `xs:appinfo`, build a **pluggable appinfo interpreter registry** — a small API mapping appinfo
elements to UI hints (label, widget override, grouping, ordering, hidden, icon). Real-world enterprise
schemas routinely encode presentation metadata there, and this is the escape hatch that makes them
look good.

**The fallback matters more than any of it.** Most schemas a beginner meets have no documentation at
all, so `describeParticle()` / `describeType()` synthesise plain English from the components
themselves — *"One or more `<Item>` elements. Each must have a `code` and may have a `description`."*
That function does more for the beginner experience than all the annotation plumbing combined.

## 4. Degraded modes

Guidance degrades; **the tool never does**. Every editing operation stays available on an
unschema'd node.

### 4.1 Schema-less — infer, but never disguise a guess as a rule

Parse into the identical document model with `schemaInfo: null`, then *learn* from the instance. Per
element name (better: per context path) record observed child sequences, attribute names, whether each
attribute is always present (→ required), the set of observed values (→ enumeration candidate when
small and repeated), and infer a datatype down a specificity lattice (boolean → integer → decimal →
date → dateTime → anyURI → string).

Derive the content model by **SOA→SORE inference**: build a Single-Occurrence Automaton from observed
child sequences, rewrite to a Single-Occurrence Regular Expression (Bex, Neven & Vansummeren,
*Inferring XML Schema Definitions from XML Data*, VLDB 2007) — roughly 300 LOC, essentially what Trang
does. The same machinery powers "Generate an XSD from this document", and better, "from these N
documents".

**Non-negotiable design rule:** every hint carries `source: 'schema' | 'inferred' | 'heuristic'`, and
the UI labels inferred suggestions *"learned from your document"*, never *"required"*. A beginner must
always be able to tell a rule from a guess.

### 4.2 Partial — four states, four badges

| Situation | Behaviour |
|---|---|
| matched by a `lax` wildcard, resolvable | full schema help, badged "validated by wildcard" |
| `lax` unresolvable, or `skip` | free editing, badged "not checked", with an offer to load a schema for that namespace |
| element not permitted anywhere in the content model | red, with edit-distance fixes **plus** a search of ancestors and siblings for a parent whose content model *does* accept it → "Move to `<Baz>`" |
| root element with no matching declaration | "the schema doesn't define `<Ordr>`" + did-you-mean |

Support **OASIS XML Catalogs** for resolution so the app works offline, behind corporate firewalls,
and without fetching arbitrary URLs at load time.

### 4.3 Namespace mismatch deserves its own diagnostic

**By far the most common way a beginner's document fails.** The raw validator reports an unhelpful
"no declaration found for element 'Order'". The actual cause is one of:

- the root has no `xmlns` while the schema has a `targetNamespace` (or the reverse), or
- the classic trap: `elementFormDefault="unqualified"` means local elements must be in *no* namespace
  while the root must be in the target namespace — bewildering, and looks like a bug in the tool.

Detect this **before** generic "undeclared element" handling, by testing whether the element's local
name matches a declaration in some other namespace. The message becomes *"`<Order>` is in no
namespace, but the schema expects it in `http://example.com/po`"* with a one-click fix that adds the
declaration to the root and re-qualifies descendants correctly per `elementFormDefault`. Back it with
a Namespaces panel that hides raw prefixes behind friendly schema names.

## 5. Diagnostics

**Produce diagnostics structurally. Never parse validator message strings.**

```ts
interface Diagnostic {
  code: DiagCode;
  severity: 'error' | 'warning' | 'info';
  nodePath: NodePath;
  anchor: 'element' | 'attribute' | 'text' | 'childGap';
  attributeName?: string;
  gapIndex?: number;
  message: string;        // plain English, rendered from structured params
  technical: string;      // the spec-ese, behind "show details"
  specRef?: string;
  schemaComponent?: NodeId;   // jump to the governing rule in the XSD
  fixes: QuickFix[];
}

interface QuickFix {
  title: string;
  kind: 'insert' | 'delete' | 'move' | 'rename' | 'setValue' | 'setType';
  apply(doc: Document): Command;   // a Command, so fixes are atomically undoable
  preview?: string;
}
```

Badges roll up the tree as the worst severity of (own diagnostics ∪ descendants'), rendered so a
problem *here* (solid dot) is distinguishable from a problem *inside* (ring), letting the user drill
down from the root.

Revalidation is debounced at ~150ms and incremental: a value edit rechecks only that node's value plus
its ancestors' content models. Document-global constraints (ID/IDREF uniqueness, key/keyref,
Schematron) need a full pass and run in the worker on idle.

### 5.1 Error taxonomy — 20 classes, each with a plain-English rewrite and a fix

| # | Code | Plain English | Quick fix |
|---|---|---|---|
| 1 | `cvc-complex-type.2.4.b` incomplete | "`<Order>` still needs a `<TotalAmount>`" | Add at the automaton-correct position, with skeleton; "Add all N missing" |
| 2 | `2.4.a` wrong order | "`<b>` can't go here, `<a>` must come first" | Move / Insert-before / Delete, from the alignment |
| 3 | `2.4.d` not allowed at all | list what **is** allowed | Delete / "did you mean `<Food>`?" / "Move to `<Baz>`" |
| 4 | `cvc-complex-type.4` missing required attribute | "`<Item>` must have a `code`" | Add and focus the widget, prefilling default/fixed/sole-enum |
| 5 | `3.2.2` attribute not allowed | — | "Rename to `code`" / Delete |
| 6 | `cvc-datatype-valid` | "`quantity` must be a whole number" | offer the obvious coercion (`"12"`→12, `" 5 "`→5) or clear |
| 7 | `cvc-enumeration-valid` | "must be one of Draft, Issued, Paid; you have `paid`" | "Change to `Paid`" via case-insensitive / edit-distance match |
| 8 | `cvc-pattern-valid` | rewrite the regex into English + a generated example | offer the normalised value (uppercase, strip hyphens) |
| 9 | facet violations | "can be at most 40 characters (you have 52)" | clamp / truncate with preview |
| 10 | `cvc-elt.4.x` bad `xsi:type` | — | dropdown of validly derived types |
| 11 | abstract used directly | "`<Vehicle>` is abstract — which kind?" | substitution / `xsi:type` picker |
| 12 | `cvc-elt.3.x` nil misuse | "marked as having no value but has content" | remove content / untick |
| 13 | `cvc-id` duplicate or dangling IDREF | — | auto-unique rename, or picker of existing IDs |
| 14 | identity-constraint failure | "No `<Customer>` has the number `C-42`" | picker of valid keys, or "create it" |
| 15 | `2.1`/`2.2` text where none allowed | — | "move this text into `<Line1>`" |
| 16 | `cvc-elt.1` no declaration | — | did-you-mean / choose root / load schema |
| 17 | **namespace mismatch** (§4.3) | "`<Order>` is in no namespace, but…" | one-click add `xmlns` |
| 18 | well-formedness | handled first, anchored to source offsets | mostly impossible in a tree editor, common on paste/import |
| 19 | fixed-value mismatch | "`version` must be exactly `2.0`" | Set and lock |
| 20 | Schematron assert/report | show the author's own message **verbatim** | from `sch:diagnostic`, or SQF (§5.2) |

### 5.2 Schematron Quick Fixes (SQF) — a real standard and a genuine differentiator

Schematron rules already carry human-authored messages, which is why they read better than any XSD
diagnostic we can synthesise. Beyond that, the **SQF specification** (schematron-quickfix.github.io,
supported by oXygen) lets a schema author attach `<sqf:fix>` elements containing `sqf:add`,
`sqf:delete`, `sqf:replace` and `sqf:stringReplace` operations to an assert or report.

An SQF interpreter turning those into our `QuickFix` objects means schema authors can ship
domain-specific one-click fixes with their rules — which no browser-based editor currently offers, and
which fits the "teach the beginner" thesis exactly.

Scope it as a stretch item, but **design the `QuickFix` interface now** so SQF operations map onto it
cleanly rather than needing a parallel mechanism later.

## 6. Scope and sequencing

Honest breakdown. **These are estimates, not measurements** (see PLAN.md §2).

| Part | Component | ~LOC | Notes |
|---|---|---|---|
| P1 | XSD document → raw AST | 600 | straightforward |
| P2 | Schema assembly: `include` (chameleon namespaces), `import`, `redefine`, circular guards, catalog resolution, caching | 500 | |
| P3 | Symbol spaces + reference resolution | 400 | six symbol spaces; QName resolution against the *schema document's* prefix bindings, not the instance's |
| P4 | **Simple-type compiler** | 1,500–2,500 | the sleeper: 44 built-ins, 12 facets, restriction/list/union, facet inheritance, lexical vs value spaces, canonical forms, plus the regex translator |
| P5 | Complex-type compiler | 800 | extension concatenation, restriction, four content types, attribute-use merging, wildcard combination |
| P6 | **Particle → automaton** | 600–900 | the differentiator |
| P7 | Substitution/derivation indices (block/final/abstract) | 250 | |
| P8 | Validator incl. identity constraints | 1,200 | identity constraints alone ~400 |
| P9 | **Query API** (`whatCanGoHere`, `requiredMissing`, `widgetFor`, `describe`, `skeleton`, `repair`) | 600 | the differentiator |

**A pragmatic v1 dropping identity constraints, restriction-legality checking and the rarer facets
lands near 3,500 LOC.** Sequence **P6 and P9 early** — they are the product. Defer P8's identity
constraints.

## 7. Performance and packaging

- Compile schemas **in the worker**; keep the model worker-resident behind an RPC facade, since
  validation belongs there too.
- **Lazy-compile each type's content model on first use** and memoise. UBL is ~2MB across many files
  with thousands of type definitions; compiling everything at load is wasted work.
- Persist compiled models in IndexedDB keyed by a hash of the concatenated sources, so reopening a
  project is instant and offline.
- Keep the compiled automaton flat (typed arrays for `delta` where the alphabet is dense) so it
  serialises cheaply.
- **Instrument from day one:** compile time, position counts, unroll-budget hits, UPA violations.
  Those four metrics tell you whether the design assumptions survive contact with real schemas.
