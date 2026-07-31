export {
  compileContentModel,
  run,
  isValidSequence,
  whatCanGoHere,
  requiredToComplete,
  firstInvalidIndex,
} from './automaton.js';
export type { CompiledContentModel, Candidate } from './automaton.js';

export {
  p,
  UNBOUNDED,
  ONCE,
  OPTIONAL,
  ANY_NUMBER,
  elementNameEquals,
  elementNameKey,
  formatElementName,
  namespaceAllowed,
} from './particles.js';
export type {
  Particle,
  Occurs,
  ElementName,
  NamespaceConstraint,
  ProcessContents,
} from './particles.js';

export {
  XSD_NS,
  XSI_NS,
  FACET_NAMES,
  EMPTY_DERIVATION_SET,
  derivationSetHas,
  emptyComponents,
  formatQName,
  qnameEquals,
  qnameKey,
} from './ast.js';
export type {
  Annotation,
  RawOpenContent,
  RawTypeAlternative,
  AttributeUseKind,
  CompositionKind,
  DerivationControl,
  DerivationSet,
  FacetName,
  Form,
  NamespaceSpec,
  NamespaceToken,
  Origin,
  RawAny,
  RawAnyAttribute,
  RawAssertion,
  RawAttribute,
  RawAttributeGroup,
  RawAttributeOwner,
  RawComplexContent,
  RawComplexType,
  RawComposition,
  RawElement,
  RawFacet,
  RawGroup,
  RawGroupRef,
  RawIdentityConstraint,
  RawModelGroup,
  RawNotation,
  RawParticle,
  RawSchema,
  RawSchemaComponents,
  RawSimpleDerivation,
  RawSimpleType,
  RawType,
  SchemaDiagnostic,
  XsdQName,
} from './ast.js';

export { parseSchemaSource, parseSchemaDocument } from './parseSchema.js';
export type { ParseSchemaResult } from './parseSchema.js';

export { assembleSchema, assembleSchemas, catalogueFrom, resolveUri, REDEFINE_NS } from './assemble.js';
export type { AssembledDocument, SchemaCatalogue, SchemaSet } from './assemble.js';

export { SymbolTable, declaredName } from './symbols.js';
export type { GlobalComponent, SymbolSpace } from './symbols.js';

export {
  BUILT_IN_TYPES,
  ANY_TYPE,
  ANY_SIMPLE_TYPE,
  applyWhiteSpace,
  builtInAncestry,
  builtInName,
  builtInType,
  compareValues,
  isBuiltInName,
  isOrdered,
  lengthOf,
  matchesLexicalSpace,
  parseValue,
} from './builtins.js';
export type {
  BuiltInType,
  PrimitiveKind,
  Variety,
  WhiteSpace,
  XsdValue,
} from './builtins.js';

export { translatePattern, sampleFor } from './xsdRegex.js';
export type { TranslatedPattern } from './xsdRegex.js';

export {
  SimpleTypeCompiler,
  validateSimpleValue,
  ANY_SIMPLE_TYPE_DEF,
} from './simpleTypes.js';
export type {
  Bound,
  CompiledFacets,
  CompiledSimpleType,
  PatternGroup,
  ValueProblem,
} from './simpleTypes.js';

export {
  compileAll,
  isAllParticle,
  allIsValid,
  allWhatCanGoHere,
  allRequiredMissing,
  allFirstInvalidIndex,
} from './allModel.js';
export type { AllContentModel, AllMember } from './allModel.js';

export { SchemaModel, ANY_TYPE_DEF } from './model.js';
export type {
  AttributeUse,
  CompiledComplexType,
  CompiledElement,
  CompiledType,
  ContentKind,
  ContentModel,
  OpenContent,
  Wildcard,
} from './model.js';

export {
  humaniseName,
  describeCardinality,
  cardinalityChip,
  describeFacets,
  describeType,
  describeElement,
  describeAttribute,
  describeWildcard,
} from './describe.js';
export type { Description } from './describe.js';

export { widgetFor } from './widgets.js';
export type { Widget } from './widgets.js';

export {
  elementContext,
  childElements,
  insertCandidates,
  groupCandidates,
  requiredMissing,
  firstProblemIndex,
  attributeStatuses,
  missingRequiredAttributes,
  textTypeOf,
  validateText,
  skeletonFor,
  serializeSkeleton,
  placeholderFor,
  insertionPlan,
} from './query.js';
export type {
  AttributeStatus,
  CandidateGroup,
  ChildElement,
  ElementContext,
  InsertCandidate,
  PlannedInsert,
  SkeletonAttribute,
  SkeletonNode,
  SkeletonOptions,
} from './query.js';

export { validateDocument, isDocumentValid, explainType, wouldBeValid } from './diagnostics.js';
export type {
  Diagnostic,
  DiagnosticAnchor,
  FixEdit,
  QuickFix,
  ValidateOptions,
} from './diagnostics.js';

export {
  alignToModel,
  applyOperations,
  describeEdit,
  isPlausibleRename,
  nameDistance,
  levenshtein,
} from './alignment.js';
export type { Alignment, EditKind, EditOperation } from './alignment.js';

export { serializeForValidation, nodeForLine } from './validationSerializer.js';
export type { ValidationPayload } from './validationSerializer.js';

export {
  CstDomFacade,
  loadXPath,
  xpathReady,
  evaluateBoolean,
  evaluateNodes,
  evaluateString,
  checkExpression,
} from './xpath.js';
export type { XPathNode, XPathNodeRef, XPathOptions, XPathOutcome, XPathFailure } from './xpath.js';

export { modelChildNames } from './query.js';
