# zustand-sagas

Generator-based side effect management for [Zustand](https://github.com/pmndrs/zustand). Inspired by redux-saga, redesigned for Zustand's function-based actions.

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
- [Patterns](#patterns)
- [Recipes](./RECIPES.md) — auth flow, paginated fetch, WebSocket reconnect, optimistic updates, and more
- [Comparison with redux-saga](#comparison-with-redux-saga)
- [Saga Monitor](#saga-monitor)
- [Testing Utilities](#testing-utilities)
- [Type Safety](#type-safety)
- [Types](#types)

## Install

```bash
npm install zustand-sagas zustand
```

## Quick Start

```ts
import { createStore } from 'zustand/vanilla';
import { createSaga } from 'zustand-sagas';

// Create store — actions are normal Zustand functions
const store = createStore((set) => ({
  count: 0,
  incrementAsync: () => {},
}));

// Attach sagas — root saga receives typed effects
const useSaga = createSaga(store, function* ({ takeEvery, delay, select, call }) {
  yield takeEvery('incrementAsync', function* () {
    yield delay(1000);
    const count = yield select((s) => s.count);
    yield call(() => store.setState({ count: count + 1 }));
  });
});

// Just call the action — the saga picks it up automatically
store.getState().incrementAsync();
```

No `dispatch()`, no `{ type: 'ACTION' }` objects. Store function names **are** the action types.

## How It Works

`createSaga` wraps every function in your store state. When you call a store action like `increment(arg)`, two things happen in order:

1. The original function runs normally (state updates via `set()`)
2. An `ActionEvent` (`{ type: 'increment', payload: arg }`) is emitted on an internal channel

The action runs **before** the event is emitted. This means state is always up to date when sagas react — a `select()` immediately after `take()` will see the state that the action just wrote.

Sagas are generator functions that yield declarative effect descriptions. The runner interprets each effect, pausing the generator until the effect completes, then resuming it with the result.

```
store.getState().increment(5)
        |
        |---> original increment(5) runs ---> state updates via set()
        |
        '---> emit { type: 'increment', payload: 5 }
                  |
                  '---> ActionChannel ---> take('increment') resolves ---> saga resumes
```

**Key design decisions:**

- Actions are store functions — no string constants, no action creators
- State mutations happen directly in store actions, not through sagas
- Sagas observe and react to actions for side effects (API calls, async flows, coordination)
- Saga-to-saga communication goes through `put()` which emits to the channel
- Cancellation is cooperative — checked after each yielded effect
- Channels support buffering, multicast, and external event sources

### Payload convention

| Call                  | `payload`    |
|-----------------------|--------------|
| `increment()`         | `undefined`  |
| `addTodo('buy milk')` | `'buy milk'` |
| `setPosition(10, 20)` | `[10, 20]`   |

## API Reference

### `createSaga(store, rootSaga)`

Attaches sagas to an existing Zustand store. Returns a `useSaga` function for accessing typed effects in child sagas. When the saga task completes or is cancelled, `createSaga` restores the store's original `setState` — safe for tests and re-attachment.

```ts
import { createStore } from 'zustand/vanilla';
import { createSaga } from 'zustand-sagas';

const store = createStore((set) => ({
  count: 0,
  increment: () => set((s) => ({ ...s, count: s.count + 1 })),
  search: (q: string) => set((s) => ({ ...s, query: q })),
}));

const useSaga = createSaga(store, function* ({ takeEvery, take, call }) {
  // take('typo')  -> TS error!
  // take('count') -> TS error! (not a function)
  yield takeEvery('increment', function* (action) {
    // action.payload is typed from increment's parameters
  });
});

// Cancel all sagas
useSaga.task.cancel();
```

Child sagas use the injected api from the root saga's closure:

```ts
const useSaga = createSaga(store, function* ({ take, fork }) {
  function* watchIncrement() {
    while (true) {
      yield take('increment');  // typed — uses parent's take
      // ...
    }
  }
  yield fork(watchIncrement);
});
```

For worker sagas in **separate files** (triggered by actions, not immediately during `createSaga`), call `useSaga()` to access the typed effects:

```ts
// workers.ts
import { useSaga } from './store';

export function* onSearch() {
  const { select, call } = useSaga();
  const query = yield select((s) => s.query);
  yield call(fetchResults, query);
}
```

### `sagas(rootSaga, stateCreator)` (middleware)

Alternative to `createSaga` — bakes sagas into the store creation. Adds `sagaTask` to the store API.

```ts
import { create } from 'zustand';
import { sagas } from 'zustand-sagas';

const useStore = create(
  sagas(
    function* ({ takeEvery }) {
      yield takeEvery('increment', function* () { /* ... */ });
    },
    (set) => ({
      count: 0,
      increment: () => set((s) => ({ ...s, count: s.count + 1 })),
    }),
  ),
);

useStore.sagaTask.cancel();
```

### Effects

Effects describe side effects declaratively. Yield them from generator functions and the runner executes them.

#### `take(pattern)` / `take(channel)`

Pauses the saga until a matching action is called or a message arrives on a channel.

- `pattern: string` — matches the store function name exactly
- `pattern: string[]` — matches any of the listed action names (autocompleted from store actions via the typed API)
- `pattern: (action) => boolean` — matches when predicate returns `true`
- `channel: Channel<Item>` — takes the next message from the channel; auto-terminates the saga on `END`

```ts
function* rootSaga({ take }) {
  // Wait for a store action
  const action = yield take('login');
  console.log(action.payload);

  // Wait for any of several actions
  const action2 = yield take(['login', 'register', 'guestLogin']);

  // Wait for any action matching a predicate
  const action3 = yield take((a) => a.type.startsWith('fetch'));
}
```

```ts
// Take from a channel
function* saga({ take }) {
  const chan = eventChannel((emit) => {
    const ws = new WebSocket(url);
    ws.onmessage = (e) => emit(JSON.parse(e.data));
    ws.onclose = () => emit(END);
    return () => ws.close();
  });

  while (true) {
    const msg = yield take(chan); // auto-terminates on END
    yield call(() => store.setState({ lastMessage: msg }));
  }
}
```

When used via the injected `SagaApi`, `take` only accepts valid action names from your store (string literals). The predicate, array, and channel overloads still accept any value.

> **Note:** Predicate and array patterns lose payload type information since there's no single action to infer from. The action is typed as `ActionEvent` (generic). Use the string overload when you need typed payloads.

#### `takeMaybe(pattern)` / `takeMaybe(channel)`

Like `take`, but does **not** auto-terminate the saga when `END` is received from a channel. Instead, `END` is returned as a normal value so the saga can handle it manually.

```ts
function* saga({ takeMaybe }) {
  const chan = eventChannel(subscribe);

  while (true) {
    const msg = yield takeMaybe(chan);
    if (msg === END) {
      console.log('channel closed');
      break;
    }
    // process msg
  }
}
```

#### `put(actionName, ...args)`

Emits an action into the saga channel. Other sagas listening via `take` will receive it. Arguments match the store function's parameters — like calling the action directly, but only through the saga channel.

```ts
function* saga({ put }) {
  yield put('increment');                  // () => void
  yield put('search', 'query');            // (q: string) => void
  yield put('setPosition', 10, 20);        // (x: number, y: number) => void
}
```

Via the typed `SagaApi`, only valid store function names are accepted — `put('typo')` is a type error.

#### `putApply(actionName, args)`

Like `put`, but takes arguments as an array (similar to `Function.prototype.apply`).

```ts
function* saga({ putApply }) {
  const coords = [10, 20];
  yield putApply('setPosition', coords);   // (x: number, y: number) => void
}
```

#### `call(fn, ...args)`

Calls a function and waits for its result. If `fn` returns a generator, it is run as a sub-saga. If it returns a promise, the saga waits for resolution. Arguments are type-checked against the function signature.

```ts
function* saga({ call }) {
  const sum = yield call((a, b) => a + b, 1, 2);
  const data = yield call(fetchUser, userId);
  yield call(otherSaga);
  yield call(() => store.setState({ count: sum }));
}
```

#### `cps(fn, ...args)`

Like `call`, but for Node.js-style callback functions `(error, result) => void`. Wraps the callback in a promise.

```ts
function* saga({ cps }) {
  const content = yield cps(fs.readFile, '/path/to/file', 'utf8');
}
```

#### `select(selector?)`

Reads the current store state. If a selector is provided, returns its result. Otherwise returns the full state. The selector parameter is typed to your store state via `SagaApi`.

```ts
function* saga({ select }) {
  const count = yield select((s) => s.count);  // s is typed
  const fullState = yield select();
}
```

#### `fork(saga, ...args)`

Starts a new saga as an **attached** (child) task. The parent continues immediately without waiting. Returns a `Task`. Saga arguments are type-checked.

- Parent cancellation cascades to forked children
- Child errors propagate to the parent

```ts
function* rootSaga({ fork }) {
  const task = yield fork(backgroundWorker);
  // continues immediately
}
```

#### `spawn(saga, ...args)`

Starts a new saga as a **detached** task. Independent lifecycle. Returns a `Task`. Saga arguments are type-checked.

- Parent cancellation does **not** affect spawned tasks
- Errors do **not** propagate to the parent

```ts
function* rootSaga({ spawn }) {
  const task = yield spawn(independentLogger);
}
```

#### `callWorker(fn | url, ...args)`

Runs a function in a **Web Worker** (browser) or **worker thread** (Node.js) and waits for the result. Blocking — the saga pauses until the worker completes.

The first argument is either:
- A **function** (sync or async) — serialized and executed in a fresh worker
- A **string URL/path** — worker created from that file

```ts
function* saga({ callWorker }) {
  // Inline function — offload CPU-heavy work
  const hash = yield callWorker((data: string) => {
    let h = 0;
    for (let i = 0; i < data.length; i++) {
      h = (h << 5) - h + data.charCodeAt(i);
    }
    return h;
  }, hugeString);

  // Async function in worker
  const data = yield callWorker(async (url: string) => {
    const res = await fetch(url);
    return res.json();
  }, '/api/heavy-data');

  // From a worker file
  const result = yield callWorker('./workers/process.js', payload);
}
```

**Important:** Inline functions must be **self-contained** — no closures over external variables, no imports. Arguments and results must be structured-cloneable (no functions, DOM nodes, class instances).

#### `forkWorker(fn | url, ...args)`

Like `callWorker`, but **non-blocking** and **attached**. Returns a `Task` immediately. The worker runs in the background. Parent cancellation cascades to the worker.

```ts
function* saga({ forkWorker, join, cancel }) {
  const task = yield forkWorker((data: number[]) => {
    return data.reduce((a, b) => a + b, 0);
  }, largeArray);

  // Do other work while worker runs...
  yield delay(100);

  // Wait for worker result
  const sum = yield join(task);

  // Or cancel it
  yield cancel(task);  // sends cancel signal, then terminates
}
```

#### `spawnWorker(fn | url, ...args)`

Like `forkWorker`, but **detached**. Parent cancellation does **not** affect the worker. Errors do **not** propagate to the parent.

```ts
function* saga({ spawnWorker }) {
  yield spawnWorker(async (metrics: object) => {
    await fetch('/api/analytics', {
      method: 'POST',
      body: JSON.stringify(metrics),
    });
  }, analyticsData);
  // saga continues, worker runs independently
}
```

#### `forkWorkerChannel(fn, ...args)` — streaming

Runs a function in a worker that can **stream values back** to the saga through a channel. The worker function receives an `emit` callback as its first argument. Returns `{ channel, task }`.

```ts
function* saga({ forkWorkerChannel, takeMaybe, join }) {
  const { channel: chan, task } = yield forkWorkerChannel(
    (emit, data: number[]) => {
      for (let i = 0; i < data.length; i++) {
        emit({ progress: (i + 1) / data.length, item: data[i] });
      }
      return 'done';
    },
    largeDataset,
  );

  // Consume streamed values (use takeMaybe to handle END manually)
  while (true) {
    const msg = yield takeMaybe(chan);
    if (msg === END) break;
    yield call(() => store.setState({ progress: msg.progress }));
  }

  const result = yield join(task);  // 'done'
}
```

The channel receives `END` automatically when the worker function returns (or throws). Use `take(chan)` if you want the saga to auto-terminate on close, or `takeMaybe(chan)` to handle `END` explicitly.

#### `callWorkerGen(fn, handler, ...args)` — bidirectional

Runs a function in a worker with **two-way communication**. The worker function receives a `send(value): Promise<response>` function. Each `send` pauses the worker until the saga's handler processes the value and returns a response. Blocking — the saga waits until the worker completes.

```ts
function* saga({ callWorkerGen, select, call }) {
  const result = yield callWorkerGen(
    // Worker side — sends values, receives responses
    async (send, rawData: string) => {
      const validated = await send({ step: 'validate', data: rawData });
      const enriched = await send({ step: 'enrich', data: validated });
      return enriched;
    },
    // Saga handler — runs on main thread with full effect access
    function* (msg) {
      if (msg.step === 'validate') {
        return yield call(validateApi, msg.data);
      }
      if (msg.step === 'enrich') {
        const config = yield select((s) => s.enrichConfig);
        return yield call(enrichApi, msg.data, config);
      }
    },
    inputData,
  );
}
```

The handler is a generator that runs as a sub-saga on the main thread — it has full access to all saga effects (`select`, `call`, `delay`, `put`, etc.). This is useful when the worker needs data or services that only the main thread can provide.

#### Worker protocol (URL-based workers)

When using a URL, your worker file must implement this message protocol:

**Standard** (`callWorker`, `forkWorker`, `spawnWorker`):

```
Main → Worker:  { type: 'exec', args: [...] }
Worker → Main:  { type: 'result', value: ... }
Worker → Main:  { type: 'error', message: string, stack?: string }
Main → Worker:  { type: 'cancel' }
```

**Channel** (`forkWorkerChannel`) — adds `emit`:

```
Worker → Main:  { type: 'emit', value: ... }      // streamed values
Worker → Main:  { type: 'result', value: ... }     // final return
```

**Gen** (`callWorkerGen`) — adds `send`/`response`:

```
Worker → Main:  { type: 'send', value: ... }       // request to handler
Main → Worker:  { type: 'response', value: ... }   // handler's response
Worker → Main:  { type: 'result', value: ... }      // final return
```

#### `configureWorkers(config)`

Configures worker code generation. Call once before any worker effects are used.

```ts
import { configureWorkers } from 'zustand-sagas';

configureWorkers({ nodeWorkerMode: 'esm' });
```

| Option           | Default | Description                                                                                                                                                                   |
|------------------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `nodeWorkerMode` | `'cjs'` | `'cjs'` generates `require()` workers (CommonJS). `'esm'` generates `import` workers via data URLs — required when the host project sets `"type": "module"` in package.json.  |

> **Note:** This only affects Node.js worker threads. Browser Web Workers are always generated as plain scripts regardless of this setting.

#### `join(task)`

Waits for a forked/spawned task to complete. Returns the task's result.

```ts
function* saga({ fork, join }) {
  const task = yield fork(worker);
  const result = yield join(task);
}
```

#### `cancel(task)`

Cancels a running task. Cancellation is cooperative — the task stops at the next yield point.

```ts
function* saga({ fork, cancel, delay }) {
  const task = yield fork(worker);
  yield delay(5000);
  yield cancel(task);
}
```

#### `delay(ms)`

Pauses the saga for `ms` milliseconds.

```ts
function* saga({ delay }) {
  yield delay(1000);
}
```

#### `retry(maxTries, delayMs, fn, ...args)`

Calls a function up to `maxTries` times with `delayMs` between attempts. Throws if all attempts fail.

```ts
function* saga({ retry }) {
  const data = yield retry(5, 2000, fetchApi, '/unstable-endpoint');
}
```

#### `race(effects)`

Runs multiple effects concurrently. Resolves with the first to complete. The result is an object where the winner's key has a value and all others are `undefined`. Losing takers are automatically cleaned up.

```ts
function* saga({ take, race, delay }) {
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
function* saga({ all, call }) {
  const [users, posts] = yield all([
    call(fetchUsers),
    call(fetchPosts),
  ]);
}
```

#### `allSettled(effects)`

Like `all`, but never rejects. Waits for every effect to settle (succeed or fail) and returns an array of result objects — matching the `Promise.allSettled` contract.

Each result is either `{ status: 'fulfilled', value }` or `{ status: 'rejected', reason }`.

```ts
function* saga({ allSettled, call }) {
  const results = yield allSettled([
    call(fetchUsers),
    call(fetchPosts),
    call(fetchComments),
  ]);

  for (const r of results) {
    if (r.status === 'fulfilled') {
      console.log('got:', r.value);
    } else {
      console.error('failed:', r.reason);
    }
  }
}
```

#### `until(predicate, timeout?)`

Pauses the saga until a store state predicate becomes truthy. Resolves immediately if the predicate is already satisfied. Returns `true` when the predicate passes, or `END` if the timeout expires.

- `predicate: string` — a key of the store state; checks `state[key]` for truthiness
- `predicate: (state) => unknown` — a selector function; checks the return value for truthiness
- `timeout?: number` — optional milliseconds; if the predicate hasn't been satisfied by then, yields `END`

```ts
function* saga({ until }) {
  // Wait for a boolean flag (string key)
  yield until('ready');

  // Wait for a computed condition (selector function)
  yield until((s) => s.count >= 10);

  // With timeout — returns END if not ready within 5s
  const result = yield until('ready', 5000);
  if (result === END) {
    console.log('timed out waiting for ready');
  }
}
```

Via the typed `SagaApi`, the string overload only accepts valid keys of your store state (not just function names — any key). The selector overload receives the full typed state.

#### `actionChannel(pattern, buffer?)`

Creates a buffered channel that queues store actions matching `pattern`. Use with `take(channel)` to process actions sequentially with backpressure.

```ts
function* saga({ actionChannel, take, call }) {
  // Buffer all 'request' actions
  const chan = yield actionChannel('request');

  // Process them one at a time
  while (true) {
    const action = yield take(chan);
    yield call(handleRequest, action.payload);
  }
}
```

Without `actionChannel`, rapid actions would be lost if the saga is busy processing a previous one. The channel buffers them until the saga is ready.

Optional second argument controls the buffer strategy (default: `buffers.expanding()`):

```ts
import { buffers } from 'zustand-sagas';

const chan = yield actionChannel('request', buffers.sliding(5));
```

#### `flush(channel)`

Drains all buffered messages from a channel and returns them as an array.

```ts
function* saga({ actionChannel, flush, delay }) {
  const chan = yield actionChannel('event');
  yield delay(1000); // let events accumulate
  const events = yield flush(chan); // get all buffered events at once
}
```

### Channels

Channels are message queues that sagas can read from (`take`) and write to (`put`). They enable communication between sagas, integration with external event sources, and buffered action processing.

#### `channel(buffer?)`

Creates a point-to-point channel. Each message is delivered to a single taker (first registered wins).

```ts
import { channel } from 'zustand-sagas';

const chan = channel<string>();

// Producer saga
function* producer() {
  chan.put('hello');
  chan.put('world');
}

// Consumer saga
function* consumer({ take }) {
  const msg = yield take(chan); // 'hello'
}
```

Default buffer is `buffers.expanding()`. Pass a different buffer to control capacity:

```ts
import { channel, buffers } from 'zustand-sagas';

const chan = channel<number>(buffers.sliding(100));
```

#### `multicastChannel()`

Creates a channel where **all** registered takers receive each message (broadcast).

```ts
import { multicastChannel } from 'zustand-sagas';

const chan = multicastChannel<string>();

// Both sagas receive 'hello'
function* listener1({ take }) { const msg = yield take(chan); }
function* listener2({ take }) { const msg = yield take(chan); }

chan.put('hello'); // delivered to both
```

#### `eventChannel(subscribe, buffer?)`

Bridges external event sources (WebSocket, DOM events, timers, SSE) into a channel that sagas can `take` from.

The `subscribe` function receives an `emit` callback and must return an unsubscribe function. Emitting `END` closes the channel.

```ts
import { eventChannel, END } from 'zustand-sagas';

// WebSocket
const wsChannel = eventChannel<Message>((emit) => {
  const ws = new WebSocket('wss://api.example.com');
  ws.onmessage = (e) => emit(JSON.parse(e.data));
  ws.onerror = () => emit(END);
  ws.onclose = () => emit(END);
  return () => ws.close();
});

// Timer countdown
const countdown = eventChannel<number>((emit) => {
  let n = 10;
  const id = setInterval(() => {
    n--;
    if (n > 0) emit(n);
    else {
      emit(END);
      clearInterval(id);
    }
  }, 1000);
  return () => clearInterval(id);
});
```

Use in a saga:

```ts
function* watchWebSocket({ take, call }) {
  const chan = eventChannel((emit) => {
    const ws = new WebSocket(url);
    ws.onmessage = (e) => emit(JSON.parse(e.data));
    ws.onclose = () => emit(END);
    return () => ws.close();
  });

  while (true) {
    const msg = yield take(chan); // auto-terminates on END
    yield call(() => store.setState({ lastMessage: msg }));
  }
}
```

#### `END`

A unique symbol that signals channel closure. When a channel is closed (via `close()` or emitting `END`):

- `take(channel)` auto-terminates the saga
- `takeMaybe(channel)` returns `END` as a value
- Further `put()` calls are ignored

```ts
import { END } from 'zustand-sagas';

chan.put(END);    // closes the channel
// or
chan.close();     // equivalent
```

### Buffers

Buffer strategies control how channels store messages when no taker is ready.

```ts
import { buffers } from 'zustand-sagas';
```

| Buffer                        | Behavior                                             |
|-------------------------------|------------------------------------------------------|
| `buffers.none()`              | Zero capacity — items dropped if no taker is waiting |
| `buffers.fixed(limit?)`       | Throws on overflow (default limit: 10)               |
| `buffers.dropping(limit)`     | Silently drops new items when full                   |
| `buffers.sliding(limit)`      | Drops oldest item when full                          |
| `buffers.expanding()`         | Grows dynamically, never drops (default)             |

```ts
// Channel with a sliding window of 100 items
const chan = channel<number>(buffers.sliding(100));

// Action channel that drops overflow
const reqChan = yield actionChannel('request', buffers.dropping(50));
```

### Helpers

Higher-level patterns built on core effects. Each helper forks an internal loop, so use with plain `yield`.

All helpers accept any pattern type: a string action name, an array of action names, or a `(action) => boolean` predicate. When used via the typed `SagaApi`, string and array patterns are validated against your store's action names.

#### `takeEvery(pattern, worker)`

Forks `worker` saga for **every** action matching `pattern`. All instances run concurrently.

```ts
function* rootSaga({ takeEvery }) {
  // String — typed payload
  yield takeEvery('fetchUser', fetchUserWorker);

  // Array — matches any listed action
  yield takeEvery(['login', 'register'], authWorker);

  // Predicate — custom matching, generic payload
  yield takeEvery((a) => a.type.startsWith('analytics'), analyticsWorker);
}
```

#### `takeLatest(pattern, worker)`

Forks `worker` saga for the latest matching action. Automatically cancels any previously forked instance.

```ts
function* rootSaga({ takeLatest }) {
  yield takeLatest('search', searchWorker);
}
```

#### `takeLeading(pattern, worker)`

Calls `worker` saga for the first matching action, then blocks until it completes before listening again. Actions arriving while the worker is running are dropped.

```ts
function* rootSaga({ takeLeading }) {
  yield takeLeading('submitForm', submitWorker);
}
```

#### `debounce(ms, pattern, worker)`

Waits `ms` after the latest matching action before running `worker` saga. Restarts the timer on each new action.

```ts
function* rootSaga({ debounce }) {
  yield debounce(300, 'search', searchWorker);
}
```

#### `throttle(ms, pattern, worker)`

Runs `worker` saga for at most one action per `ms` milliseconds. Accepts the first, then ignores for the duration.

```ts
function* rootSaga({ throttle }) {
  yield throttle(500, 'scroll', scrollHandler);
}
```

### Async Slice

Helpers for the common pattern of fetching an async resource: data, loading state, error, and actions — all derived from a single name.

#### `AsyncSlice<Name, T, Args>`

A mapped type that expands a resource name into typed state and action properties:

```ts
import type { AsyncSlice } from 'zustand-sagas';

type UserSlice = AsyncSlice<'user', User, [id: string]>;
// Expands to:
// {
//   user: User | null;
//   isUserLoading: boolean;
//   isUserError: boolean;
//   isUserSuccess: boolean;
//   userError: string | null;
//   fetchUser: (id: string) => void;
//   setUser: (data: User) => void;
//   setUserError: (error: string) => void;
//   resetUser: () => void;
// }
```

#### `createAsyncSlice(name, set)`

Creates the initial state and actions for an async resource. Spread into your store's state creator.

```ts
import { createStore } from 'zustand/vanilla';
import { createAsyncSlice, type AsyncSlice } from 'zustand-sagas';

type Store = AsyncSlice<'user', User, [id: string]>;

const store = createStore<Store>((set) => ({
  ...createAsyncSlice<'user', User, [id: string]>('user', set),
}));

// State: store.getState().user, .isUserLoading, .isUserError, .isUserSuccess, .userError
// Actions: .fetchUser(id), .setUser(data), .setUserError(msg), .resetUser()
```

#### `createAsyncSaga(store, name, fetchFn, options?)`

Creates a saga that watches `fetchX` actions and handles the full async lifecycle. Works in two modes:

**AsyncSlice mode** — pairs with `createAsyncSlice`:

```ts
import { createSaga, createAsyncSlice, createAsyncSaga, type AsyncSlice } from 'zustand-sagas';

type Store = AsyncSlice<'user', User, [id: string]>;

const store = createStore<Store>((set) => ({
  ...createAsyncSlice<'user', User, [id: string]>('user', set),
}));

const userSaga = createAsyncSaga(store, 'user', fetchUser);

createSaga(store, function* (api) {
  yield* userSaga(api);
});

// Trigger from anywhere:
store.getState().fetchUser('123');
// → isUserLoading: true
// → (on success) user: { id: '123', ... }, isUserSuccess: true
// → (on failure) isUserError: true, userError: 'Not found'
```

**Standalone mode** — works with any store actions, no `AsyncSlice` required:

```ts
const saga = createAsyncSaga(store, {
  trigger: 'loadProfile',
  fetch: fetchProfile,
  onSuccess: 'setProfile',      // calls store.getState().setProfile(data)
  onError: 'setProfileError',   // calls store.getState().setProfileError(message)
});
```

`onSuccess` and `onError` can also be generator functions for custom handling:

```ts
const saga = createAsyncSaga(store, {
  trigger: 'loadProfile',
  fetch: fetchProfile,
  onSuccess: function* (data, api) {
    yield api.call(() => store.setState({ profile: data }));
    yield api.put('profileLoaded');
  },
});
```

**Options** (available in both modes):

| Option      | Default        | Description                                                |
|-------------|----------------|------------------------------------------------------------|
| `strategy`  | `'takeLatest'` | `'takeLatest'`, `'takeEvery'`, `'takeLeading'`, `'debounce'`, `'throttle'` |
| `debounceMs`| —              | Required for `'debounce'` and `'throttle'` strategies      |
| `retries`   | `0`            | Number of retry attempts on failure                        |
| `retryDelay`| `1000`         | Delay between retries in ms                                |
| `transform` | —              | Transform the raw fetch result before settling             |
| `onSuccess` | —              | Generator to run after success (AsyncSlice mode)           |
| `onError`   | —              | Generator to run after error (AsyncSlice mode)             |

```ts
// Debounced search with retry and transform
const searchSaga = createAsyncSaga(store, 'results', searchApi, {
  strategy: 'debounce',
  debounceMs: 300,
  retries: 2,
  retryDelay: 500,
  transform: (raw) => raw.data.items,
});
```

Multiple async sagas compose naturally:

```ts
const userSaga = createAsyncSaga(store, 'user', fetchUser);
const postsSaga = createAsyncSaga(store, 'posts', fetchPosts, { strategy: 'takeEvery' });

createSaga(store, function* (api) {
  yield* userSaga(api);
  yield* postsSaga(api);
});
```

### Task

Tasks are returned by `fork`, `spawn`, and `runSaga`. They represent a running saga and provide control over its lifecycle.

```ts
interface Task<Result = unknown> {
  id: number;
  isRunning(): boolean;
  isCancelled(): boolean;
  result(): Result | undefined;   // the return value (undefined until completion)
  toPromise(): Promise<Result>;
  cancel(): void;
}
```

## Patterns

### Async Counter

```ts
const store = createStore((set) => ({
  count: 0,
  incrementAsync: () => {},
}));

createSaga(store, function* ({ takeEvery, delay, select, call }) {
  yield takeEvery('incrementAsync', function* () {
    yield delay(1000);
    const count = yield select((s) => s.count);
    yield call(() => store.setState({ count: count + 1 }));
  });
});
```

### Fetch with Timeout

```ts
const store = createStore((set) => ({
  data: null,
  error: null,
  fetchData: () => {},
}));

createSaga(store, function* ({ take, race, call, delay }) {
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
});
```

### Sequential Request Processing

Use `actionChannel` to buffer rapid requests and process them one at a time:

```ts
const store = createStore((set) => ({
  results: [],
  processItem: (id: string) => {},
}));

createSaga(store, function* ({ actionChannel, take, call }) {
  const chan = yield actionChannel('processItem');

  while (true) {
    const action = yield take(chan);
    yield call(processOnServer, action.payload);
    yield call(() =>
      store.setState((s) => ({ ...s, results: [...s.results, action.payload] })),
    );
  }
});
```

### Saga-to-Saga Communication

Sagas communicate through the channel. One saga emits an action via `put()`, another listens for it via `take()`.

```ts
const store = createStore((set) => ({
  data: null,
  dataLoaded: (data) => set({ data }),
}));

createSaga(store, function* ({ take, fork, call, put }) {
  function* producer() {
    const data = yield call(fetchData);
    yield put('dataLoaded', data);
  }

  function* consumer() {
    const action = yield take('dataLoaded');
    console.log('received:', action.payload);
  }

  yield fork(consumer);  // start listening first
  yield fork(producer);  // then produce
});
```

### Error Handling

```ts
const store = createStore((set) => ({
  data: null,
  error: null,
  fetchUser: (id: string) => {},
}));

createSaga(store, function* ({ takeEvery, call }) {
  yield takeEvery('fetchUser', function* (action) {
    try {
      const data = yield call(fetchApi, action.payload);
      yield call(() => store.setState({ data, error: null }));
    } catch (e) {
      yield call(() => store.setState({ error: e.message }));
    }
  });
});
```

### Cancellable Background Task

```ts
const store = createStore((set) => ({
  status: null,
  startPolling: () => {},
  stopPolling: () => {},
}));

createSaga(store, function* ({ take, fork, call, cancel, delay }) {
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
});
```

### Offload to Web Worker

```ts
const store = createStore((set) => ({
  result: null,
  processData: (data: number[]) => {},
}));

createSaga(store, function* ({ takeEvery, callWorker, call }) {
  yield takeEvery('processData', function* (action) {
    // Heavy computation runs off the main thread
    const result = yield callWorker((data: number[]) => {
      return data.map((n) => Math.sqrt(n)).filter((n) => n % 1 === 0);
    }, action.payload);

    yield call(() => store.setState({ result }));
  });
});
```

### Worker with Progress Streaming

```ts
import { END } from 'zustand-sagas';

const store = createStore((set) => ({
  progress: 0,
  results: [],
  startProcessing: (items: string[]) => {},
}));

createSaga(store, function* ({ take, forkWorkerChannel, takeMaybe, call }) {
  yield take('startProcessing');

  const { channel: chan } = yield forkWorkerChannel(
    (emit, items: string[]) => {
      const results = [];
      for (let i = 0; i < items.length; i++) {
        // Heavy per-item work happens in the worker
        results.push(items[i].toUpperCase());
        emit({ progress: (i + 1) / items.length });
      }
      return results;
    },
    store.getState().results,
  );

  while (true) {
    const msg = yield takeMaybe(chan);
    if (msg === END) break;
    yield call(() => store.setState({ progress: msg.progress }));
  }
});
```

## Recipes

See [RECIPES.md](./RECIPES.md) for real-world patterns: auth flows, paginated fetch with cancel, WebSocket reconnect, optimistic updates, request deduplication, zero-boilerplate async with `createAsyncSaga`, and standalone async sagas without `AsyncSlice`.

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
  yield put({ type: INCREMENT });
}

function* rootSaga() {
  yield takeEvery(INCREMENT_ASYNC, onIncrementAsync);
}

// dispatch
dispatch({ type: INCREMENT_ASYNC });
```

**Zustand + zustand-sagas:**

```ts
const store = createStore((set) => ({
  count: 0,
  incrementAsync: () => {},
}));

createSaga(store, function* ({ takeEvery, delay, select, call }) {
  yield takeEvery('incrementAsync', function* () {
    yield delay(1000);
    const count = yield select((s) => s.count);
    yield call(() => store.setState({ count: count + 1 }));
  });
});

// call the action directly
store.getState().incrementAsync();
```

### What's different

- **Actions**
  — redux-saga: string constants + action creator functions.
  - zustand-sagas: store function names (automatic).
- **Dispatching**
  — redux-saga: `dispatch({ type: 'INCREMENT' })`.
  - zustand-sagas: `store.getState().increment()`.
- **State mutation**
  — redux-saga: `put()` dispatches to reducer.
  - zustand-sagas: state updated directly in store actions.
- **Saga triggers**
  — redux-saga: intercepts dispatched action objects.
  - zustand-sagas: intercepts store function calls.
- **Saga-to-saga**
  — redux-saga: `put({ type, payload })`.
  - zustand-sagas: `put('actionName', ...args)`.
- **Boilerplate**
  — redux-saga: action types + action creators + reducer + saga.
  - zustand-sagas: store actions + saga.
- **Store**
  — redux-saga: Redux.
  - ustand-sagas: Zustand.
- **TypeScript**
  — redux-saga: partial (heavy use of `any`).
  - zustand-sagas: full — action names, payloads, selectors, channels, and task results are all type-checked.

### What's the same

Both libraries share the same generator-based mental model:

- **`take`** — pause until a specific action happens
- **`call`** — invoke a function and wait for the result
- **`select`** — read current state
- **`fork` / `spawn`** — start concurrent tasks (attached vs detached)
- **`cancel`** / **`join`** — task lifecycle control
- **`delay`** / **`retry`** — timing utilities
- **`race` / `all` / `allSettled`** — concurrency combinators
- **`until`** — wait for a store state predicate to become truthy
- **`takeEvery`, `takeLatest`, `takeLeading`, `debounce`, `throttle`** — high-level watcher patterns
- **`channel`, `eventChannel`, `actionChannel`** — buffered channels and external event sources
- **`END`** — channel termination signal
- **`buffers`** — buffer strategies (none, fixed, dropping, sliding, expanding)
- **`cps`** — Node.js callback-style functions
- **`put`** — emit actions into the saga channel
- **`callWorker` / `forkWorker` / `spawnWorker`** — run functions in Web Workers / worker threads
- **`forkWorkerChannel`** — stream values from a worker through a channel
- **`callWorkerGen`** — bidirectional worker ↔ saga communication
- **`cloneableGenerator`**, **`createMockTask`** — testing utilities
- **`runSaga`** — run sagas outside of a store for testing

## Saga Monitor

`createSagaMonitor()` returns a monitor that logs task lifecycle, effect execution with timing, and errors. Attach it via the `monitor` option on `createSaga` or `sagas`.

```ts
import { createSaga, createSagaMonitor } from 'zustand-sagas';

const monitor = createSagaMonitor();
const useSaga = createSaga(store, rootSaga, { monitor });
```

Or with the middleware:

```ts
import { sagas, createSagaMonitor } from 'zustand-sagas';

const store = createStore(
  sagas(rootSaga, stateCreator, { monitor: createSagaMonitor() }),
);
```

Sample output:

```
[task:1] started  rootSaga
[task:1] >> TAKE('search')
[task:1] << TAKE('search') (142.3ms)
[task:1] >> CALL(fetchResults)
[task:1] << CALL(fetchResults) (85.1ms)
[task:1] done
```

### Options

| Option    | Default       | Description                                      |
|-----------|---------------|--------------------------------------------------|
| `log`     | `console.log` | Custom log function                              |
| `verbose` | `false`       | Include effect results and task return values     |
| `filter`  | all           | Array of effect names to log (e.g. `['TAKE', 'CALL']`) |

### Custom monitors

You can also implement the `SagaMonitor` interface directly for custom tooling:

```ts
import type { SagaMonitor } from 'zustand-sagas';

const myMonitor: SagaMonitor = {
  onTaskStart(task, saga, args) { /* ... */ },
  onTaskResult(task, result) { /* ... */ },
  onTaskError(task, error) { /* ... */ },
  onTaskCancel(task) { /* ... */ },
  onEffectStart(task, effect) { /* ... */ },
  onEffectResult(task, effect, result) { /* ... */ },
  onEffectError(task, effect, error) { /* ... */ },
};
```

All callbacks are optional — implement only what you need.

## Testing Utilities

### `cloneableGenerator(fn)`

Wraps a generator function so you can `.clone()` it at any point — useful for testing different branches from the same saga state without rerunning from the start.

```ts
import { cloneableGenerator } from 'zustand-sagas';

function* mySaga(value: number) {
  const state = yield select();
  if (state > 0) {
    yield put('positive');
    return 'positive';
  } else {
    yield call(fallbackFn);
    return 'non-positive';
  }
}

const gen = cloneableGenerator(mySaga)(10);
gen.next();  // yield select()

// Clone at the branch point
const positive = gen.clone();
const nonPositive = gen.clone();

positive.next(5);      // takes the if branch
nonPositive.next(-1);  // takes the else branch
```

### `createMockTask()`

Creates a mock `Task` for testing sagas that use `fork`, `join`, or `cancel` without running real sagas. Returns an extended `Task` with setters to control state.

```ts
import { createMockTask, fork, cancel, join } from 'zustand-sagas';

const task = createMockTask();
task.isRunning();   // true
task.isCancelled(); // false

// Control the mock
task.setRunning(false);
task.setResult(42);
task.result();      // 42

// Or simulate failure
task.setError(new Error('boom'));
await task.toPromise(); // rejects with 'boom'
```

Use it to step through a saga generator manually:

```ts
function* mySaga() {
  const task = yield fork(worker);
  yield delay(5000);
  yield cancel(task);
}

const gen = mySaga();
gen.next();                         // yield fork(worker) — returns ForkEffect

const mockTask = createMockTask();
gen.next(mockTask);                 // saga receives mockTask, yield delay(5000)
const cancelEffect = gen.next();    // yield cancel(mockTask)
expect(cancelEffect.value).toEqual(cancel(mockTask));
```

### `runSaga(saga, env, ...args)`

Runs a saga outside of a store. Useful for integration-testing sagas with a real runner but without attaching to a Zustand store.

```ts
import { runSaga, ActionChannel } from 'zustand-sagas';

const channel = new ActionChannel();
const state = { count: 0 };

const task = runSaga(mySaga, {
  channel,
  getState: () => state,
});

// Drive the saga by emitting actions
channel.emit({ type: 'increment', payload: 1 });

// Wait for the saga to complete
const result = await task.toPromise();

// Cancel if needed
task.cancel();
```

`runSaga` processes all effects (take, call, fork, actionChannel, etc.) the same way `createSaga` does — the only difference is that store actions aren't auto-wrapped.

## Type Safety

The `SagaApi<State>` interface derives all type information from your store's state type. Every action-related effect constrains its arguments to valid store function names and their parameter types.

### Typed results with `yield*`

Use `yield*` (yield-star) instead of `yield` to get fully typed effect results — no casts needed:

```ts
import type { Saga } from 'zustand-sagas';

createSaga(store, function* ({ take, select, fork, race, delay }): Saga {
  // action is TypedActionEvent<Store, 'increment'> — fully typed
  const action = yield* take('increment');

  // count is number — inferred from selector
  const count = yield* select((s) => s.count);

  // task is Task<void> — inferred from the forked saga's return type
  const task = yield* fork(function* (): Saga<void> { /* ... */ });

  // winner is { timeout: void | undefined; action: TypedActionEvent | undefined }
  const winner = yield* race({
    timeout: delay(5000),
    action: take('search'),
  });
});
```

Plain `yield` still works at the runtime level, but returns `unknown` at the type level — `yield*` is the recommended approach for new code.

### Action type checking

```ts
type Store = {
  count: number;
  increment: () => void;
  search: (q: string) => void;
  setPosition: (x: number, y: number) => void;
};

// Given SagaApi<StoreState>:
yield* take('increment');           // ✓
yield* take('count');               // ✗ — not a function
yield* take('typo');                // ✗ — doesn't exist

yield* put('search', 'query');      // ✓
yield* put('search');               // ✗ — missing required arg
yield* put('search', 123);          // ✗ — wrong arg type
yield* put('setPosition', 10, 20);  // ✓

yield* select((s) => s.count);      // s: Store, result: number
```

### How `yield*` works

Each effect object carries a `Symbol.iterator` that delegates to the saga runner via a single `yield`. When you write `yield* take('increment')`, TypeScript sees the generator's return type and infers the resolved value. The runner sees the same plain effect object it always has — no protocol change.

### Effect result types

| Effect                       | `yield*` result type                        |
|------------------------------|---------------------------------------------|
| `take('action')`             | `TypedActionEvent<State, 'action'>`         |
| `take(channel)`              | `Value` (channel's value type)              |
| `takeMaybe(channel)`         | `Value \| END`                              |
| `select((s) => s.count)`     | `number` (selector return type)             |
| `select()`                   | `State`                                     |
| `call(fn, ...args)`          | `ReturnType<fn>` (or generator return type) |
| `fork(saga)`                 | `Task<Result>` (saga's return type)         |
| `spawn(saga)`                | `Task<Result>`                              |
| `join(task)`                 | `Result` (task's result type)               |
| `cancel(task)`               | `void`                                      |
| `put('action', ...args)`     | `void`                                      |
| `delay(ms)`                  | `true`                                      |
| `race({ a, b })`            | `{ a: A \| undefined, b: B \| undefined }` |
| `all([effectA, effectB])`    | `[ResultA, ResultB]`                        |
| `allSettled([a, b])`         | `[SettledResult<A>, SettledResult<B>]`       |
| `actionChannel('pattern')`   | `Channel<TypedActionEvent>`                 |
| `flush(channel)`             | `Value[]`                                   |
| `retry(n, ms, fn, ...args)`  | `ReturnType<fn>`                            |

All effect types have sensible defaults, so unparameterized usage (`TakeEffect`, `JoinEffect`, etc.) works unchanged.

## Types

All types are exported for use in TypeScript projects:

```ts
import type {
  SagaApi,             // Typed effects injected into the root saga
  UseSaga,             // Return type of createSaga
  RootSagaFn,          // Root saga function signature
  ActionEvent,         // { type: string; payload?: unknown }
  ActionNames,         // Extracts function-property keys from a store state type
  ActionArgs,          // Extracts raw parameter tuple for a store action
  ActionPayload,       // Derives payload type for a given action
  TypedActionEvent,    // Typed action event for a specific store action
  ActionPattern,
  Effect,
  TakeEffect,          // TakeEffect<Value> — generic over channel value type
  TakeMaybeEffect,     // TakeMaybeEffect<Value>
  JoinEffect,          // JoinEffect<Result> — generic over task result type
  CancelEffect,        // CancelEffect<Result>
  FlushEffect,         // FlushEffect<Value>
  SelectEffect,        // SelectEffect<Result> — generic over selector return type
  RetryEffect,         // RetryEffect<Fn> — first-class retry effect
  UntilEffect,         // until effect type
  Task,                // Task<Result> — generic over result type
  Saga,                // User-facing saga generator type: Generator<Effect, Result, unknown>
  SagaFn,
  EffectDescriptor,    // Marker interface for yield* support on effects
  EffectResult,        // Extract resolved type from an effect: EffectResult<TakeEffect<V>> → V
  Channel,             // Channel interface
  Buffer,              // Buffer interface
  CallWorkerEffect,    // callWorker effect type
  ForkWorkerEffect,    // forkWorker effect type
  SpawnWorkerEffect,   // spawnWorker effect type
  WorkerFn,            // Function or URL accepted by worker effects
  ForkWorkerChannelEffect,  // forkWorkerChannel effect type
  CallWorkerGenEffect,      // callWorkerGen effect type
  WorkerConfig,        // configureWorkers option type
  MockTask,            // createMockTask return type (Task + setters)
  CloneableGenerator,  // Cloneable generator for testing
  AsyncSlice,          // Mapped type for async resource state + actions
  AsyncSagaOptions,    // Options for createAsyncSaga (strategy, retries, etc.)
  AsyncSagaStrategy,   // 'takeLatest' | 'takeEvery' | 'takeLeading' | 'debounce' | 'throttle'
  StandaloneAsyncSagaConfig, // Config for standalone createAsyncSaga
  SagaMonitor,         // Monitor interface for custom tooling
  SagaMonitorOptions,  // Options for createSagaMonitor
  CreateSagaOptions,   // Options for createSaga (monitor, etc.)
  StoreSagas,
  RunnerEnv,
} from 'zustand-sagas';
```

The middleware augments Zustand's store type to include `sagaTask` automatically.

## License

MIT
