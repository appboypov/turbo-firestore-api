import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User, Auth } from 'firebase/auth';
import { FirebaseAuthService } from './FirebaseAuthService';
import { TurboFirestoreException } from '../exceptions/TurboFirestoreException';

// Mock firebase/auth
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
}));

import { onAuthStateChanged } from 'firebase/auth';

const mockOnAuthStateChanged = vi.mocked(onAuthStateChanged);

// Concrete implementation for testing
class TestFirebaseAuthService extends FirebaseAuthService<string> {
  public streamCalls: Array<{ user: User }> = [];
  public onDataCalls: Array<{ value: string | null; user: User | null }> = [];
  public onAuthCalls: Array<{ user: User }> = [];
  public onErrorCalls: Array<{ error: TurboFirestoreException }> = [];
  public onDoneCalls: Array<{ nrOfRetry: number; maxNrOfRetry: number }> = [];

  private _mockUnsubscribe = vi.fn();
  private _onValueCallback: ((value: string | null) => void) | null = null;
  private _onErrorCallback:
    | ((error: unknown, stackTrace?: string) => void)
    | null = null;

  stream(
    user: User,
    onValue: (value: string | null) => void,
    onError: (error: unknown, stackTrace?: string) => void
  ) {
    this.streamCalls.push({ user });
    this._onValueCallback = onValue;
    this._onErrorCallback = onError;
    return this._mockUnsubscribe;
  }

  async onData(value: string | null, user: User | null): Promise<void> {
    this.onDataCalls.push({ value, user });
  }

  override onAuth(user: User): void {
    this.onAuthCalls.push({ user });
  }

  override onError(error: TurboFirestoreException): void {
    this.onErrorCalls.push({ error });
  }

  override onDone(nrOfRetry: number, maxNrOfRetry: number): void {
    this.onDoneCalls.push({ nrOfRetry, maxNrOfRetry });
  }

  // Test helpers
  emitValue(value: string | null) {
    this._onValueCallback?.(value);
  }

  emitError(error: unknown) {
    this._onErrorCallback?.(error);
  }

  getMockUnsubscribe() {
    return this._mockUnsubscribe;
  }
}

describe('FirebaseAuthService', () => {
  let mockAuth: Auth;
  let mockUnsubscribeAuth: ReturnType<typeof vi.fn>;
  let authStateCallback: ((user: User | null) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockAuth = {} as Auth;
    mockUnsubscribeAuth = vi.fn();

    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      authStateCallback = callback as (user: User | null) => void;
      return mockUnsubscribeAuth;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    authStateCallback = null;
  });

  const createMockUser = (uid: string): User =>
    ({
      uid,
      email: `${uid}@test.com`,
    }) as User;

  describe('constructor', () => {
    it('should initialize stream by default', () => {
      new TestFirebaseAuthService({ auth: mockAuth });

      expect(mockOnAuthStateChanged).toHaveBeenCalledWith(
        mockAuth,
        expect.any(Function)
      );
    });

    it('should not initialize stream when initialiseStream is false', () => {
      new TestFirebaseAuthService({
        auth: mockAuth,
        initialiseStream: false,
      });

      expect(mockOnAuthStateChanged).not.toHaveBeenCalled();
    });
  });

  describe('tryInitialiseStream', () => {
    it('should only create one auth subscription when called multiple times', async () => {
      const service = new TestFirebaseAuthService({
        auth: mockAuth,
        initialiseStream: false,
      });

      await service.tryInitialiseStream();
      await service.tryInitialiseStream();

      expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
    });
  });

  describe('auth state changes', () => {
    it('should set cachedUserId and call onAuth when user signs in', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);

      expect(service.cachedUserId).toBe('user-123');
      expect(service.onAuthCalls).toHaveLength(1);
      expect(service.onAuthCalls[0].user).toBe(mockUser);
    });

    it('should set up stream when user signs in', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);

      expect(service.streamCalls).toHaveLength(1);
      expect(service.streamCalls[0].user).toBe(mockUser);
    });

    it('should only create one stream subscription when auth fires multiple times', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      await authStateCallback?.(mockUser);

      expect(service.streamCalls).toHaveLength(1);
    });

    it('should clear cachedUserId and call onData with null when user signs out', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      await authStateCallback?.(null);

      expect(service.cachedUserId).toBeNull();
      expect(service.onDataCalls).toContainEqual({ value: null, user: null });
    });

    it('should unsubscribe from stream when user signs out', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      const mockUnsubscribe = service.getMockUnsubscribe();

      await authStateCallback?.(null);

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('stream data handling', () => {
    it('should call onData when stream emits value', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      service.emitValue('test-data');

      await vi.runAllTimersAsync();

      expect(service.onDataCalls).toContainEqual({
        value: 'test-data',
        user: mockUser,
      });
    });
  });

  describe('error handling', () => {
    it('should call onError when stream emits error', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      service.emitError(new Error('Test error'));

      expect(service.onErrorCalls).toHaveLength(1);
    });

    it('should convert non-TurboFirestoreException errors', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      service.emitError(new Error('Generic error'));

      expect(service.onErrorCalls[0].error).toBeInstanceOf(
        TurboFirestoreException
      );
    });

    it('should pass through TurboFirestoreException errors', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');
      const exception = new TurboFirestoreException(
        'Test',
        'test-code',
        '/path'
      );

      await authStateCallback?.(mockUser);
      service.emitError(exception);

      expect(service.onErrorCalls[0].error).toBe(exception);
    });
  });

  describe('retry logic', () => {
    it('should retry after 10 seconds on error', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      service.emitError(new Error('Test error'));

      expect(service.streamCalls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(10000);

      // Stream should be called again after retry
      expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(2);
    });

    it('should stop retrying after max retries reached', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);

      // Trigger 20 retries (max)
      for (let i = 0; i < 20; i++) {
        service.emitError(new Error('Test error'));
        await vi.advanceTimersByTimeAsync(10000);
        // Re-setup the user for the next iteration
        if (i < 19) {
          await authStateCallback?.(mockUser);
        }
      }

      // Should not retry after max
      service.emitError(new Error('Test error'));
      const callsBefore = mockOnAuthStateChanged.mock.calls.length;

      await vi.advanceTimersByTimeAsync(10000);

      expect(mockOnAuthStateChanged.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('dispose', () => {
    it('should unsubscribe from auth listener', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });

      await service.dispose();

      expect(mockUnsubscribeAuth).toHaveBeenCalled();
    });

    it('should unsubscribe from stream', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      const mockUnsubscribe = service.getMockUnsubscribe();

      await service.dispose();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should reset retry count', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      service.emitError(new Error('Test error'));
      await vi.advanceTimersByTimeAsync(10000);

      await service.dispose();

      // After dispose, retry count should be 0
      // We can verify by checking that a new init doesn't think we're at max retries
      await service.tryInitialiseStream();
      await authStateCallback?.(mockUser);
      service.emitError(new Error('Test error'));

      // Should still retry (not at max)
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockOnAuthStateChanged.mock.calls.length).toBeGreaterThan(2);
    });
  });

  describe('resetAndTryInitialiseStream', () => {
    it('should reset and reinitialize the stream', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      const initialCallCount = mockOnAuthStateChanged.mock.calls.length;

      await service.resetAndTryInitialiseStream();

      expect(mockOnAuthStateChanged.mock.calls.length).toBe(
        initialCallCount + 1
      );
    });

    it('should unsubscribe from previous subscriptions', async () => {
      const service = new TestFirebaseAuthService({ auth: mockAuth });
      const mockUser = createMockUser('user-123');

      await authStateCallback?.(mockUser);
      const mockUnsubscribe = service.getMockUnsubscribe();

      await service.resetAndTryInitialiseStream();

      expect(mockUnsubscribeAuth).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
