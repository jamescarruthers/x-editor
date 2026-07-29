# x-editor

A browser-based, tree-node editor for **XML**, **XSD** and **Schematron** — with XSD and Schematron
validation running client-side, designed so that someone who does not already know the schema can
still produce a valid document.

> **Status: planning.** No code yet. The implementation plan is in [`PLAN.md`](PLAN.md).

## The idea

Every existing XML editor answers *"is this document valid?"* — an expert's question, useful only once
you already know what the document should look like.

x-editor answers a beginner's question: ***"what am I allowed to put here, and what does it mean?"***

That needs a schema-aware guidance engine that no validator provides, because validators are yes/no
oracles over complete documents. Building that engine is the project.

## Documents

| | |
|---|---|
| [`PLAN.md`](PLAN.md) | Thesis, stack, architecture, roadmap, risks, open questions |
| [`docs/schema-engine.md`](docs/schema-engine.md) | The guidance core — XSD component model, content-model automaton, quick fixes |
| [`docs/validation.md`](docs/validation.md) | XSD and Schematron validation, error→node mapping, security model |
| [`docs/ux-spec.md`](docs/ux-spec.md) | Layout, tree, Insert palette, keyboard map, design tokens, accessibility |
