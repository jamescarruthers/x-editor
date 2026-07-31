# Graph Report - x-editor  (2026-07-31)

## Corpus Check
- 138 files · ~154,167 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1617 nodes · 5061 edges · 78 communities (73 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2059f80f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- xsd/src/index.ts
- NodeId
- componentTree.ts
- simpleTypes.ts
- xsdAuthoring.ts
- xsdRegex.ts
- dependencies
- Tree.tsx
- EditorStore
- validation.ts
- xml-core/src/index.ts
- model/describe.ts
- query.ts
- TableView.tsx
- elementContext
- CoachMarks.tsx
- automaton.ts
- diagnostics.ts
- SchemaModel
- XmlDocument
- whatCanGoHere: forward run intersected with backward co-reachability
- store.ts
- schema.ts
- The anti-drift differential harness
- SchemaSections.tsx
- paste.ts
- package.json
- xsd/package.json
- insert.ts
- xpath.ts
- schematron/src/parse.ts
- wellformed.test.ts
- compilerOptions
- taxonomy.test.ts
- compilerOptions
- Diagnostic interface
- schematron/package.json
- xsd-libxml2/package.json
- xsd/test/differential.test.ts
- interpret.ts
- Lossless CST document model, not the DOM
- xml-core/package.json
- graphify
- Glushkov position automaton
- x-editor
- CstDomFacade
- Security model: client-side is not a security property
- infer.ts
- buildSkeleton and placeholder provenance
- xsd-libxml2/tsconfig.json
- CI build job
- SchematronSections.tsx
- validation-protocol/package.json
- SchematronStore
- ROOT_ID
- differential11.test.ts
- graphify-guard.sh
- Quick fixes from error-tolerant alignment
- ProseMirror declined
- graphify-setup.sh
- schematron/tsconfig.json
- xml-core/tsconfig.json
- .node
- xsd/tsconfig.json
- Editor App Favicon (32x32 SVG app icon)
- schematron/test/differential.test.ts
- validation-protocol/tsconfig.json
- check-bundle.mjs
- build-sw.mjs
- scaffold.test.ts
- Hand-rolled typed worker protocol
- qnameToString
- Inspector section stack and per-document-kind registry
- Expert mode differences table
- graphify-precommit.sh
- catalogueFrom
- interpret.test.ts

## God Nodes (most connected - your core abstractions)
1. `NodeId` - 164 edges
2. `XmlDocument` - 96 edges
3. `isElement()` - 79 edges
4. `SchemaModel` - 58 edges
5. `SchemaParser` - 52 edges
6. `EditorStore` - 51 edges
7. `XsdQName` - 40 edges
8. `qnameToString()` - 38 edges
9. `elementContext` - 38 edges
10. `qnameKey()` - 36 edges

## Surprising Connections (you probably didn't know these)
- `The beginner's question: what am I allowed to put here?` --semantically_similar_to--> `Product thesis: guidance is the product, not a layer over a validator`  [INFERRED] [semantically similar]
  README.md → PLAN.md
- `Placeholder review state is derived, not tracked` --semantically_similar_to--> `Filtering narrows rather than highlights`  [AMBIGUOUS] [semantically similar]
  PLAN.md → docs/ux-spec.md
- `The tokenizer does not decide validity` --semantically_similar_to--> `Guidance degrades; the tool never does`  [INFERRED] [semantically similar]
  packages/xml-core/README.md → docs/schema-engine.md
- `XSD version detection prefers 1.1 when ambiguous` --semantically_similar_to--> `Differential harness dispatches on the schema's declared version`  [INFERRED] [semantically similar]
  docs/validation.md → PLAN.md
- `A generated document is valid and meaningless` --semantically_similar_to--> `buildSkeleton and placeholder provenance`  [INFERRED] [semantically similar]
  PLAN.md → docs/schema-engine.md

## Import Cycles
- 5-file cycle: `apps/editor/src/model/componentTree.ts -> apps/editor/src/model/rows.ts -> apps/editor/src/model/mixed.ts -> apps/editor/src/model/insert.ts -> apps/editor/src/state/store.ts -> apps/editor/src/model/componentTree.ts`
- 5-file cycle: `apps/editor/src/model/componentTree.ts -> apps/editor/src/model/rows.ts -> apps/editor/src/model/mixed.ts -> apps/editor/src/model/paste.ts -> apps/editor/src/state/store.ts -> apps/editor/src/model/componentTree.ts`

## Hyperedges (group relationships)
- **The differential oracle stack** — plan_libxml2_wasm_oracle, plan_xmlschema_pyodide, docs_validation_schxslt2, docs_validation_differential_harness, _github_workflows_ci_differential_oracles, plan_version_dispatch [EXTRACTED 1.00]
- **One CST, projections never a second model** — plan_lossless_cst, plan_projections_over_one_cst, docs_validation_idomfacade, docs_spikes_prosemirror_declined, docs_ux_spec_form_view, packages_xml_core_readme_span_invariant [INFERRED 0.95]
- **The beginner guidance flow: ask, describe, insert, repair** — docs_schema_engine_whatcangohere, docs_schema_engine_required_missing, docs_schema_engine_describe, docs_schema_engine_build_skeleton, docs_schema_engine_oflazer_alignment, docs_ux_spec_insert_palette [INFERRED 0.85]
- **Favicon Icon Design: badge, glyph and brand colour forming one mark** — apps_editor_public_favicon_app_icon, apps_editor_public_favicon_rounded_square_badge, apps_editor_public_favicon_angle_bracket_glyph, apps_editor_public_favicon_brand_blue_2563eb [EXTRACTED 1.00]
- **Favicon Design Constraints: vector delivery, tab-size legibility, static asset path** — apps_editor_public_favicon_scalable_vector_favicon, apps_editor_public_favicon_small_size_legibility, apps_editor_public_favicon_static_public_asset, apps_editor_public_favicon_app_icon [INFERRED 0.75]

## Communities (78 total, 5 thin omitted)

### Community 0 - "xsd/src/index.ts"
Cohesion: 0.09
Nodes (66): AllContentModel, AllMember, applyRedefine(), AssembledDocument, normalizePath(), PendingDocument, REDEFINE_NS, RedefineResult (+58 more)

### Community 1 - "NodeId"
Cohesion: 0.14
Nodes (7): ChildGroupSpec, ExplanationStep, SchematronParser, NodeId, Form, RawSimpleDerivation, SchemaParser

### Community 2 - "componentTree.ts"
Cohesion: 0.29
Nodes (12): appendLiteral(), attribute(), buildComponentRows(), collect(), componentRowLabel(), contentSummary(), Group, headingKey() (+4 more)

### Community 3 - "simpleTypes.ts"
Cohesion: 0.06
Nodes (48): FacetName, XSD_NS, ANY_SIMPLE_TYPE, ANY_TYPE, base64Octets(), BUILT_IN_TYPES, builtInAncestry(), BuiltInFacets (+40 more)

### Community 4 - "xsdAuthoring.ts"
Cohesion: 0.14
Nodes (38): hasInlineType(), IdentitySection(), RefactorSection(), referenceLabel(), resolveSimpleType(), SchemaHealthSection(), TypeSection(), XsdInspector() (+30 more)

### Community 5 - "xsdRegex.ts"
Cohesion: 0.09
Nodes (27): CharSet, ClassExpr, complementRanges(), Emitter, enumerable(), escapeInClass(), escapeLiteral(), LITERAL_SPECIALS (+19 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (42): dependencies, react, react-dom, @tanstack/react-virtual, @x-editor/schematron, @x-editor/validation-protocol, @x-editor/xml-core, @x-editor/xsd (+34 more)

### Community 7 - "Tree.tsx"
Cohesion: 0.35
Nodes (8): inlineText(), SchemaBadge(), Tree(), TreeRow(), buildRows(), nodeLabel(), Row, textPreview()

### Community 8 - "EditorStore"
Cohesion: 0.07
Nodes (4): Placeholder, EditorStore, expandInitial(), WorkspaceFile

### Community 9 - "validation.ts"
Cohesion: 0.07
Nodes (19): EngineFinding, IDLE, ValidationClient, VerdictState, engine, doc(), FakeWorker, Posted (+11 more)

### Community 10 - "xml-core/src/index.ts"
Cohesion: 0.11
Nodes (44): Reference, decodeText(), encodeAttributeValue(), encodeText(), escapeAmpersands(), normalizeAttributeValue(), PREDEFINED, buildElement() (+36 more)

### Community 11 - "model/describe.ts"
Cohesion: 0.33
Nodes (8): countWords(), describe(), describeElement(), Description, DescriptionSource, humanise(), listOf(), expandAll()

### Community 12 - "query.ts"
Cohesion: 0.08
Nodes (38): FacetsSection(), countErrors(), compileAll(), cardinalityChip(), describeCardinality(), describeElement(), describeFacets(), describeType() (+30 more)

### Community 13 - "TableView.tsx"
Cohesion: 0.27
Nodes (8): WidgetInput(), AddRow(), Cell(), TableCell, TableColumn, TableRow, TableSpec, Widget

### Community 14 - "elementContext"
Cohesion: 0.26
Nodes (15): FlowEditor(), attributeName(), escapeAttribute(), escapeText(), FlowEdit, flowSource(), inlineNames(), isFlowElement() (+7 more)

### Community 15 - "CoachMarks.tsx"
Cohesion: 0.50
Nodes (3): CoachMarks(), Mark, MARKS

### Community 16 - "automaton.ts"
Cohesion: 0.06
Nodes (73): acceptableFrom(), Alignment, alignToModel(), applyOperations(), EditKind, EditOperation, isAccepting(), key() (+65 more)

### Community 17 - "diagnostics.ts"
Cohesion: 0.14
Nodes (32): describeEdit(), isPlausibleRename(), nameDistance(), formatQName(), applyWhiteSpace(), matchesLexicalSpace(), asElementName(), diagnoseAbstract() (+24 more)

### Community 18 - "SchemaModel"
Cohesion: 0.10
Nodes (17): GlobalDeclaration, derivationSetHas(), NamespaceSpec, Origin, qnameKey(), XsdQName, builtInType, Diagnostic (+9 more)

### Community 19 - "XmlDocument"
Cohesion: 0.14
Nodes (3): parseSchematron(), ParseSchematronResult, XmlDocument

### Community 20 - "whatCanGoHere: forward run intersected with backward co-reachability"
Cohesion: 0.10
Nodes (23): AllContentModel: xs:all is a bitset, not an automaton, Pluggable xs:appinfo interpreter registry, describeParticle / describeType — the guaranteed fallback, whatCanGoHere: forward run intersected with backward co-reachability, Wildcards: processContents drives the UI directly, Xerces XSCMValidator.whatCanGoHere precedent, src/schema/describe.ts — the documentation guarantee, Insert palette specification (+15 more)

### Community 21 - "store.ts"
Cohesion: 0.10
Nodes (27): Breadcrumb(), RightTab, FileTabs(), FormView(), InsertPaletteHost(), DiagnosticRow(), HistoryPanel(), ProblemsPanel() (+19 more)

### Community 22 - "schema.ts"
Cohesion: 0.21
Nodes (4): SchemaStore, assembleSchemas(), SchemaCatalogue, usesVersion11()

### Community 23 - "The anti-drift differential harness"
Cohesion: 0.12
Nodes (21): Install the differential oracles step (xmlschema, lxml), Substitution groups as symbol matchers, never expansion, Unique Particle Attribution and graceful UPA degradation, Differential harness finding: abstract substitution-group head accepted, The anti-drift differential harness, ISO/IEC 19757-3:2025 (Schematron, Edition 4), libxml2 demoted from authoritative validator to fast 1.0 oracle, Explicit disposal of native-memory handles in the worker (+13 more)

### Community 24 - "SchemaSections.tsx"
Cohesion: 0.12
Nodes (27): AttributeField(), childGroups(), FormNode(), hint(), label(), ValueField(), ElementName(), Inspector() (+19 more)

### Community 25 - "paste.ts"
Cohesion: 0.23
Nodes (16): commit(), PasteSheetHost(), analysePaste(), applyPaste(), bindingsOf(), describeOption(), elementChildren(), labelOf() (+8 more)

### Community 26 - "package.json"
Cohesion: 0.11
Nodes (18): fast-check, devDependencies, fast-check, playwright, typescript, vitest, xslt3, name (+10 more)

### Community 27 - "xsd/package.json"
Cohesion: 0.11
Nodes (18): fontoxpath, dependencies, fontoxpath, @x-editor/xml-core, devDependencies, libxml2-wasm, exports, libxml2-wasm (+10 more)

### Community 28 - "insert.ts"
Cohesion: 0.13
Nodes (26): filterCandidates(), GROUP_LABEL, GROUP_ORDER, groupInOrder(), InsertPalette(), isSubsequence(), plain(), previewOf() (+18 more)

### Community 29 - "xpath.ts"
Cohesion: 0.24
Nodes (9): FontoXPath, resolverFor(), run(), XPathFailure, XPathFailureDetail, XPathNode, XPathNodeRef, XPathOptions (+1 more)

### Community 30 - "schematron/src/parse.ts"
Cohesion: 0.19
Nodes (17): AssertionStatistics, RuleStatistics, RunOptions, SchematronFinding, expandPatterns(), SCH_NS, SCH_NS_OLD, SchAssertion (+9 more)

### Community 31 - "wellformed.test.ts"
Cohesion: 0.38
Nodes (5): checkWellFormed(), isWellFormed(), WellFormednessError, MALFORMED, WELL_FORMED

### Community 32 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, jsx, lib, noEmit, types, extends, include, DOM (+8 more)

### Community 33 - "taxonomy.test.ts"
Cohesion: 0.40
Nodes (3): diagnose(), find(), model

### Community 34 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, exactOptionalPropertyTypes, isolatedModules, lib, module, moduleResolution, noFallthroughCasesInSwitch (+8 more)

### Community 35 - "Diagnostic interface"
Cohesion: 0.18
Nodes (12): Badge roll-up and incremental revalidation, Diagnostic interface, Error taxonomy — 20 classes, each with a plain-English rewrite and a fix, Namespace mismatch deserves its own diagnostic, Tri-state validity badging (red / amber / green), cvc-catalogue.ts and svrl-catalogue.ts message templates, Visual design tokens, Namespace colouring from eight curated OKLCH hues (+4 more)

### Community 36 - "schematron/package.json"
Cohesion: 0.12
Nodes (15): dependencies, @x-editor/xml-core, @x-editor/xsd, exports, @x-editor/xml-core, @x-editor/xsd, main, name (+7 more)

### Community 37 - "xsd-libxml2/package.json"
Cohesion: 0.12
Nodes (15): dependencies, libxml2-wasm, @x-editor/validation-protocol, exports, libxml2-wasm, @x-editor/validation-protocol, main, name (+7 more)

### Community 38 - "xsd/test/differential.test.ts"
Cohesion: 0.22
Nodes (7): Case, CASES, CORNER_CASES, OracleError, OracleResult, validateWithLibxml2(), withCatalogue()

### Community 39 - "interpret.ts"
Cohesion: 0.18
Nodes (19): activePatterns(), AssertionCounts, bindLets(), documentOrder(), EMPTY, NodeRef, positionOf(), renderMessage() (+11 more)

### Community 41 - "Lossless CST document model, not the DOM"
Cohesion: 0.18
Nodes (15): SPIKE-1 — libxml2-wasm reports all errors, with line numbers; columns are always 0, Visible undo history panel, IDomFacade: our CST is the XPath data model, ValidationPayload with lineMap, Mutation through commands that carry their own inverse, The lossless contract: identical bytes, not semantically equivalent, Property-based round-trip and apply-invert identity tests, Exact byte spans: every byte belongs to exactly one token (+7 more)

### Community 42 - "xml-core/package.json"
Cohesion: 0.13
Nodes (14): dependencies, saxes, exports, main, name, private, scripts, test (+6 more)

### Community 43 - "graphify"
Cohesion: 0.33
Nodes (5): Do not run `graphify label` here, graphify, If graphify is missing, Keeping it current, Using it

### Community 45 - "Glushkov position automaton"
Cohesion: 0.11
Nodes (18): Brüggemann-Klein & Wood, 1-unambiguity, Single backward co-reachability sweep for every gap, Effective content models (extension, restriction, xsi:type), Gelade, Gyssens & Martens, regular expressions with counting, Glushkov position automaton, Instrument compile time, position counts, unroll-budget hits, UPA violations, Kilpeläinen & Tuhkanen, regular expressions with numeric occurrence, Lazy per-type content-model compilation and IndexedDB persistence (+10 more)

### Community 46 - "x-editor"
Cohesion: 0.21
Nodes (14): Survey: no library exposes an XSD component model, Scope and sequencing (P1-P10), simple-type compiler is the sleeper, The schema-aware guidance engine (spec), Spike answers, SPIKE-0 — no library exposes an XSD component model, UX and visual design specification, Validation architecture and security model (spec), @x-editor/xml-core (+6 more)

### Community 47 - "CstDomFacade"
Cohesion: 0.21
Nodes (3): moveBefore(), topLevelAncestor(), CstDomFacade

### Community 48 - "Security model: client-side is not a security property"
Cohesion: 0.19
Nodes (13): PWA manifest and theme-color links, OASIS XML Catalogs for resolution, Security model asserted rather than assumed, SPIKE-2 — multi-file schema sets work through a registered input provider, libxml2 parser flag policy, Resolve the schema graph in JavaScript before calling into WASM, Never auto-fetch a remote schemaLocation, No telemetry in v1 (+5 more)

### Community 49 - "infer.ts"
Cohesion: 0.25
Nodes (13): ExplainPanel(), attributeLine(), collectCaveats(), ElementFacts, elementName(), enumerationOrString(), escapeAttribute(), factsFor() (+5 more)

### Community 50 - "buildSkeleton and placeholder provenance"
Cohesion: 0.18
Nodes (13): buildSkeleton and placeholder provenance, Required-and-missing as a shortest-path BFS, XSD regex is not JavaScript regex (types/xsdRegex.ts), 'Add all required' is recursive and fills values, Onboarding empty states and three bundled examples, New-document wizard — five steps, XSD authoring mode UI, First-run coach marks, never modal (+5 more)

### Community 51 - "xsd-libxml2/tsconfig.json"
Cohesion: 0.17
Nodes (11): compilerOptions, lib, outDir, rootDir, extends, include, DOM, ES2022 (+3 more)

### Community 52 - "CI build job"
Cohesion: 0.22
Nodes (11): CI build job, Check the bundle budget step (scripts/check-bundle.mjs), CI concurrency group with cancel-in-progress, pnpm/action-setup without an explicit version, BASE_PATH build env for the project Pages site, Deploy to GitHub Pages workflow, SPA fallback: copy index.html to 404.html, apps/editor index.html shell (+3 more)

### Community 53 - "SchematronSections.tsx"
Cohesion: 0.17
Nodes (11): AssertionSection(), attributeValue(), commitAttribute(), RuleSection(), EXAMPLE_RULES, EXAMPLE_RULES_NAME, EXAMPLE_SCHEMA_NAME, enclosingRule() (+3 more)

### Community 54 - "validation-protocol/package.json"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, test, typecheck, type (+2 more)

### Community 55 - "SchematronStore"
Cohesion: 0.24
Nodes (4): SchematronStore, SchematronResult, SchDiagnostic, SchSchema

### Community 57 - "ROOT_ID"
Cohesion: 0.36
Nodes (9): ROOT_ID, attributesOf(), elementChildren(), hasSignificantText(), inlineContent(), nodeForLine(), serializeForValidation(), nameAtLine() (+1 more)

### Community 58 - "differential11.test.ts"
Cohesion: 0.22
Nodes (7): available, Case, CASES, validateWithXmlschema(), xmlschemaAvailable(), XmlschemaResult, text()

### Community 60 - "Quick fixes from error-tolerant alignment"
Cohesion: 0.28
Nodes (9): Bex, Neven & Vansummeren, Inferring XML Schema Definitions from XML Data (VLDB 2007), Guidance degrades; the tool never does, Oflazer (1996), error-tolerant recognition, Quick fixes from error-tolerant alignment, QuickFix interface, Schema-less mode: infer, but never disguise a guess as a rule, SOA to SORE content-model inference, Schematron Quick Fixes (SQF) (+1 more)

### Community 61 - "ProseMirror declined"
Cohesion: 0.28
Nodes (9): widgetFor(simpleTypeDef) decision table, ProseMirror declined, Scoped source snippet flow editor, SPIKE-4 — mixed content: neither candidate, and the spike asked the wrong question, Form view — same model, no second state tree, Risk 4: bundle weight and the entry-chunk regression, FlowEditor seam (flowSource / setFlow), A mixed element is one tree row carrying its flow (+1 more)

### Community 63 - "schematron/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src, test, ../../tsconfig.base.json

### Community 64 - "xml-core/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src, test, ../../tsconfig.base.json

### Community 65 - ".node"
Cohesion: 0.14
Nodes (29): App(), DocumentationSection(), container, isSchemaDocument(), describe(), explainDocument(), Explanation, shapeOf() (+21 more)

### Community 66 - "xsd/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src, test, ../../tsconfig.base.json

### Community 67 - "Editor App Favicon (32x32 SVG app icon)"
Cohesion: 0.43
Nodes (8): Outward Angle Bracket Glyph (white chevron pair), Editor App Favicon (32x32 SVG app icon), Brand Blue #2563eb, Code Editor Visual Identity (brackets as product signifier), Rounded Square Badge (32x32, rx=7, blue fill), Scalable Vector Favicon Strategy, Small-Size Legibility Constraints (heavy stroke, round caps, max contrast), Static public/ Asset Convention

### Community 68 - "schematron/test/differential.test.ts"
Cohesion: 0.28
Nodes (6): available, Case, CASES, isoSchematronAvailable(), IsoSchematronResult, runIsoSchematron()

### Community 69 - "validation-protocol/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 70 - "check-bundle.mjs"
Cohesion: 0.29
Nodes (5): entry, entrySize, expectSeparate(), fail(), files

### Community 71 - "build-sw.mjs"
Cohesion: 0.29
Nodes (5): assets, files, hash, manifest, version

### Community 72 - "scaffold.test.ts"
Cohesion: 0.12
Nodes (23): StartScreen(), compile(), FillStep(), LoadedSchema, RootStep(), Wizard(), Example, EXAMPLES (+15 more)

### Community 73 - "Hand-rolled typed worker protocol"
Cohesion: 0.29
Nodes (7): libxml2-wasm needs an ES-module worker (worker: { format: 'es' }), Revision tagging and terminate-and-respawn cancellation, A file is filed by its root element, not its extension, Findings are attributed to the file they belong in, Downstream re-derivation tiered by cost, Three-file workspace: one slot per kind (xml, xsd, sch), Hand-rolled typed worker protocol

### Community 74 - "qnameToString"
Cohesion: 0.18
Nodes (23): ChildGroup(), Attributes(), alignmentCommand(), attributeQName(), commandFor(), commandsForOperation(), setTextCommand(), compose() (+15 more)

### Community 76 - "Inspector section stack and per-document-kind registry"
Cohesion: 0.67
Nodes (3): Four-region resizable layout, Inspector section stack and per-document-kind registry, The Inspector is the selection inspector

### Community 81 - "catalogueFrom"
Cohesion: 0.18
Nodes (16): useSelfModel(), model(), model(), modelOf(), parse(), assembleSchema(), catalogueFrom(), model() (+8 more)

## Ambiguous Edges - Review These
- `Placeholder review state is derived, not tracked` → `Filtering narrows rather than highlights`  [AMBIGUOUS]
  PLAN.md · relation: semantically_similar_to
- `Pluggable xs:appinfo interpreter registry` → `A .sch someone emailed you is executable code`  [AMBIGUOUS]
  docs/schema-engine.md · relation: conceptually_related_to
- `Rounded Square Badge (32x32, rx=7, blue fill)` → `Code Editor Visual Identity (brackets as product signifier)`  [AMBIGUOUS]
  apps/editor/public/favicon.svg · relation: conceptually_related_to

## Knowledge Gaps
- **241 isolated node(s):** `graphify-guard.sh script`, `graphify-precommit.sh script`, `graphify-setup.sh script`, `name`, `version` (+236 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Placeholder review state is derived, not tracked` and `Filtering narrows rather than highlights`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Pluggable xs:appinfo interpreter registry` and `A .sch someone emailed you is executable code`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Rounded Square Badge (32x32, rx=7, blue fill)` and `Code Editor Visual Identity (brackets as product signifier)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `NodeId` connect `NodeId` to `xsd/src/index.ts`, `componentTree.ts`, `xsdAuthoring.ts`, `Tree.tsx`, `EditorStore`, `validation.ts`, `xml-core/src/index.ts`, `model/describe.ts`, `query.ts`, `TableView.tsx`, `elementContext`, `automaton.ts`, `diagnostics.ts`, `SchemaModel`, `XmlDocument`, `store.ts`, `schema.ts`, `SchemaSections.tsx`, `paste.ts`, `insert.ts`, `xpath.ts`, `schematron/src/parse.ts`, `interpret.ts`, `CstDomFacade`, `infer.ts`, `SchematronSections.tsx`, `SchematronStore`, `ROOT_ID`, `.node`, `scaffold.test.ts`, `qnameToString`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `XmlDocument` connect `XmlDocument` to `xsd/src/index.ts`, `NodeId`, `componentTree.ts`, `xsdAuthoring.ts`, `Tree.tsx`, `EditorStore`, `validation.ts`, `xml-core/src/index.ts`, `model/describe.ts`, `query.ts`, `TableView.tsx`, `elementContext`, `diagnostics.ts`, `store.ts`, `schema.ts`, `paste.ts`, `insert.ts`, `xpath.ts`, `schematron/src/parse.ts`, `wellformed.test.ts`, `taxonomy.test.ts`, `xsd/test/differential.test.ts`, `interpret.ts`, `CstDomFacade`, `infer.ts`, `SchematronSections.tsx`, `SchematronStore`, `ROOT_ID`, `differential11.test.ts`, `.node`, `schematron/test/differential.test.ts`, `scaffold.test.ts`, `qnameToString`, `catalogueFrom`, `interpret.test.ts`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `EditorStore` connect `EditorStore` to `xsd/src/index.ts`, `.node`, `differential11.test.ts`, `store.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `graphify-guard.sh script`, `graphify-precommit.sh script`, `graphify-setup.sh script` to the rest of the system?**
  _241 weakly-connected nodes found - possible documentation gaps or missing edges._