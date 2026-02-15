import { Informer } from '@appboypov/informers';
import {
  TurboResponse,
  success,
  fail,
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
  TurboLocatorDef,
  Unsubscribe,
} from '../typedefs/index';

/**
 * Configuration for TurboDocumentService.
 *
 * @template T - The document type
 */
export interface TurboDocumentServiceConfig<T extends TurboWriteableId> {
  api: TurboFirestoreApi<T>;
  getUserId?: () => string | null;
  initialValueLocator?: TurboLocatorDef<T>;
  defaultValueLocator?: TurboLocatorDef<T>;
}

const NO_AUTH_ID = 'no-auth';

/**
 * A standalone service for managing a single Firestore document with
 * synchronized local state.
 *
 * Provides:
 * - Local state management via `Informer<T | null>` with optimistic updates
 * - Remote state synchronization via streaming
 * - Before/after local update callbacks
 * - Error handling
 *
 * This is a standalone class (not a React hook). It can be used in any JS/TS
 * environment: React services, Node.js backends, MCP tools, etc.
 *
 * @template T - The document type, must extend TurboWriteableId
 *
 * @example
 * ```typescript
 * const profileApi = new TurboFirestoreApi<ProfileDto>({ ... });
 * const profileService = new TurboDocumentService({
 *   api: profileApi,
 *   getUserId: () => auth.currentUser?.uid ?? null,
 * });
 *
 * // Start streaming a specific document
 * profileService.stream('user-123');
 * await profileService.isReady;
 *
 * // Use data
 * const profile = profileService.doc.value;
 * ```
 */
export class TurboDocumentService<T extends TurboWriteableId> {
  readonly api: TurboFirestoreApi<T>;
  private readonly _getUserId: () => string | null;

  initialValueLocator: TurboLocatorDef<T> | null;
  defaultValueLocator: TurboLocatorDef<T> | null;

  private readonly _doc: Informer<T | null>;

  private _isReadyResolve: (() => void) | null = null;
  private _isReadyPromise: Promise<void>;
  private _isReadyResolved = false;

  private _unsubscribe: Unsubscribe | null = null;

  beforeLocalNotifyUpdate: ((doc: T | null) => void) | null = null;
  afterLocalNotifyUpdate: ((doc: T | null) => void) | null = null;
  onError: ((error: TurboFirestoreException) => void) | null = null;

  constructor(config: TurboDocumentServiceConfig<T>) {
    this.api = config.api;
    this._getUserId = config.getUserId ?? (() => null);
    this.initialValueLocator = config.initialValueLocator ?? null;
    this.defaultValueLocator = config.defaultValueLocator ?? null;

    const initialValue =
      this.initialValueLocator?.() ??
      this.defaultValueLocator?.() ??
      null;
    this._doc = new Informer<T | null>(initialValue, { forceUpdate: true });

    this._isReadyPromise = new Promise<void>((resolve) => {
      this._isReadyResolve = resolve;
    });
  }

  // ── State Accessors ──────────────────────────────────────────────────────

  get isReady(): Promise<void> {
    return this._isReadyPromise;
  }

  get doc(): Informer<T | null> {
    return this._doc;
  }

  get id(): string | null {
    return this._doc.value?.id ?? null;
  }

  get exists(): boolean {
    return this._doc.value !== null;
  }

  // ── Streaming ────────────────────────────────────────────────────────────

  /**
   * Starts streaming a document by ID.
   *
   * @param documentId - The ID of the document to stream
   */
  stream(documentId: string): void {
    this.stopStream();
    this._unsubscribe = this.api.streamDocByIdWithConverter(
      documentId,
      (value) => {
        if (value !== null) {
          this.upsertLocalDoc(value.id, (_, __) => value);
        } else {
          this._updateDoc(null);
        }
        this._markReady();
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
    this._doc.rebuild();
  }

  createLocalDoc(doc: CreateDocDef<T>, doNotifyListeners = true): T {
    const pDoc = doc(this.turboVars());
    this._updateDoc(pDoc, doNotifyListeners);
    return pDoc;
  }

  updateLocalDoc(doc: UpdateDocDef<T>, doNotifyListeners = true): T {
    const current = this._doc.value;
    if (!current) {
      throw new Error('Cannot update non-existent document');
    }
    const pDoc = doc(current, this.turboVars(current.id));
    this._updateDoc(pDoc, doNotifyListeners);
    return pDoc;
  }

  deleteLocalDoc(doNotifyListeners = true): void {
    this._updateDoc(null, doNotifyListeners);
  }

  upsertLocalDoc(
    id: string,
    doc: UpsertDocDef<T>,
    doNotifyListeners = true
  ): T {
    const pDoc = doc(this._doc.value, this.turboVars(id));
    this._updateDoc(pDoc, doNotifyListeners);
    return pDoc;
  }

  private _updateDoc(value: T | null, doNotifyListeners = true): void {
    if (doNotifyListeners) {
      this.beforeLocalNotifyUpdate?.(value);
    }
    this._doc.update(value, { doNotifyListeners });
    if (doNotifyListeners) {
      this.afterLocalNotifyUpdate?.(value);
    }
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
    doc: UpdateDocDef<T>,
    doNotifyListeners = true
  ): Promise<TurboResponse<T>> {
    try {
      const current = this._doc.value;
      if (!current) {
        return fail(
          new Error('Cannot update non-existent document'),
          'Update Failed',
          'Document does not exist'
        );
      }
      const pDoc = this.updateLocalDoc(doc, doNotifyListeners);
      const response = await this.api.updateDoc({
        id: current.id,
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

  async deleteDoc(doNotifyListeners = true): Promise<TurboResponse<void>> {
    try {
      const current = this._doc.value;
      if (!current) {
        return fail(
          new Error('Cannot delete non-existent document'),
          'Delete Failed',
          'Document does not exist'
        );
      }
      const docId = current.id;
      this.deleteLocalDoc(doNotifyListeners);
      const response = await this.api.deleteDoc(docId);
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

  // ── Lifecycle ────────────────────────────────────────────────────────────

  dispose(): void {
    this.stopStream();
    this._doc.dispose();
    if (!this._isReadyResolved) {
      this._isReadyResolved = true;
      this._isReadyResolve?.();
    }
  }
}
