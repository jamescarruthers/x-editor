# x-editor

A browser-based, tree-node editor for **XML**, **XSD** and **Schematron** — with XSD and Schematron
validation running client-side, designed so that someone who does not already know the schema can
still produce a valid document.

> **Status: early.** The lossless document layer and the editor shell work. The guidance engine —
> the part that makes this useful to a beginner — is next. See [`PLAN.md`](PLAN.md).

## The idea

Every existing XML editor answers *"is this document valid?"* — an expert's question, useful only once
you already know what the document should look like.

x-editor answers a beginner's question: ***"what am I allowed to put here, and what does it mean?"***

That needs a schema-aware guidance engine that no validator provides, because validators are yes/no
oracles over complete documents. Building that engine is the project.

## Running it

```bash
pnpm install
pnpm -C apps/editor dev
```

Tests and typecheck across the workspace:

```bash
pnpm -r test
pnpm -r typecheck
```

The app is a static client-only SPA — no server, and documents never leave the browser. It deploys to
GitHub Pages from `main` via [`.github/workflows/pages.yml`](.github/workflows/pages.yml). To enable
it on a fork: **Settings → Pages → Source: GitHub Actions**.

## What works today

- **Lossless round-tripping.** Parse and re-serialize an untouched document and you get the original
  bytes back, exactly — line endings, BOM, DOCTYPE internal subset, attribute quote style, entity
  references and all. Editing one element leaves every other byte untouched.
- **Tree editing** with keyboard navigation, virtualization, and a proper ARIA tree.
- **The Inspector** — attributes, values, and a plain-English description of the selected node.
- **Undo/redo** with human-readable history (`Deleted <a> and 2 children`).
- **Live source view** and a well-formedness Problems panel.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ App bar                                                      │
├──────────────┬────────────────────────────┬──────────────────┤
│ Source       │           Tree             │    Inspector     │
│ History      │                            │    attributes    │
│              ├────────────────────────────┤                  │
│              │ breadcrumb                 │                  │
├──────────────┴────────────────────────────┴──────────────────┤
│ Problems                                                     │
└──────────────────────────────────────────────────────────────┘
```

## Repository

| | |
|---|---|
| [`PLAN.md`](PLAN.md) | Thesis, stack, architecture, roadmap, risks, open questions |
| [`docs/schema-engine.md`](docs/schema-engine.md) | The guidance core — XSD component model, content-model automaton, quick fixes |
| [`docs/validation.md`](docs/validation.md) | XSD and Schematron validation, error→node mapping, security model |
| [`docs/ux-spec.md`](docs/ux-spec.md) | Layout, tree, Insert palette, keyboard map, design tokens, accessibility |
| [`packages/xml-core`](packages/xml-core) | The lossless document layer |
| [`apps/editor`](apps/editor) | The React app |
