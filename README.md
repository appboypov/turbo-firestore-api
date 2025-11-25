# turbo-firestore-api

Type-safe Firestore API wrapper with CRUD operations, real-time streaming, and optimistic updates for React.

## Installation

```bash
npm install turbo-firestore-api
```

### Peer Dependencies

```bash
npm install firebase react
```

### Dependencies

This package uses:
- `turbo-response` - Type-safe result handling
- `informers` - Reactive state management
- `veto-mvvm` - ViewModel pattern and DI

## Features

- **Type-safe CRUD operations** with full TypeScript support
- **Real-time streaming** with automatic synchronization
- **Optimistic updates** for instant UI feedback
- **Automatic rollback** on API failures
- **Batch operations** for multiple documents
- **Auth-synced streams** that restart on user changes
- **O(1) document lookup** with ID-based maps
- **Local-only operations** for temporary state

## Quick Start

```tsx
import { useTurboCollection, useAuthSync } from 'turbo-firestore-api';
import { TurboFirestoreApi } from 'turbo-firestore-api';
import { isSuccess } from 'turbo-response';

// Define your document type
interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  toJson(): Record<string, unknown>;
}

// Create API instance
const usersApi = new TurboFirestoreApi<UserDto>({
  firestore,
  collectionPath: () => 'users',
  fromJson: (json) => ({
    id: json.id as string,
    name: json.name as string,
    email: json.email as string,
    createdAt: (json.createdAt as any).toDate(),
    updatedAt: (json.updatedAt as any).toDate(),
    toJson() {
      return { name: this.name, email: this.email };
    },
  }),
});

// Use in component
function UserList() {
  const { docs, isReady, createDoc, updateDoc, deleteDoc } = useTurboCollection({
    api: usersApi,
    getUserId: () => auth.currentUser?.uid ?? null,
  });

  if (!isReady) return <Loading />;

  return (
    <ul>
      {docs.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

## API

### `useTurboCollection<T>(options): TurboCollectionHook<T>`

Hook for managing a Firestore collection with real-time updates and CRUD operations.

#### Options

| Property | Type | Description |
|----------|------|-------------|
| `api` | `TurboFirestoreApi<T>` | The API instance for the collection |
| `getUserId` | `() => string \| null` | Function to get current user ID |
| `onDocsChanged` | `(docs: T[]) => void` | Optional callback when documents change |
| `onError` | `(error: TurboFirestoreException) => void` | Optional error callback |
| `initialDocs` | `T[]` | Optional initial documents (for SSR) |

#### Returns

**State:**

| Property | Type | Description |
|----------|------|-------------|
| `docs` | `T[]` | Array of all documents |
| `docsById` | `Map<string, T>` | Documents indexed by ID |
| `isReady` | `boolean` | Whether initial load is complete |
| `hasDocs` | `boolean` | Whether collection has any documents |

**Lookup Methods:**

| Method | Type | Description |
|--------|------|-------------|
| `findById` | `(id: string) => T` | Find document by ID (throws if not found) |
| `tryFindById` | `(id: string \| null) => T \| null` | Safe lookup (returns null) |
| `exists` | `(id: string) => boolean` | Check if document exists |

**CRUD Operations (with optimistic updates):**

| Method | Description |
|--------|-------------|
| `createDoc(def)` | Create a new document |
| `updateDoc(id, def)` | Update existing document |
| `upsertDoc(id, def)` | Create or update document |
| `deleteDoc(id)` | Delete document |

**Batch Operations:**

| Method | Description |
|--------|-------------|
| `createDocs(defs)` | Create multiple documents |
| `updateDocs(updates)` | Update multiple documents |
| `deleteDocs(ids)` | Delete multiple documents |

**Local Operations (no API call):**

| Method | Description |
|--------|-------------|
| `createLocalDoc(def)` | Create document locally only |
| `updateLocalDoc(id, def)` | Update document locally only |
| `deleteLocalDoc(id)` | Delete document locally only |

**Utilities:**

| Method | Description |
|--------|-------------|
| `rebuild()` | Force refresh the collection |

#### Example: CRUD Operations

```tsx
function TaskManager() {
  const { docs, createDoc, updateDoc, deleteDoc, tryFindById } = useTurboCollection({
    api: tasksApi,
    getUserId: () => currentUserId,
    onError: (error) => toast.error(error.message),
  });

  // Create
  const handleCreate = async () => {
    const response = await createDoc((vars) => ({
      id: vars.id,
      title: 'New Task',
      completed: false,
      createdAt: vars.now,
      updatedAt: vars.now,
      createdBy: vars.userId,
      toJson() {
        return { title: this.title, completed: this.completed };
      },
    }));

    if (isSuccess(response)) {
      console.log('Created:', response.result.id);
    }
  };

  // Update with optimistic UI
  const toggleComplete = async (taskId: string) => {
    const task = tryFindById(taskId);
    if (!task) return;

    // UI updates immediately, rolls back if API fails
    await updateDoc(taskId, (current, vars) => ({
      ...current,
      completed: !current.completed,
      updatedAt: vars.now,
    }));
  };

  // Delete
  const handleDelete = async (taskId: string) => {
    await deleteDoc(taskId);
  };

  return (
    <ul>
      {docs.map(task => (
        <li key={task.id}>
          <input
            type="checkbox"
            checked={task.completed}
            onChange={() => toggleComplete(task.id)}
          />
          {task.title}
          <button onClick={() => handleDelete(task.id)}>Delete</button>
        </li>
      ))}
      <button onClick={handleCreate}>Add Task</button>
    </ul>
  );
}
```

#### Example: Batch Operations

```tsx
function BulkActions() {
  const { docs, updateDocs, deleteDocs } = useTurboCollection({
    api: itemsApi,
    getUserId: () => currentUserId,
  });

  const markAllComplete = async () => {
    const updates = docs
      .filter(item => !item.completed)
      .map(item => ({
        id: item.id,
        def: (current, vars) => ({
          ...current,
          completed: true,
          updatedAt: vars.now,
        }),
      }));

    await updateDocs(updates);
  };

  const deleteSelected = async (selectedIds: string[]) => {
    await deleteDocs(selectedIds);
  };

  return (
    <div>
      <button onClick={markAllComplete}>Complete All</button>
    </div>
  );
}
```

### `useAuthSync<T>(options): AuthSyncHook`

Hook for synchronizing data streams with Firebase Auth state. Automatically manages stream lifecycle based on user authentication.

#### Options

| Property | Type | Description |
|----------|------|-------------|
| `auth` | `Auth` | Firebase Auth instance |
| `stream` | `(user: User) => Unsubscribe` | Function to setup stream for user |
| `onData` | `(value: T \| null, user: User \| null) => void` | Data callback |
| `onAuth` | `(user: User) => void` | Optional callback when user signs in |
| `onError` | `(error: TurboFirestoreException) => void` | Optional error callback |
| `onDone` | `(retryCount, maxRetries) => void` | Optional completion callback |
| `maxRetries` | `number` | Max retry attempts (default: 20) |
| `retryDelayMs` | `number` | Delay between retries (default: 1000) |

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `isReady` | `boolean` | Whether stream has completed initial load |
| `cachedUserId` | `string \| null` | Current user ID |
| `isRetrying` | `boolean` | Whether currently retrying |
| `retryCount` | `number` | Current retry count |
| `resetAndReinitialize` | `() => Promise<void>` | Reset and restart stream |

#### Example

```tsx
function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const { isReady, cachedUserId, resetAndReinitialize } = useAuthSync<UserProfile>({
    auth: getAuth(),
    stream: (user) => {
      return profileApi.streamDocByIdWithConverter(
        user.uid,
        (data) => setProfile(data),
        (error) => console.error(error)
      );
    },
    onData: (data, user) => {
      if (!user) {
        setProfile(null);
      }
    },
    onAuth: async (user) => {
      console.log('User signed in:', user.uid);
    },
    maxRetries: 5,
    retryDelayMs: 2000,
  });

  return { profile, isReady, cachedUserId, resetAndReinitialize };
}

function App() {
  const { profile, isReady } = useUserProfile();

  if (!isReady) return <Loading />;
  if (!profile) return <LoginPage />;

  return <Dashboard profile={profile} />;
}
```

## Patterns

### Optimistic Updates with Rollback

All CRUD operations in `useTurboCollection` are optimistic by default:

1. UI updates immediately with the new state
2. API call is made in the background
3. If API fails, state is rolled back to previous value

```tsx
const toggleTask = async (taskId: string) => {
  // Immediately updates local state
  const response = await updateDoc(taskId, (current, vars) => ({
    ...current,
    completed: !current.completed,
    updatedAt: vars.now,
  }));

  // If API call failed, state was automatically rolled back
  if (!isSuccess(response)) {
    toast.error('Failed to update task');
  }
};
```

### Local-Only State for Drafts

Use local operations for temporary state that shouldn't persist:

```tsx
function DraftEditor() {
  const { createLocalDoc, updateLocalDoc, createDoc } = useTurboCollection({
    api: draftsApi,
    getUserId: () => currentUserId,
  });

  // Create local draft (no API call)
  const draft = createLocalDoc((vars) => ({
    id: vars.id,
    content: '',
    createdAt: vars.now,
    updatedAt: vars.now,
    toJson() { return { content: this.content }; },
  }));

  // Update locally while typing
  const handleChange = (content: string) => {
    updateLocalDoc(draft.id, (current, vars) => ({
      ...current,
      content,
      updatedAt: vars.now,
    }));
  };

  // Persist to API when saving
  const handleSave = async () => {
    await createDoc((vars) => draft);
  };
}
```

### Multiple Auth-Synced Streams

```tsx
function useAppData() {
  const auth = getAuth();
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);

  const profileSync = useAuthSync({
    auth,
    stream: (user) => profileApi.stream(user.uid, setProfile),
    onData: (data) => !data && setProfile(null),
  });

  const settingsSync = useAuthSync({
    auth,
    stream: (user) => settingsApi.stream(user.uid, setSettings),
    onData: (data) => !data && setSettings(null),
  });

  return {
    profile,
    settings,
    isReady: profileSync.isReady && settingsSync.isReady,
  };
}
```

## License

MIT
