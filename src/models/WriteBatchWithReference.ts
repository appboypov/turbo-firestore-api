import type { WriteBatch, DocumentReference } from 'firebase/firestore';

/**
 * Represents a Firestore write batch along with the document reference it operates on.
 *
 * This interface is returned by batch operations to allow you to continue adding
 * operations to the batch or to commit the batch when ready.
 *
 * @template T - The type of the document
 *
 * @example
 * ```typescript
 * import { TurboFirestoreApi } from 'turbo-firestore-api';
 *
 * const api = new TurboFirestoreApi<User>({
 *   firestore,
 *   collectionPath: () => 'users',
 * });
 *
 * // Create multiple documents in a single batch
 * const batch = api.writeBatch;
 * const result1 = api.createDocInBatch({ writeable: user1, writeBatch: batch });
 * const result2 = api.createDocInBatch({ writeable: user2, writeBatch: batch });
 *
 * if (isSuccess(result1) && isSuccess(result2)) {
 *   await result1.result.writeBatch.commit();
 *   console.log('Created user 1 at:', result1.result.documentReference.path);
 *   console.log('Created user 2 at:', result2.result.documentReference.path);
 * }
 * ```
 */
export interface WriteBatchWithReference<T = unknown> {
  /**
   * The Firestore write batch instance.
   *
   * Use this to add more operations to the batch or to commit all operations
   * atomically with batch.commit().
   */
  writeBatch: WriteBatch;

  /**
   * The document reference for the operation that was added to the batch.
   *
   * This reference points to the document that will be created, updated, or deleted
   * when the batch is committed.
   */
  documentReference: DocumentReference<T>;
}
