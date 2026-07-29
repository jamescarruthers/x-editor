import { SaxesParser } from 'saxes';

export interface WellFormednessError {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

/**
 * An independent well-formedness check, using saxes.
 *
 * Deliberately a *second* implementation. Our tokenizer owns byte spans and recovers from malformed
 * input so the tree is always usable mid-edit; it does not decide validity. Keeping the verdict in a
 * separate, mature parser means a tokenizer bug cannot quietly make a broken document look fine —
 * and the two are diffed against each other in the test suite.
 */
export function checkWellFormed(source: string): WellFormednessError[] {
  const errors: WellFormednessError[] = [];
  const parser = new SaxesParser({ position: true });

  parser.on('error', (error: Error) => {
    errors.push({
      message: error.message,
      line: parser.line,
      column: parser.column,
    });
  });

  try {
    parser.write(source).close();
  } catch (error) {
    // saxes throws rather than emitting once it cannot continue.
    errors.push({
      message: error instanceof Error ? error.message : String(error),
      line: parser.line,
      column: parser.column,
    });
  }

  return errors;
}

export function isWellFormed(source: string): boolean {
  return checkWellFormed(source).length === 0;
}
