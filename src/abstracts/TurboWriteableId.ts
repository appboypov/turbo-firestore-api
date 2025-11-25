import type { TurboWriteable } from './TurboWriteable';

/**
 * Interface for writeable objects that have an ID.
 * Extends TurboWriteable with an ID property and local default flag.
 *
 * This interface is typically used for documents that can be persisted to Firestore
 * and need to be uniquely identified.
 *
 * @template T - The type of the ID (string or number, defaults to string)
 *
 * @example
 * ```typescript
 * interface User extends TurboWriteableId {
 *   name: string;
 *   email: string;
 * }
 *
 * const user: User = {
 *   id: 'user-123',
 *   name: 'John Doe',
 *   email: 'john@example.com',
 *   isLocalDefault: false,
 *   toJson() {
 *     return {
 *       name: this.name,
 *       email: this.email,
 *     };
 *   },
 * };
 * ```
 */
export interface TurboWriteableId<T extends string | number = string>
  extends TurboWriteable {
  /**
   * The unique identifier for this document.
   * This ID is used to reference the document in Firestore.
   */
  readonly id: T;

  /**
   * Indicates if this is a local default/placeholder document
   * that hasn't been synced to the server yet.
   *
   * When true, this document represents a temporary local state
   * that should not be considered as persisted data.
   *
   * @default false
   */
  readonly isLocalDefault?: boolean;
}

/**
 * Type guard to check if an object implements TurboWriteableId.
 *
 * @template T - The type of the ID (string or number, defaults to string)
 * @param obj - The object to check
 * @returns True if the object implements TurboWriteableId interface
 *
 * @example
 * ```typescript
 * if (isTurboWriteableId(user)) {
 *   console.log(user.id);
 *   const json = user.toJson();
 * }
 * ```
 */
export function isTurboWriteableId<T extends string | number = string>(
  obj: unknown
): obj is TurboWriteableId<T> {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === 'object' &&
    'id' in obj &&
    (typeof obj.id === 'string' || typeof obj.id === 'number') &&
    'toJson' in obj &&
    typeof obj.toJson === 'function'
  );
}
