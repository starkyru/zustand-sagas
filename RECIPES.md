# Recipes

Common patterns and real-world recipes for zustand-sagas. Each recipe uses only existing primitives — no custom APIs needed.

## Table of Contents

- [Throttling](#throttling)
- [Debouncing](#debouncing)
- [Retrying API Calls](#retrying-api-calls)
- [Undo](#undo)
- [Batching State Updates](#batching-state-updates)
- [Auth Flow](#auth-flow)
- [Paginated Fetch with Cancel](#paginated-fetch-with-cancel)
- [WebSocket with Reconnect](#websocket-with-reconnect)
- [Optimistic Update with Rollback](#optimistic-update-with-rollback)
- [Parallel Fetch with Partial Failure](#parallel-fetch-with-partial-failure)
- [Request Deduplication](#request-deduplication)
- [Zero-Boilerplate Async with createAsyncSaga](#zero-boilerplate-async-with-createasyncsaga)
- [Standalone Async Saga (No AsyncSlice)](#standalone-async-saga-no-asyncslice)

## Throttling

Use the built-in `throttle` helper to process at most one action per interval:

```ts
const store = createStore((set) => ({
  query: '',
  inputChanged: (value: string) => set({ query: value }),
}));

createSaga(store, function* ({ throttle, call }) {
  yield throttle(500, 'inputChanged', function* (action) {
    yield call(doSearch, action.payload);
  });
});
```

The saga processes the first `inputChanged` action immediately, then ignores subsequent actions for 500ms before listening again.

## Debouncing

Use the built-in `debounce` helper:

```ts
const store = createStore((set) => ({
  query: '',
  results: [],
  inputChanged: (value: string) => set({ query: value }),
}));

createSaga(store, function* ({ debounce, call }) {
  yield debounce(500, 'inputChanged', function* (action) {
    const results = yield call(fetchResults, action.payload);
    yield call(() => store.setState({ results }));
  });
});
```

If the user keeps typing, the worker won't run until 500ms after the last keystroke.

### Manual debounce with takeLatest

You can achieve the same result with `takeLatest` and a `delay` inside the worker:

```ts
createSaga(store, function* ({ takeLatest, delay, call }) {
  yield takeLatest('inputChanged', function* (action) {
    yield delay(500);
    const results = yield call(fetchResults, action.payload);
    yield call(() => store.setState({ results }));
  });
});
```

`takeLatest` cancels the previous worker on each new action. The `delay` inside the worker acts as the debounce window — if cancelled before the delay completes, the search never runs.

### Manual debounce with fork and cancel

For full control over the debounce logic:

```ts
createSaga(store, function* ({ take, fork, cancel, delay, call }) {
  let task;
  while (true) {
    const action = yield take('inputChanged');
    if (task) {
      yield cancel(task);
    }
    task = yield fork(function* () {
      yield delay(500);
      const results = yield call(fetchResults, action.payload);
      yield call(() => store.setState({ results }));
    });
  }
});
```

## Retrying API Calls

### Retry with a limit

Use the built-in `retry` effect to retry an API call up to 5 times with a 2-second delay:

```ts
const store = createStore((set) => ({
  data: null,
  error: null,
  updateResource: (data: any) => {},
}));

createSaga(store, function* ({ takeEvery, retry, call }) {
  yield takeEvery('updateResource', function* (action) {
    try {
      const response = yield retry(5, 2000, apiRequest, action.payload);
      yield call(() => store.setState({ data: response, error: null }));
    } catch (error) {
      yield call(() => store.setState({ error: error.message }));
    }
  });
});
```

### Exponential backoff

The built-in `retry` uses fixed delays. For exponential backoff, compose the primitives yourself:

```ts
function* fetchWithBackoff(api, url: string, maxAttempts = 5) {
  const { call, delay } = api;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return yield call(fetch, url);
    } catch (e) {
      if (attempt === maxAttempts - 1) throw e;
      const backoff = Math.min(1000 * 2 ** attempt, 30000);
      yield delay(backoff + Math.random() * 1000);
    }
  }
}
```

Use it anywhere a `call` would go — it's just a generator:

```ts
createSaga(store, function* (api) {
  const { takeEvery, call } = api;
  yield takeEvery('syncData', function* () {
    const data = yield* fetchWithBackoff(api, '/api/sync');
    yield call(() => store.setState({ data }));
  });
});
```

### Unlimited retries with status updates

Retry indefinitely, updating the store on each failure so the UI can show retry status:

```ts
function* callWithUnlimitedRetry(fn, ...args) {
  while (true) {
    try {
      return yield call(fn, ...args);
    } catch (error) {
      yield call(() => store.setState({ retrying: true, lastError: error.message }));
      yield delay(2000);
    }
  }
}

createSaga(store, function* ({ takeLatest, call }) {
  yield takeLatest('updateResource', function* (action) {
    const response = yield call(callWithUnlimitedRetry, apiRequest, action.payload);
    yield call(() => store.setState({ data: response, retrying: false, error: null }));
  });
});
```

## Undo

Allow the user a window to undo an action before it's committed to the server. Uses `race` between an undo action and a timeout:

```ts
const store = createStore((set) => ({
  threads: {},
  undoVisible: false,
  archiveThread: (threadId: string) => {},
  undoArchive: () => {},
}));

createSaga(store, function* ({ take, spawn, race, delay, call }) {
  function* onArchive(action) {
    const threadId = action.payload;

    // Optimistically mark as archived
    yield call(() =>
      store.setState((s) => ({
        ...s,
        threads: { ...s.threads, [threadId]: { ...s.threads[threadId], archived: true } },
        undoVisible: true,
      })),
    );

    // Race: user undoes within 5 seconds, or the timeout wins
    const { undo } = yield race({
      undo: take('undoArchive'),
      commit: delay(5000),
    });

    yield call(() => store.setState({ undoVisible: false }));

    if (undo) {
      // Revert
      yield call(() =>
        store.setState((s) => ({
          ...s,
          threads: { ...s.threads, [threadId]: { ...s.threads[threadId], archived: false } },
        })),
      );
    } else {
      // Commit to server
      yield call(archiveThreadApi, threadId);
    }
  }

  while (true) {
    const action = yield take('archiveThread');
    // spawn so each archive operation runs independently
    yield spawn(onArchive, action);
  }
});
```

Key points:
- `race` runs `take('undoArchive')` and `delay(5000)` concurrently — first to complete wins
- `spawn` (not `fork`) so each archive operation has an independent lifecycle
- The state is updated optimistically before the race, then reverted or committed based on the outcome

## Batching State Updates

Unlike Redux, Zustand doesn't have reducers — state updates are direct function calls. There's no need for a batching library. If you need to update multiple pieces of state atomically, just do it in one `setState` call:

```ts
yield call(() =>
  store.setState({
    loading: false,
    data: response,
    error: null,
    lastUpdated: Date.now(),
  }),
);
```

Zustand's `setState` merges all properties in a single synchronous update, so subscribers are notified only once.

## Auth Flow

A complete authentication lifecycle: login, automatic token refresh before expiry, and clean logout that cancels everything. With a cache layer you'd need custom middleware for the refresh loop and race-condition guards — here it's a single readable generator.

```ts
const store = createStore((set, get) => ({
  user: null,
  token: null,
  authError: null,
  isAuthenticating: false,
  login: (email: string, password: string) => {},
  logout: () => set({ user: null, token: null }),
  tokenRefreshed: (token: string) => set({ token }),
}));

createSaga(store, function* ({ take, call, fork, cancel, race, delay, select }) {
  // Refresh token loop — runs in the background after login
  function* refreshLoop(expiresIn: number) {
    while (true) {
      // Refresh 60s before expiry
      yield delay((expiresIn - 60) * 1000);
      try {
        const currentToken = yield select((s) => s.token);
        const { token, expiresIn: newExp } = yield call(refreshToken, currentToken);
        yield call(() => store.setState({ token }));
        expiresIn = newExp;
      } catch {
        // Refresh failed — force logout
        yield call(() => store.getState().logout());
        return;
      }
    }
  }

  while (true) {
    const { payload: [email, password] } = yield take('login');
    yield call(() => store.setState({ isAuthenticating: true, authError: null }));

    try {
      const { user, token, expiresIn } = yield call(loginApi, email, password);
      yield call(() => store.setState({ user, token, isAuthenticating: false }));

      // Fork the refresh loop, then wait for logout
      const refreshTask = yield fork(refreshLoop, expiresIn);
      yield take('logout');
      yield cancel(refreshTask);
    } catch (e) {
      yield call(() =>
        store.setState({ authError: e.message, isAuthenticating: false }),
      );
    }
  }
});
```

The entire auth state machine — login attempt, background refresh, logout teardown — lives in one generator. No leaked timers, no stale refresh racing a logout.

## Paginated Fetch with Cancel

Cursor-based pagination where navigating away cancels in-flight requests and partial results. `takeLatest` handles the cancellation automatically — start a new search, the old one dies. RTK Query pagination requires manual cache key juggling and has no built-in concept of "user left, stop fetching".

```ts
const store = createStore((set) => ({
  items: [],
  cursor: null,
  hasMore: true,
  isLoading: false,
  error: null,
  search: (query: string) => set({ items: [], cursor: null, hasMore: true }),
  loadMore: () => {},
  cancelSearch: () => {},
}));

createSaga(store, function* ({ takeLatest, take, call, select, race, delay }) {
  yield takeLatest('search', function* (action) {
    const query = action.payload;

    // Fetch pages until exhausted or cancelled
    while (true) {
      const { hasMore } = yield select();
      if (!hasMore) return;

      yield call(() => store.setState({ isLoading: true, error: null }));

      try {
        const { cursor } = yield select();
        const { data, nextCursor } = yield call(fetchPage, query, cursor);

        yield call(() =>
          store.setState((s) => ({
            ...s,
            items: [...s.items, ...data],
            cursor: nextCursor,
            hasMore: nextCursor != null,
            isLoading: false,
          })),
        );

        if (!nextCursor) return;

        // Wait for explicit "load more" or cancel
        const { more } = yield race({
          more: take('loadMore'),
          cancel: take('cancelSearch'),
        });
        if (!more) return; // cancelled
      } catch (e) {
        yield call(() => store.setState({ error: e.message, isLoading: false }));
        return;
      }
    }
  });
});

// Usage: user types a new query → old pagination dies, new one starts
store.getState().search('zustand');       // starts fetching page 1
store.getState().loadMore();              // fetches page 2
store.getState().search('zustand sagas'); // cancels page 2, starts fresh
```

## WebSocket with Reconnect

Exponential backoff reconnection with jitter — the socket drops, the saga reconnects, and the component never knows. Event channels turn the WebSocket into a pull-based stream; `race` adds the timeout. Compare this to writing a custom `baseQuery` with reconnect logic in RTK Query.

```ts
import { eventChannel, END } from 'zustand-sagas';

const store = createStore((set) => ({
  messages: [],
  status: 'disconnected' as 'disconnected' | 'connecting' | 'connected',
  connect: (url: string) => {},
  disconnect: () => {},
  send: (msg: unknown) => {},
}));

function createWsChannel(url: string) {
  let ws: WebSocket;
  const chan = eventChannel<{ type: string; data?: unknown }>((emit) => {
    ws = new WebSocket(url);
    ws.onopen = () => emit({ type: 'open' });
    ws.onmessage = (e) => emit({ type: 'message', data: JSON.parse(e.data) });
    ws.onerror = () => emit({ type: 'error' });
    ws.onclose = () => emit(END);
    return () => ws.close();
  });
  return { chan, getWs: () => ws };
}

createSaga(store, function* ({ take, fork, call, cancel, race, delay, takeMaybe }) {
  function* handleConnection(url: string) {
    let attempt = 0;

    while (true) {
      yield call(() => store.setState({ status: 'connecting' }));
      const { chan, getWs } = createWsChannel(url);

      // Race: either the socket opens or we timeout
      const first = yield takeMaybe(chan);
      if (first === END) {
        // Connection failed immediately — backoff and retry
        const backoff = Math.min(1000 * 2 ** attempt, 30000);
        const jitter = Math.random() * backoff * 0.3;
        yield delay(backoff + jitter);
        attempt++;
        continue;
      }

      // Connected
      attempt = 0;
      yield call(() => store.setState({ status: 'connected' }));

      // Read messages until the channel closes (socket dropped)
      while (true) {
        const event = yield takeMaybe(chan);
        if (event === END) break;
        if (event.type === 'message') {
          yield call(() =>
            store.setState((s) => ({
              ...s,
              messages: [...s.messages, event.data],
            })),
          );
        }
      }

      // Socket closed — loop back to reconnect
      yield call(() => store.setState({ status: 'disconnected' }));
    }
  }

  while (true) {
    const { payload: url } = yield take('connect');
    const connTask = yield fork(handleConnection, url);
    yield take('disconnect');
    yield cancel(connTask);
    yield call(() => store.setState({ status: 'disconnected' }));
  }
});
```

Calling `disconnect()` cancels the entire connection loop — including any pending backoff delay. Calling `connect()` again starts fresh.

## Optimistic Update with Rollback

Apply the mutation instantly, then confirm or rollback. This is where generators shine: the happy path reads top-to-bottom, and the rollback is just a `catch` block. No `onQueryStarted` / `updateQueryData` / `patchResult` ceremony.

```ts
const store = createStore((set, get) => ({
  todos: [] as Todo[],
  toggleTodo: (id: string) => {},
  deleteTodo: (id: string) => {},
}));

createSaga(store, function* ({ takeEvery, call, select }) {
  // Optimistic toggle
  yield takeEvery('toggleTodo', function* (action) {
    const id = action.payload;
    const snapshot = yield select((s) => s.todos);

    // Apply optimistically
    yield call(() =>
      store.setState((s) => ({
        ...s,
        todos: s.todos.map((t) =>
          t.id === id ? { ...t, done: !t.done } : t,
        ),
      })),
    );

    try {
      const todo = snapshot.find((t) => t.id === id);
      yield call(updateTodoApi, id, { done: !todo.done });
    } catch {
      // Rollback to snapshot
      yield call(() => store.setState({ todos: snapshot }));
    }
  });

  // Optimistic delete
  yield takeEvery('deleteTodo', function* (action) {
    const id = action.payload;
    const snapshot = yield select((s) => s.todos);

    yield call(() =>
      store.setState((s) => ({
        ...s,
        todos: s.todos.filter((t) => t.id !== id),
      })),
    );

    try {
      yield call(deleteTodoApi, id);
    } catch {
      yield call(() => store.setState({ todos: snapshot }));
    }
  });
});
```

For high-frequency mutations (drag-to-reorder, collaborative editing), combine with `actionChannel` and `buffers.sliding` to coalesce rapid updates into batched server calls without losing the optimistic UX:

```ts
createSaga(store, function* ({ actionChannel, take, call, select, delay }) {
  const chan = yield actionChannel('reorderTodo', buffers.sliding(1));

  while (true) {
    const action = yield take(chan);
    // Optimistic reorder already applied by the store action
    // Debounce: wait for rapid drags to settle
    yield delay(300);
    const currentOrder = yield select((s) => s.todos.map((t) => t.id));
    yield call(saveOrderApi, currentOrder);
  }
});
```

## Parallel Fetch with Partial Failure

Load a dashboard where some panels can fail without blocking the rest. `allSettled` handles this cleanly — no wrapper functions, no per-query error boundaries in the data layer.

```ts
const store = createStore((set) => ({
  metrics: null,
  alerts: null,
  activity: null,
  errors: {} as Record<string, string>,
  loadDashboard: () => {},
}));

createSaga(store, function* ({ takeLeading, allSettled, call }) {
  yield takeLeading('loadDashboard', function* () {
    const [metrics, alerts, activity] = yield allSettled([
      call(fetchMetrics),
      call(fetchAlerts),
      call(fetchActivity),
    ]);

    const errors: Record<string, string> = {};
    const state: Record<string, unknown> = { errors };

    if (metrics.status === 'fulfilled') state.metrics = metrics.value;
    else errors.metrics = metrics.reason?.message ?? 'Failed to load';

    if (alerts.status === 'fulfilled') state.alerts = alerts.value;
    else errors.alerts = alerts.reason?.message ?? 'Failed to load';

    if (activity.status === 'fulfilled') state.activity = activity.value;
    else errors.activity = activity.reason?.message ?? 'Failed to load';

    yield call(() => store.setState(state));
  });
});
```

## Request Deduplication

Multiple components trigger the same fetch — only one network request fires. Use `takeLeading` for simple dedup, or a manual cache for time-based staleness.

```ts
const store = createStore((set) => ({
  users: {} as Record<string, User>,
  fetchUser: (id: string) => {},
}));

createSaga(store, function* ({ actionChannel, take, call, select }) {
  const chan = yield actionChannel('fetchUser');
  const inflight = new Set<string>();

  while (true) {
    const { payload: id } = yield take(chan);

    // Skip if already fetching or cached
    const cached = yield select((s) => s.users[id]);
    if (cached || inflight.has(id)) continue;

    inflight.add(id);
    try {
      const user = yield call(fetchUserApi, id);
      yield call(() =>
        store.setState((s) => ({
          ...s,
          users: { ...s.users, [id]: user },
        })),
      );
    } finally {
      inflight.delete(id);
    }
  }
});
```

## Zero-Boilerplate Async with createAsyncSaga

For standard fetch-and-settle flows, `createAsyncSaga` + `createAsyncSlice` eliminates all the generator boilerplate. You get loading, error, and success states with typed actions — zero manual wiring.

```ts
import { createStore } from 'zustand/vanilla';
import { createSaga, createAsyncSlice, createAsyncSaga, type AsyncSlice } from 'zustand-sagas';

type Store = AsyncSlice<'user', User, [id: string]> &
  AsyncSlice<'posts', Post[], [userId: string]>;

const store = createStore<Store>((set) => ({
  ...createAsyncSlice<'user', User, [id: string]>('user', set),
  ...createAsyncSlice<'posts', Post[], [userId: string]>('posts', set),
}));

const userSaga = createAsyncSaga(store, 'user', fetchUser);
const postsSaga = createAsyncSaga(store, 'posts', fetchPosts, {
  strategy: 'takeEvery',  // allow concurrent fetches
});

createSaga(store, function* (api) {
  yield* userSaga(api);
  yield* postsSaga(api);
});

// Usage:
store.getState().fetchUser('42');
// → isUserLoading: true
// → user: { id: '42', name: '...' }, isUserSuccess: true

store.getState().fetchPosts('42');
// → isPostsLoading: true
// → posts: [...], isPostsSuccess: true
```

### With retries and transform

```ts
const searchSaga = createAsyncSaga(store, 'results', searchApi, {
  strategy: 'debounce',
  debounceMs: 300,
  retries: 2,
  retryDelay: 500,
  transform: (raw) => raw.data.items,
  onSuccess: function* (data, api) {
    // Run extra effects after success
    yield api.call(() => console.log(`Loaded ${data.length} items`));
  },
});
```

### When to use createAsyncSaga vs a manual saga

| Use `createAsyncSaga` when...     | Write a manual saga when...         |
|-----------------------------------|-------------------------------------|
| Standard fetch → set data/error   | Multi-step flows (login → refresh)  |
| You want built-in loading states   | Conditional/dependent fetches       |
| Retry/debounce via config          | Complex cancellation patterns       |
| Minimal code is the goal           | Full control over every effect      |

## Standalone Async Saga (No AsyncSlice)

If you don't want `AsyncSlice` or already have your own store shape, use the standalone config form. Point it at any trigger action and settlement actions on your store.

### String-based settlement

```ts
const store = createStore((set) => ({
  profile: null,
  profileError: null,
  loadProfile: (id: string) => {},
  setProfile: (data: Profile) => set({ profile: data, profileError: null }),
  setProfileError: (msg: string) => set({ profileError: msg, profile: null }),
}));

const saga = createAsyncSaga(store, {
  trigger: 'loadProfile',
  fetch: async (id: string) => {
    const res = await fetch(`/api/profiles/${id}`);
    return res.json();
  },
  onSuccess: 'setProfile',
  onError: 'setProfileError',
});

createSaga(store, saga);
store.getState().loadProfile('abc');
// → calls fetch → calls setProfile(data) or setProfileError(message)
```

### Generator-based settlement

For more control, pass generator functions instead of strings:

```ts
const saga = createAsyncSaga(store, {
  trigger: 'loadProfile',
  fetch: fetchProfile,
  onSuccess: function* (data, api) {
    yield api.call(() => store.setState({ profile: data }));
    yield api.put('profileLoaded');  // notify other sagas
  },
  onError: function* (error, api) {
    yield api.call(() => store.setState({ profileError: error.message }));
    if (error.message.includes('401')) {
      yield api.put('forceLogout');
    }
  },
});
```

### With options

All options from the AsyncSlice mode work in standalone mode too:

```ts
const saga = createAsyncSaga(store, {
  trigger: 'search',
  fetch: searchApi,
  onSuccess: 'setResults',
  strategy: 'debounce',
  debounceMs: 300,
  retries: 2,
  retryDelay: 500,
  transform: (raw) => raw.hits,
});
```
