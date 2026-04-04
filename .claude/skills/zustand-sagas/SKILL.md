---
name: zustand-sagas
description: Help write code using zustand-sagas — generator-based side effects for Zustand. Use when implementing sagas, effects, async flows, channels, or workers with zustand-sagas.
allowed-tools: Read Grep Glob
argument-hint: "[what to build — e.g. 'auth flow', 'search with debounce', 'websocket reconnect']"
---

You are helping the user write code with **zustand-sagas**, a generator-based side effect library for Zustand (inspired by redux-saga).

## Key rules

1. **Always use `yield*`** (yield-star), not `yield`, for all effects. This gives full TypeScript type inference.
2. **Annotate saga return types** with `Saga` or `Saga<ReturnType>` from `zustand-sagas`.
3. **State mutations go in store actions**, not in sagas. Use `yield* call(() => store.setState(...))` to update state from sagas.
4. **`put` emits to the saga channel** — it does NOT call the store action directly.
5. **Store function names are action types** — no string constants, no action creators, no dispatch.

## Template: basic saga setup

```ts
import { createStore } from 'zustand/vanilla';
import { createSaga } from 'zustand-sagas';
import type { Saga } from 'zustand-sagas';

// 1. Define store with actions
const store = createStore((set) => ({
  // data
  count: 0,
  // actions (these become saga action types)
  increment: () => set((s) => ({ ...s, count: s.count + 1 })),
  fetchData: (id: string) => {},  // empty = saga-only trigger
}));

// 2. Attach sagas
createSaga(store, function* ({ takeEvery, call, select, delay }): Saga {
  yield* takeEvery('fetchData', function* (action): Saga {
    const id = action.payload; // typed from fetchData's params
    const data = yield* call(fetchApi, id);
    yield* call(() => store.setState({ data }));
  });
});

// 3. Trigger from anywhere
store.getState().fetchData('123');
```

## Effect quick reference (always use yield*)

```ts
// Wait for action
const action = yield* take('actionName');

// Wait for any of several actions
const action = yield* take(['action1', 'action2']);

// Read state
const value = yield* select((s) => s.someField);
const fullState = yield* select();

// Call function (async or sync or generator)
const result = yield* call(myFunction, arg1, arg2);

// Update state from saga
yield* call(() => store.setState({ key: value }));

// Fork (attached child — errors propagate, parent cancel cascades)
const task = yield* fork(childSaga, ...args);

// Spawn (detached — independent lifecycle)
const task = yield* spawn(childSaga, ...args);

// Wait for task
const result = yield* join(task);

// Cancel task
yield* cancel(task);

// Delay
yield* delay(1000);

// Race — first to complete wins
const winner = yield* race({
  data: call(fetchApi),
  timeout: delay(5000),
});
if (winner.timeout !== undefined) { /* timed out */ }

// Parallel — wait for all
const [users, posts] = yield* all([call(fetchUsers), call(fetchPosts)]);

// Parallel with partial failure
const results = yield* allSettled([call(a), call(b)]);
// results[i].status === 'fulfilled' | 'rejected'

// Retry
const data = yield* retry(3, 1000, fetchApi, '/endpoint');

// Emit action to saga channel
yield* put('actionName', ...args);

// Buffer actions
const chan = yield* actionChannel('rapidAction');
while (true) {
  const action = yield* take(chan);
  yield* call(process, action.payload);
}

// Wait for state condition
yield* until((s) => s.ready === true);
yield* until('ready', 5000); // with timeout

// Flush buffered channel messages
const messages = yield* flush(chan);
```

## Helpers (fork internal watcher loops)

```ts
yield* takeEvery('action', workerSaga);     // every action, concurrent
yield* takeLatest('action', workerSaga);    // cancel previous on new
yield* takeLeading('action', workerSaga);   // ignore while running
yield* debounce(300, 'action', workerSaga); // wait after last
yield* throttle(500, 'action', workerSaga); // at most one per interval
```

## Channels

```ts
import { channel, multicastChannel, eventChannel, END } from 'zustand-sagas';

// Point-to-point
const chan = channel<string>();
chan.put('hello');
const msg = yield* take(chan);

// Broadcast
const multi = multicastChannel<string>();

// External events (WebSocket, DOM, etc.)
const wsChan = eventChannel<Message>((emit) => {
  const ws = new WebSocket(url);
  ws.onmessage = (e) => emit(JSON.parse(e.data));
  ws.onclose = () => emit(END);
  return () => ws.close();
});
```

## Async slice (zero-boilerplate fetch pattern)

```ts
import { createAsyncSlice, createAsyncSaga, type AsyncSlice } from 'zustand-sagas';

type Store = AsyncSlice<'user', User, [id: string]>;

const store = createStore<Store>((set) => ({
  ...createAsyncSlice<'user', User, [id: string]>('user', set),
}));

const userSaga = createAsyncSaga(store, 'user', fetchUser, {
  strategy: 'takeLatest',  // or takeEvery, takeLeading, debounce, throttle
  retries: 2,
  retryDelay: 1000,
});

createSaga(store, function* (api): Saga { yield* userSaga(api); });

// Auto-generates: user, isUserLoading, isUserError, isUserSuccess, userError,
//                 fetchUser(), setUser(), setUserError(), resetUser()
```

## Workers (offload to Web Worker / worker thread)

```ts
// Blocking
const result = yield* callWorker((data: number[]) => {
  return data.reduce((a, b) => a + b, 0);
}, largeArray);

// Non-blocking
const task = yield* forkWorker(heavyFn, args);
const result = yield* join(task);

// Streaming
const { channel: chan, task } = yield* forkWorkerChannel(
  (emit, data) => { for (const item of data) emit(item); return 'done'; },
  items,
);
```

## Common patterns

### Auth flow
```ts
function* authSaga({ take, call, fork, cancel, select }): Saga {
  while (true) {
    const { payload: [email, password] } = yield* take('login');
    const { user, token, expiresIn } = yield* call(loginApi, email, password);
    yield* call(() => store.setState({ user, token }));
    const refreshTask = yield* fork(refreshLoop, expiresIn);
    yield* take('logout');
    yield* cancel(refreshTask);
  }
}
```

### Optimistic update with rollback
```ts
yield* takeEvery('toggleTodo', function* (action): Saga {
  const snapshot = yield* select((s) => s.todos);
  yield* call(() => store.setState(/* optimistic update */));
  try {
    yield* call(updateApi, action.payload);
  } catch {
    yield* call(() => store.setState({ todos: snapshot })); // rollback
  }
});
```

### Fetch with timeout
```ts
const { data, timeout } = yield* race({
  data: call(fetchApi, '/endpoint'),
  timeout: delay(5000),
});
```

## When helping the user

1. Read the user's existing store type to understand available actions and state shape
2. Use `yield*` for every effect — never use plain `yield`
3. Annotate generator return types with `Saga` or `Saga<T>`
4. Prefer `createAsyncSaga` for simple fetch-and-settle flows
5. Prefer manual sagas for multi-step flows, complex cancellation, or conditional logic
6. For error handling, use try/catch around `yield* call(...)` blocks
7. Use `call(() => store.setState(...))` for state updates, not direct setState calls outside sagas
8. Worker functions must be self-contained (no closures, no imports)
