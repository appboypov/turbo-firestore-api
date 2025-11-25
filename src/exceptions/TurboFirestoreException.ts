import { FirestoreError } from 'firebase/firestore';

/**
 * Base exception class for all Turbo Firestore exceptions.
 */
export class TurboFirestoreException extends Error {
  /**
   * The Firestore error code.
   */
  readonly code: string;

  /**
   * An optional document or collection path related to the error.
   */
  readonly path?: string;

  /**
   * An optional query string related to the error.
   */
  readonly query?: string;

  /**
   * An optional stack trace string.
   */
  readonly stackTrace?: string;

  /**
   * Creates a new TurboFirestoreException.
   *
   * @param message - The exception message
   * @param code - The Firestore error code
   * @param path - An optional document or collection path
   * @param query - An optional query string
   * @param stackTrace - An optional stack trace string
   */
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message);
    this.name = 'TurboFirestoreException';
    this.code = code;
    this.path = path;
    this.query = query;
    this.stackTrace = stackTrace;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if ('captureStackTrace' in Error) {
      (Error as { captureStackTrace(target: object, constructor: Function): void }).captureStackTrace(this, TurboFirestoreException);
    }
  }

  /**
   * Creates a TurboFirestoreException from a FirestoreError.
   * Maps Firestore error codes to specific exception types.
   *
   * @param error - The Firestore error
   * @param path - An optional document or collection path
   * @param query - An optional query string
   * @returns The appropriate TurboFirestoreException subclass
   */
  static fromFirestoreError(
    error: FirestoreError,
    path?: string,
    query?: string
  ): TurboFirestoreException {
    const stackTrace = error.stack;

    switch (error.code) {
      case 'permission-denied':
        return new TurboFirestorePermissionDeniedException(
          error.message,
          error.code,
          path,
          query,
          stackTrace
        );
      case 'unavailable':
        return new TurboFirestoreUnavailableException(
          error.message,
          error.code,
          path,
          query,
          stackTrace
        );
      case 'not-found':
        return new TurboFirestoreNotFoundException(
          error.message,
          error.code,
          path,
          query,
          stackTrace
        );
      case 'already-exists':
        return new TurboFirestoreAlreadyExistsException(
          error.message,
          error.code,
          path,
          query,
          stackTrace
        );
      case 'cancelled':
        return new TurboFirestoreCancelledException(
          error.message,
          error.code,
          path,
          query,
          stackTrace
        );
      case 'deadline-exceeded':
        return new TurboFirestoreDeadlineExceededException(
          error.message,
          error.code,
          path,
          query,
          stackTrace
        );
      default:
        return new TurboFirestoreGenericException(
          error.message,
          error.code,
          path,
          query,
          stackTrace
        );
    }
  }
}

/**
 * Exception thrown when a Firestore operation is denied due to security rules.
 */
export class TurboFirestorePermissionDeniedException extends TurboFirestoreException {
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message, code, path, query, stackTrace);
    this.name = 'TurboFirestorePermissionDeniedException';
  }
}

/**
 * Exception thrown when Firestore is unavailable (e.g., network issues).
 */
export class TurboFirestoreUnavailableException extends TurboFirestoreException {
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message, code, path, query, stackTrace);
    this.name = 'TurboFirestoreUnavailableException';
  }
}

/**
 * Exception thrown when a requested document or resource is not found.
 */
export class TurboFirestoreNotFoundException extends TurboFirestoreException {
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message, code, path, query, stackTrace);
    this.name = 'TurboFirestoreNotFoundException';
  }
}

/**
 * Exception thrown when attempting to create a document that already exists.
 */
export class TurboFirestoreAlreadyExistsException extends TurboFirestoreException {
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message, code, path, query, stackTrace);
    this.name = 'TurboFirestoreAlreadyExistsException';
  }
}

/**
 * Exception thrown when a Firestore operation is cancelled.
 */
export class TurboFirestoreCancelledException extends TurboFirestoreException {
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message, code, path, query, stackTrace);
    this.name = 'TurboFirestoreCancelledException';
  }
}

/**
 * Exception thrown when a Firestore operation exceeds its deadline (timeout).
 */
export class TurboFirestoreDeadlineExceededException extends TurboFirestoreException {
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message, code, path, query, stackTrace);
    this.name = 'TurboFirestoreDeadlineExceededException';
  }
}

/**
 * Generic exception for Firestore errors that don't match specific exception types.
 */
export class TurboFirestoreGenericException extends TurboFirestoreException {
  constructor(
    message: string,
    code: string,
    path?: string,
    query?: string,
    stackTrace?: string
  ) {
    super(message, code, path, query, stackTrace);
    this.name = 'TurboFirestoreGenericException';
  }
}
