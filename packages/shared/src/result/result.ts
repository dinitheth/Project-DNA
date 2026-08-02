/**
 * Result type for explicit error handling without exceptions.
 *
 * Design decisions:
 * - Discriminated union for exhaustive type narrowing in switch/if statements.
 * - Forces callers to handle errors at the call site.
 * - Avoids try/catch spaghetti across engine boundaries.
 * - Helper constructors (Ok, Err) and type guards (isOk, isErr) for ergonomics.
 *
 * @example
 * ```ts
 * function parseFile(path: string): Result<FileDNA, ParseError> {
 *   if (!exists(path)) return Err({ code: 'NOT_FOUND', message: '...' });
 *   return Ok(parsedDna);
 * }
 *
 * const result = parseFile('/src/index.ts');
 * if (isOk(result)) {
 *   console.log(result.value.functions);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */

/** Successful result. */
export interface OkResult<T> {
  readonly ok: true;
  readonly value: T;
}

/** Failed result. */
export interface ErrResult<E> {
  readonly ok: false;
  readonly error: E;
}

/** A result that is either Ok with a value or Err with an error. */
export type Result<T, E = Error> = OkResult<T> | ErrResult<E>;

/** Construct a successful result. */
export function Ok<T>(value: T): OkResult<T> {
  return { ok: true, value };
}

/** Construct a failed result. */
export function Err<E>(error: E): ErrResult<E> {
  return { ok: false, error };
}

/** Type guard: narrows to OkResult. */
export function isOk<T, E>(result: Result<T, E>): result is OkResult<T> {
  return result.ok === true;
}

/** Type guard: narrows to ErrResult. */
export function isErr<T, E>(result: Result<T, E>): result is ErrResult<E> {
  return result.ok === false;
}
