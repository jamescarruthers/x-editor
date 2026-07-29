# Spike answers

`PLAN.md` §12 named five spikes to resolve before the architecture was fixed. This is the record.
Each answer states what was actually run, so a later reader can tell a measurement from an opinion.

Phase 0's *done when* is "each spike has a written answer and the affected decisions are confirmed
or changed". All five spikes are answered below.

---

## SPIKE-0 — Does any library expose an XSD component model with content-model particles intact?

**Answer: no. Build it.** Confirmed, and the plan's architecture stands.

The question mattered because a positive answer would have removed roughly 40% of the engineering
budget. It was resolved by survey rather than experiment:

- **libxml2** keeps `xmlSchemaParticle` and its friends in `private/` headers. The public API
  (`xmlSchemaValidateDoc`, `xmlSchemaValidateOneElement`) is a yes/no oracle over a complete
  document. `libxml2-wasm` exposes exactly that surface — `XsdValidator.fromDoc().validate()` —
  which SPIKE-1 confirms empirically.
- **Xerces-J/C** expose `XSModel` through XNI, which does have particles. There is no JavaScript
  binding, and shelling out to a JVM is not a browser story.
- **Code generators** (`cxsd`, `xsd2jsonschema`) are lossy by construction. JSON Schema cannot
  express `xs:sequence` ordering at all, so a generator targeting it has already thrown away the one
  thing the guidance engine needs.

The consequence is the whole product thesis: *"what may I put here?"* is not a validation feature,
because no validator exposes the state machine that answers it. `packages/xsd` is that state
machine.

---

## SPIKE-1 — Does `libxml2-wasm` report all validation errors with line numbers, or throw on the first?

**Answer: all of them, each with a line number. Columns are useless.** `xmllint-wasm` is not needed.

Measured against `libxml2-wasm@0.7.1`, with a document carrying five distinct faults in five sibling
subtrees so that none masks another:

```
line 3: Element 'item': The attribute 'id' is required but missing.
line 4: Element 'n': 'oops' is not a valid value of the atomic type 'xs:int'.
line 5: Element 'extra': This element is not expected.
line 6: Element 'item': Missing child element(s). Expected is ( n ).
line 7: Element 'n': This element is not expected.
```

All five, via `XmlValidateError.details`. The check lives in
`packages/xsd/test/differential.test.ts` so that a libxml2 upgrade changing the answer fails the
build rather than passing quietly.

Two caveats worth keeping in mind:

- **Every column is 0.** So an error cannot be mapped to a node by line *and* column — only by line.
  This confirms the plan's error→node design: own the serializer, emit exactly one element start-tag
  per line when serialising for validation, and return a `lineMap: NodeId[]` alongside the text.
  libxml2's "line 42" then becomes an O(1) array lookup and columns never matter.
- **A structural failure truncates the rest of that element.** Five faults *within one* element
  yielded three errors, because once the content model rejects a child libxml2 stops checking that
  element's remaining children. This is normal validator behaviour, not a defect, but it means the
  Problems panel must not promise to be exhaustive after the first structural error in a subtree.

---

## SPIKE-2 — Can multi-file schema sets be driven through `libxml2-wasm`, or must they be flattened?

**Answer: they work, through a registered input provider. No flattening needed.**

`libxml2-wasm` documents its `xs:import`/`xs:include` support as experimental, which was the risk.
In practice `xmlRegisterInputProvider` resolves both. A three-file set — a main schema that both
imports a foreign namespace and includes a same-namespace document — validates correctly, and the
facets from each of the three files are enforced:

```
good           : VALID
code too long  : INVALID — [facet 'maxLength'] ... exceeds the allowed maximum length of '3'
note too long  : INVALID — [facet 'maxLength'] ... exceeds the allowed maximum length of '5'
```

The provider is the security boundary, and it is a tight one: `match` and `open` only answer for
keys already in the catalogue, so **there is no code path from a hostile `schemaLocation` to the
network**. libxml2 never resolves anything itself. This is the mechanism `PLAN.md` §8 requires, and
it turns out to be simpler than the "rewrite to flat filenames and materialise into the WASM virtual
FS" fallback the plan had budgeted for.

`packages/xsd/test/oracles/libxml2.ts` holds the implementation; the multi-file cases in
`differential.test.ts` are the regression test.

---

## SPIKE-3 — Does the Glushkov automaton meet the interactive latency budget?

**Answer: comfortably, on the schemas built so far. Not yet proven on UBL or GML.**

The success criterion was `whatCanGoHere` under 16ms on UBL 2.1 and GML 3.2 content models. Those
corpora are not yet vendored, so the criterion is *partially* met: on every schema in the test suite
the query is sub-millisecond, and the construction is the one the criterion assumed.

Two things make this unlikely to become a problem, and one keeps it honest:

- Occurrence bounds are unrolled with a **position budget of 2000**. Real schemas essentially always
  use `maxOccurs` of 1 or `unbounded`, so the budget is rarely approached; when it is, the model
  marks itself `approximate` rather than pretending to be exact.
- The backward co-reachability sweep is computed **once for every insertion gap in a parent**, not
  once per gap, so a parent with 200 children costs one sweep rather than 200.
- The palette's `insertionPlan` deliberately does *not* share that optimisation — it asks each gap
  separately, which is quadratic in the child count. That is fine for one element's palette and is
  why it is not used to paint the tree. Noted here so it is a decision rather than an oversight.

Re-run this against UBL 2.1 when the differential corpus lands. The documented fallback — a
derivative-based matcher — remains available and untouched.

---

## SPIKE-4 — Mixed content: ProseMirror with a generated schema, or scoped CodeMirror?

**Answered: neither, and the reason is worth more than the answer.**

The risk the plan identifies is real and was confirmed exactly as written: a row per node turns
`<p>See <emph>this</emph> for details.</p>` into five rows, and that is the entire
DocBook/DITA/TEI/JATS world. A test now asserts the fix rather than the problem.

But the spike asked the wrong question, and running it made that visible. Both candidate answers are
*editors* — and the unusable part was never the editing, it was the **display**. Five rows is
unreadable before anyone types anything. So the change that mattered is that a mixed element is now
**one tree row carrying its flow**, with marked-up runs shown as `⟨…⟩` rather than stripped, so it is
never a surprise that half a sentence is tagged. The children stay reachable; nothing forces a reader
through them to get at a paragraph.

Editing is then a much smaller problem, and it is answered with a **scoped source snippet** — the
element's inner XML in a textarea, with the schema's permitted inline elements as wrap buttons, and
nothing committed until it parses. Refusing a broken commit matters more here than anywhere else in
the editor: the alternative is discarding a paragraph someone was midway through typing.

**Why not ProseMirror.** It is the richer editor, and it costs ~150 KB in the entry chunk plus a
second document model to keep in step with the CST — the exact two-representations problem this
codebase is arranged around, bought for a minority of documents. §11 risk 4 has already fired once in
this project for less. If a WYSIWYG flow surface is wanted later, the seam is `FlowEditor` and
nothing else has to move: `flowSource` and `setFlow` are the whole interface between the flow and the
document.

**What is given up.** WYSIWYG. Someone editing a 200-paragraph DITA topic all day wants the richer
surface, and this is not it. What is kept: one model, no silent reformatting, and every flow edit is
an ordinary command in the same undo history as everything else.

---

## What Phase 4 confirmed

Both SPIKE-1 and SPIKE-2 findings now hold in the shipped code as well as the test harness.
`packages/xsd-libxml2` runs libxml2 in a worker behind the `XsdEngine` interface, serving schema
documents through the same catalogue-only input provider, and `packages/xsd/src/validationSerializer.ts`
produces the one-start-tag-per-line text whose line numbers the `lineMap` turns back into node ids.

One thing SPIKE-1 did not anticipate, worth recording: **`libxml2-wasm` initialises with a top-level
await**, which Vite's default `iife` worker output cannot express. The worker has to be built as an
ES module (`worker: { format: 'es' }`). The failure is a build error rather than a runtime one, so it
cannot reach production — but it is the sort of thing that costs an afternoon if it is met without
warning.

The security model named in PLAN.md §8 is now asserted rather than assumed:
`packages/xsd-libxml2/test/engine.test.ts` feeds a billion-laughs bomb and an XXE payload pointing at
`file:///etc/passwd`, and checks that the first returns promptly instead of expanding and the second
never yields the file's contents.

## What the differential harness has caught so far

The harness exists because of `PLAN.md` §11's top risk: the guidance engine and libxml2 are two
independent implementations of XSD semantics, and when they disagree the product actively teaches
beginners wrong things.

It has already earned its place. On its first run against the awkward-corner corpus it found that
**the engine accepted an abstract substitution-group head appearing in a document**. The head is the
name a content model *references*, and it is precisely the one name that may never be written. The
palette had the filter — abstract candidates were already excluded from insertion — but the
validation path did not, so the engine would have called a document valid that libxml2 rejects.

The fix pushes `abstract` down onto the element particle, so the matcher accepts a head's
substitutes and not its own name. That is the correct level: filtering at the palette was treating a
symptom, and the naive reference matcher used by the property tests now encodes the same rule, so
the two oracles stay in step.
