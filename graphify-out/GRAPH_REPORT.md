# Graph Report - x-editor  (2026-07-31)

## Corpus Check
- 138 files · ~152,310 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1612 nodes · 5044 edges · 86 communities (81 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4803c14e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- xsd/src/index.ts
- NodeId
- diagnostics.ts
- simpleTypes.ts
- xsdAuthoring.ts
- xsdRegex.ts
- dependencies
- .node
- EditorStore
- validation.ts
- xml-core/src/index.ts
- assemble.ts
- query.ts
- insert.ts
- elementContext
- App.tsx
- particles.ts
- SchemaSections.tsx
- XsdQName
- XmlDocument
- whatCanGoHere: forward run intersected with backward co-reachability
- workspaceProblems.ts
- assembleSchema
- The anti-drift differential harness
- Inspector.tsx
- paste.ts
- package.json
- xsd/package.json
- InsertPalette.tsx
- tokenizer.ts
- schematron/src/parse.ts
- SchemaModel
- compilerOptions
- automaton.ts
- compilerOptions
- Diagnostic interface
- schematron/package.json
- xsd-libxml2/package.json
- xsd/test/differential.test.ts
- xpath.ts
- scaffold.ts
- Lossless CST document model, not the DOM
- xml-core/package.json
- graphify
- insert.test.ts
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
- schematron.ts
- interpret.ts
- qnameToString
- differential11.test.ts
- graphify-guard.sh
- Quick fixes from error-tolerant alignment
- ProseMirror declined
- graphify-setup.sh
- schematron/tsconfig.json
- xml-core/tsconfig.json
- isElement
- xsd/tsconfig.json
- Editor App Favicon (32x32 SVG app icon)
- schematron/test/differential.test.ts
- validation-protocol/tsconfig.json
- check-bundle.mjs
- build-sw.mjs
- scaffold.test.ts
- Hand-rolled typed worker protocol
- store.ts
- componentTree.ts
- Inspector section stack and per-document-kind registry
- Expert mode differences table
- alignment.ts
- graphify-precommit.sh
- validateDocument
- allModel.ts
- .parse
- serialize.ts
- CoachMarks.tsx

## God Nodes (most connected - your core abstractions)
1. `NodeId` - 163 edges
2. `XmlDocument` - 95 edges
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

## Communities (86 total, 5 thin omitted)

### Community 0 - "xsd/src/index.ts"
Cohesion: 0.09
Nodes (59): AllContentModel, compileAll(), Annotation, AttributeUseKind, CompositionKind, DerivationControl, DerivationSet, EMPTY_DERIVATION_SET (+51 more)

### Community 1 - "NodeId"
Cohesion: 0.15
Nodes (5): SchematronParser, NodeId, Form, RawSimpleDerivation, SchemaParser

### Community 2 - "diagnostics.ts"
Cohesion: 0.15
Nodes (30): describeEdit(), isPlausibleRename(), levenshtein(), nameDistance(), formatQName(), applyWhiteSpace(), asElementName(), diagnoseAbstract() (+22 more)

### Community 3 - "simpleTypes.ts"
Cohesion: 0.07
Nodes (44): RawSimpleType, ANY_SIMPLE_TYPE, ANY_TYPE, base64Octets(), BUILT_IN_TYPES, builtInAncestry(), BuiltInFacets, builtInName() (+36 more)

### Community 4 - "xsdAuthoring.ts"
Cohesion: 0.14
Nodes (34): DocumentationSection(), hasInlineType(), IdentitySection(), RefactorSection(), referenceLabel(), resolveSimpleType(), SchemaHealthSection(), TypeSection() (+26 more)

### Community 5 - "xsdRegex.ts"
Cohesion: 0.08
Nodes (30): FacetsSection(), CharSet, ClassExpr, complementRanges(), Emitter, enumerable(), escapeInClass(), escapeLiteral() (+22 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (42): dependencies, react, react-dom, @tanstack/react-virtual, @x-editor/schematron, @x-editor/validation-protocol, @x-editor/xml-core, @x-editor/xsd (+34 more)

### Community 7 - ".node"
Cohesion: 0.17
Nodes (22): elementChildren(), nextPlaceholder(), pendingPlaceholders(), resolvePlaceholders(), textOf(), cellFor(), columnsFor(), tableFor() (+14 more)

### Community 8 - "EditorStore"
Cohesion: 0.07
Nodes (4): Placeholder, EditorStore, expandInitial(), WorkspaceFile

### Community 9 - "validation.ts"
Cohesion: 0.07
Nodes (19): EngineFinding, IDLE, ValidationClient, VerdictState, engine, doc(), FakeWorker, Posted (+11 more)

### Community 10 - "xml-core/src/index.ts"
Cohesion: 0.17
Nodes (32): Reference, NewElementSpec, decodeText(), normalizeAttributeValue(), buildElement(), buildTree(), elementBindings(), qnameSource() (+24 more)

### Community 11 - "assemble.ts"
Cohesion: 0.13
Nodes (18): applyRedefine(), AssembledDocument, normalizePath(), PendingDocument, REDEFINE_NS, RedefineResult, renameType(), resolveUri() (+10 more)

### Community 12 - "query.ts"
Cohesion: 0.14
Nodes (25): AllowedHere(), SchemaBadge(), cardinalityChip(), attributeStatuses(), build(), escapeAttribute(), escapeText(), findOccurs() (+17 more)

### Community 13 - "insert.ts"
Cohesion: 0.13
Nodes (31): ChildGroup(), AddRow(), Cell(), alignmentCommand(), attributeQName(), commandFor(), commandsForOperation(), moveBefore() (+23 more)

### Community 14 - "elementContext"
Cohesion: 0.23
Nodes (15): FlowEditor(), attributeName(), escapeAttribute(), escapeText(), FlowEdit, flowPreview(), flowSource(), inlineNames() (+7 more)

### Community 15 - "App.tsx"
Cohesion: 0.20
Nodes (14): Breadcrumb(), RightTab, FormView(), InsertPaletteHost(), DiagnosticRow(), ExplainPanel(), HistoryPanel(), ProblemsPanel() (+6 more)

### Community 16 - "particles.ts"
Cohesion: 0.12
Nodes (26): applyOperations(), EditOperation, AllMember, Candidate, ANY_NUMBER, ElementName, namespaceAllowed(), ONCE (+18 more)

### Community 17 - "SchemaSections.tsx"
Cohesion: 0.12
Nodes (28): AttributeField(), childGroups(), ChildGroupSpec, FormNode(), hint(), label(), ValueField(), AttributeRow() (+20 more)

### Community 18 - "XsdQName"
Cohesion: 0.17
Nodes (8): GlobalDeclaration, derivationSetHas(), Origin, qnameKey(), RawType, XsdQName, SkeletonAttribute, SymbolTable

### Community 19 - "XmlDocument"
Cohesion: 0.19
Nodes (3): XmlDocument, SerializeContext, XmlNode

### Community 20 - "whatCanGoHere: forward run intersected with backward co-reachability"
Cohesion: 0.10
Nodes (23): AllContentModel: xs:all is a bitset, not an automaton, Pluggable xs:appinfo interpreter registry, describeParticle / describeType — the guaranteed fallback, whatCanGoHere: forward run intersected with backward co-reachability, Wildcards: processContents drives the UI directly, Xerces XSCMValidator.whatCanGoHere precedent, src/schema/describe.ts — the documentation guarantee, Insert palette specification (+15 more)

### Community 21 - "workspaceProblems.ts"
Cohesion: 0.22
Nodes (11): FileTabs(), Counts, countsByFile(), countsFor(), NONE, ProblemSeverity, WorkspaceProblem, FILE_KINDS (+3 more)

### Community 22 - "assembleSchema"
Cohesion: 0.12
Nodes (19): SchemaStore, model(), model(), modelOf(), assembleSchema(), catalogueFrom(), SchemaCatalogue, XSD_NS (+11 more)

### Community 23 - "The anti-drift differential harness"
Cohesion: 0.12
Nodes (21): Install the differential oracles step (xmlschema, lxml), Substitution groups as symbol matchers, never expansion, Unique Particle Attribution and graceful UPA degradation, Differential harness finding: abstract substitution-group head accepted, The anti-drift differential harness, ISO/IEC 19757-3:2025 (Schematron, Edition 4), libxml2 demoted from authoritative validator to fast 1.0 oracle, Explicit disposal of native-memory handles in the worker (+13 more)

### Community 24 - "Inspector.tsx"
Cohesion: 0.14
Nodes (16): Attributes(), ElementName(), Inspector(), nameProblem(), ValueEditor(), SchemaAttributes(), XsiType(), countWords() (+8 more)

### Community 25 - "paste.ts"
Cohesion: 0.18
Nodes (20): commit(), PasteSheetHost(), compose(), analysePaste(), applyPaste(), bindingsOf(), countErrors(), describeOption() (+12 more)

### Community 26 - "package.json"
Cohesion: 0.11
Nodes (18): fast-check, devDependencies, fast-check, playwright, typescript, vitest, xslt3, name (+10 more)

### Community 27 - "xsd/package.json"
Cohesion: 0.11
Nodes (18): fontoxpath, dependencies, fontoxpath, @x-editor/xml-core, devDependencies, libxml2-wasm, exports, libxml2-wasm (+10 more)

### Community 28 - "InsertPalette.tsx"
Cohesion: 0.27
Nodes (12): filterCandidates(), GROUP_LABEL, GROUP_ORDER, groupInOrder(), InsertPalette(), isSubsequence(), plain(), previewOf() (+4 more)

### Community 29 - "tokenizer.ts"
Cohesion: 0.16
Nodes (16): isBlank(), isValidName(), isWhitespace(), RawAttribute, scanDoctype(), scanStartTag(), tokenize(), TokenizerError (+8 more)

### Community 30 - "schematron/src/parse.ts"
Cohesion: 0.19
Nodes (17): RuleStatistics, RunOptions, SchematronFinding, expandPatterns(), ParseSchematronResult, SCH_NS, SCH_NS_OLD, SchAssertion (+9 more)

### Community 31 - "SchemaModel"
Cohesion: 0.16
Nodes (8): SchemaSet, NamespaceSpec, RawComplexType, SchemaDiagnostic, applyOccurs(), concatenate(), SchemaModel, selectAlternative()

### Community 32 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, jsx, lib, noEmit, types, extends, include, DOM (+8 more)

### Community 33 - "automaton.ts"
Cohesion: 0.19
Nodes (20): acceptedNames(), coAccessibleStates(), compileContentModel(), coReachableSets(), detectAmbiguity(), firstInvalidIndex(), isAccepting(), isValidSequence() (+12 more)

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

### Community 39 - "xpath.ts"
Cohesion: 0.18
Nodes (16): checkExpression(), evaluateBoolean(), evaluateNodes(), FontoXPath, resolverFor(), run(), XPathFailure, XPathFailureDetail (+8 more)

### Community 40 - "scaffold.ts"
Cohesion: 0.18
Nodes (14): compile(), FillStep(), LoadedSchema, RootStep(), Wizard(), assignPrefixes(), escapeAttribute(), escapeText() (+6 more)

### Community 41 - "Lossless CST document model, not the DOM"
Cohesion: 0.18
Nodes (15): SPIKE-1 — libxml2-wasm reports all errors, with line numbers; columns are always 0, Visible undo history panel, IDomFacade: our CST is the XPath data model, ValidationPayload with lineMap, Mutation through commands that carry their own inverse, The lossless contract: identical bytes, not semantically equivalent, Property-based round-trip and apply-invert identity tests, Exact byte spans: every byte belongs to exactly one token (+7 more)

### Community 42 - "xml-core/package.json"
Cohesion: 0.13
Nodes (14): dependencies, saxes, exports, main, name, private, scripts, test (+6 more)

### Community 43 - "graphify"
Cohesion: 0.33
Nodes (5): Do not run `graphify label` here, graphify, If graphify is missing, Keeping it current, Using it

### Community 44 - "insert.test.ts"
Cohesion: 0.25
Nodes (5): EXAMPLE_RULES, EXAMPLE_RULES_NAME, EXAMPLE_SCHEMA, EXAMPLE_SCHEMA_NAME, nodesWithRole()

### Community 45 - "Glushkov position automaton"
Cohesion: 0.11
Nodes (18): Brüggemann-Klein & Wood, 1-unambiguity, Single backward co-reachability sweep for every gap, Effective content models (extension, restriction, xsi:type), Gelade, Gyssens & Martens, regular expressions with counting, Glushkov position automaton, Instrument compile time, position counts, unroll-budget hits, UPA violations, Kilpeläinen & Tuhkanen, regular expressions with numeric occurrence, Lazy per-type content-model compilation and IndexedDB persistence (+10 more)

### Community 46 - "x-editor"
Cohesion: 0.21
Nodes (14): Survey: no library exposes an XSD component model, Scope and sequencing (P1-P10), simple-type compiler is the sleeper, The schema-aware guidance engine (spec), Spike answers, SPIKE-0 — no library exposes an XSD component model, UX and visual design specification, Validation architecture and security model (spec), @x-editor/xml-core (+6 more)

### Community 48 - "Security model: client-side is not a security property"
Cohesion: 0.19
Nodes (13): PWA manifest and theme-color links, OASIS XML Catalogs for resolution, Security model asserted rather than assumed, SPIKE-2 — multi-file schema sets work through a registered input provider, libxml2 parser flag policy, Resolve the schema graph in JavaScript before calling into WASM, Never auto-fetch a remote schemaLocation, No telemetry in v1 (+5 more)

### Community 49 - "infer.ts"
Cohesion: 0.28
Nodes (12): attributeLine(), collectCaveats(), ElementFacts, elementName(), enumerationOrString(), escapeAttribute(), factsFor(), InferenceResult (+4 more)

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
Cohesion: 0.27
Nodes (7): AssertionSection(), attributeValue(), commitAttribute(), RuleSection(), SchematronInspector(), enclosingRule(), schematronRole()

### Community 54 - "validation-protocol/package.json"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, test, typecheck, type (+2 more)

### Community 55 - "schematron.ts"
Cohesion: 0.22
Nodes (5): SchematronStore, SchematronResult, parseSchematron(), SchDiagnostic, SchSchema

### Community 56 - "interpret.ts"
Cohesion: 0.23
Nodes (14): activePatterns(), AssertionCounts, AssertionStatistics, bindLets(), documentOrder(), EMPTY, NodeRef, positionOf() (+6 more)

### Community 57 - "qnameToString"
Cohesion: 0.20
Nodes (17): inlineText(), Tree(), TreeRow(), componentRowLabel(), buildRows(), nodeLabel(), Row, textPreview() (+9 more)

### Community 58 - "differential11.test.ts"
Cohesion: 0.24
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

### Community 65 - "isElement"
Cohesion: 0.22
Nodes (12): App(), container, isSchemaDocument(), describe(), explainDocument(), Explanation, ExplanationStep, shapeOf() (+4 more)

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
Cohesion: 0.27
Nodes (9): Example, EXAMPLES, INVOICE_DOCUMENT, INVOICE_RULES, INVOICE_SCHEMA, TOPIC_DOCUMENT, TOPIC_METADATA_SCHEMA, TOPIC_SCHEMA (+1 more)

### Community 73 - "Hand-rolled typed worker protocol"
Cohesion: 0.29
Nodes (7): libxml2-wasm needs an ES-module worker (worker: { format: 'es' }), Revision tagging and terminate-and-respawn cancellation, A file is filed by its root element, not its extension, Findings are attributed to the file they belong in, Downstream re-derivation tiered by cost, Three-file workspace: one slot per kind (xml, xsd, sch), Hand-rolled typed worker protocol

### Community 74 - "store.ts"
Cohesion: 0.31
Nodes (6): StartScreen(), store, NEW_SCH, NEW_XML, NEW_XSD, loadXPath()

### Community 75 - "componentTree.ts"
Cohesion: 0.33
Nodes (11): appendLiteral(), attribute(), buildComponentRows(), collect(), contentSummary(), Group, headingKey(), HEADINGS (+3 more)

### Community 76 - "Inspector section stack and per-document-kind registry"
Cohesion: 0.67
Nodes (3): Four-region resizable layout, Inspector section stack and per-document-kind registry, The Inspector is the selection inspector

### Community 79 - "alignment.ts"
Cohesion: 0.32
Nodes (11): acceptableFrom(), Alignment, alignToModel(), EditKind, isAccepting(), key(), matcherAccepts(), SearchState (+3 more)

### Community 81 - "validateDocument"
Cohesion: 0.27
Nodes (6): Diagnostic, isDocumentValid(), validateDocument(), diagnose(), find(), model

### Community 82 - "allModel.ts"
Cohesion: 0.47
Nodes (9): allFirstInvalidIndex(), allIsValid(), allRequiredMissing(), allWhatCanGoHere(), counts(), isAllParticle(), memberFor(), wildcardAccepts() (+1 more)

### Community 83 - ".parse"
Cohesion: 0.32
Nodes (5): parse(), parseSchematronSource(), run(), codes(), messages()

### Community 84 - "serialize.ts"
Cohesion: 0.50
Nodes (6): encodeAttributeValue(), encodeText(), escapeAmpersands(), PREDEFINED, serializeElement(), serializeNode()

### Community 85 - "CoachMarks.tsx"
Cohesion: 0.50
Nodes (3): CoachMarks(), Mark, MARKS

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
- **Why does `NodeId` connect `NodeId` to `xsd/src/index.ts`, `diagnostics.ts`, `xsdAuthoring.ts`, `.node`, `EditorStore`, `validation.ts`, `xml-core/src/index.ts`, `query.ts`, `insert.ts`, `elementContext`, `particles.ts`, `SchemaSections.tsx`, `XsdQName`, `XmlDocument`, `workspaceProblems.ts`, `assembleSchema`, `Inspector.tsx`, `paste.ts`, `schematron/src/parse.ts`, `xpath.ts`, `scaffold.ts`, `insert.test.ts`, `CstDomFacade`, `infer.ts`, `SchematronSections.tsx`, `schematron.ts`, `interpret.ts`, `qnameToString`, `isElement`, `scaffold.test.ts`, `store.ts`, `componentTree.ts`, `validateDocument`, `serialize.ts`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `XmlDocument` connect `XmlDocument` to `xsd/src/index.ts`, `NodeId`, `diagnostics.ts`, `xsdAuthoring.ts`, `.node`, `EditorStore`, `validation.ts`, `xml-core/src/index.ts`, `assemble.ts`, `query.ts`, `insert.ts`, `elementContext`, `SchemaSections.tsx`, `assembleSchema`, `Inspector.tsx`, `paste.ts`, `tokenizer.ts`, `schematron/src/parse.ts`, `xsd/test/differential.test.ts`, `xpath.ts`, `scaffold.ts`, `CstDomFacade`, `infer.ts`, `schematron.ts`, `interpret.ts`, `qnameToString`, `differential11.test.ts`, `isElement`, `schematron/test/differential.test.ts`, `scaffold.test.ts`, `store.ts`, `componentTree.ts`, `validateDocument`, `.parse`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `ValidationClient` connect `validation.ts` to `store.ts`, `XmlDocument`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `graphify-guard.sh script`, `graphify-precommit.sh script`, `graphify-setup.sh script` to the rest of the system?**
  _241 weakly-connected nodes found - possible documentation gaps or missing edges._