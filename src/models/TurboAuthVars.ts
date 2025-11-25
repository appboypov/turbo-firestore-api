import type { TurboApiVars } from './TurboApiVars';

/**
 * Variables provided to authenticated API operations.
 * Extends TurboApiVars with user information.
 *
 * This interface is used for operations that require authentication context,
 * such as setting ownership, tracking who created or modified a document,
 * or enforcing user-specific access controls.
 *
 * @example
 * ```typescript
 * const createPost: CreateDocDef<Post> = (vars) => ({
 *   id: vars.id,
 *   title: 'New Post',
 *   authorId: vars.userId, // Automatically set to current user
 *   createdAt: vars.now,
 *   updatedAt: vars.now,
 * });
 *
 * const updatePost: UpdateDocDef<Post> = (current, vars) => ({
 *   ...current,
 *   lastModifiedBy: vars.userId,
 *   updatedAt: vars.now,
 * });
 * ```
 */
export interface TurboAuthVars extends TurboApiVars {
  /**
   * Current authenticated user's ID.
   *
   * This ID represents the user performing the operation.
   * It can be used for setting ownership, tracking modifications,
   * or implementing user-specific business logic.
   */
  readonly userId: string;
}
