# Graph Report - .  (2026-07-31)

## Corpus Check
- 135 files · ~145,487 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1571 nodes · 4961 edges · 79 communities (77 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Error-Tolerant Alignment
- Schematron Parsing
- XSD AST and Content Models
- XSD Built-In Types
- XSD Authoring Inspector
- XSD Regex Translation
- Editor App Dependencies
- XSD Component View
- Editor Workspace Store
- libxml2 Validation Client
- XML Core Document
- Selection Inspector
- Schema Query API
- Table View and Quick Fixes
- Schema Assembly and Redefine
- App Shell and Toolbar
- Diagnostics and Renames
- Form View
- QNames and Symbol Spaces
- Document Edit Commands
- Guidance Engine Design Notes
- File Tabs and Workspace Problems
- Schema Store
- Differential Harness Design
- Mixed Content Flow Editor
- Smart Paste
- Root Dev Dependencies
- XSD Package Dependencies
- XML Tokenizer
- Complex Type Compiler
- Schematron Schema Model
- New Document Wizard
- Editor TypeScript Config
- Schematron Interpreter
- Base TypeScript Config
- Diagnostics and Accessibility Notes
- Schematron Package Manifest
- libxml2 Package Manifest
- XPath Engine Binding
- Insert Palette
- Start Screen and Examples
- Lossless CST Design Notes
- XML Core Package Manifest
- Human-Readable Descriptions
- Purchase Order Example
- Automaton Theory References
- Plan and Spec Index
- CST DOM Facade
- Security and Offline Policy
- Schema Inference
- Scaffolding and Onboarding Notes
- libxml2 TypeScript Config
- CI and Pages Deployment
- Schematron Inspector
- Validation Protocol Manifest
- Simple Type Compiler
- XSD Differential Tests
- Validation Serializer
- Entities and Serialization
- Schematron Store
- Inference and Quick-Fix References
- Mixed Content Design Notes
- Schematron Differential Tests
- Schematron TypeScript Config
- XML Core TypeScript Config
- XSD 1.1 Differential Tests
- XSD TypeScript Config
- Favicon and Brand Identity
- Schematron Interpreter Tests
- Validation Protocol Config
- Bundle Budget Check
- Service Worker Build
- Table and Widget Models
- Workspace and Worker Design Notes
- Error Taxonomy Tests
- Coach Marks
- Layout Design Notes
- Expert Mode Notes

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

## Communities (79 total, 2 thin omitted)

### Community 0 - "Error-Tolerant Alignment"
Cohesion: 0.06
Nodes (76): acceptableFrom(), Alignment, alignToModel(), applyOperations(), describeEdit(), EditKind, EditOperation, isAccepting() (+68 more)

### Community 1 - "Schematron Parsing"
Cohesion: 0.13
Nodes (7): Group, ExplanationStep, SchematronParser, NodeId, Form, RawSimpleDerivation, SchemaParser

### Community 2 - "XSD AST and Content Models"
Cohesion: 0.10
Nodes (49): AllContentModel, AllMember, compileAll(), Annotation, AttributeUseKind, CompositionKind, DerivationControl, DerivationSet (+41 more)

### Community 3 - "XSD Built-In Types"
Cohesion: 0.07
Nodes (46): ANY_SIMPLE_TYPE, base64Octets(), BUILT_IN_TYPES, builtInAncestry(), BuiltInFacets, builtInName(), builtInType, BY_NAME (+38 more)

### Community 4 - "XSD Authoring Inspector"
Cohesion: 0.12
Nodes (43): DocumentationSection(), hasInlineType(), IdentitySection(), RefactorSection(), referenceLabel(), resolveSimpleType(), SchemaHealthSection(), TypeSection() (+35 more)

### Community 5 - "XSD Regex Translation"
Cohesion: 0.09
Nodes (27): CharSet, ClassExpr, complementRanges(), Emitter, enumerable(), escapeInClass(), escapeLiteral(), LITERAL_SPECIALS (+19 more)

### Community 6 - "Editor App Dependencies"
Cohesion: 0.05
Nodes (42): dependencies, react, react-dom, @tanstack/react-virtual, @x-editor/schematron, @x-editor/validation-protocol, @x-editor/xml-core, @x-editor/xsd (+34 more)

### Community 7 - "XSD Component View"
Cohesion: 0.13
Nodes (35): appendLiteral(), attribute(), buildComponentRows(), collect(), componentRowLabel(), contentSummary(), headingKey(), HEADINGS (+27 more)

### Community 8 - "Editor Workspace Store"
Cohesion: 0.09
Nodes (3): EditorStore, expandInitial(), text()

### Community 9 - "libxml2 Validation Client"
Cohesion: 0.09
Nodes (16): EngineFinding, IDLE, ValidationClient, VerdictState, engine, EngineError, EngineResult, SchemaSource (+8 more)

### Community 10 - "XML Core Document"
Cohesion: 0.17
Nodes (31): countDescendants(), NewElementSpec, decodeText(), normalizeAttributeValue(), buildElement(), buildTree(), elementBindings(), qnameSource() (+23 more)

### Community 11 - "Selection Inspector"
Cohesion: 0.12
Nodes (24): Attributes(), ElementName(), Inspector(), nameProblem(), ValueEditor(), inlineText(), SchemaBadge(), Tree() (+16 more)

### Community 12 - "Schema Query API"
Cohesion: 0.11
Nodes (30): countErrors(), root(), cardinalityChip(), Description, AttributeUse, CompiledType, AttributeStatus, build() (+22 more)

### Community 13 - "Table View and Quick Fixes"
Cohesion: 0.19
Nodes (27): ChildGroup(), AddRow(), Cell(), alignmentCommand(), attributeQName(), commandFor(), commandsForOperation(), moveBefore() (+19 more)

### Community 14 - "Schema Assembly and Redefine"
Cohesion: 0.12
Nodes (21): applyRedefine(), AssembledDocument, normalizePath(), PendingDocument, REDEFINE_NS, RedefineResult, renameType(), resolveUri() (+13 more)

### Community 15 - "App Shell and Toolbar"
Cohesion: 0.14
Nodes (20): App(), Breadcrumb(), RightTab, FileTabs(), FormView(), InsertPaletteHost(), DiagnosticRow(), ExplainPanel() (+12 more)

### Community 16 - "Diagnostics and Renames"
Cohesion: 0.16
Nodes (24): isPlausibleRename(), nameDistance(), applyWhiteSpace(), matchesLexicalSpace(), asElementName(), diagnoseAbstract(), diagnoseAssertions(), diagnoseAttributes() (+16 more)

### Community 17 - "Form View"
Cohesion: 0.17
Nodes (17): childGroups(), ChildGroupSpec, FormNode(), hint(), label(), ValueField(), AttributeRow(), rich() (+9 more)

### Community 18 - "QNames and Symbol Spaces"
Cohesion: 0.25
Nodes (6): GlobalDeclaration, formatQName(), Origin, qnameKey(), XsdQName, SymbolTable

### Community 19 - "Document Edit Commands"
Cohesion: 0.15
Nodes (6): insertElement(), insertText(), moveNode(), XmlDocument, SerializeContext, XmlNode

### Community 20 - "Guidance Engine Design Notes"
Cohesion: 0.10
Nodes (23): AllContentModel: xs:all is a bitset, not an automaton, Pluggable xs:appinfo interpreter registry, describeParticle / describeType — the guaranteed fallback, whatCanGoHere: forward run intersected with backward co-reachability, Wildcards: processContents drives the UI directly, Xerces XSCMValidator.whatCanGoHere precedent, src/schema/describe.ts — the documentation guarantee, Insert palette specification (+15 more)

### Community 21 - "File Tabs and Workspace Problems"
Cohesion: 0.17
Nodes (12): Placeholder, countsByFile(), ProblemSeverity, WorkspaceProblem, FILE_KINDS, FILE_LABELS, FileKind, WorkspaceFile (+4 more)

### Community 22 - "Schema Store"
Cohesion: 0.15
Nodes (13): useSelfModel(), SchemaStore, model(), model(), modelOf(), assembleSchema(), catalogueFrom(), SchemaCatalogue (+5 more)

### Community 23 - "Differential Harness Design"
Cohesion: 0.12
Nodes (21): Install the differential oracles step (xmlschema, lxml), Substitution groups as symbol matchers, never expansion, Unique Particle Attribution and graceful UPA degradation, Differential harness finding: abstract substitution-group head accepted, The anti-drift differential harness, ISO/IEC 19757-3:2025 (Schematron, Edition 4), libxml2 demoted from authoritative validator to fast 1.0 oracle, Explicit disposal of native-memory handles in the worker (+13 more)

### Community 24 - "Mixed Content Flow Editor"
Cohesion: 0.23
Nodes (14): FlowEditor(), attributeName(), escapeAttribute(), escapeText(), FlowEdit, flowSource(), inlineNames(), isFlowElement() (+6 more)

### Community 25 - "Smart Paste"
Cohesion: 0.23
Nodes (16): commit(), PasteSheetHost(), analysePaste(), applyPaste(), bindingsOf(), describeOption(), elementChildren(), labelOf() (+8 more)

### Community 26 - "Root Dev Dependencies"
Cohesion: 0.11
Nodes (18): fast-check, devDependencies, fast-check, playwright, typescript, vitest, xslt3, name (+10 more)

### Community 27 - "XSD Package Dependencies"
Cohesion: 0.11
Nodes (18): fontoxpath, dependencies, fontoxpath, @x-editor/xml-core, devDependencies, libxml2-wasm, exports, libxml2-wasm (+10 more)

### Community 28 - "XML Tokenizer"
Cohesion: 0.16
Nodes (15): isBlank(), isWhitespace(), RawAttribute, scanDoctype(), scanStartTag(), Token, tokenize(), TokenizerError (+7 more)

### Community 29 - "Complex Type Compiler"
Cohesion: 0.20
Nodes (6): NamespaceSpec, RawComplexType, applyOccurs(), concatenate(), SchemaModel, declaredName()

### Community 30 - "Schematron Schema Model"
Cohesion: 0.22
Nodes (16): SchematronFinding, expandPatterns(), parseSchematron(), ParseSchematronResult, SCH_NS, SCH_NS_OLD, SchAssertion, SchDiagnosticText (+8 more)

### Community 31 - "New Document Wizard"
Cohesion: 0.18
Nodes (14): compile(), FillStep(), LoadedSchema, RootStep(), Wizard(), assignPrefixes(), escapeAttribute(), escapeText() (+6 more)

### Community 32 - "Editor TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, jsx, lib, noEmit, types, extends, include, DOM (+8 more)

### Community 33 - "Schematron Interpreter"
Cohesion: 0.19
Nodes (16): activePatterns(), AssertionCounts, AssertionStatistics, bindLets(), documentOrder(), EMPTY, NodeRef, positionOf() (+8 more)

### Community 34 - "Base TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, exactOptionalPropertyTypes, isolatedModules, lib, module, moduleResolution, noFallthroughCasesInSwitch (+8 more)

### Community 35 - "Diagnostics and Accessibility Notes"
Cohesion: 0.13
Nodes (16): Badge roll-up and incremental revalidation, Single backward co-reachability sweep for every gap, Diagnostic interface, Error taxonomy — 20 classes, each with a plain-English rewrite and a fix, Namespace mismatch deserves its own diagnostic, SPIKE-3 — Glushkov automaton latency, partially answered, One debounced polite live region and the delta-only rule, role="tree" with aria-activedescendant, rejecting treegrid (+8 more)

### Community 36 - "Schematron Package Manifest"
Cohesion: 0.12
Nodes (15): dependencies, @x-editor/xml-core, @x-editor/xsd, exports, @x-editor/xml-core, @x-editor/xsd, main, name (+7 more)

### Community 37 - "libxml2 Package Manifest"
Cohesion: 0.12
Nodes (15): dependencies, libxml2-wasm, @x-editor/validation-protocol, exports, libxml2-wasm, @x-editor/validation-protocol, main, name (+7 more)

### Community 38 - "XPath Engine Binding"
Cohesion: 0.17
Nodes (14): evaluateNodes(), FontoXPath, resolverFor(), run(), XPathFailure, XPathFailureDetail, XPathNode, XPathNodeRef (+6 more)

### Community 39 - "Insert Palette"
Cohesion: 0.26
Nodes (14): filterCandidates(), GROUP_LABEL, GROUP_ORDER, groupInOrder(), InsertPalette(), isSubsequence(), plain(), previewOf() (+6 more)

### Community 40 - "Start Screen and Examples"
Cohesion: 0.29
Nodes (9): StartScreen(), Example, EXAMPLES, INVOICE_DOCUMENT, INVOICE_RULES, INVOICE_SCHEMA, TOPIC_DOCUMENT, TOPIC_METADATA_SCHEMA (+1 more)

### Community 41 - "Lossless CST Design Notes"
Cohesion: 0.18
Nodes (15): SPIKE-1 — libxml2-wasm reports all errors, with line numbers; columns are always 0, Visible undo history panel, IDomFacade: our CST is the XPath data model, ValidationPayload with lineMap, Mutation through commands that carry their own inverse, The lossless contract: identical bytes, not semantically equivalent, Property-based round-trip and apply-invert identity tests, Exact byte spans: every byte belongs to exactly one token (+7 more)

### Community 42 - "XML Core Package Manifest"
Cohesion: 0.13
Nodes (14): dependencies, saxes, exports, main, name, private, scripts, test (+6 more)

### Community 43 - "Human-Readable Descriptions"
Cohesion: 0.26
Nodes (13): AttributeField(), FacetsSection(), describeAttribute(), describeCardinality(), describeElement(), describeFacets(), describeType(), describeWildcard() (+5 more)

### Community 44 - "Purchase Order Example"
Cohesion: 0.21
Nodes (8): SchematronInspector(), EXAMPLE_RULES, EXAMPLE_RULES_NAME, EXAMPLE_SCHEMA, EXAMPLE_SCHEMA_NAME, schematronRole(), store, nodesWithRole()

### Community 45 - "Automaton Theory References"
Cohesion: 0.14
Nodes (14): Brüggemann-Klein & Wood, 1-unambiguity, Effective content models (extension, restriction, xsi:type), Gelade, Gyssens & Martens, regular expressions with counting, Glushkov position automaton, Instrument compile time, position counts, unroll-budget hits, UPA violations, Kilpeläinen & Tuhkanen, regular expressions with numeric occurrence, Lazy per-type content-model compilation and IndexedDB persistence, Numeric occurrence: unbounded / unroll / counting hybrid (+6 more)

### Community 46 - "Plan and Spec Index"
Cohesion: 0.21
Nodes (14): Survey: no library exposes an XSD component model, Scope and sequencing (P1-P10), simple-type compiler is the sleeper, The schema-aware guidance engine (spec), Spike answers, SPIKE-0 — no library exposes an XSD component model, UX and visual design specification, Validation architecture and security model (spec), @x-editor/xml-core (+6 more)

### Community 48 - "Security and Offline Policy"
Cohesion: 0.19
Nodes (13): PWA manifest and theme-color links, OASIS XML Catalogs for resolution, Security model asserted rather than assumed, SPIKE-2 — multi-file schema sets work through a registered input provider, libxml2 parser flag policy, Resolve the schema graph in JavaScript before calling into WASM, Never auto-fetch a remote schemaLocation, No telemetry in v1 (+5 more)

### Community 49 - "Schema Inference"
Cohesion: 0.28
Nodes (12): attributeLine(), collectCaveats(), ElementFacts, elementName(), enumerationOrString(), escapeAttribute(), factsFor(), InferenceResult (+4 more)

### Community 50 - "Scaffolding and Onboarding Notes"
Cohesion: 0.18
Nodes (13): buildSkeleton and placeholder provenance, Required-and-missing as a shortest-path BFS, XSD regex is not JavaScript regex (types/xsdRegex.ts), 'Add all required' is recursive and fills values, Onboarding empty states and three bundled examples, New-document wizard — five steps, XSD authoring mode UI, First-run coach marks, never modal (+5 more)

### Community 51 - "libxml2 TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, lib, outDir, rootDir, extends, include, DOM, ES2022 (+3 more)

### Community 52 - "CI and Pages Deployment"
Cohesion: 0.22
Nodes (11): CI build job, Check the bundle budget step (scripts/check-bundle.mjs), CI concurrency group with cancel-in-progress, pnpm/action-setup without an explicit version, BASE_PATH build env for the project Pages site, Deploy to GitHub Pages workflow, SPA fallback: copy index.html to 404.html, apps/editor index.html shell (+3 more)

### Community 53 - "Schematron Inspector"
Cohesion: 0.31
Nodes (6): AssertionSection(), attributeValue(), commitAttribute(), RuleSection(), enclosingRule(), checkExpression()

### Community 54 - "Validation Protocol Manifest"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, test, typecheck, type (+2 more)

### Community 55 - "Simple Type Compiler"
Cohesion: 0.25
Nodes (6): RawSimpleType, isWhiteSpaceNarrowing(), narrow(), SimpleTypeCompiler, translatePattern(), accepts()

### Community 56 - "XSD Differential Tests"
Cohesion: 0.22
Nodes (7): Case, CASES, CORNER_CASES, OracleError, OracleResult, validateWithLibxml2(), withCatalogue()

### Community 57 - "Validation Serializer"
Cohesion: 0.42
Nodes (8): attributesOf(), elementChildren(), hasSignificantText(), inlineContent(), nodeForLine(), serializeForValidation(), nameAtLine(), serialize()

### Community 58 - "Entities and Serialization"
Cohesion: 0.42
Nodes (7): Reference, encodeAttributeValue(), encodeText(), escapeAmpersands(), PREDEFINED, serializeElement(), serializeNode()

### Community 59 - "Schematron Store"
Cohesion: 0.36
Nodes (4): SchematronStore, SchematronResult, SchDiagnostic, SchSchema

### Community 60 - "Inference and Quick-Fix References"
Cohesion: 0.28
Nodes (9): Bex, Neven & Vansummeren, Inferring XML Schema Definitions from XML Data (VLDB 2007), Guidance degrades; the tool never does, Oflazer (1996), error-tolerant recognition, Quick fixes from error-tolerant alignment, QuickFix interface, Schema-less mode: infer, but never disguise a guess as a rule, SOA to SORE content-model inference, Schematron Quick Fixes (SQF) (+1 more)

### Community 61 - "Mixed Content Design Notes"
Cohesion: 0.28
Nodes (9): widgetFor(simpleTypeDef) decision table, ProseMirror declined, Scoped source snippet flow editor, SPIKE-4 — mixed content: neither candidate, and the spike asked the wrong question, Form view — same model, no second state tree, Risk 4: bundle weight and the entry-chunk regression, FlowEditor seam (flowSource / setFlow), A mixed element is one tree row carrying its flow (+1 more)

### Community 62 - "Schematron Differential Tests"
Cohesion: 0.28
Nodes (6): available, Case, CASES, isoSchematronAvailable(), IsoSchematronResult, runIsoSchematron()

### Community 63 - "Schematron TypeScript Config"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src, test, ../../tsconfig.base.json

### Community 64 - "XML Core TypeScript Config"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src, test, ../../tsconfig.base.json

### Community 65 - "XSD 1.1 Differential Tests"
Cohesion: 0.28
Nodes (6): available, Case, CASES, validateWithXmlschema(), xmlschemaAvailable(), XmlschemaResult

### Community 66 - "XSD TypeScript Config"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src, test, ../../tsconfig.base.json

### Community 67 - "Favicon and Brand Identity"
Cohesion: 0.43
Nodes (8): Outward Angle Bracket Glyph (white chevron pair), Editor App Favicon (32x32 SVG app icon), Brand Blue #2563eb, Code Editor Visual Identity (brackets as product signifier), Rounded Square Badge (32x32, rx=7, blue fill), Scalable Vector Favicon Strategy, Small-Size Legibility Constraints (heavy stroke, round caps, max contrast), Static public/ Asset Convention

### Community 68 - "Schematron Interpreter Tests"
Cohesion: 0.32
Nodes (5): parse(), parseSchematronSource(), run(), codes(), messages()

### Community 69 - "Validation Protocol Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 70 - "Bundle Budget Check"
Cohesion: 0.29
Nodes (5): entry, entrySize, expectSeparate(), fail(), files

### Community 71 - "Service Worker Build"
Cohesion: 0.29
Nodes (5): assets, files, hash, manifest, version

### Community 72 - "Table and Widget Models"
Cohesion: 0.33
Nodes (5): TableCell, TableColumn, TableRow, TableSpec, Widget

### Community 73 - "Workspace and Worker Design Notes"
Cohesion: 0.29
Nodes (7): libxml2-wasm needs an ES-module worker (worker: { format: 'es' }), Revision tagging and terminate-and-respawn cancellation, A file is filed by its root element, not its extension, Findings are attributed to the file they belong in, Downstream re-derivation tiered by cost, Three-file workspace: one slot per kind (xml, xsd, sch), Hand-rolled typed worker protocol

### Community 74 - "Error Taxonomy Tests"
Cohesion: 0.40
Nodes (3): diagnose(), find(), model

### Community 75 - "Coach Marks"
Cohesion: 0.50
Nodes (3): CoachMarks(), Mark, MARKS

### Community 76 - "Layout Design Notes"
Cohesion: 0.67
Nodes (3): Four-region resizable layout, Inspector section stack and per-document-kind registry, The Inspector is the selection inspector

## Ambiguous Edges - Review These
- `Placeholder review state is derived, not tracked` → `Filtering narrows rather than highlights`  [AMBIGUOUS]
  PLAN.md · relation: semantically_similar_to
- `Pluggable xs:appinfo interpreter registry` → `A .sch someone emailed you is executable code`  [AMBIGUOUS]
  docs/schema-engine.md · relation: conceptually_related_to
- `Rounded Square Badge (32x32, rx=7, blue fill)` → `Code Editor Visual Identity (brackets as product signifier)`  [AMBIGUOUS]
  apps/editor/public/favicon.svg · relation: conceptually_related_to

## Knowledge Gaps
- **232 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+227 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Placeholder review state is derived, not tracked` and `Filtering narrows rather than highlights`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Pluggable xs:appinfo interpreter registry` and `A .sch someone emailed you is executable code`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Rounded Square Badge (32x32, rx=7, blue fill)` and `Code Editor Visual Identity (brackets as product signifier)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `NodeId` connect `Schematron Parsing` to `XSD AST and Content Models`, `XSD Authoring Inspector`, `XSD Component View`, `Editor Workspace Store`, `libxml2 Validation Client`, `XML Core Document`, `Selection Inspector`, `Schema Query API`, `Table View and Quick Fixes`, `App Shell and Toolbar`, `Diagnostics and Renames`, `Form View`, `QNames and Symbol Spaces`, `Document Edit Commands`, `File Tabs and Workspace Problems`, `Schema Store`, `Mixed Content Flow Editor`, `Smart Paste`, `Schematron Schema Model`, `New Document Wizard`, `Schematron Interpreter`, `XPath Engine Binding`, `Start Screen and Examples`, `Purchase Order Example`, `CST DOM Facade`, `Schema Inference`, `Schematron Inspector`, `Validation Serializer`, `Entities and Serialization`, `Schematron Store`, `Table and Widget Models`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `XmlDocument` connect `Document Edit Commands` to `Schematron Parsing`, `XSD AST and Content Models`, `XSD Authoring Inspector`, `XSD Component View`, `Editor Workspace Store`, `libxml2 Validation Client`, `XML Core Document`, `Selection Inspector`, `Schema Query API`, `Table View and Quick Fixes`, `Schema Assembly and Redefine`, `Diagnostics and Renames`, `File Tabs and Workspace Problems`, `Schema Store`, `Mixed Content Flow Editor`, `Smart Paste`, `XML Tokenizer`, `Schematron Schema Model`, `New Document Wizard`, `Schematron Interpreter`, `XPath Engine Binding`, `Start Screen and Examples`, `CST DOM Facade`, `Schema Inference`, `XSD Differential Tests`, `Validation Serializer`, `Schematron Store`, `Schematron Differential Tests`, `XSD 1.1 Differential Tests`, `Schematron Interpreter Tests`, `Table and Widget Models`, `Error Taxonomy Tests`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `isElement()` connect `XSD Component View` to `Schematron Parsing`, `XSD AST and Content Models`, `XSD Authoring Inspector`, `XML Core Document`, `Schema Query API`, `Table View and Quick Fixes`, `App Shell and Toolbar`, `Diagnostics and Renames`, `Form View`, `Schema Store`, `Mixed Content Flow Editor`, `Smart Paste`, `Schematron Schema Model`, `New Document Wizard`, `Schematron Interpreter`, `XPath Engine Binding`, `Purchase Order Example`, `CST DOM Facade`, `Schema Inference`, `Validation Serializer`, `Schematron Store`, `Table and Widget Models`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _232 weakly-connected nodes found - possible documentation gaps or missing edges._