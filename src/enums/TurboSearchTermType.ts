/**
 * Enum representing the type of search query to perform.
 *
 * This enum is used to control how search terms are matched against
 * Firestore document fields during search operations.
 *
 * @example
 * ```typescript
 * import { TurboSearchTermType } from 'turbo-firestore-api';
 *
 * // Search for names starting with "John"
 * listBySearchTerm({
 *   searchTerm: 'John',
 *   searchField: 'name',
 *   searchTermType: TurboSearchTermType.StartsWith,
 * });
 *
 * // Search for tags array containing "featured"
 * listBySearchTerm({
 *   searchTerm: 'featured',
 *   searchField: 'tags',
 *   searchTermType: TurboSearchTermType.ArrayContains,
 * });
 * ```
 */
export enum TurboSearchTermType {
  /**
   * Performs a prefix search (startsWith).
   *
   * Uses Firestore's >= and < operators to find documents where the field
   * value starts with the given search term.
   *
   * Example: searchTerm "Joh" would match "John", "Johnny", but not "Bob"
   */
  StartsWith = 'startsWith',

  /**
   * Searches for arrays containing the specified value.
   *
   * Uses Firestore's array-contains operator to find documents where the
   * specified array field contains the search term.
   *
   * Example: searchTerm "tag1" would match documents with tags: ["tag1", "tag2"]
   */
  ArrayContains = 'arrayContains',
}
