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
