import type { TurboAuthVars } from '../models/TurboAuthVars';
import type { Query, CollectionReference } from 'firebase/firestore';

/**
 * Definition function for creating a new document.
 *
 * This function receives authentication variables (including auto-generated ID,
 * current timestamp, and user ID) and returns a new document of type T.
 *
 * @template T - The type of the document being created
 * @param vars - Authentication variables provided by the system
 * @returns A new document instance
 *
 * @example
 * ```typescript
 * const createUser: CreateDocDef<User> = (vars) => ({
 *   id: vars.id,
 *   name: 'New User',
 *   email: 'user@example.com',
 *   createdBy: vars.userId,
 *   createdAt: vars.now,
 *   updatedAt: vars.now,
 * });
 * ```
 */
export type CreateDocDef<T> = (vars: TurboAuthVars) => T;

/**
 * Definition function for updating an existing document.
 *
 * This function receives the current document state and authentication variables,
 * and returns the updated document. It allows you to modify specific fields
 * while preserving others.
 *
 * @template T - The type of the document being updated
 * @param current - The current state of the document
 * @param vars - Authentication variables provided by the system
 * @returns The updated document instance
 *
 * @example
 * ```typescript
 * const updateUser: UpdateDocDef<User> = (current, vars) => ({
 *   ...current,
 *   name: 'Updated Name',
 *   updatedBy: vars.userId,
 *   updatedAt: vars.now,
 * });
 * ```
 */
export type UpdateDocDef<T> = (current: T, vars: TurboAuthVars) => T;

/**
 * Definition function for upserting a document (create or update).
 *
 * This function receives the current document state (which may be null if the
 * document doesn't exist) and authentication variables. It returns either a new
 * document or an updated version of the existing one.
 *
 * @template T - The type of the document being upserted
 * @param current - The current state of the document, or null if it doesn't exist
 * @param vars - Authentication variables provided by the system
 * @returns The upserted document instance
 *
 * @example
 * ```typescript
 * const upsertUser: UpsertDocDef<User> = (current, vars) => {
 *   if (current) {
 *     // Update existing document
 *     return {
 *       ...current,
 *       lastLogin: vars.now,
 *       updatedAt: vars.now,
 *     };
 *   } else {
 *     // Create new document
 *     return {
 *       id: vars.id,
 *       name: 'New User',
 *       createdAt: vars.now,
 *       updatedAt: vars.now,
 *     };
 *   }
 * };
 * ```
 */
export type UpsertDocDef<T> = (current: T | null, vars: TurboAuthVars) => T;

/**
 * Definition function for building a Firestore query.
 *
 * This function receives a Firestore collection reference and returns a query
 * that can be used for filtering, ordering, and limiting results.
 *
 * @template T - The type of documents in the collection
 * @param ref - The Firestore collection reference
 * @returns A Firestore query
 *
 * @example
 * ```typescript
 * import { where, orderBy, limit } from 'firebase/firestore';
 *
 * const getActiveUsers: CollectionReferenceDef<User> = (ref) =>
 *   query(
 *     ref,
 *     where('status', '==', 'active'),
 *     orderBy('createdAt', 'desc'),
 *     limit(10)
 *   );
 * ```
 */
export type CollectionReferenceDef<T> = (
  ref: CollectionReference<T>
) => Query<T>;

/**
 * Unsubscribe function returned by stream subscriptions.
 *
 * Call this function to stop listening to real-time updates and clean up
 * the subscription. Always call this when the component unmounts or when
 * the subscription is no longer needed to prevent memory leaks.
 *
 * @example
 * ```typescript
 * const unsubscribe = streamDocument({
 *   path: 'users/user-123',
 *   onData: (user) => console.log(user),
 * });
 *
 * // Later, when done listening:
 * unsubscribe();
 * ```
 */
export type Unsubscribe = () => void;

/**
 * Locator function for finding initial/default values.
 *
 * This function is used to locate or compute an initial value for a document
 * or resource. It returns the value if found, or null if not available.
 *
 * @template T - The type of the value being located
 * @returns The located value, or null if not found
 *
 * @example
 * ```typescript
 * const locateDefaultUser: TurboLocatorDef<User> = () => {
 *   const cachedUser = localStorage.getItem('defaultUser');
 *   return cachedUser ? JSON.parse(cachedUser) : null;
 * };
 *
 * const locateCurrentOrganization: TurboLocatorDef<Organization> = () => {
 *   const orgId = getCurrentOrgId();
 *   return orgId ? getOrganizationById(orgId) : null;
 * };
 * ```
 */
export type TurboLocatorDef<T> = () => T | null;
