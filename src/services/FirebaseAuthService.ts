import type { User, Auth } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import type { Unsubscribe } from '../typedefs/index';
import { TurboFirestoreException } from '../exceptions/TurboFirestoreException';

/**
 * Options for configuring the FirebaseAuthService.
 */
export interface FirebaseAuthServiceOptions {
  /**
   * Firebase Auth instance to use for auth state changes.
   */
  auth: Auth;

  /**
   * Whether to initialize the stream immediately on construction.
   * Default: true
   */
  initialiseStream?: boolean;
}

/**
 * A service that synchronizes data with Firebase Authentication state changes.
 *
 * Provides automatic data synchronization based on user authentication state:
 * - Starts streaming data when a user signs in
 * - Clears data when user signs out
 * - Handles stream errors with automatic retries
 * - Manages stream lifecycle
 *
 * @template StreamValue - The type of data being streamed
 */
export abstract class FirebaseAuthService<StreamValue> {
  protected readonly auth: Auth;

  /**
   * The ID of the currently authenticated user.
   */
  cachedUserId: string | null = null;

  /**
   * Subscription to the data stream.
   */
  private _subscription: Unsubscribe | null = null;

  /**
   * Subscription to the authentication state stream.
   */
  private _userSubscription: Unsubscribe | null = null;

  /**
   * Timer for retry attempts.
   */
  private _retryTimer: NodeJS.Timeout | null = null;

  /**
   * Maximum number of retry attempts.
   */
  private readonly _maxNrOfRetry = 20;

  /**
   * Current number of retry attempts.
   */
  private _nrOfRetry = 0;

  /**
   * Creates a new FirebaseAuthService instance.
   *
   * @param options - Configuration options for the service
   */
  constructor(options: FirebaseAuthServiceOptions) {
    this.auth = options.auth;

    if (options.initialiseStream !== false) {
      this.tryInitialiseStream();
    }
  }

  /**
   * Returns a stream of data for the authenticated user.
   *
   * The implementation should set up a Firestore listener and call the provided
   * handlers when data/errors occur. Return an unsubscribe function.
   *
   * @param user - The authenticated Firebase user
   * @param onValue - Callback to invoke when new data is received
   * @param onError - Callback to invoke when an error occurs
   * @returns An unsubscribe function, optionally async
   */
  abstract stream(
    user: User,
    onValue: (value: StreamValue | null) => void,
    onError: (error: unknown, stackTrace?: string) => void
  ): Unsubscribe | Promise<Unsubscribe>;

  /**
   * Handles data updates from the stream.
   *
   * @param value - The streamed data, or null when user signs out
   * @param user - The authenticated user, or null when signed out
   */
  abstract onData(
    value: StreamValue | null,
    user: User | null
  ): Promise<void>;

  /**
   * Called when a user is authenticated, before setting up the stream.
   *
   * @param user - The authenticated Firebase user
   */
  onAuth?(user: User): void | Promise<void>;

  /**
   * Called when a stream error occurs.
   *
   * @param error - The Firestore exception that occurred
   */
  onError(error: TurboFirestoreException): void {
    console.warn('Stream error occurred (onError not overridden):', error);
  }

  /**
   * Called when the stream is done.
   *
   * @param nrOfRetry - The current retry count
   * @param maxNrOfRetry - The maximum number of retries
   */
  onDone(nrOfRetry: number, maxNrOfRetry: number): void {
    console.warn('FirebaseAuthService stream is done!');
  }

  /**
   * Initializes the authentication state stream and data synchronization.
   *
   * Sets up listeners for user authentication changes and manages the data stream.
   */
  async tryInitialiseStream(): Promise<void> {
    console.info('Initialising FirebaseAuthService stream..');
    try {
      this._userSubscription ??= onAuthStateChanged(
        this.auth,
        async (user) => {
          const userId = user?.uid ?? null;
          if (userId !== null) {
            this.cachedUserId = userId;
            await this.onAuth?.(user!);
            this._subscription ??= await this.stream(
              user!,
              async (value) => {
                await this.onData(value, user);
              },
              (error, stackTrace) => {
                console.error(
                  'Stream error occurred inside of stream!',
                  error,
                  stackTrace
                );

                const exception =
                  error instanceof TurboFirestoreException
                    ? error
                    : TurboFirestoreException.fromFirestoreError(
                        error as Parameters<
                          typeof TurboFirestoreException.fromFirestoreError
                        >[0]
                      );

                this.onError(exception);
                this._tryRetry();
              }
            );
          } else {
            this.cachedUserId = null;
            this._subscription?.();
            this._subscription = null;
            await this.onData(null, null);
          }
        }
      );
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(
        'Stream error occurred while setting up stream!',
        error,
        stack
      );

      const exception =
        error instanceof TurboFirestoreException
          ? error
          : TurboFirestoreException.fromFirestoreError(
              error as Parameters<
                typeof TurboFirestoreException.fromFirestoreError
              >[0]
            );

      this.onError(exception);
      this._tryRetry();
    }
  }

  /**
   * Resets and reinitializes the stream.
   */
  async resetAndTryInitialiseStream(): Promise<void> {
    await this._resetStream();
    await this.tryInitialiseStream();
  }

  /**
   * Cleans up resources and resets the service state.
   */
  async dispose(): Promise<void> {
    console.warn('Disposing FirebaseAuthService!');
    await this._resetStream();
    this._resetRetryTimer();
    this._nrOfRetry = 0;
  }

  /**
   * Resets the stream subscriptions.
   */
  private async _resetStream(): Promise<void> {
    this._userSubscription?.();
    this._userSubscription = null;
    this._subscription?.();
    this._subscription = null;
  }

  /**
   * Resets the retry timer.
   */
  private _resetRetryTimer(): void {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  /**
   * Attempts to retry stream initialization after an error.
   */
  private _tryRetry(): void {
    if (this._nrOfRetry < this._maxNrOfRetry) {
      if (this._retryTimer !== null) {
        this._resetRetryTimer();
        console.info('Retry reset!');
      }
      console.info(
        `Initiating stream retry ${this._nrOfRetry}/${this._maxNrOfRetry} for FirebaseAuthService in 10 seconds..`
      );
      this._retryTimer = setTimeout(async () => {
        this._nrOfRetry++;
        await this._resetStream();
        await this.tryInitialiseStream();
        this._retryTimer = null;
      }, 10000);
    } else {
      this._resetStream();
    }
  }
}
