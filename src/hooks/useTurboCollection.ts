import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TurboFirestoreApi } from '../api/TurboFirestoreApi';
import { TurboResponse, success, fail, isSuccess } from '@appboypov/turbo-response';
import { TurboWriteableId } from '../abstracts/TurboWriteableId';
import { TurboAuthVars } from '../models/TurboAuthVars';
import { TurboFirestoreException } from '../exceptions/TurboFirestoreException';
import type { CreateDocDef, UpdateDocDef, UpsertDocDef } from '../typedefs/index';

/**
 * State for the TurboCollection hook.
 * Contains the collection data and metadata.
 *
 * @template T - The type of documents in the collection
 */
export interface TurboCollectionState<T extends TurboWriteableId> {
  /** Map of documents by ID for O(1) lookup */
  docsById: Map<string, T>;
  /** Array of all documents */
  docs: T[];
  /** Whether the collection has completed initial load */
  isReady: boolean;
  /** Whether the collection has any documents */
  hasDocs: boolean;
}

/**
 * Actions for the TurboCollection hook.
 * Provides CRUD operations with optimistic updates.
 *
 * @template T - The type of documents in the collection
 */
export interface TurboCollectionActions<T extends TurboWriteableId> {
  /** Find document by ID (throws if not found) */
  findById: (id: string) => T;
  /** Try to find document by ID (returns null if not found) */
  tryFindById: (id: string | null | undefined) => T | null;
  /** Check if document exists */
  exists: (id: string) => boolean;

  /** Create a new document with optimistic local update */
  createDoc: (def: CreateDocDef<T>) => Promise<TurboResponse<T>>;
  /** Update existing document with optimistic local update */
  updateDoc: (id: string, def: UpdateDocDef<T>) => Promise<TurboResponse<T>>;
  /** Create or update document with optimistic local update */
  upsertDoc: (id: string, def: UpsertDocDef<T>) => Promise<TurboResponse<T>>;
  /** Delete document with optimistic local removal */
  deleteDoc: (id: string) => Promise<TurboResponse<void>>;

  /** Create multiple documents in a batch */
  createDocs: (defs: CreateDocDef<T>[]) => Promise<TurboResponse<T[]>>;
  /** Update multiple documents in a batch */
  updateDocs: (updates: Array<{ id: string; def: UpdateDocDef<T> }>) => Promise<TurboResponse<T[]>>;
  /** Delete multiple documents in a batch */
  deleteDocs: (ids: string[]) => Promise<TurboResponse<void>>;

  /** Force refresh the collection */
  rebuild: () => void;

  /** Create document locally without API call */
  createLocalDoc: (def: CreateDocDef<T>) => T;
  /** Update document locally without API call */
  updateLocalDoc: (id: string, def: UpdateDocDef<T>) => T;
  /** Delete document locally without API call */
  deleteLocalDoc: (id: string) => void;
}

/**
 * Combined state and actions for the TurboCollection hook.
 *
 * @template T - The type of documents in the collection
 */
export type TurboCollectionHook<T extends TurboWriteableId> =
  TurboCollectionState<T> & TurboCollectionActions<T>;

/**
 * Options for configuring the useTurboCollection hook.
 *
 * @template T - The type of documents in the collection
 */
export interface UseTurboCollectionOptions<T extends TurboWriteableId> {
  /** The TurboFirestoreApi instance to use */
  api: TurboFirestoreApi<T>;
  /** Function to get the current user ID (for TurboAuthVars) */
  getUserId: () => string | null;
  /** Optional callback when documents change */
  onDocsChanged?: (docs: T[]) => void;
  /** Optional callback on error */
  onError?: (error: TurboFirestoreException) => void;
  /** Optional initial documents (for SSR or hydration) */
  initialDocs?: T[];
}

/**
 * Creates TurboAuthVars by combining API vars with user ID.
 *
 * @template T - The type of documents in the collection
 * @param api - The TurboFirestoreApi instance
 * @param getUserId - Function to get the current user ID
 * @returns TurboAuthVars with generated ID, timestamp, and user ID
 */
function createAuthVars<T extends TurboWriteableId>(
  api: TurboFirestoreApi<T>,
  getUserId: () => string | null
): TurboAuthVars {
  const baseVars = api.turboVars();
  return {
    ...baseVars,
    userId: getUserId() ?? '',
  };
}

/**
 * Hook for managing a Firestore collection with real-time streaming,
 * optimistic updates, and CRUD operations.
 *
 * Ports Flutter's TurboCollectionService pattern to React, providing:
 * - Real-time streaming with automatic synchronization
 * - Optimistic updates for instant UI feedback
 * - CRUD operations with rollback on failure
 * - O(1) document lookup by ID
 * - Batch operations for multiple documents
 *
 * @template T - The type of documents in the collection
 * @param options - Configuration options for the hook
 * @returns State and actions for managing the collection
 *
 * @example
 * Basic usage with real-time updates
 * ```tsx
 * interface UserDto extends TurboWriteableId {
 *   name: string;
 *   email: string;
 *   createdAt: Date;
 *   updatedAt: Date;
 *   toJson(): Record<string, unknown>;
 * }
 *
 * const usersApi = new TurboFirestoreApi<UserDto>({
 *   firestore,
 *   collectionPath: () => 'users',
 *   fromJson: (json) => ({
 *     id: json.id as string,
 *     name: json.name as string,
 *     email: json.email as string,
 *     createdAt: (json.createdAt as any).toDate(),
 *     updatedAt: (json.updatedAt as any).toDate(),
 *     toJson() {
 *       return {
 *         name: this.name,
 *         email: this.email,
 *       };
 *     },
 *   }),
 * });
 *
 * function UserList() {
 *   const { docs, isReady, createDoc, updateDoc, deleteDoc, findById } = useTurboCollection({
 *     api: usersApi,
 *     getUserId: () => auth.currentUser?.uid ?? null,
 *   });
 *
 *   const handleCreate = async () => {
 *     const response = await createDoc((vars) => ({
 *       id: vars.id,
 *       name: 'New User',
 *       email: 'user@example.com',
 *       createdAt: vars.now,
 *       updatedAt: vars.now,
 *       toJson() {
 *         return { name: this.name, email: this.email };
 *       },
 *     }));
 *
 *     if (isSuccess(response)) {
 *       console.log('Created:', response.result.id);
 *     } else {
 *       console.error('Failed:', response.error);
 *     }
 *   };
 *
 *   const handleUpdate = async (userId: string) => {
 *     const response = await updateDoc(userId, (current, vars) => ({
 *       ...current,
 *       name: 'Updated Name',
 *       updatedAt: vars.now,
 *     }));
 *
 *     if (isSuccess(response)) {
 *       console.log('Updated:', response.result.id);
 *     }
 *   };
 *
 *   if (!isReady) return <Loading />;
 *
 *   return (
 *     <div>
 *       <button onClick={handleCreate}>Create User</button>
 *       <ul>
 *         {docs.map(user => (
 *           <li key={user.id}>
 *             {user.name} - {user.email}
 *             <button onClick={() => handleUpdate(user.id)}>Update</button>
 *             <button onClick={() => deleteDoc(user.id)}>Delete</button>
 *           </li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * Optimistic updates with error handling
 * ```tsx
 * function TaskList() {
 *   const { docs, createDoc, updateDoc, tryFindById } = useTurboCollection({
 *     api: tasksApi,
 *     getUserId: () => currentUserId,
 *     onError: (error) => {
 *       console.error('Collection error:', error.message);
 *       toast.error(error.message);
 *     },
 *   });
 *
 *   const toggleTask = async (taskId: string) => {
 *     const task = tryFindById(taskId);
 *     if (!task) return;
 *
 *     // Optimistically updates local state immediately
 *     await updateDoc(taskId, (current, vars) => ({
 *       ...current,
 *       completed: !current.completed,
 *       updatedAt: vars.now,
 *     }));
 *     // If API call fails, state is automatically rolled back
 *   };
 *
 *   return (
 *     <ul>
 *       {docs.map(task => (
 *         <li key={task.id}>
 *           <input
 *             type="checkbox"
 *             checked={task.completed}
 *             onChange={() => toggleTask(task.id)}
 *           />
 *           {task.title}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example
 * Batch operations
 * ```tsx
 * function BulkActions() {
 *   const { docs, updateDocs, deleteDocs } = useTurboCollection({
 *     api: itemsApi,
 *     getUserId: () => currentUserId,
 *   });
 *
 *   const markAllAsRead = async () => {
 *     const updates = docs
 *       .filter(item => !item.read)
 *       .map(item => ({
 *         id: item.id,
 *         def: (current: ItemDto, vars: TurboAuthVars) => ({
 *           ...current,
 *           read: true,
 *           updatedAt: vars.now,
 *         }),
 *       }));
 *
 *     await updateDocs(updates);
 *   };
 *
 *   const deleteSelected = async (selectedIds: string[]) => {
 *     await deleteDocs(selectedIds);
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={markAllAsRead}>Mark All as Read</button>
 *       <button onClick={() => deleteSelected(selectedIds)}>Delete Selected</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * Local-only operations (for temporary state)
 * ```tsx
 * function DraftEditor() {
 *   const { docs, createLocalDoc, updateLocalDoc, deleteLocalDoc } = useTurboCollection({
 *     api: draftsApi,
 *     getUserId: () => currentUserId,
 *   });
 *
 *   const createDraft = () => {
 *     // Creates document in local state only, no API call
 *     const draft = createLocalDoc((vars) => ({
 *       id: vars.id,
 *       title: 'Untitled Draft',
 *       content: '',
 *       createdAt: vars.now,
 *       updatedAt: vars.now,
 *       toJson() {
 *         return { title: this.title, content: this.content };
 *       },
 *     }));
 *
 *     return draft.id;
 *   };
 *
 *   const updateDraft = (id: string, content: string) => {
 *     // Updates local state only, no API call
 *     updateLocalDoc(id, (current, vars) => ({
 *       ...current,
 *       content,
 *       updatedAt: vars.now,
 *     }));
 *   };
 *
 *   return <div>Draft editor with local-only operations</div>;
 * }
 * ```
 */
export function useTurboCollection<T extends TurboWriteableId>(
  options: UseTurboCollectionOptions<T>
): TurboCollectionHook<T> {
  const { api, getUserId, onDocsChanged, onError, initialDocs } = options;

  const [docsById, setDocsById] = useState<Map<string, T>>(
    () => new Map(initialDocs?.map(doc => [doc.id, doc]) ?? [])
  );
  const [isReady, setIsReady] = useState<boolean>(false);
  const [rebuildTrigger, setRebuildTrigger] = useState<number>(0);

  const onDocsChangedRef = useRef(onDocsChanged);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onDocsChangedRef.current = onDocsChanged;
    onErrorRef.current = onError;
  }, [onDocsChanged, onError]);

  const docs = useMemo(() => Array.from(docsById.values()), [docsById]);
  const hasDocs = useMemo(() => docsById.size > 0, [docsById]);

  useEffect(() => {
    const unsubscribe = api.streamAllWithConverter(
      (newDocs) => {
        setDocsById(new Map(newDocs.map(doc => [doc.id, doc])));
        setIsReady(true);
        onDocsChangedRef.current?.(newDocs);
      },
      (error) => {
        onErrorRef.current?.(error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [api, rebuildTrigger]);

  const findById = useCallback((id: string): T => {
    const doc = docsById.get(id);
    if (!doc) {
      throw new Error(`Document with id "${id}" not found in collection`);
    }
    return doc;
  }, [docsById]);

  const tryFindById = useCallback((id: string | null | undefined): T | null => {
    if (!id) return null;
    return docsById.get(id) ?? null;
  }, [docsById]);

  const exists = useCallback((id: string): boolean => {
    return docsById.has(id);
  }, [docsById]);

  const createLocalDoc = useCallback((def: CreateDocDef<T>): T => {
    const vars = createAuthVars(api, getUserId);
    const newDoc = def(vars);

    setDocsById(prev => {
      const updated = new Map(prev);
      updated.set(newDoc.id, newDoc);
      return updated;
    });

    return newDoc;
  }, [api, getUserId]);

  const updateLocalDoc = useCallback((id: string, def: UpdateDocDef<T>): T => {
    const current = findById(id);
    const vars = createAuthVars(api, getUserId);
    const updatedDoc = def(current, vars);

    setDocsById(prev => {
      const updated = new Map(prev);
      updated.set(id, updatedDoc);
      return updated;
    });

    return updatedDoc;
  }, [api, getUserId, findById]);

  const deleteLocalDoc = useCallback((id: string): void => {
    setDocsById(prev => {
      const updated = new Map(prev);
      updated.delete(id);
      return updated;
    });
  }, []);

  const createDoc = useCallback(async (def: CreateDocDef<T>): Promise<TurboResponse<T>> => {
    const vars = createAuthVars(api, getUserId);
    const newDoc = def(vars);

    setDocsById(prev => {
      const updated = new Map(prev);
      updated.set(newDoc.id, newDoc);
      return updated;
    });

    const response = await api.createDoc({
      writeable: newDoc,
      id: newDoc.id,
    });

    if (!isSuccess(response)) {
      setDocsById(prev => {
        const updated = new Map(prev);
        updated.delete(newDoc.id);
        return updated;
      });
      return fail(response.error, response.title, response.message, response.stackTrace);
    }

    return success(newDoc, response.title, response.message);
  }, [api, getUserId]);

  const updateDoc = useCallback(async (id: string, def: UpdateDocDef<T>): Promise<TurboResponse<T>> => {
    const current = tryFindById(id);
    if (!current) {
      return fail(
        new Error(`Document with id "${id}" not found`),
        'Update Failed',
        `Cannot update non-existent document with id "${id}"`
      );
    }

    const vars = createAuthVars(api, getUserId);
    const updatedDoc = def(current, vars);

    const previousDoc = current;
    setDocsById(prev => {
      const updated = new Map(prev);
      updated.set(id, updatedDoc);
      return updated;
    });

    const response = await api.updateDoc({
      id,
      data: updatedDoc.toJson(),
    });

    if (!isSuccess(response)) {
      setDocsById(prev => {
        const updated = new Map(prev);
        updated.set(id, previousDoc);
        return updated;
      });
      return fail(response.error, response.title, response.message, response.stackTrace);
    }

    return success(updatedDoc, response.title, response.message);
  }, [api, getUserId, tryFindById]);

  const upsertDoc = useCallback(async (id: string, def: UpsertDocDef<T>): Promise<TurboResponse<T>> => {
    const current = tryFindById(id);
    const vars = createAuthVars(api, getUserId);
    const upsertedDoc = def(current, vars);

    const previousDoc = current;
    setDocsById(prev => {
      const updated = new Map(prev);
      updated.set(id, upsertedDoc);
      return updated;
    });

    const response = await api.createDoc({
      writeable: upsertedDoc,
      id,
      merge: true,
    });

    if (!isSuccess(response)) {
      setDocsById(prev => {
        const updated = new Map(prev);
        if (previousDoc) {
          updated.set(id, previousDoc);
        } else {
          updated.delete(id);
        }
        return updated;
      });
      return fail(response.error, response.title, response.message, response.stackTrace);
    }

    return success(upsertedDoc, response.title, response.message);
  }, [api, getUserId, tryFindById]);

  const deleteDoc = useCallback(async (id: string): Promise<TurboResponse<void>> => {
    const current = tryFindById(id);
    if (!current) {
      return fail(
        new Error(`Document with id "${id}" not found`),
        'Delete Failed',
        `Cannot delete non-existent document with id "${id}"`
      );
    }

    setDocsById(prev => {
      const updated = new Map(prev);
      updated.delete(id);
      return updated;
    });

    const response = await api.deleteDoc(id);

    if (!isSuccess(response)) {
      setDocsById(prev => {
        const updated = new Map(prev);
        updated.set(id, current);
        return updated;
      });
      return fail(response.error, response.title, response.message, response.stackTrace);
    }

    return success(undefined, response.title, response.message);
  }, [api, tryFindById]);

  const createDocs = useCallback(async (defs: CreateDocDef<T>[]): Promise<TurboResponse<T[]>> => {
    const vars = createAuthVars(api, getUserId);
    const newDocs = defs.map(def => def(vars));

    setDocsById(prev => {
      const updated = new Map(prev);
      newDocs.forEach(doc => updated.set(doc.id, doc));
      return updated;
    });

    const batch = api.writeBatch;
    const batchResults: TurboResponse<unknown>[] = [];

    for (const doc of newDocs) {
      const result = api.createDocInBatch({
        writeable: doc,
        id: doc.id,
        writeBatch: batch,
      });
      batchResults.push(result);
    }

    const failedResult = batchResults.find(r => !isSuccess(r));
    if (failedResult && !isSuccess(failedResult)) {
      setDocsById(prev => {
        const updated = new Map(prev);
        newDocs.forEach(doc => updated.delete(doc.id));
        return updated;
      });
      return fail(
        failedResult.error,
        failedResult.title,
        failedResult.message,
        failedResult.stackTrace
      );
    }

    try {
      await batch.commit();
      return success(newDocs);
    } catch (error) {
      setDocsById(prev => {
        const updated = new Map(prev);
        newDocs.forEach(doc => updated.delete(doc.id));
        return updated;
      });
      return fail(error, 'Batch Create Failed', 'Failed to commit batch create operation');
    }
  }, [api, getUserId]);

  const updateDocs = useCallback(async (
    updates: Array<{ id: string; def: UpdateDocDef<T> }>
  ): Promise<TurboResponse<T[]>> => {
    const vars = createAuthVars(api, getUserId);
    const previousDocs = new Map<string, T>();
    const updatedDocs: T[] = [];

    for (const { id, def } of updates) {
      const current = tryFindById(id);
      if (!current) {
        return fail(
          new Error(`Document with id "${id}" not found`),
          'Batch Update Failed',
          `Cannot update non-existent document with id "${id}"`
        );
      }
      previousDocs.set(id, current);
      updatedDocs.push(def(current, vars));
    }

    setDocsById(prev => {
      const updated = new Map(prev);
      updatedDocs.forEach(doc => updated.set(doc.id, doc));
      return updated;
    });

    const batch = api.writeBatch;
    const batchResults: TurboResponse<unknown>[] = [];

    for (const doc of updatedDocs) {
      const result = api.updateDocInBatch({
        id: doc.id,
        data: doc.toJson(),
        writeBatch: batch,
      });
      batchResults.push(result);
    }

    const failedResult = batchResults.find(r => !isSuccess(r));
    if (failedResult && !isSuccess(failedResult)) {
      setDocsById(prev => {
        const updated = new Map(prev);
        previousDocs.forEach((doc, id) => updated.set(id, doc));
        return updated;
      });
      return fail(
        failedResult.error,
        failedResult.title,
        failedResult.message,
        failedResult.stackTrace
      );
    }

    try {
      await batch.commit();
      return success(updatedDocs);
    } catch (error) {
      setDocsById(prev => {
        const updated = new Map(prev);
        previousDocs.forEach((doc, id) => updated.set(id, doc));
        return updated;
      });
      return fail(error, 'Batch Update Failed', 'Failed to commit batch update operation');
    }
  }, [api, getUserId, tryFindById]);

  const deleteDocs = useCallback(async (ids: string[]): Promise<TurboResponse<void>> => {
    const previousDocs = new Map<string, T>();

    for (const id of ids) {
      const current = tryFindById(id);
      if (!current) {
        return fail(
          new Error(`Document with id "${id}" not found`),
          'Batch Delete Failed',
          `Cannot delete non-existent document with id "${id}"`
        );
      }
      previousDocs.set(id, current);
    }

    setDocsById(prev => {
      const updated = new Map(prev);
      ids.forEach(id => updated.delete(id));
      return updated;
    });

    const batch = api.writeBatch;
    const batchResults: TurboResponse<unknown>[] = [];

    for (const id of ids) {
      const result = api.deleteDocInBatch(id, batch);
      batchResults.push(result);
    }

    const failedResult = batchResults.find(r => !isSuccess(r));
    if (failedResult && !isSuccess(failedResult)) {
      setDocsById(prev => {
        const updated = new Map(prev);
        previousDocs.forEach((doc, id) => updated.set(id, doc));
        return updated;
      });
      return fail(
        failedResult.error,
        failedResult.title,
        failedResult.message,
        failedResult.stackTrace
      );
    }

    try {
      await batch.commit();
      return success(undefined);
    } catch (error) {
      setDocsById(prev => {
        const updated = new Map(prev);
        previousDocs.forEach((doc, id) => updated.set(id, doc));
        return updated;
      });
      return fail(error, 'Batch Delete Failed', 'Failed to commit batch delete operation');
    }
  }, [api, tryFindById]);

  const rebuild = useCallback(() => {
    setRebuildTrigger(prev => prev + 1);
  }, []);

  return {
    docsById,
    docs,
    isReady,
    hasDocs,
    findById,
    tryFindById,
    exists,
    createDoc,
    updateDoc,
    upsertDoc,
    deleteDoc,
    createDocs,
    updateDocs,
    deleteDocs,
    rebuild,
    createLocalDoc,
    updateLocalDoc,
    deleteLocalDoc,
  };
}
