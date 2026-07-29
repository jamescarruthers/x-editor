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

export { assembleSchema, catalogueFrom, resolveUri, REDEFINE_NS } from './assemble.js';
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
  Wildcard,
} from './model.js';
