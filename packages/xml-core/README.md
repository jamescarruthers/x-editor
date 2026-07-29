# `@x-editor/xml-core`

The lossless document layer. Phase 1 of [the plan](../../PLAN.md).

Everything above this package — the guidance engine, the validators, the tree UI — assumes it can
edit a document without damaging the parts nobody touched. That is this package's whole job.

## The contract

**Parse and re-serialize an untouched document and you get the original bytes back, exactly.** Not
"semantically equivalent" — identical. Users keep these files in git, and a tool that reformats on
save produces a four-thousand-line diff on every commit.

Preserved: original line endings, byte order mark, XML declaration, DOCTYPE with its internal subset,
attribute order, attribute quote style, whitespace inside tags, comments, processing instructions,
CDATA sections, self-closing vs. expanded empty elements, and entity references — including
author-declared ones like `&mydash;`, which most editors silently expand.

## How

A tokenizer that owns exact byte spans, and the invariant that **every byte belongs to exactly one
token**. A node that has not been touched is re-emitted by slicing the original source; only dirty
nodes are regenerated. That makes fidelity structural rather than a matter of reproducing a hundred
formatting details, and makes serialization O(changed) rather than O(document).

```
tokenizer.ts   exact-span scanner; recovers from malformed input rather than throwing
parse.ts       tokens → tree, namespace resolution, structural errors
serialize.ts   the splice serializer
entities.ts    decode/encode; unknown entities survive untouched
document.ts    XmlDocument, mutation commands, undo/redo
wellformed.ts  an independent saxes-based validity oracle
```

Two deliberate separations:

- **The tokenizer does not decide validity.** It recovers, because a beginner's document is malformed
  most of the time it is being edited, and refusing to open a broken file is a product failure. The
  verdict comes from `wellformed.ts`, a second implementation, so a tokenizer bug cannot quietly make
  a broken document look fine. The two are diffed against each other in the tests.
- **Mutation goes through commands that carry their own inverse.** Undo is exact rather than a
  re-parse, node ids stay stable across history navigation so selection and diagnostics survive, and
  every command carries a human label (`Deleted <a> and 2 children`) — which is what makes a visible
  History panel possible later.

## Tests

```
pnpm -C packages/xml-core exec vitest run
```

104 tests. The two that matter most are property-based:

- **arbitrary generated documents round-trip byte-for-byte** (500 runs)
- **apply-then-invert is the identity** over random command sequences (300 runs) — an undo model that
  is subtly non-inverting corrupts documents in ways users only notice much later

Plus a corpus covering CRLF, BOMs, internal subsets, unknown entities, mixed content and unicode, and
a malformed corpus asserting that broken documents still round-trip and still report errors.
