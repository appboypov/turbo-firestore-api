import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, Auth } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import type { Unsubscribe } from '../typedefs/index';
import { TurboFirestoreException } from '../exceptions/TurboFirestoreException';

/**
 * State interface for auth sync operations.
 */
export interface AuthSyncState {
  /** Whether the stream has completed initial load */
  isReady: boolean;
  /** The cached user ID from last auth state */
  cachedUserId: string | null;
  /** Whether currently retrying after an error */
  isRetrying: boolean;
  /** Current retry count */
  retryCount: number;
}

/**
 * Actions interface for auth sync operations.
 */
export interface AuthSyncActions {
  /** Reset the stream and reinitialize */
  resetAndReinitialize: () => Promise<void>;
}

/**
 * Combined hook return type.
 */
export type AuthSyncHook = AuthSyncState & AuthSyncActions;

/**
 * Options for configuring the useAuthSync hook.
 */
export interface UseAuthSyncOptions<T> {
  /**
   * Function that returns a stream setup for the authenticated user.
   * Should return an unsubscribe function.
   */
  stream: (user: User) => Unsubscribe;

  /**
   * Callback when data is received from the stream.
   * Called with null when user signs out.
   */
  onData: (value: T | null, user: User | null) => void | Promise<void>;

  /**
   * Optional callback when auth state changes (user signs in).
   * Called before setting up the stream.
   */
  onAuth?: (user: User) => void | Promise<void>;

  /**
   * Optional callback when stream errors occur.
   */
  onError?: (error: TurboFirestoreException) => void;

  /**
   * Optional callback when stream completes (user signs out or max retries reached).
   */
  onDone?: (retryCount: number, maxRetries: number) => void;

  /**
   * Maximum number of retry attempts on stream error.
   * Default: 20
   */
  maxRetries?: number;

  /**
   * Delay between retry attempts in milliseconds.
   * Default: 1000
   */
  retryDelayMs?: number;

  /**
   * Firebase Auth instance to use for auth state changes.
   * Required to subscribe to onAuthStateChanged.
   */
  auth: Auth;
}

/**
 * Hook for synchronizing data streams with Firebase Auth state.
 *
 * Automatically manages stream lifecycle:
 * - Sets up stream when user signs in
 * - Tears down stream when user signs out
 * - Handles errors with automatic retry logic
 * - Provides reset/reinitialize capability
 *
 * Ports Flutter's TurboAuthSyncService pattern to React.
 *
 * @template T - The type of data being streamed
 * @param options - Configuration options for the auth sync
 *
 * @example
 * ```tsx
 * import { getAuth } from 'firebase/auth';
 * import { useState } from 'react';
 *
 * interface UserData {
 *   id: string;
 *   name: string;
 *   email: string;
 * }
 *
 * function useUserDataSync() {
 *   const [userData, setUserData] = useState<UserData | null>(null);
 *
 *   const { isReady, cachedUserId, resetAndReinitialize } = useAuthSync<UserData>({
 *     auth: getAuth(),
 *     stream: (user) => {
 *       // Return unsubscribe function from your API
 *       return userDataApi.streamDocByIdWithConverter(
 *         user.uid,
 *         (data) => setUserData(data),
 *         (error) => console.error('Stream error:', error)
 *       );
 *     },
 *     onData: (data, user) => {
 *       if (user) {
 *         console.log('User data updated:', data);
 *       } else {
 *         setUserData(null);
 *         console.log('User signed out');
 *       }
 *     },
 *     onAuth: async (user) => {
 *       console.log('User authenticated:', user.uid);
 *       // Perform any setup needed when user signs in
 *     },
 *     onError: (error) => {
 *       console.error('Auth sync error:', error);
 *     },
 *     maxRetries: 5,
 *     retryDelayMs: 2000,
 *   });
 *
 *   return { userData, isReady, cachedUserId, resetAndReinitialize };
 * }
 *
 * function App() {
 *   const { userData, isReady } = useUserDataSync();
 *
 *   if (!isReady) return <Loading />;
 *   if (!userData) return <LoginPage />;
 *
 *   return <Dashboard data={userData} />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Example with multiple streams
 * function useMultiStreamSync() {
 *   const auth = getAuth();
 *   const [profile, setProfile] = useState<UserProfile | null>(null);
 *   const [settings, setSettings] = useState<UserSettings | null>(null);
 *
 *   const profileSync = useAuthSync<UserProfile>({
 *     auth,
 *     stream: (user) => profileApi.streamUserProfile(user.uid, setProfile),
 *     onData: (data) => console.log('Profile updated:', data),
 *   });
 *
 *   const settingsSync = useAuthSync<UserSettings>({
 *     auth,
 *     stream: (user) => settingsApi.streamUserSettings(user.uid, setSettings),
 *     onData: (data) => console.log('Settings updated:', data),
 *   });
 *
 *   return {
 *     profile,
 *     settings,
 *     isReady: profileSync.isReady && settingsSync.isReady,
 *   };
 * }
 * ```
 */
export function useAuthSync<T>(options: UseAuthSyncOptions<T>): AuthSyncHook {
  const {
    stream,
    onData,
    onAuth,
    onError,
    onDone,
    maxRetries = 20,
    retryDelayMs = 1000,
    auth,
  } = options;

  const [isReady, setIsReady] = useState(false);
  const [cachedUserId, setCachedUserId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const streamUnsubscribeRef = useRef<Unsubscribe | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const isMountedRef = useRef(true);

  const cleanupStream = useCallback(() => {
    if (streamUnsubscribeRef.current) {
      streamUnsubscribeRef.current();
      streamUnsubscribeRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const handleStreamError = useCallback((error: TurboFirestoreException) => {
    if (!isMountedRef.current) return;

    if (onError) {
      onError(error);
    }

    setRetryCount(prev => {
      const newCount = prev + 1;

      if (newCount >= maxRetries) {
        setIsRetrying(false);
        if (onDone) {
          onDone(newCount, maxRetries);
        }
        return newCount;
      }

      setIsRetrying(true);
      retryTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current && currentUserRef.current) {
          setupStream(currentUserRef.current);
        }
      }, retryDelayMs);

      return newCount;
    });
  }, [onError, onDone, maxRetries, retryDelayMs]);

  const setupStream = useCallback(async (user: User) => {
    if (!isMountedRef.current) return;

    cleanupStream();

    try {
      if (onAuth) {
        await onAuth(user);
      }

      const unsubscribe = stream(user);
      streamUnsubscribeRef.current = unsubscribe;

      setIsReady(true);
      setRetryCount(0);
      setIsRetrying(false);
    } catch (error) {
      const firestoreError = error instanceof TurboFirestoreException
        ? error
        : new TurboFirestoreException(
            error instanceof Error ? error.message : 'Unknown stream setup error',
            'unknown',
            undefined,
            undefined,
            error instanceof Error ? error.stack : undefined
          );
      handleStreamError(firestoreError);
    }
  }, [stream, onAuth, cleanupStream, handleStreamError]);

  const handleSignOut = useCallback(async () => {
    if (!isMountedRef.current) return;

    cleanupStream();
    setCachedUserId(null);
    setIsReady(false);
    setRetryCount(0);
    setIsRetrying(false);
    currentUserRef.current = null;

    try {
      await onData(null, null);
    } catch (error) {
      console.error('Error in onData callback during sign out:', error);
    }

    if (onDone) {
      onDone(0, maxRetries);
    }
  }, [cleanupStream, onData, onDone, maxRetries]);

  const resetAndReinitialize = useCallback(async () => {
    if (!isMountedRef.current) return;

    cleanupStream();
    setRetryCount(0);
    setIsRetrying(false);

    if (currentUserRef.current) {
      await setupStream(currentUserRef.current);
    }
  }, [cleanupStream, setupStream]);

  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!isMountedRef.current) return;

      currentUserRef.current = user;

      if (user) {
        setCachedUserId(user.uid);
        await setupStream(user);
      } else {
        await handleSignOut();
      }
    });

    return () => {
      isMountedRef.current = false;
      cleanupStream();
      unsubscribeAuth();
    };
  }, [auth, setupStream, handleSignOut, cleanupStream]);

  return {
    isReady,
    cachedUserId,
    isRetrying,
    retryCount,
    resetAndReinitialize,
  };
}
