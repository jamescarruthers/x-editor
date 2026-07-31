# Graph Report - x-editor  (2026-07-31)

## Corpus Check
- 136 files · ~146,894 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1582 nodes · 4968 edges · 81 communities (75 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ef9f7532`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- particles.ts
- NodeId
- xsd/src/index.ts
- simpleTypes.ts
- xsdAuthoring.ts
- xsdRegex.ts
- dependencies
- .node
- EditorStore
- validation.ts
- xml-core/src/index.ts
- SchemaModel
- query.ts
- insert.ts
- assemble.ts
- App.tsx
- diagnostics.ts
- automaton.ts
- XsdQName
- XmlDocument
- whatCanGoHere: forward run intersected with backward co-reachability
- store.ts
- assembleSchema
- The anti-drift differential harness
- mixed.ts
- paste.ts
- package.json
- xsd/package.json
- tokenizer.ts
- qnameToString
- interpret.ts
- scaffold.ts
- compilerOptions
- allModel.ts
- compilerOptions
- Diagnostic interface
- schematron/package.json
- xsd-libxml2/package.json
- alignment.ts
- xpath.ts
- scaffold.test.ts
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
- runSchematron
- validationSerializer.ts
- validateDocument
- graphify-guard.sh
- Quick fixes from error-tolerant alignment
- ProseMirror declined
- graphify-setup.sh
- schematron/tsconfig.json
- xml-core/tsconfig.json
- xsd/test/differential.test.ts
- xsd/tsconfig.json
- Editor App Favicon (32x32 SVG app icon)
- schematron/test/differential.test.ts
- validation-protocol/tsconfig.json
- check-bundle.mjs
- build-sw.mjs
- serialize.ts
- Hand-rolled typed worker protocol
- differential11.test.ts
- Command
- Inspector section stack and per-document-kind registry
- Expert mode differences table
- alignment.test.ts
- graphify-precommit.sh

## God Nodes (most connected - your core abstractions)
1. `NodeId` - 163 edges
2. `XmlDocument` - 88 edges
3. `isElement()` - 79 edges
4. `SchemaModel` - 57 edges
5. `SchemaParser` - 52 edges
6. `EditorStore` - 44 edges
7. `XsdQName` - 39 edges
8. `elementContext` - 38 edges
9. `qnameToString()` - 37 edges
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

## Communities (81 total, 6 thin omitted)

### Community 0 - "particles.ts"
Cohesion: 0.13
Nodes (22): Candidate, matches(), ANY_NUMBER, ElementName, elementNameEquals(), namespaceAllowed(), ONCE, OPTIONAL (+14 more)

### Community 1 - "NodeId"
Cohesion: 0.14
Nodes (7): Group, ExplanationStep, SchematronParser, NodeId, Form, RawSimpleDerivation, SchemaParser

### Community 2 - "xsd/src/index.ts"
Cohesion: 0.09
Nodes (58): AllContentModel, AllMember, Annotation, AttributeUseKind, CompositionKind, DerivationControl, DerivationSet, derivationSetHas() (+50 more)

### Community 3 - "simpleTypes.ts"
Cohesion: 0.06
Nodes (58): isBuiltIn(), RawFacet, RawSimpleType, ANY_SIMPLE_TYPE, ANY_TYPE, applyWhiteSpace(), base64Octets(), BUILT_IN_TYPES (+50 more)

### Community 4 - "xsdAuthoring.ts"
Cohesion: 0.13
Nodes (40): hasInlineType(), IdentitySection(), RefactorSection(), referenceLabel(), resolveSimpleType(), SchemaHealthSection(), TypeSection(), XsdInspector() (+32 more)

### Community 5 - "xsdRegex.ts"
Cohesion: 0.08
Nodes (33): FacetsSection(), describeFacets(), joinClauses(), explainType(), CharSet, ClassExpr, complementRanges(), Emitter (+25 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (42): dependencies, react, react-dom, @tanstack/react-virtual, @x-editor/schematron, @x-editor/validation-protocol, @x-editor/xml-core, @x-editor/xsd (+34 more)

### Community 7 - ".node"
Cohesion: 0.14
Nodes (33): DocumentationSection(), appendLiteral(), attribute(), buildComponentRows(), collect(), contentSummary(), headingKey(), HEADINGS (+25 more)

### Community 8 - "EditorStore"
Cohesion: 0.08
Nodes (5): Placeholder, EditorStore, expandInitial(), WorkspaceFile, text()

### Community 9 - "validation.ts"
Cohesion: 0.09
Nodes (16): EngineFinding, IDLE, ValidationClient, VerdictState, engine, EngineError, EngineResult, SchemaSource (+8 more)

### Community 10 - "xml-core/src/index.ts"
Cohesion: 0.17
Nodes (29): Reference, decodeText(), normalizeAttributeValue(), buildElement(), buildTree(), elementBindings(), qnameSource(), Scope (+21 more)

### Community 11 - "SchemaModel"
Cohesion: 0.17
Nodes (6): compileAll(), NamespaceSpec, qnameKey(), SchemaDiagnostic, SchemaModel, declaredName()

### Community 12 - "query.ts"
Cohesion: 0.05
Nodes (72): AttributeField(), ChildGroup(), childGroups(), ChildGroupSpec, FormNode(), hint(), label(), ValueField() (+64 more)

### Community 13 - "insert.ts"
Cohesion: 0.20
Nodes (23): AddRow(), alignmentCommand(), attributeQName(), commandFor(), commandsForOperation(), moveBefore(), setTextCommand(), attributeName() (+15 more)

### Community 14 - "assemble.ts"
Cohesion: 0.29
Nodes (8): applyRedefine(), normalizePath(), PendingDocument, REDEFINE_NS, renameType(), resolveUri(), rewriteGroupRefs(), rewriteSelfReference()

### Community 15 - "App.tsx"
Cohesion: 0.13
Nodes (19): App(), Breadcrumb(), RightTab, CoachMarks(), Mark, MARKS, FormView(), InsertPaletteHost() (+11 more)

### Community 16 - "diagnostics.ts"
Cohesion: 0.17
Nodes (25): describeEdit(), isPlausibleRename(), levenshtein(), nameDistance(), asElementName(), diagnoseAbstract(), diagnoseAllContent(), diagnoseAssertions() (+17 more)

### Community 17 - "automaton.ts"
Cohesion: 0.20
Nodes (19): acceptedNames(), coAccessibleStates(), coReachableSets(), detectAmbiguity(), firstInvalidIndex(), isAccepting(), isValidSequence(), Matcher (+11 more)

### Community 18 - "XsdQName"
Cohesion: 0.13
Nodes (17): AssembledDocument, RedefineResult, SchemaSet, formatQName(), Origin, RawAttribute, RawGroup, RawType (+9 more)

### Community 19 - "XmlDocument"
Cohesion: 0.18
Nodes (10): countDescendants(), insertElement(), insertText(), moveNode(), NewElementSpec, removeAttribute(), XmlDocument, NamespaceDeclaration (+2 more)

### Community 20 - "whatCanGoHere: forward run intersected with backward co-reachability"
Cohesion: 0.10
Nodes (23): AllContentModel: xs:all is a bitset, not an automaton, Pluggable xs:appinfo interpreter registry, describeParticle / describeType — the guaranteed fallback, whatCanGoHere: forward run intersected with backward co-reachability, Wildcards: processContents drives the UI directly, Xerces XSCMValidator.whatCanGoHere precedent, src/schema/describe.ts — the documentation guarantee, Insert palette specification (+15 more)

### Community 21 - "store.ts"
Cohesion: 0.17
Nodes (12): FileTabs(), countsByFile(), ProblemSeverity, WorkspaceProblem, FILE_KINDS, FILE_LABELS, FileKind, store (+4 more)

### Community 22 - "assembleSchema"
Cohesion: 0.13
Nodes (16): compile(), useSelfModel(), SchemaStore, model(), model(), modelOf(), assembleSchema(), catalogueFrom() (+8 more)

### Community 23 - "The anti-drift differential harness"
Cohesion: 0.12
Nodes (21): Install the differential oracles step (xmlschema, lxml), Substitution groups as symbol matchers, never expansion, Unique Particle Attribution and graceful UPA degradation, Differential harness finding: abstract substitution-group head accepted, The anti-drift differential harness, ISO/IEC 19757-3:2025 (Schematron, Edition 4), libxml2 demoted from authoritative validator to fast 1.0 oracle, Explicit disposal of native-memory handles in the worker (+13 more)

### Community 24 - "mixed.ts"
Cohesion: 0.33
Nodes (12): FlowEditor(), attributeName(), escapeAttribute(), escapeText(), flowSource(), inlineNames(), isFlowElement(), qname() (+4 more)

### Community 25 - "paste.ts"
Cohesion: 0.22
Nodes (17): commit(), PasteSheetHost(), analysePaste(), applyPaste(), bindingsOf(), countErrors(), describeOption(), elementChildren() (+9 more)

### Community 26 - "package.json"
Cohesion: 0.11
Nodes (18): fast-check, devDependencies, fast-check, playwright, typescript, vitest, xslt3, name (+10 more)

### Community 27 - "xsd/package.json"
Cohesion: 0.11
Nodes (18): fontoxpath, dependencies, fontoxpath, @x-editor/xml-core, devDependencies, libxml2-wasm, exports, libxml2-wasm (+10 more)

### Community 28 - "tokenizer.ts"
Cohesion: 0.16
Nodes (16): isBlank(), isValidName(), isWhitespace(), RawAttribute, scanDoctype(), scanStartTag(), tokenize(), TokenizerError (+8 more)

### Community 29 - "qnameToString"
Cohesion: 0.17
Nodes (19): Inspector(), inlineText(), Tree(), TreeRow(), componentRowLabel(), countWords(), describe(), describeElement() (+11 more)

### Community 30 - "interpret.ts"
Cohesion: 0.19
Nodes (19): AssertionCounts, AssertionStatistics, EMPTY, NodeRef, RuleStatistics, RunOptions, SchematronFinding, expandPatterns() (+11 more)

### Community 31 - "scaffold.ts"
Cohesion: 0.29
Nodes (9): FillStep(), assignPrefixes(), escapeAttribute(), escapeText(), PlaceholderPath, Scaffold, scaffoldDocument(), ScaffoldOptions (+1 more)

### Community 32 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, jsx, lib, noEmit, types, extends, include, DOM (+8 more)

### Community 33 - "allModel.ts"
Cohesion: 0.29
Nodes (13): allFirstInvalidIndex(), allIsValid(), allRequiredMissing(), allWhatCanGoHere(), counts(), isAllParticle(), memberFor(), wildcardAccepts() (+5 more)

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

### Community 38 - "alignment.ts"
Cohesion: 0.29
Nodes (11): acceptableFrom(), Alignment, alignToModel(), EditKind, EditOperation, isAccepting(), key(), matcherAccepts() (+3 more)

### Community 39 - "xpath.ts"
Cohesion: 0.14
Nodes (20): bindLets(), renderMessage(), selectContext(), evaluateBoolean(), evaluateNodes(), evaluateString(), FontoXPath, resolverFor() (+12 more)

### Community 40 - "scaffold.test.ts"
Cohesion: 0.18
Nodes (13): StartScreen(), LoadedSchema, RootStep(), Wizard(), Example, EXAMPLES, INVOICE_DOCUMENT, INVOICE_RULES (+5 more)

### Community 41 - "Lossless CST document model, not the DOM"
Cohesion: 0.18
Nodes (15): SPIKE-1 — libxml2-wasm reports all errors, with line numbers; columns are always 0, Visible undo history panel, IDomFacade: our CST is the XPath data model, ValidationPayload with lineMap, Mutation through commands that carry their own inverse, The lossless contract: identical bytes, not semantically equivalent, Property-based round-trip and apply-invert identity tests, Exact byte spans: every byte belongs to exactly one token (+7 more)

### Community 42 - "xml-core/package.json"
Cohesion: 0.13
Nodes (14): dependencies, saxes, exports, main, name, private, scripts, test (+6 more)

### Community 43 - "graphify"
Cohesion: 0.40
Nodes (4): graphify, If graphify is missing, Keeping it current, Using it

### Community 44 - "insert.test.ts"
Cohesion: 0.22
Nodes (7): SchematronInspector(), EXAMPLE_RULES, EXAMPLE_RULES_NAME, EXAMPLE_SCHEMA, EXAMPLE_SCHEMA_NAME, schematronRole(), nodesWithRole()

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
Cohesion: 0.31
Nodes (6): AssertionSection(), attributeValue(), commitAttribute(), RuleSection(), enclosingRule(), checkExpression()

### Community 54 - "validation-protocol/package.json"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, test, typecheck, type (+2 more)

### Community 55 - "schematron.ts"
Cohesion: 0.21
Nodes (7): SchematronStore, SchematronResult, parseSchematron(), SCH_NS, SCH_NS_OLD, SchDiagnostic, SchSchema

### Community 56 - "runSchematron"
Cohesion: 0.24
Nodes (8): parse(), activePatterns(), documentOrder(), positionOf(), runSchematron(), shadowingRule(), parseSchematronSource(), run()

### Community 57 - "validationSerializer.ts"
Cohesion: 0.42
Nodes (8): attributesOf(), elementChildren(), hasSignificantText(), inlineContent(), nodeForLine(), serializeForValidation(), nameAtLine(), serialize()

### Community 58 - "validateDocument"
Cohesion: 0.25
Nodes (7): isDocumentValid(), validateDocument(), diagnose(), find(), model, codes(), messages()

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

### Community 65 - "xsd/test/differential.test.ts"
Cohesion: 0.22
Nodes (7): Case, CASES, CORNER_CASES, OracleError, OracleResult, validateWithLibxml2(), withCatalogue()

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

### Community 72 - "serialize.ts"
Cohesion: 0.42
Nodes (7): encodeAttributeValue(), encodeText(), escapeAmpersands(), PREDEFINED, SerializeContext, serializeElement(), serializeNode()

### Community 73 - "Hand-rolled typed worker protocol"
Cohesion: 0.29
Nodes (7): libxml2-wasm needs an ES-module worker (worker: { format: 'es' }), Revision tagging and terminate-and-respawn cancellation, A file is filed by its root element, not its extension, Findings are attributed to the file they belong in, Downstream re-derivation tiered by cost, Three-file workspace: one slot per kind (xml, xsd, sch), Hand-rolled typed worker protocol

### Community 74 - "differential11.test.ts"
Cohesion: 0.28
Nodes (6): available, Case, CASES, validateWithXmlschema(), xmlschemaAvailable(), XmlschemaResult

### Community 76 - "Inspector section stack and per-document-kind registry"
Cohesion: 0.67
Nodes (3): Four-region resizable layout, Inspector section stack and per-document-kind registry, The Inspector is the selection inspector

### Community 79 - "alignment.test.ts"
Cohesion: 0.52
Nodes (6): applyOperations(), compileContentModel(), align(), applyEdits(), n(), names()

## Ambiguous Edges - Review These
- `Placeholder review state is derived, not tracked` → `Filtering narrows rather than highlights`  [AMBIGUOUS]
  PLAN.md · relation: semantically_similar_to
- `Pluggable xs:appinfo interpreter registry` → `A .sch someone emailed you is executable code`  [AMBIGUOUS]
  docs/schema-engine.md · relation: conceptually_related_to
- `Rounded Square Badge (32x32, rx=7, blue fill)` → `Code Editor Visual Identity (brackets as product signifier)`  [AMBIGUOUS]
  apps/editor/public/favicon.svg · relation: conceptually_related_to

## Knowledge Gaps
- **238 isolated node(s):** `graphify-guard.sh script`, `graphify-precommit.sh script`, `graphify-setup.sh script`, `name`, `version` (+233 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Placeholder review state is derived, not tracked` and `Filtering narrows rather than highlights`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Pluggable xs:appinfo interpreter registry` and `A .sch someone emailed you is executable code`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Rounded Square Badge (32x32, rx=7, blue fill)` and `Code Editor Visual Identity (brackets as product signifier)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `NodeId` connect `NodeId` to `particles.ts`, `xsd/src/index.ts`, `xsdAuthoring.ts`, `.node`, `EditorStore`, `validation.ts`, `xml-core/src/index.ts`, `query.ts`, `insert.ts`, `diagnostics.ts`, `XsdQName`, `XmlDocument`, `store.ts`, `assembleSchema`, `mixed.ts`, `paste.ts`, `qnameToString`, `interpret.ts`, `scaffold.ts`, `xpath.ts`, `scaffold.test.ts`, `insert.test.ts`, `CstDomFacade`, `infer.ts`, `SchematronSections.tsx`, `schematron.ts`, `validationSerializer.ts`, `serialize.ts`, `Command`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `XmlDocument` connect `XmlDocument` to `NodeId`, `xsd/src/index.ts`, `xsdAuthoring.ts`, `.node`, `EditorStore`, `validation.ts`, `xml-core/src/index.ts`, `query.ts`, `insert.ts`, `assemble.ts`, `diagnostics.ts`, `XsdQName`, `store.ts`, `assembleSchema`, `mixed.ts`, `paste.ts`, `tokenizer.ts`, `qnameToString`, `interpret.ts`, `scaffold.ts`, `xpath.ts`, `scaffold.test.ts`, `CstDomFacade`, `infer.ts`, `schematron.ts`, `runSchematron`, `validationSerializer.ts`, `validateDocument`, `xsd/test/differential.test.ts`, `schematron/test/differential.test.ts`, `differential11.test.ts`, `Command`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `isElement()` connect `.node` to `NodeId`, `xsd/src/index.ts`, `xsdAuthoring.ts`, `xml-core/src/index.ts`, `query.ts`, `insert.ts`, `diagnostics.ts`, `assembleSchema`, `mixed.ts`, `paste.ts`, `qnameToString`, `interpret.ts`, `scaffold.ts`, `xpath.ts`, `insert.test.ts`, `CstDomFacade`, `infer.ts`, `schematron.ts`, `validationSerializer.ts`, `validateDocument`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `graphify-guard.sh script`, `graphify-precommit.sh script`, `graphify-setup.sh script` to the rest of the system?**
  _238 weakly-connected nodes found - possible documentation gaps or missing edges._