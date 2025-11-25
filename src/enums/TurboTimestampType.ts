/**
 * Enum representing the type of timestamp to add to a Firestore document.
 *
 * This enum is used to control which timestamp fields are automatically
 * added or updated during create, update, or upsert operations.
 *
 * @example
 * ```typescript
 * import { TurboTimestampType } from 'turbo-firestore-api';
 *
 * // Don't add any timestamps
 * createDoc({ writeable: user, timestampType: TurboTimestampType.None });
 *
 * // Only add createdAt on create
 * createDoc({ writeable: user, timestampType: TurboTimestampType.CreatedAt });
 *
 * // Only add/update updatedAt
 * updateDoc({ id: '123', data: updates, timestampType: TurboTimestampType.UpdatedAt });
 *
 * // Add both createdAt and updatedAt (default behavior)
 * createDoc({ writeable: user, timestampType: TurboTimestampType.Both });
 * ```
 */
export enum TurboTimestampType {
  /**
   * Do not add any timestamps to the document.
   */
  None = 'none',

  /**
   * Only add or update the createdAt timestamp field.
   */
  CreatedAt = 'createdAt',

  /**
   * Only add or update the updatedAt timestamp field.
   */
  UpdatedAt = 'updatedAt',

  /**
   * Add or update both createdAt and updatedAt timestamp fields.
   * This is typically the default behavior for most operations.
   */
  Both = 'both',
}
