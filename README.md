# zustand-sagas

Generator-based side effect management for [Zustand](https://github.com/pmndrs/zustand). Inspired by redux-saga, redesigned for Zustand's function-based actions.

## Install

```bash
npm install zustand-sagas zustand
```

## Quick Start

```ts
import { create } from 'zustand';
import { sagas } from 'zustand-sagas';

const store = create(
  sagas(
    // Root saga receives typed effects — typos in action names are TS errors
    function* ({ takeEvery, delay, select, call }) {
      yield* takeEvery('incrementAsync', function* () {
        yield delay(1000);
        const count = yield select((s) => s.count);
        yield call(() => store.setState({ count: count + 1 }));
      });
    },
    // Store state — actions are normal Zustand functions
    (set) => ({
      count: 0,
      incrementAsync: () => {},
    }),
  ),
);

// Just call the action — the saga picks it up automatically
store.getState().incrementAsync();
```

No `dispatch()`, no `{ type: 'ACTION' }` objects. Store function names **are** the action types.

## How It Works

The `sagas` middleware wraps every function in your store state. When you call a store action like `increment(arg)`, two things happen:

1. An `ActionEvent` (`{ type: 'increment', payload: arg }`) is emitted on an internal channel
2. The original function runs normally (state updates happen as usual)

Sagas are generator functions that yield declarative effect descriptions. The runner interprets each effect, pausing the generator until the effect completes, then resuming it with the result.

```
store.getState().increment(5)
        │
        ├──> emit { type: 'increment', payload: 5 }
        │         │
        │         └──> ActionChannel ──> take('increment') resolves ──> saga resumes
        │
        └──> original increment(5) runs ──> state updates via set()
```

**Key design decisions:**
- Actions are store functions — no string constants, no action creators
- State mutations happen directly in store actions, not through sagas
- Sagas observe and react to actions for side effects (API calls, async flows, coordination)
- Saga-to-saga communication goes through store actions via `call()`
- Cancellation is cooperative — checked after each yielded effect
- No buffered channels — unmatched actions are dropped

### Payload convention

|      Call             |       `payload`      |
|-----------------------|----------------------|
| `increment()`         | `undefined`          |
| `addTodo('buy milk')` | `'buy milk'`         |
| `setPosition(10, 20)` |  `[10, 20]`          |

## API Reference

### Middleware

#### `sagas(rootSaga, stateCreator)`

Zustand middleware that starts the root saga when the store is created. Adds `sagaTask` to the store API.

The root saga receives a typed `SagaApi<T>` object as its first argument — all effects are injected automatically, constrained to your store's action names. Typos and non-function keys are compile-time errors.

```ts
import { create } from 'zustand';
import { sagas } from 'zustand-sagas';

const useStore = create(
  sagas(
    function* ({ take, takeEvery, call, select, delay }) {
      // take('typo')  → TS error!
      // take('count') → TS error! (not a function)
      yield* takeEvery('increment', function* (action) {
        // action.payload is typed from increment's parameters
      });
    },
    (set) => ({
      count: 0,
      increment: () => set((s) => ({ ...s, count: s.count + 1 })),
    }),
  ),
);

// Access the root saga task
useStore.sagaTask.cancel(); // stop all sagas
```

### `createSagaApi<StoreState>()`

For sagas defined **outside** the middleware call (separate files, shared workers), use `createSagaApi` to get a standalone typed API:

```ts
import { createSagaApi } from 'zustand-sagas';
import type { TypedActionEvent } from 'zustand-sagas';

type State = {
  count: number;
  increment: () => void;
  search: (q: string) => void;
};

const { take, takeEvery } = createSagaApi<State>();

function* onSearch(action: TypedActionEvent<State, 'search'>) {
  action.payload // typed as string (from search's parameter)
}

// Use in a root saga that ignores the injected api
function* rootSaga() {
  yield* takeEvery('search', onSearch);
}
```

At runtime, these are identical to the injected versions — `createSagaApi` is purely a type-level wrapper.

### Effects

Effects are plain objects that describe side effects. Yield them from generator functions and the runner executes them.

#### `take(pattern)`

Pauses the saga until a store action matching `pattern` is called.

- `pattern: string` — matches the action's function name
- `pattern: (action) => boolean` — matches when predicate returns `true`

```ts
function* saga() {
  // Wait for the login action to be called
  const action = yield take('login');
  console.log(action.payload); // the argument passed to login()

  // Wait for any action matching a predicate
  const action2 = yield take((a) => a.type.startsWith('fetch'));
}
```

> **Note:** When used via the injected `SagaApi`, `take` only accepts valid action names from your store.

#### `call(fn, ...args)`

Calls a function and waits for its result. If `fn` returns a generator, it is run as a sub-saga. If it returns a promise, the saga waits for resolution.

```ts
function* saga() {
  // Call a sync function
  const sum = yield call((a, b) => a + b, 1, 2);

  // Call an async function
  const data = yield call(fetchUser, userId);

  // Call a sub-saga (generator)
  yield call(otherSaga);

  // Mutate store state from a saga
  yield call(() => store.setState({ count: sum }));
}
```

#### `select(selector?)`

Reads the current store state. If a selector is provided, returns its result. Otherwise returns the full state.

```ts
function* saga() {
  const count = yield select((s) => s.count);
  const fullState = yield select();
}
```

#### `fork(saga, ...args)`

Starts a new saga as an **attached** (child) task. The parent continues immediately without waiting.

- Parent cancellation cascades to forked children
- Child errors propagate to the parent

```ts
function* rootSaga() {
  const task = yield fork(backgroundWorker);
  // continues immediately
}
```

#### `spawn(saga, ...args)`

Starts a new saga as a **detached** task. Independent lifecycle.

- Parent cancellation does **not** affect spawned tasks
- Errors do **not** propagate to the parent

```ts
function* rootSaga() {
  yield spawn(independentLogger);
}
```

#### `cancel(task)`

Cancels a running task. Cancellation is cooperative — the task stops at the next yield point.

```ts
function* saga() {
  const task = yield fork(worker);
  yield delay(5000);
  yield cancel(task);
}
```

#### `delay(ms)`

Pauses the saga for `ms` milliseconds.

```ts
function* saga() {
  yield delay(1000); // wait 1 second
}
```

#### `race(effects)`

Runs multiple effects concurrently. Resolves with the first to complete. The result is an object where the winner's key has a value and all others are `undefined`. Losing takers are automatically cleaned up.

```ts
function* saga() {
  const result = yield race({
    response: take('fetchComplete'),
    timeout: delay(5000),
  });

  if (result.timeout !== undefined) {
    console.log('timed out');
  } else {
    console.log('got response:', result.response);
  }
}
```

#### `all(effects)`

Runs multiple effects concurrently and waits for all to complete. Returns an array of results in the same order. If any effect rejects, all are cancelled.

```ts
function* saga() {
  const [users, posts] = yield all([
    call(fetchUsers),
    call(fetchPosts),
  ]);
}
```

### Helpers

Higher-level patterns built on core effects. Use with `yield*` (delegating yield) since they are themselves generators.

#### `takeEvery(pattern, worker)`

Forks `worker` for **every** action matching `pattern`. All instances run concurrently.

```ts
function* rootSaga() {
  yield* takeEvery('fetchUser', fetchUserWorker);
}
```

#### `takeLatest(pattern, worker)`

Forks `worker` for the latest matching action. Automatically cancels any previously forked instance.

```ts
function* rootSaga() {
  yield* takeLatest('search', searchWorker);
}
```

#### `takeLeading(pattern, worker)`

Calls `worker` for the first matching action, then blocks until it completes before listening again. Actions arriving while the worker is running are dropped.

```ts
function* rootSaga() {
  yield* takeLeading('submitForm', submitWorker);
}
```

#### `debounce(ms, pattern, worker)`

Waits `ms` after the latest matching action before running `worker`. Restarts the timer on each new action.

```ts
function* rootSaga() {
  yield* debounce(300, 'search', searchWorker);
}
```

### Task

Tasks are returned by `fork`, `spawn`, and `runSaga`. They represent a running saga and provide control over its lifecycle.

```ts
interface Task<R = unknown> {
  id: number;
  isRunning(): boolean;
  isCancelled(): boolean;
  result(): R | undefined;     // the return value (undefined until completion)
  toPromise(): Promise<R>;
  cancel(): void;
}
```

The generic parameter `R` is inferred from the saga's return type:

```ts
function* mySaga() {
  return 42;
}

const task = runSaga(mySaga, env); // Task<number>
const value = await task.toPromise(); // number
task.result(); // number | undefined
```

### Advanced

#### `ActionChannel`

The internal pub/sub mechanism. Exported for testing and advanced use cases.

```ts
import { ActionChannel } from 'zustand-sagas';

const channel = new ActionChannel();

const { promise, takerId } = channel.take('myAction');

channel.emit({ type: 'myAction', payload: 42 });

// Remove a pending taker (used in race cleanup)
channel.removeTaker(takerId);
```

#### `runSaga(saga, env, ...args)`

Run a saga outside of the Zustand middleware. Useful for testing sagas in isolation.

```ts
import { runSaga, ActionChannel } from 'zustand-sagas';

const channel = new ActionChannel();
const state = { count: 0 };

const task = runSaga(mySaga, {
  channel,
  getState: () => state,
  context: {
    set: (partial) => Object.assign(state, partial),
    get: () => state,
  },
});

// Drive the saga by emitting actions
channel.emit({ type: 'increment' });

const result = await task.toPromise();
```

## Patterns

### Async Counter

```ts
const store = create(
  sagas(function* ({ takeEvery, delay, select, call }) {
    yield* takeEvery('incrementAsync', function* () {
      yield delay(1000);
      const count = yield select((s) => s.count);
      yield call(() => store.setState({ count: count + 1 }));
    });
  }, (set) => ({
    count: 0,
    incrementAsync: () => {},
  })),
);
```

### Fetch with Timeout

```ts
const store = create(
  sagas(function* ({ take, race, call, delay }) {
    yield take('fetchData');
    const { data, timeout } = yield race({
      data: call(fetchApi, '/data'),
      timeout: delay(5000),
    });

    if (timeout !== undefined) {
      yield call(() => store.setState({ error: 'Request timed out' }));
    } else {
      yield call(() => store.setState({ data }));
    }
  }, (set) => ({
    data: null,
    error: null,
    fetchData: () => {},
  })),
);
```

### Saga-to-Saga Communication

Sagas communicate through store actions. One saga triggers a store action via `call()`, another listens for it via `take()`.

```ts
const store = create(
  sagas(function* ({ take, fork, call, delay }) {
    function* producer() {
      const data = yield call(fetchData);
      yield call(() => store.getState().dataLoaded(data));
    }

    function* consumer() {
      const action = yield take('dataLoaded');
      console.log('received:', action.payload);
    }

    yield fork(consumer);  // start listening first
    yield fork(producer);  // then produce
  }, (set) => ({
    data: null,
    dataLoaded: (data) => set({ data }),
  })),
);
```

### Error Handling

```ts
const store = create(
  sagas(function* ({ takeEvery, call }) {
    yield* takeEvery('fetchUser', function* (action) {
      try {
        const data = yield call(fetchApi, action.payload);
        yield call(() => store.setState({ data, error: null }));
      } catch (e) {
        yield call(() => store.setState({ error: e.message }));
      }
    });
  }, (set) => ({
    data: null,
    error: null,
    fetchUser: (id: string) => {},
  })),
);
```

### Cancellable Background Task

```ts
const store = create(
  sagas(function* ({ take, fork, call, cancel, delay }) {
    function* pollServer() {
      while (true) {
        const data = yield call(fetchStatus);
        yield call(() => store.setState({ status: data }));
        yield delay(5000);
      }
    }

    while (true) {
      yield take('startPolling');
      const task = yield fork(pollServer);
      yield take('stopPolling');
      yield cancel(task);
    }
  }, (set) => ({
    status: null,
    startPolling: () => {},
    stopPolling: () => {},
  })),
);
```

## Comparison with redux-saga

### Philosophy

redux-saga was built for Redux, where every state change is an action object dispatched through reducers. This means actions are strings by design, and sagas intercept them in flight.

Zustand has no actions. State changes are just function calls — `set({ count: 1 })` or `increment()`. zustand-sagas embraces this: your store functions **are** the actions. No action constants, no action creators, no dispatch.

### Side-by-side

**Redux + redux-saga:**

```ts
// action constants
const INCREMENT_ASYNC = 'INCREMENT_ASYNC';
const INCREMENT = 'INCREMENT';

// action creators
const incrementAsync = () => ({ type: INCREMENT_ASYNC });
const increment = () => ({ type: INCREMENT });

// reducer
function counterReducer(state = { count: 0 }, action) {
  switch (action.type) {
    case INCREMENT:
      return { count: state.count + 1 };
    default:
      return state;
  }
}

// saga
function* onIncrementAsync() {
  yield delay(1000);
  yield put({ type: INCREMENT });  // dispatches to Redux store
}

function* rootSaga() {
  yield takeEvery(INCREMENT_ASYNC, onIncrementAsync);
}

// dispatch
dispatch({ type: INCREMENT_ASYNC });
```

**Zustand + zustand-sagas:**

```ts
// store — actions, state, and sagas in one place
const store = create(
  sagas(function* ({ takeEvery, delay, select, call }) {
    yield* takeEvery('incrementAsync', function* () {
      yield delay(1000);
      const count = yield select((s) => s.count);
      yield call(() => store.setState({ count: count + 1 }));
    });
  }, (set) => ({
    count: 0,
    incrementAsync: () => {},
  })),
);

// call the action directly
store.getState().incrementAsync();
```

### What's different

| | redux-saga | zustand-sagas |
|---|---|---|
| **Actions** | String constants + action creator functions | Store function names (automatic) |
| **Dispatching** | `dispatch({ type: 'INCREMENT' })` | `store.getState().increment()` |
| **State mutation** | `put()` dispatches to reducer | State updated directly in store actions |
| **Saga triggers** | Intercepts dispatched action objects | Intercepts store function calls |
| **Saga-to-saga** | `put()` emits to channel | `call()` invokes a store action |
| **Boilerplate** | Action types + action creators + reducer + saga | Store actions + saga |
| **Store** | Redux | Zustand |
| **Channels** | Buffered, multicast | Unbuffered, first-match |
| **Bundle** | ~14 KB min | ~3 KB min |
| **TypeScript** | Partial (heavy use of `any`) | Full — injected effects validate action names at compile time |

### What's the same

Both libraries share the same generator-based mental model:

- **`take`** — pause until a specific action happens
- **`call`** — invoke a function and wait for the result
- **`select`** — read current state
- **`fork` / `spawn`** — start concurrent tasks (attached vs detached)
- **`cancel`** — stop a running task cooperatively
- **`delay`** — pause for a duration
- **`race` / `all`** — concurrency combinators
- **`takeEvery`, `takeLatest`, `takeLeading`, `debounce`** — high-level watcher patterns

If you know redux-saga, the effects work the same way. The difference is how actions enter the system — not how sagas process them.

### What's gone

| redux-saga | zustand-sagas | Why |
|---|---|---|
| `put(action)` | `call(() => store.getState().fn())` | No separate dispatch channel. Store actions are the channel. |
| `dispatch()` | *(removed)* | Same reason — call the store action directly. |
| `actionChannel` | *(not needed)* | No buffered channels in v1. |
| `throttle` | *(not included)* | Use `takeLatest` + `delay` or `debounce`. |
| Action constants | *(not needed)* | Function names are the identifiers. |
| Action creators | *(not needed)* | Store functions are the actions. |

## Types

All types are exported for use in TypeScript projects:

```ts
import type {
  SagaApi,           // Typed effects injected into the root saga
  ActionEvent,       // { type: string; payload?: unknown }
  ActionNames,       // Extracts function-property keys from a store state type
  ActionPayload,     // Derives payload type for a given action
  TypedActionEvent,  // Typed action event for a specific store action
  ActionPattern,
  Effect,
  Task,
  SagaFn,
  SagaContext,
  StoreSagas,
  RunnerEnv,
} from 'zustand-sagas';
```

The middleware augments Zustand's store type to include `sagaTask` automatically.

## License

MIT
