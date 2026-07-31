## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and
cross-file relationships. **It is committed**, so a fresh clone or container has a map immediately
and never needs to build one to get started.

### Using it

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json`
  exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for
  focused concepts. These return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or
  raw grep output.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source
  browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review, or when
  query/path/explain do not surface enough context.

### Keeping it current

Two different mechanisms, because they cost different amounts:

- **Code changes are automatic.** The `post-commit` hook re-extracts changed code files after every
  commit — AST only, no LLM, no API cost. Nothing to remember.
- **Doc, image and config changes are not.** The hook deliberately skips them, because they need
  semantic extraction. After editing anything under `docs/`, `PLAN.md`, `README.md` or similar, run
  `/graphify ./docs --update` (or `--update` on whichever path changed) to re-extract just the new
  and changed files. Skipping this does not corrupt the graph; it leaves those files described by
  their previous version, which is the quieter failure and the reason it is written down here.

A graph that silently describes an older version of the tree is worse than an obviously absent one,
so if `graphify query` returns something that contradicts the file in front of you, trust the file
and re-run the update.

### Do not run `graphify label` here

Community names — `particles.ts`, `NodeId`, `xsdRegex.ts` — are **hub-derived on purpose**: each
community is named after its most connected node. That is deterministic, free, and never goes stale.

`graphify label` replaces them with LLM-written names, and needs an API key to do it. With no
`GEMINI_API_KEY` or `GOOGLE_API_KEY` set, as here, it does not decline — it re-clusters the whole
graph and writes `Community N` placeholders, which is strictly worse than what it replaced. Running
it once cost this project its first set of curated names.

If you want prose names, set a key first and use `--missing-only`. Otherwise leave labels alone.

### If graphify is missing

`.claude/graphify-setup.sh` runs at session start and installs it. Nothing needs doing by hand. The
graph itself is committed and is never rebuilt on startup.
