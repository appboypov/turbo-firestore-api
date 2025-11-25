import type { TurboResponse } from 'turbo-response';

/**
 * Interface for objects that can be written to Firestore.
 * Provides validation and JSON serialization capabilities.
 */
export interface TurboWriteable {
  /**
   * Optional validation method. Returns a Fail response if validation fails,
   * or null/undefined if validation passes.
   *
   * @template T - The type of data being validated
   * @returns A TurboResponse indicating validation failure, or null/undefined if validation passes
   *
   * @example
   * ```typescript
   * validate<User>() {
   *   if (!this.email) {
   *     return TurboResponse.fail<User>({ message: 'Email is required' });
   *   }
   *   return null;
   * }
   * ```
   */
  validate?<T>(): TurboResponse<T> | null | undefined;

  /**
   * Converts the object to a JSON-serializable record for Firestore.
   * This method is used when writing data to Firestore documents.
   *
   * @returns A record containing the object's data in a format suitable for Firestore
   *
   * @example
   * ```typescript
   * toJson() {
   *   return {
   *     name: this.name,
   *     email: this.email,
   *     createdAt: this.createdAt.toISOString(),
   *   };
   * }
   * ```
   */
  toJson(): Record<string, unknown>;
}

/**
 * Type guard to check if an object implements TurboWriteable.
 *
 * @param obj - The object to check
 * @returns True if the object implements TurboWriteable interface
 *
 * @example
 * ```typescript
 * if (isTurboWriteable(user)) {
 *   const json = user.toJson();
 * }
 * ```
 */
export function isTurboWriteable(obj: unknown): obj is TurboWriteable {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === 'object' &&
    'toJson' in obj &&
    typeof obj.toJson === 'function'
  );
}
