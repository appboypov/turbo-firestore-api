import {
  Firestore,
  CollectionReference,
  DocumentReference,
  WriteBatch,
  Query,
  Transaction,
  QuerySnapshot,
  DocumentSnapshot,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc as firestoreUpdateDoc,
  deleteDoc as firestoreDeleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  runTransaction as firestoreRunTransaction,
  writeBatch,
  serverTimestamp,
  FirestoreError,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from 'firebase/firestore';

import { TurboResponse, success, fail } from '@appboypov/turbo-response';
import { TurboFirestoreException } from '../exceptions/TurboFirestoreException';
import { TurboApiVars } from '../models/TurboApiVars';
import { TurboTimestampType } from '../enums/TurboTimestampType';
import { TurboSearchTermType } from '../enums/TurboSearchTermType';
import { WriteBatchWithReference } from '../models/WriteBatchWithReference';
import type {
  CollectionReferenceDef,
  Unsubscribe,
} from '../typedefs/index';

/**
 * Configuration options for TurboFirestoreApi.
 *
 * @template T - The type of documents in the collection
 */
export interface TurboFirestoreApiOptions<T> {
  /**
   * The Firestore instance to use for all operations.
   */
  firestore: Firestore;

  /**
   * Function that returns the collection path.
   * Can be dynamic to support sub-collections or parameterized paths.
   *
   * @example
   * ```typescript
   * // Simple collection
   * collectionPath: () => 'users'
   *
   * // Sub-collection
   * collectionPath: () => `organizations/${orgId}/members`
   * ```
   */
  collectionPath: () => string;

  /**
   * Function to convert JSON data to a typed object.
   * Required for operations that return typed results.
   */
  fromJson?: (json: Record<string, unknown>) => T;

  /**
   * Function to convert a typed object to JSON for Firestore.
   * Required for write operations with typed objects.
   */
  toJson?: (value: T) => Record<string, unknown>;

  /**
   * Function to handle errors during JSON conversion.
   * If not provided, conversion errors will be thrown.
   */
  fromJsonError?: (json: Record<string, unknown>) => T;

  /**
   * Whether to automatically add the document ID to returned objects.
   * @default true
   */
  tryAddLocalId?: boolean;

  /**
   * The field name to use when adding the document ID to returned objects.
   * @default 'id'
   */
  idFieldName?: string;

  /**
   * The field name for the createdAt timestamp.
   * @default 'createdAt'
   */
  createdAtFieldName?: string;

  /**
   * The field name for the updatedAt timestamp.
   * @default 'updatedAt'
   */
  updatedAtFieldName?: string;

  /**
   * The field name for storing the document reference path.
   * @default 'documentReferencePath'
   */
  documentReferenceFieldName?: string;

  /**
   * Whether this is a collection group query (searches across all collections with this name).
   * @default false
   */
  isCollectionGroup?: boolean;

  /**
   * Whether to automatically add the document reference path to returned objects.
   * @default false
   */
  tryAddLocalDocumentReference?: boolean;
}

/**
 * Options for creating a document.
 *
 * @template T - The type of the document being created
 */
export interface CreateDocOptions<T> {
  /**
   * The document data to create.
   */
  writeable: T;

  /**
   * Optional document ID. If not provided, Firestore will generate one.
   */
  id?: string;

  /**
   * The type of timestamps to add to the document.
   * @default TurboTimestampType.Both
   */
  timestampType?: TurboTimestampType;

  /**
   * Whether to merge the data with existing document data.
   * @default false
   */
  merge?: boolean;

  /**
   * Optional transaction to use for this operation.
   */
  transaction?: Transaction;

  /**
   * Optional collection path override for this specific operation.
   */
  collectionPathOverride?: string;
}

/**
 * Options for updating a document.
 */
export interface UpdateDocOptions {
  /**
   * The ID of the document to update.
   */
  id: string;

  /**
   * The data to update in the document.
   */
  data: Record<string, unknown>;

  /**
   * The type of timestamps to add to the document.
   * @default TurboTimestampType.UpdatedAt
   */
  timestampType?: TurboTimestampType;

  /**
   * Optional transaction to use for this operation.
   */
  transaction?: Transaction;

  /**
   * Optional collection path override for this specific operation.
   */
  collectionPathOverride?: string;
}

/**
 * Options for searching documents.
 */
export interface SearchOptions {
  /**
   * The search term to look for.
   */
  searchTerm: string;

  /**
   * The field to search in.
   */
  searchField: string;

  /**
   * The type of search to perform.
   * @default TurboSearchTermType.StartsWith
   */
  searchTermType?: TurboSearchTermType;

  /**
   * Maximum number of results to return.
   * @default 50
   */
  searchLimit?: number;

  /**
   * Optional collection path override for this specific operation.
   */
  collectionPathOverride?: string;
}

/**
 * TurboFirestoreApi - A comprehensive API for Firestore operations.
 *
 * Provides type-safe CRUD operations, real-time streaming, search functionality,
 * and batch/transaction support for Firestore collections.
 *
 * @template T - The type of documents in the collection
 *
 * @example
 * ```typescript
 * interface User {
 *   id: string;
 *   name: string;
 *   email: string;
 *   createdAt: Date;
 *   updatedAt: Date;
 * }
 *
 * const usersApi = new TurboFirestoreApi<User>({
 *   firestore,
 *   collectionPath: () => 'users',
 *   fromJson: (json) => ({
 *     id: json.id as string,
 *     name: json.name as string,
 *     email: json.email as string,
 *     createdAt: (json.createdAt as any).toDate(),
 *     updatedAt: (json.updatedAt as any).toDate(),
 *   }),
 *   toJson: (user) => ({
 *     name: user.name,
 *     email: user.email,
 *   }),
 * });
 *
 * // Create a user
 * const result = await usersApi.createDoc({
 *   writeable: { name: 'John', email: 'john@example.com' },
 * });
 *
 * // Stream all users
 * const unsubscribe = usersApi.streamAllWithConverter(
 *   (users) => console.log('Users:', users),
 *   (error) => console.error('Error:', error)
 * );
 * ```
 */
export class TurboFirestoreApi<T> {
  private readonly firestore: Firestore;
  private readonly collectionPathFn: () => string;
  private readonly fromJsonFn?: (json: Record<string, unknown>) => T;
  private readonly toJsonFn?: (value: T) => Record<string, unknown>;
  private readonly fromJsonErrorFn?: (json: Record<string, unknown>) => T;
  private readonly tryAddLocalId: boolean;
  private readonly idFieldName: string;
  private readonly createdAtFieldName: string;
  private readonly updatedAtFieldName: string;
  private readonly documentReferenceFieldName: string;
  private readonly isCollectionGroup: boolean;
  private readonly tryAddLocalDocumentReference: boolean;

  constructor(options: TurboFirestoreApiOptions<T>) {
    this.firestore = options.firestore;
    this.collectionPathFn = options.collectionPath;
    this.fromJsonFn = options.fromJson;
    this.toJsonFn = options.toJson;
    this.fromJsonErrorFn = options.fromJsonError;
    this.tryAddLocalId = options.tryAddLocalId ?? true;
    this.idFieldName = options.idFieldName ?? 'id';
    this.createdAtFieldName = options.createdAtFieldName ?? 'createdAt';
    this.updatedAtFieldName = options.updatedAtFieldName ?? 'updatedAt';
    this.documentReferenceFieldName =
      options.documentReferenceFieldName ?? 'documentReferencePath';
    this.isCollectionGroup = options.isCollectionGroup ?? false;
    this.tryAddLocalDocumentReference =
      options.tryAddLocalDocumentReference ?? false;
  }

  /**
   * Gets the collection reference.
   *
   * @param collectionPathOverride - Optional path to override the default collection path
   * @returns The Firestore collection reference
   */
  get collection(): CollectionReference {
    return this.getCollectionReference();
  }

  /**
   * Generates a new document ID.
   *
   * @returns A unique document ID
   */
  get genId(): string {
    return doc(this.getCollectionReference()).id;
  }

  /**
   * Creates a new write batch.
   *
   * @returns A new Firestore write batch
   */
  get writeBatch(): WriteBatch {
    return writeBatch(this.firestore);
  }

  /**
   * Generates API variables with a new ID and current timestamp.
   *
   * @template V - The type of variables (TurboApiVars or TurboAuthVars)
   * @returns The generated variables
   */
  turboVars<V extends TurboApiVars>(): V {
    return {
      id: this.genId,
      now: new Date(),
    } as V;
  }

  /**
   * Checks if a document exists.
   *
   * @param id - The document ID
   * @param collectionPathOverride - Optional collection path override
   * @returns True if the document exists, false otherwise
   */
  async docExists(
    id: string,
    collectionPathOverride?: string
  ): Promise<boolean> {
    try {
      const docRef = this.getDocRefById(id, collectionPathOverride);
      const docSnap = await getDoc(docRef);
      return docSnap.exists();
    } catch (error) {
      return false;
    }
  }

  /**
   * Runs a transaction.
   *
   * @template E - The type of the transaction result
   * @param handler - The transaction handler function
   * @returns A promise that resolves with the transaction result
   */
  async runTransaction<E>(
    handler: (transaction: Transaction) => Promise<E>
  ): Promise<E> {
    return firestoreRunTransaction(this.firestore, handler);
  }

  /**
   * Creates a new document.
   *
   * @param options - The create options
   * @returns A TurboResponse containing the document reference or error
   */
  async createDoc(
    options: CreateDocOptions<T>
  ): Promise<TurboResponse<DocumentReference>> {
    try {
      const {
        writeable,
        id,
        timestampType = TurboTimestampType.Both,
        merge = false,
        transaction,
        collectionPathOverride,
      } = options;

      const docId = id ?? this.genId;
      const docRef = this.getDocRefById(docId, collectionPathOverride);

      let data = this.toJsonFn ? this.toJsonFn(writeable) : (writeable as any);
      data = this.addTimestamps(data, timestampType, true);

      if (transaction) {
        transaction.set(docRef, data, { merge });
      } else {
        await setDoc(docRef, data, { merge });
      }

      return success(docRef);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Creates a new document in a write batch.
   *
   * @param options - The create options with write batch
   * @returns A TurboResponse containing the write batch with reference or error
   */
  createDocInBatch(
    options: CreateDocOptions<T> & { writeBatch: WriteBatch }
  ): TurboResponse<WriteBatchWithReference> {
    try {
      const {
        writeable,
        id,
        timestampType = TurboTimestampType.Both,
        merge = false,
        writeBatch: batch,
        collectionPathOverride,
      } = options;

      const docId = id ?? this.genId;
      const docRef = this.getDocRefById(docId, collectionPathOverride);

      let data = this.toJsonFn ? this.toJsonFn(writeable) : (writeable as any);
      data = this.addTimestamps(data, timestampType, true);

      batch.set(docRef, data, { merge });

      return success({
        writeBatch: batch,
        documentReference: docRef,
      });
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Gets a document by ID as raw JSON.
   *
   * @param id - The document ID
   * @param collectionPathOverride - Optional collection path override
   * @returns A TurboResponse containing the document data or null if not found
   */
  async getById(
    id: string,
    collectionPathOverride?: string
  ): Promise<TurboResponse<Record<string, unknown> | null>> {
    try {
      const docRef = this.getDocRefById(id, collectionPathOverride);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        return success(null);
      }

      let data = docSnap.data();
      data = this.addLocalFields(data, docSnap.id, docSnap.ref.path);

      return success(data);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Gets a document by ID with type conversion.
   *
   * @param id - The document ID
   * @param collectionPathOverride - Optional collection path override
   * @returns A TurboResponse containing the typed document or null if not found
   */
  async getByIdWithConverter(
    id: string,
    collectionPathOverride?: string
  ): Promise<TurboResponse<T | null>> {
    try {
      const docRef = this.getDocRefByIdWithConverter(id, collectionPathOverride);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        return success(null);
      }

      return success(docSnap.data());
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Gets a document reference by ID.
   *
   * @param id - The document ID
   * @param collectionPathOverride - Optional collection path override
   * @returns The document reference
   */
  getDocRefById(id: string, collectionPathOverride?: string): DocumentReference {
    const collRef = this.getCollectionReference(collectionPathOverride);
    return doc(collRef, id);
  }

  /**
   * Gets a document reference by ID with type converter.
   *
   * @param id - The document ID
   * @param collectionPathOverride - Optional collection path override
   * @returns The typed document reference
   */
  getDocRefByIdWithConverter(
    id: string,
    collectionPathOverride?: string
  ): DocumentReference<T> {
    const collRef = this.getCollectionReferenceWithConverter(
      collectionPathOverride
    );
    return doc(collRef, id);
  }

  /**
   * Lists all documents in the collection.
   *
   * @returns A TurboResponse containing an array of typed documents
   */
  async listAll(): Promise<TurboResponse<T[]>> {
    try {
      const collRef = this.getCollectionReferenceWithConverter();
      const querySnapshot = await getDocs(collRef);
      const docs = querySnapshot.docs.map((doc) => doc.data());
      return success(docs);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Lists documents by a custom query.
   *
   * @param queryDef - The query definition function
   * @returns A TurboResponse containing an array of typed documents
   */
  async listByQuery(
    queryDef: CollectionReferenceDef<T>
  ): Promise<TurboResponse<T[]>> {
    try {
      const collRef = this.getCollectionReferenceWithConverter();
      const q = queryDef(collRef);
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs.map((doc) => doc.data());
      return success(docs);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Gets a collection reference as a query.
   *
   * @returns A Firestore query
   */
  listCollectionReference(): Query {
    return query(this.getCollectionReference());
  }

  /**
   * Gets a collection reference as a typed query.
   *
   * @returns A typed Firestore query
   */
  listCollectionReferenceWithConverter(): Query<T> {
    return query(this.getCollectionReferenceWithConverter());
  }

  /**
   * Updates a document.
   *
   * @param options - The update options
   * @returns A TurboResponse containing the document reference or error
   */
  async updateDoc(
    options: UpdateDocOptions
  ): Promise<TurboResponse<DocumentReference>> {
    try {
      const {
        id,
        data,
        timestampType = TurboTimestampType.UpdatedAt,
        transaction,
        collectionPathOverride,
      } = options;

      const docRef = this.getDocRefById(id, collectionPathOverride);
      let updateData = { ...data };
      updateData = this.addTimestamps(updateData, timestampType, false);

      if (transaction) {
        transaction.update(docRef, updateData);
      } else {
        await firestoreUpdateDoc(docRef, updateData);
      }

      return success(docRef);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Updates a document in a write batch.
   *
   * @param options - The update options with write batch
   * @returns A TurboResponse containing the write batch with reference or error
   */
  updateDocInBatch(
    options: UpdateDocOptions & { writeBatch: WriteBatch }
  ): TurboResponse<WriteBatchWithReference> {
    try {
      const {
        id,
        data,
        timestampType = TurboTimestampType.UpdatedAt,
        writeBatch: batch,
        collectionPathOverride,
      } = options;

      const docRef = this.getDocRefById(id, collectionPathOverride);
      let updateData = { ...data };
      updateData = this.addTimestamps(updateData, timestampType, false);

      batch.update(docRef, updateData);

      return success({
        writeBatch: batch,
        documentReference: docRef,
      });
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Deletes a document.
   *
   * @param id - The document ID
   * @param transaction - Optional transaction
   * @param collectionPathOverride - Optional collection path override
   * @returns A TurboResponse indicating success or error
   */
  async deleteDoc(
    id: string,
    transaction?: Transaction,
    collectionPathOverride?: string
  ): Promise<TurboResponse<void>> {
    try {
      const docRef = this.getDocRefById(id, collectionPathOverride);

      if (transaction) {
        transaction.delete(docRef);
      } else {
        await firestoreDeleteDoc(docRef);
      }

      return success(undefined);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Deletes a document in a write batch.
   *
   * @param id - The document ID
   * @param writeBatch - The write batch
   * @param collectionPathOverride - Optional collection path override
   * @returns A TurboResponse indicating success or error
   */
  deleteDocInBatch(
    id: string,
    writeBatch: WriteBatch,
    collectionPathOverride?: string
  ): TurboResponse<void> {
    try {
      const docRef = this.getDocRefById(id, collectionPathOverride);
      writeBatch.delete(docRef);
      return success(undefined);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Streams all documents as raw query snapshots.
   *
   * @param onData - Callback when data changes
   * @param onError - Optional callback when an error occurs
   * @returns Unsubscribe function
   */
  streamAll(
    onData: (snapshot: QuerySnapshot) => void,
    onError?: (error: TurboFirestoreException) => void
  ): Unsubscribe {
    const collRef = this.getCollectionReference();
    return onSnapshot(
      collRef,
      onData,
      (error) => {
        if (onError) {
          const exception = TurboFirestoreException.fromFirestoreError(
            error,
            this.collectionPathFn()
          );
          onError(exception);
        }
      }
    );
  }

  /**
   * Streams all documents with type conversion.
   *
   * @param onData - Callback when data changes, receives array of typed documents
   * @param onError - Optional callback when an error occurs
   * @returns Unsubscribe function
   */
  streamAllWithConverter(
    onData: (docs: T[]) => void,
    onError?: (error: TurboFirestoreException) => void
  ): Unsubscribe {
    const collRef = this.getCollectionReferenceWithConverter();
    return onSnapshot(
      collRef,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => doc.data());
        onData(docs);
      },
      (error) => {
        if (onError) {
          const exception = TurboFirestoreException.fromFirestoreError(
            error,
            this.collectionPathFn()
          );
          onError(exception);
        }
      }
    );
  }

  /**
   * Streams documents by a custom query.
   *
   * @param queryDef - The query definition function
   * @param onData - Callback when data changes, receives array of typed documents
   * @param onError - Optional callback when an error occurs
   * @returns Unsubscribe function
   */
  streamByQuery(
    queryDef: CollectionReferenceDef<T>,
    onData: (docs: T[]) => void,
    onError?: (error: TurboFirestoreException) => void
  ): Unsubscribe {
    const collRef = this.getCollectionReferenceWithConverter();
    const q = queryDef(collRef);
    return onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => doc.data());
        onData(docs);
      },
      (error) => {
        if (onError) {
          const exception = TurboFirestoreException.fromFirestoreError(
            error,
            this.collectionPathFn()
          );
          onError(exception);
        }
      }
    );
  }

  /**
   * Streams a single document by ID as raw snapshot.
   *
   * @param id - The document ID
   * @param onData - Callback when data changes
   * @param onError - Optional callback when an error occurs
   * @returns Unsubscribe function
   */
  streamByDocId(
    id: string,
    onData: (snapshot: DocumentSnapshot) => void,
    onError?: (error: TurboFirestoreException) => void
  ): Unsubscribe {
    const docRef = this.getDocRefById(id);
    return onSnapshot(
      docRef,
      onData,
      (error) => {
        if (onError) {
          const exception = TurboFirestoreException.fromFirestoreError(
            error,
            this.collectionPathFn()
          );
          onError(exception);
        }
      }
    );
  }

  /**
   * Streams a single document by ID with type conversion.
   *
   * @param id - The document ID
   * @param onData - Callback when data changes, receives typed document or null
   * @param onError - Optional callback when an error occurs
   * @returns Unsubscribe function
   */
  streamDocByIdWithConverter(
    id: string,
    onData: (doc: T | null) => void,
    onError?: (error: TurboFirestoreException) => void
  ): Unsubscribe {
    const docRef = this.getDocRefByIdWithConverter(id);
    return onSnapshot(
      docRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        onData(data);
      },
      (error) => {
        if (onError) {
          const exception = TurboFirestoreException.fromFirestoreError(
            error,
            this.collectionPathFn()
          );
          onError(exception);
        }
      }
    );
  }

  /**
   * Searches documents by a search term as raw JSON.
   *
   * @param options - The search options
   * @returns A TurboResponse containing an array of document data
   */
  async listBySearchTerm(
    options: SearchOptions
  ): Promise<TurboResponse<Record<string, unknown>[]>> {
    try {
      const {
        searchTerm,
        searchField,
        searchTermType = TurboSearchTermType.StartsWith,
        searchLimit = 50,
        collectionPathOverride,
      } = options;

      const collRef = this.getCollectionReference(collectionPathOverride);
      let q: Query;

      if (searchTermType === TurboSearchTermType.StartsWith) {
        const endTerm = searchTerm + '\uf8ff';
        q = query(
          collRef,
          where(searchField, '>=', searchTerm),
          where(searchField, '<', endTerm),
          orderBy(searchField),
          limit(searchLimit)
        );
      } else {
        q = query(
          collRef,
          where(searchField, 'array-contains', searchTerm),
          limit(searchLimit)
        );
      }

      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs.map((doc) => {
        let data = doc.data();
        data = this.addLocalFields(data, doc.id, doc.ref.path);
        return data;
      });

      return success(docs);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  /**
   * Searches documents by a search term with type conversion.
   *
   * @param options - The search options
   * @returns A TurboResponse containing an array of typed documents
   */
  async listBySearchTermWithConverter(
    options: SearchOptions
  ): Promise<TurboResponse<T[]>> {
    try {
      const {
        searchTerm,
        searchField,
        searchTermType = TurboSearchTermType.StartsWith,
        searchLimit = 50,
        collectionPathOverride,
      } = options;

      const collRef = this.getCollectionReferenceWithConverter(
        collectionPathOverride
      );
      let q: Query<T>;

      if (searchTermType === TurboSearchTermType.StartsWith) {
        const endTerm = searchTerm + '\uf8ff';
        q = query(
          collRef,
          where(searchField, '>=', searchTerm),
          where(searchField, '<', endTerm),
          orderBy(searchField),
          limit(searchLimit)
        );
      } else {
        q = query(
          collRef,
          where(searchField, 'array-contains', searchTerm),
          limit(searchLimit)
        );
      }

      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs.map((doc) => doc.data());

      return success(docs);
    } catch (error) {
      const firestoreError = error as FirestoreError;
      const exception = TurboFirestoreException.fromFirestoreError(
        firestoreError,
        this.collectionPathFn()
      );
      return fail(exception, undefined, exception.message, exception.stackTrace);
    }
  }

  private getCollectionReference(
    collectionPathOverride?: string
  ): CollectionReference {
    const path = collectionPathOverride ?? this.collectionPathFn();
    return this.isCollectionGroup
      ? (collectionGroup(this.firestore, path) as unknown as CollectionReference)
      : collection(this.firestore, path);
  }

  private getCollectionReferenceWithConverter(
    collectionPathOverride?: string
  ): CollectionReference<T> {
    const collRef = this.getCollectionReference(collectionPathOverride);
    return collRef.withConverter({
      toFirestore: (data: T): Record<string, unknown> => {
        return this.toJsonFn ? this.toJsonFn(data) : (data as any);
      },
      fromFirestore: (
        snapshot: QueryDocumentSnapshot,
        options: SnapshotOptions
      ): T => {
        const data = snapshot.data(options);
        const enrichedData = this.addLocalFields(data, snapshot.id, snapshot.ref.path);
        try {
          return this.fromJsonFn
            ? this.fromJsonFn(enrichedData)
            : (enrichedData as unknown as T);
        } catch (error) {
          if (this.fromJsonErrorFn) {
            return this.fromJsonErrorFn(enrichedData);
          }
          throw error;
        }
      },
    });
  }

  private addTimestamps(
    data: Record<string, unknown>,
    timestampType: TurboTimestampType,
    isCreate: boolean
  ): Record<string, unknown> {
    const result = { ...data };

    if (
      timestampType === TurboTimestampType.CreatedAt ||
      timestampType === TurboTimestampType.Both
    ) {
      if (isCreate) {
        result[this.createdAtFieldName] = serverTimestamp();
      }
    }

    if (
      timestampType === TurboTimestampType.UpdatedAt ||
      timestampType === TurboTimestampType.Both
    ) {
      result[this.updatedAtFieldName] = serverTimestamp();
    }

    return result;
  }

  private addLocalFields(
    data: Record<string, unknown>,
    id: string,
    path: string
  ): Record<string, unknown> {
    const result = { ...data };

    if (this.tryAddLocalId) {
      result[this.idFieldName] = id;
    }

    if (this.tryAddLocalDocumentReference) {
      result[this.documentReferenceFieldName] = path;
    }

    return result;
  }
}
