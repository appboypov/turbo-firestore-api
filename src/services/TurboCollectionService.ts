import { Informer } from '@appboypov/informers';
import {
  TurboResponse,
  success,
  fail,
  isSuccess,
  isFail,
} from '@appboypov/turbo-response';
import { TurboFirestoreApi } from '../api/TurboFirestoreApi';
import { TurboFirestoreException } from '../exceptions/TurboFirestoreException';
import type { TurboWriteableId } from '../abstracts/TurboWriteableId';
import type { TurboAuthVars } from '../models/TurboAuthVars';
import type {
  CreateDocDef,
  UpdateDocDef,
  UpsertDocDef,
  CollectionReferenceDef,
  Unsubscribe,
} from '../typedefs/index';

/**
 * Configuration for TurboCollectionService.
 *
 * @template T - The document type
 */
export interface TurboCollectionServiceConfig<T extends TurboWriteableId> {
  api: TurboFirestoreApi<T>;
  getUserId?: () => string | null;
}

/**
 * Callback invoked when documents are received from a stream.
 *
 * @template T - The document type
 */
export type OnStreamData<T> = (docs: T[]) => void | Promise<void>;

/**
 * Callback invoked before the local state is updated with streamed data.
 *
 * @template T - The document type
 */
export type BeforeSyncCallback<T> = (docs: T[]) => void | Promise<void>;

/**
 * Callback invoked after the local state is updated with streamed data.
 *
 * @template T - The document type
 */
export type AfterSyncCallback<T> = (docs: T[]) => void | Promise<void>;

const NO_AUTH_ID = 'no-auth';

/**
 * A standalone service for managing a collection of Firestore documents with
 * synchronized local state.
 *
 * Provides:
 * - Local state management via `Informer<Map<string, T>>` with optimistic updates
 * - Remote state synchronization via streaming
 * - Batch operations
 * - Error handling
 *
 * This is a standalone class (not a React hook). It can be used in any JS/TS
 * environment: React services, Node.js backends, MCP tools, etc.
 *
 * @template T - The document type, must extend TurboWriteableId
 *
 * @example
 * ```typescript
 * const usersApi = new TurboFirestoreApi<UserDto>({ ... });
 * const usersService = new TurboCollectionService({ api: usersApi });
 *
 * // Start streaming
 * usersService.stream();
 * await usersService.isReady;
 *
 * // Use data
 * const user = usersService.findById('user-123');
 * ```
 */
export class TurboCollectionService<T extends TurboWriteableId> {
  readonly api: TurboFirestoreApi<T>;
  private readonly _getUserId: () => string | null;

  private readonly _docsById = new Informer<Map<string, T>>(new Map(), {
    forceUpdate: true,
  });

  private readonly _docsInformer = new Informer<T[]>([], {
    forceUpdate: true,
  });

  private _isReadyResolve: (() => void) | null = null;
  private _isReadyPromise: Promise<void>;
  private _isReadyResolved = false;

  private _isLoaded = false;
  private _isLoading = false;
  private _loadPromise: Promise<void> | null = null;

  private _unsubscribe: Unsubscribe | null = null;

  beforeSync: BeforeSyncCallback<T> | null = null;
  afterSync: AfterSyncCallback<T> | null = null;
  onError: ((error: TurboFirestoreException) => void) | null = null;

  constructor(config: TurboCollectionServiceConfig<T>) {
    this.api = config.api;
    this._getUserId = config.getUserId ?? (() => null);

    this._isReadyPromise = new Promise<void>((resolve) => {
      this._isReadyResolve = resolve;
    });
  }

  // ── State Accessors ──────────────────────────────────────────────────────

  get isReady(): Promise<void> {
    return this._isReadyPromise;
  }

  get docsById(): Informer<Map<string, T>> {
    return this._docsById;
  }

  get docsInformer(): Informer<T[]> {
    return this._docsInformer;
  }

  get docs(): T[] {
    return Array.from(this._docsById.value.values());
  }

  get hasDocs(): boolean {
    return this._docsById.value.size > 0;
  }

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  exists(id: string): boolean {
    return this._docsById.value.has(id);
  }

  findById(id: string): T {
    const doc = this._docsById.value.get(id);
    if (!doc) {
      throw new Error(
        `Document with id "${id}" not found in collection`
      );
    }
    return doc;
  }

  tryFindById(id: string | null | undefined): T | null {
    if (!id) return null;
    return this._docsById.value.get(id) ?? null;
  }

  getById(id: string): T | undefined {
    return this._docsById.value.get(id);
  }

  tryGetById(id: string | null | undefined): T | null {
    if (!id) return null;
    return this._docsById.value.get(id) ?? null;
  }

  async fetchById(id: string): Promise<T | null> {
    const cached = this._docsById.value.get(id);
    if (cached) return cached;

    const response = await this.api.getByIdWithConverter(id);
    if (isSuccess(response) && response.result) {
      return response.result;
    }
    return null;
  }

  // ── Streaming ────────────────────────────────────────────────────────────

  /**
   * Starts streaming all documents in the collection.
   * Calls `beforeSync` and `afterSync` callbacks around state updates.
   */
  stream(): void {
    this.stopStream();
    this._unsubscribe = this.api.streamAllWithConverter(
      async (docs) => {
        await this._handleStreamData(docs);
      },
      (error) => {
        this.onError?.(error);
      }
    );
  }

  /**
   * Starts streaming documents matching a query.
   *
   * @param queryDef - Query builder function
   */
  streamByQuery(queryDef: CollectionReferenceDef<T>): void {
    this.stopStream();
    this._unsubscribe = this.api.streamByQuery(
      queryDef,
      async (docs) => {
        await this._handleStreamData(docs);
      },
      (error) => {
        this.onError?.(error);
      }
    );
  }

  /**
   * Stops the active stream subscription.
   */
  stopStream(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  /**
   * Loads all documents by starting a stream and awaiting the first emission.
   * Subsequent calls return the existing promise if already loading, or
   * resolve immediately if already loaded.
   */
  async load(): Promise<void> {
    if (this._isLoaded) return;
    if (this._loadPromise) return this._loadPromise;

    this._isLoading = true;

    this._loadPromise = (async () => {
      this.stream();
      await this.isReady;
      this._loadPromise = null;
    })();

    return this._loadPromise;
  }

  private async _handleStreamData(docs: T[]): Promise<void> {
    const map = new Map(docs.map((d) => [d.id, d]));
    await this.beforeSync?.(docs);
    this._docsById.update(map);
    this._docsInformer.update(docs);
    this._isLoaded = true;
    this._isLoading = false;
    this._markReady();
    await this.afterSync?.(docs);
  }

  private _markReady(): void {
    if (!this._isReadyResolved) {
      this._isReadyResolved = true;
      this._isReadyResolve?.();
    }
  }

  // ── Vars ─────────────────────────────────────────────────────────────────

  turboVars(id?: string): TurboAuthVars {
    return {
      id: id ?? this.api.genId,
      now: new Date(),
      userId: this._getUserId() ?? NO_AUTH_ID,
    };
  }

  // ── Local Mutators ───────────────────────────────────────────────────────

  rebuild(): void {
    this._docsById.rebuild();
  }

  createLocalDoc(doc: CreateDocDef<T>, doNotifyListeners = true): T {
    const pDoc = doc(this.turboVars());
    this._docsById.updateCurrent(
      (map) => {
        const updated = new Map(map);
        updated.set(pDoc.id, pDoc);
        return updated;
      },
      { doNotifyListeners }
    );
    return pDoc;
  }

  updateLocalDoc(
    id: string,
    doc: UpdateDocDef<T>,
    doNotifyListeners = true
  ): T {
    const pDoc = doc(this.findById(id), this.turboVars(id));
    this._docsById.updateCurrent(
      (map) => {
        const updated = new Map(map);
        updated.set(pDoc.id, pDoc);
        return updated;
      },
      { doNotifyListeners }
    );
    return pDoc;
  }

  deleteLocalDoc(id: string, doNotifyListeners = true): void {
    this._docsById.updateCurrent(
      (map) => {
        const updated = new Map(map);
        updated.delete(id);
        return updated;
      },
      { doNotifyListeners }
    );
  }

  upsertLocalDoc(
    id: string,
    doc: UpsertDocDef<T>,
    doNotifyListeners = true
  ): T {
    const pDoc = doc(this.tryFindById(id), this.turboVars(id));
    this._docsById.updateCurrent(
      (map) => {
        const updated = new Map(map);
        updated.set(pDoc.id, pDoc);
        return updated;
      },
      { doNotifyListeners }
    );
    return pDoc;
  }

  createLocalDocs(docs: CreateDocDef<T>[], doNotifyListeners = true): T[] {
    const pDocs: T[] = [];
    for (const doc of docs) {
      pDocs.push(this.createLocalDoc(doc, false));
    }
    if (doNotifyListeners) this._docsById.rebuild();
    return pDocs;
  }

  updateLocalDocs(
    ids: string[],
    doc: UpdateDocDef<T>,
    doNotifyListeners = true
  ): T[] {
    const pDocs: T[] = [];
    for (const id of ids) {
      pDocs.push(this.updateLocalDoc(id, doc, false));
    }
    if (doNotifyListeners) this._docsById.rebuild();
    return pDocs;
  }

  deleteLocalDocs(ids: string[], doNotifyListeners = true): void {
    for (const id of ids) {
      this.deleteLocalDoc(id, false);
    }
    if (doNotifyListeners) this._docsById.rebuild();
  }

  upsertLocalDocs(
    ids: string[],
    doc: UpsertDocDef<T>,
    doNotifyListeners = true
  ): T[] {
    const pDocs: T[] = [];
    for (const id of ids) {
      pDocs.push(this.upsertLocalDoc(id, doc, false));
    }
    if (doNotifyListeners) this._docsById.rebuild();
    return pDocs;
  }

  // ── Remote Mutators (Optimistic) ─────────────────────────────────────────

  async createDoc(
    doc: CreateDocDef<T>,
    doNotifyListeners = true
  ): Promise<TurboResponse<T>> {
    try {
      const pDoc = this.createLocalDoc(doc, doNotifyListeners);
      const response = await this.api.createDoc({
        writeable: pDoc,
        id: pDoc.id,
      });
      if (isFail(response)) {
        return fail(response.error, response.title, response.message, response.stackTrace);
      }
      return success(pDoc);
    } catch (error) {
      return fail(error);
    }
  }

  async updateDoc(
    id: string,
    doc: UpdateDocDef<T>,
    doNotifyListeners = true
  ): Promise<TurboResponse<T>> {
    try {
      const pDoc = this.updateLocalDoc(id, doc, doNotifyListeners);
      const response = await this.api.updateDoc({
        id,
        data: pDoc.toJson(),
      });
      if (isFail(response)) {
        return fail(response.error, response.title, response.message, response.stackTrace);
      }
      return success(pDoc);
    } catch (error) {
      return fail(error);
    }
  }

  async deleteDoc(
    id: string,
    doNotifyListeners = true
  ): Promise<TurboResponse<void>> {
    try {
      this.deleteLocalDoc(id, doNotifyListeners);
      const response = await this.api.deleteDoc(id);
      if (isFail(response)) {
        return fail(response.error, response.title, response.message, response.stackTrace);
      }
      return success(undefined);
    } catch (error) {
      return fail(error);
    }
  }

  async upsertDoc(
    id: string,
    doc: UpsertDocDef<T>,
    doNotifyListeners = true
  ): Promise<TurboResponse<T>> {
    try {
      const pDoc = this.upsertLocalDoc(id, doc, doNotifyListeners);
      const response = await this.api.createDoc({
        writeable: pDoc,
        id,
        merge: true,
      });
      if (isFail(response)) {
        return fail(response.error, response.title, response.message, response.stackTrace);
      }
      return success(pDoc);
    } catch (error) {
      return fail(error);
    }
  }

  // ── Batch Remote Mutators ────────────────────────────────────────────────

  async createDocs(
    docs: CreateDocDef<T>[],
    doNotifyListeners = true
  ): Promise<TurboResponse<T[]>> {
    try {
      const pDocs = this.createLocalDocs(docs, doNotifyListeners);
      const batch = this.api.writeBatch;
      for (const pDoc of pDocs) {
        const result = this.api.createDocInBatch({
          writeable: pDoc,
          id: pDoc.id,
          writeBatch: batch,
        });
        if (isFail(result)) {
          return fail(result.error, result.title, result.message, result.stackTrace);
        }
      }
      await batch.commit();
      return success(pDocs);
    } catch (error) {
      return fail(error);
    }
  }

  async updateDocs(
    ids: string[],
    doc: UpdateDocDef<T>,
    doNotifyListeners = true
  ): Promise<TurboResponse<T[]>> {
    try {
      const pDocs = this.updateLocalDocs(ids, doc, doNotifyListeners);
      const batch = this.api.writeBatch;
      for (const pDoc of pDocs) {
        const result = this.api.updateDocInBatch({
          id: pDoc.id,
          data: pDoc.toJson(),
          writeBatch: batch,
        });
        if (isFail(result)) {
          return fail(result.error, result.title, result.message, result.stackTrace);
        }
      }
      await batch.commit();
      return success(pDocs);
    } catch (error) {
      return fail(error);
    }
  }

  async deleteDocs(
    ids: string[],
    doNotifyListeners = true
  ): Promise<TurboResponse<void>> {
    try {
      this.deleteLocalDocs(ids, doNotifyListeners);
      const batch = this.api.writeBatch;
      for (const id of ids) {
        const result = this.api.deleteDocInBatch(id, batch);
        if (isFail(result)) {
          return fail(result.error, result.title, result.message, result.stackTrace);
        }
      }
      await batch.commit();
      return success(undefined);
    } catch (error) {
      return fail(error);
    }
  }

  async upsertDocs(
    ids: string[],
    doc: UpsertDocDef<T>,
    doNotifyListeners = true
  ): Promise<TurboResponse<T[]>> {
    try {
      const pDocs = this.upsertLocalDocs(ids, doc, doNotifyListeners);
      const batch = this.api.writeBatch;
      for (const pDoc of pDocs) {
        const result = this.api.createDocInBatch({
          writeable: pDoc,
          id: pDoc.id,
          writeBatch: batch,
          merge: true,
        });
        if (isFail(result)) {
          return fail(result.error, result.title, result.message, result.stackTrace);
        }
      }
      await batch.commit();
      return success(pDocs);
    } catch (error) {
      return fail(error);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  dispose(): void {
    this.stopStream();
    this._docsById.dispose();
    this._docsInformer.dispose();
    this._isLoaded = false;
    this._isLoading = false;
    this._loadPromise = null;
    if (!this._isReadyResolved) {
      this._isReadyResolved = true;
      this._isReadyResolve?.();
    }
  }
}
