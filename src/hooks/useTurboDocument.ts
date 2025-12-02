import { useState, useEffect, useCallback, useRef } from 'react';
import { TurboFirestoreApi } from '../api/TurboFirestoreApi';
import { TurboResponse, success, fail, isSuccess } from '@appboypov/turbo-response';
import { TurboWriteableId } from '../abstracts/TurboWriteableId';
import { TurboAuthVars } from '../models/TurboAuthVars';
import { TurboFirestoreException } from '../exceptions/TurboFirestoreException';
import type {
  CreateDocDef,
  UpdateDocDef,
  UpsertDocDef,
  Unsubscribe,
  TurboLocatorDef,
} from '../typedefs/index';

/**
 * State interface for a Turbo document.
 * Provides access to the current document state and metadata.
 *
 * @template T - The type of the document extending TurboWriteableId
 */
export interface TurboDocumentState<T extends TurboWriteableId> {
  /**
   * The current document (null if not loaded or doesn't exist).
   */
  doc: T | null;

  /**
   * Whether the document has completed initial load.
   * False during initial loading, true once the first snapshot is received.
   */
  isReady: boolean;

  /**
   * The document ID (convenience getter).
   * Returns null if doc is null.
   */
  id: string | null;

  /**
   * Whether the document exists in Firestore.
   * True if doc is not null, false otherwise.
   */
  exists: boolean;
}

/**
 * Actions interface for a Turbo document.
 * Provides CRUD operations with optimistic updates.
 *
 * @template T - The type of the document extending TurboWriteableId
 */
export interface TurboDocumentActions<T extends TurboWriteableId> {
  /**
   * Create the document with optimistic local update.
   * Updates local state immediately, then calls the API.
   * Automatically rolls back on failure.
   *
   * @param def - Function to create the new document
   * @returns TurboResponse containing the created document or error
   */
  createDoc: (def: CreateDocDef<T>) => Promise<TurboResponse<T>>;

  /**
   * Update the document with optimistic local update.
   * Updates local state immediately, then calls the API.
   * Automatically rolls back on failure.
   *
   * @param def - Function to update the current document
   * @returns TurboResponse containing the updated document or error
   */
  updateDoc: (def: UpdateDocDef<T>) => Promise<TurboResponse<T>>;

  /**
   * Create or update the document with optimistic local update.
   * Updates local state immediately, then calls the API.
   * Automatically rolls back on failure.
   *
   * @param def - Function to create or update the document
   * @returns TurboResponse containing the upserted document or error
   */
  upsertDoc: (def: UpsertDocDef<T>) => Promise<TurboResponse<T>>;

  /**
   * Delete the document with optimistic local removal.
   * Clears local state immediately, then calls the API.
   * Automatically rolls back on failure.
   *
   * @returns TurboResponse indicating success or error
   */
  deleteDoc: () => Promise<TurboResponse<void>>;

  /**
   * Force refresh the document by triggering a re-render.
   * Useful when you need to update the UI after external state changes.
   */
  rebuild: () => void;

  /**
   * Create document locally without API call.
   * Only updates local state, does not persist to Firestore.
   * Useful for optimistic updates that will be synced later.
   *
   * @param def - Function to create the new document
   * @returns The created document
   */
  createLocalDoc: (def: CreateDocDef<T>) => T;

  /**
   * Update document locally without API call.
   * Only updates local state, does not persist to Firestore.
   * Useful for optimistic updates that will be synced later.
   *
   * @param def - Function to update the current document
   * @returns The updated document
   */
  updateLocalDoc: (def: UpdateDocDef<T>) => T;

  /**
   * Delete document locally without API call.
   * Only clears local state, does not delete from Firestore.
   * Useful for optimistic updates that will be synced later.
   */
  deleteLocalDoc: () => void;
}

/**
 * Combined state and actions for a Turbo document.
 *
 * @template T - The type of the document extending TurboWriteableId
 */
export type TurboDocumentHook<T extends TurboWriteableId> = TurboDocumentState<T> &
  TurboDocumentActions<T>;

/**
 * Options for configuring the useTurboDocument hook.
 *
 * @template T - The type of the document extending TurboWriteableId
 */
export interface UseTurboDocumentOptions<T extends TurboWriteableId> {
  /**
   * The TurboFirestoreApi instance to use for all operations.
   * This API should be configured with the appropriate collection path and converters.
   */
  api: TurboFirestoreApi<T>;

  /**
   * The document ID to stream from Firestore.
   * When this changes, the hook will unsubscribe from the old document and subscribe to the new one.
   */
  documentId: string;

  /**
   * Function to get the current user ID for TurboAuthVars.
   * Called whenever CRUD operations need to generate auth context.
   * Should return null if no user is authenticated.
   */
  getUserId: () => string | null;

  /**
   * Optional function to provide initial value while loading.
   * Called once during initialization to show data before the first snapshot arrives.
   * Useful for displaying cached or placeholder data during initial load.
   */
  initialValueLocator?: TurboLocatorDef<T>;

  /**
   * Optional function to provide default value if document doesn't exist.
   * Called whenever a snapshot indicates the document doesn't exist.
   * Useful for showing a fallback UI or default data structure.
   */
  defaultValueLocator?: TurboLocatorDef<T>;

  /**
   * Optional callback when document changes.
   * Called after every snapshot update with the new document state.
   *
   * @param doc - The new document or null if it doesn't exist
   */
  onDocChanged?: (doc: T | null) => void;

  /**
   * Optional callback before local state update.
   * Called before the local state is updated (before re-render).
   * Useful for validation or logging.
   *
   * @param doc - The document about to be set
   */
  beforeLocalUpdate?: (doc: T | null) => void;

  /**
   * Optional callback after local state update.
   * Called after the local state is updated (after re-render).
   * Useful for side effects or analytics.
   *
   * @param doc - The newly set document
   */
  afterLocalUpdate?: (doc: T | null) => void;

  /**
   * Optional callback on error.
   * Called when a Firestore error occurs during streaming or CRUD operations.
   *
   * @param error - The TurboFirestoreException that occurred
   */
  onError?: (error: TurboFirestoreException) => void;
}

/**
 * Hook for managing a single Firestore document with real-time streaming,
 * optimistic updates, and CRUD operations.
 *
 * Ports Flutter's TurboDocumentService pattern to React, providing:
 * - Real-time document streaming with automatic subscription management
 * - Optimistic local updates for all CRUD operations
 * - Automatic rollback on failure
 * - Initial value and default value support
 * - Auth-aware operations using TurboAuthVars
 * - Comprehensive lifecycle callbacks
 *
 * @template T - The type of the document extending TurboWriteableId
 * @param options - Configuration options for the hook
 * @returns Combined state and actions for managing the document
 *
 * @example
 * ```tsx
 * interface UserProfileDto extends TurboWriteableId {
 *   name: string;
 *   bio: string;
 *   avatarUrl?: string;
 *   toJson: () => Record<string, unknown>;
 * }
 *
 * const userProfileApi = new TurboFirestoreApi<UserProfileDto>({
 *   firestore,
 *   collectionPath: () => 'users',
 *   fromJson: (json) => ({
 *     id: json.id as string,
 *     name: json.name as string,
 *     bio: json.bio as string,
 *     avatarUrl: json.avatarUrl as string | undefined,
 *     toJson() {
 *       return { name: this.name, bio: this.bio, avatarUrl: this.avatarUrl };
 *     },
 *   }),
 *   toJson: (user) => user.toJson(),
 * });
 *
 * function UserProfile({ userId }: { userId: string }) {
 *   const { doc, isReady, updateDoc, exists } = useTurboDocument({
 *     api: userProfileApi,
 *     documentId: userId,
 *     getUserId: () => auth.currentUser?.uid ?? null,
 *     defaultValueLocator: () => ({
 *       id: userId,
 *       name: 'New User',
 *       bio: '',
 *       toJson() {
 *         return { name: this.name, bio: this.bio };
 *       },
 *     }),
 *     onError: (error) => {
 *       console.error('Firestore error:', error.message);
 *     },
 *   });
 *
 *   const handleUpdateBio = async (newBio: string) => {
 *     const response = await updateDoc((current, vars) => ({
 *       ...current,
 *       bio: newBio,
 *     }));
 *
 *     if (isSuccess(response)) {
 *       console.log('Bio updated successfully');
 *     } else {
 *       console.error('Failed to update bio:', response.error);
 *     }
 *   };
 *
 *   if (!isReady) {
 *     return <div>Loading...</div>;
 *   }
 *
 *   if (!exists || !doc) {
 *     return <div>User not found</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <h1>{doc.name}</h1>
 *       <p>{doc.bio}</p>
 *       <button onClick={() => handleUpdateBio('New bio text')}>
 *         Update Bio
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Example with optimistic updates and local operations
 * function TaskEditor({ taskId }: { taskId: string }) {
 *   const {
 *     doc: task,
 *     isReady,
 *     updateDoc,
 *     updateLocalDoc,
 *     deleteDoc,
 *   } = useTurboDocument({
 *     api: tasksApi,
 *     documentId: taskId,
 *     getUserId: () => currentUserId,
 *     onDocChanged: (task) => {
 *       console.log('Task changed:', task);
 *     },
 *   });
 *
 *   // Optimistic update with API sync
 *   const toggleComplete = async () => {
 *     await updateDoc((current, vars) => ({
 *       ...current,
 *       completed: !current.completed,
 *       updatedAt: vars.now,
 *     }));
 *   };
 *
 *   // Local-only update (no API call)
 *   const handleLocalEdit = (newTitle: string) => {
 *     updateLocalDoc((current, vars) => ({
 *       ...current,
 *       title: newTitle,
 *     }));
 *   };
 *
 *   // Delete with optimistic removal
 *   const handleDelete = async () => {
 *     const response = await deleteDoc();
 *     if (isSuccess(response)) {
 *       // Navigate away after successful deletion
 *       router.push('/tasks');
 *     }
 *   };
 *
 *   if (!isReady || !task) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       <h2>{task.title}</h2>
 *       <input
 *         type="checkbox"
 *         checked={task.completed}
 *         onChange={toggleComplete}
 *       />
 *       <button onClick={handleDelete}>Delete</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTurboDocument<T extends TurboWriteableId>(
  options: UseTurboDocumentOptions<T>
): TurboDocumentHook<T> {
  const {
    api,
    documentId,
    getUserId,
    initialValueLocator,
    defaultValueLocator,
    onDocChanged,
    beforeLocalUpdate,
    afterLocalUpdate,
    onError,
  } = options;

  const [doc, setDoc] = useState<T | null>(() => {
    return initialValueLocator?.() ?? null;
  });
  const [isReady, setIsReady] = useState(false);
  const [, setRebuildTrigger] = useState(0);

  const previousDocRef = useRef<T | null>(null);

  const updateLocalState = useCallback(
    (newDoc: T | null) => {
      beforeLocalUpdate?.(newDoc);
      setDoc(newDoc);
      previousDocRef.current = newDoc;
      afterLocalUpdate?.(newDoc);
    },
    [beforeLocalUpdate, afterLocalUpdate]
  );

  const generateAuthVars = useCallback((): TurboAuthVars => {
    const userId = getUserId();
    const apiVars = api.turboVars<TurboAuthVars>();
    return {
      ...apiVars,
      userId: userId ?? '',
    };
  }, [api, getUserId]);

  useEffect(() => {
    let unsubscribe: Unsubscribe | null = null;

    const setupSubscription = () => {
      unsubscribe = api.streamDocByIdWithConverter(
        documentId,
        (snapshot) => {
          const newDoc = snapshot ?? defaultValueLocator?.() ?? null;
          updateLocalState(newDoc);
          setIsReady(true);
          onDocChanged?.(newDoc);
        },
        (error) => {
          onError?.(error);
          setIsReady(true);
        }
      );
    };

    setupSubscription();

    return () => {
      unsubscribe?.();
    };
  }, [
    api,
    documentId,
    defaultValueLocator,
    updateLocalState,
    onDocChanged,
    onError,
  ]);

  const createDoc = useCallback(
    async (def: CreateDocDef<T>): Promise<TurboResponse<T>> => {
      const vars = generateAuthVars();
      const newDoc = def(vars);
      const previousDoc = previousDocRef.current;

      updateLocalState(newDoc);

      const response = await api.createDoc({
        writeable: newDoc,
        id: documentId,
      });

      if (!isSuccess(response)) {
        updateLocalState(previousDoc);
        return fail(response.error, response.title, response.message, response.stackTrace);
      }

      return success(newDoc);
    },
    [api, documentId, generateAuthVars, updateLocalState]
  );

  const updateDoc = useCallback(
    async (def: UpdateDocDef<T>): Promise<TurboResponse<T>> => {
      const currentDoc = previousDocRef.current;
      if (!currentDoc) {
        const error = new TurboFirestoreException(
          'Cannot update: document does not exist',
          'not-found',
          documentId
        );
        onError?.(error);
        return fail(error, undefined, error.message, error.stackTrace);
      }

      const vars = generateAuthVars();
      const updatedDoc = def(currentDoc, vars);
      const previousDoc = currentDoc;

      updateLocalState(updatedDoc);

      const response = await api.updateDoc({
        id: documentId,
        data: updatedDoc.toJson(),
      });

      if (!isSuccess(response)) {
        updateLocalState(previousDoc);
        return fail(response.error, response.title, response.message, response.stackTrace);
      }

      return success(updatedDoc);
    },
    [api, documentId, generateAuthVars, updateLocalState, onError]
  );

  const upsertDoc = useCallback(
    async (def: UpsertDocDef<T>): Promise<TurboResponse<T>> => {
      const currentDoc = previousDocRef.current;
      const vars = generateAuthVars();
      const upsertedDoc = def(currentDoc, vars);
      const previousDoc = currentDoc;

      updateLocalState(upsertedDoc);

      const response = await api.createDoc({
        writeable: upsertedDoc,
        id: documentId,
        merge: true,
      });

      if (!isSuccess(response)) {
        updateLocalState(previousDoc);
        return fail(response.error, response.title, response.message, response.stackTrace);
      }

      return success(upsertedDoc);
    },
    [api, documentId, generateAuthVars, updateLocalState]
  );

  const deleteDoc = useCallback(async (): Promise<TurboResponse<void>> => {
    const previousDoc = previousDocRef.current;

    updateLocalState(null);

    const response = await api.deleteDoc(documentId);

    if (!isSuccess(response)) {
      updateLocalState(previousDoc);
      return fail(response.error, response.title, response.message, response.stackTrace);
    }

    return success(undefined);
  }, [api, documentId, updateLocalState]);

  const rebuild = useCallback(() => {
    setRebuildTrigger((prev) => prev + 1);
  }, []);

  const createLocalDoc = useCallback(
    (def: CreateDocDef<T>): T => {
      const vars = generateAuthVars();
      const newDoc = def(vars);
      updateLocalState(newDoc);
      return newDoc;
    },
    [generateAuthVars, updateLocalState]
  );

  const updateLocalDoc = useCallback(
    (def: UpdateDocDef<T>): T => {
      const currentDoc = previousDocRef.current;
      if (!currentDoc) {
        throw new TurboFirestoreException(
          'Cannot update locally: document does not exist',
          'not-found',
          documentId
        );
      }

      const vars = generateAuthVars();
      const updatedDoc = def(currentDoc, vars);
      updateLocalState(updatedDoc);
      return updatedDoc;
    },
    [documentId, generateAuthVars, updateLocalState]
  );

  const deleteLocalDoc = useCallback(() => {
    updateLocalState(null);
  }, [updateLocalState]);

  return {
    doc,
    isReady,
    id: doc?.id ?? null,
    exists: doc !== null,
    createDoc,
    updateDoc,
    upsertDoc,
    deleteDoc,
    rebuild,
    createLocalDoc,
    updateLocalDoc,
    deleteLocalDoc,
  };
}
