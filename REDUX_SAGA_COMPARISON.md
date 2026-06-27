# redux-saga vs zustand-sagas

A behavior-level comparison of [redux-saga](https://redux-saga.js.org/docs/api/) and
zustand-sagas. zustand-sagas borrows redux-saga's generator-effect model but is rebuilt
for Zustand's function-based actions instead of Redux's reducer + dispatch pipeline. Most
effect creators have the same name and shape; the deep differences are in **what `take`
and `put` operate on** and in a handful of missing / added effects.

> Source of truth: redux-saga API docs (linked above) and this repo's `src/`. Verified
> against `effects.ts`, `runner.ts`, `channels.ts`, `buffers.ts`, `helpers.ts`,
> `createSaga.ts`, `task.ts` as of this writing.

---

## 1. The core mental-model difference

redux-saga and zustand-sagas both run a generator and interpret yielded effect objects.
What differs is the **message bus** they sit on.

| | redux-saga | zustand-sagas |
|---|---|---|
| Substrate | Redux: reducers + single `dispatch` stream | Zustand: function-based store actions |
| What `take(pattern)` listens to | **dispatched actions** flowing through the store | **store action function calls** — `createSaga` wraps every function on the store; calling it emits an `ActionEvent` *after* the original runs (`createSaga.ts:29-38`) |
| What `put(action)` does | **dispatches** the action — reducers run, other middleware run, other sagas see it | **only emits to the internal saga channel** — it does **NOT** call the store action and does **NOT** mutate state (`runner.ts:591-594`) |
| Where state changes | reducers (pure) | store actions, or `call(() => store.setState(...))` from a saga |

### The sharpest gotcha: `put` does not dispatch

In redux-saga, `yield put({type: 'increment'})` runs the `increment` reducer. In
zustand-sagas, `yield put('increment')` **does not run the `increment` store action** — it
only wakes sagas blocked on `take('increment')`. To actually change state from a saga you
call the store action or `setState` through `call`:

```ts
// zustand-sagas — change state from a saga
yield* call(() => store.setState({ count: 5 }));
// or invoke a wrapped store action (which also re-emits to the channel)
yield* call(() => store.getState().increment());
```

This is a direct consequence of there being no reducer: `put` is a saga-to-saga
notification, not a state mutation.

---

## 2. Effect-by-effect parity

### Present in both (same intent)

| Effect | redux-saga | zustand-sagas | Notes on divergence |
|---|---|---|---|
| `take(pattern\|channel)` | matches dispatched actions; `END` terminates | matches store-action calls; closed channel → terminate (`runner.ts:507`) | pattern = string / string[] / predicate in both |
| `takeMaybe` | like `take` but `END` arrives as a value | same — does not auto-terminate on close | |
| `put` | **dispatches** | **emits to saga channel only** (no dispatch, no state change) | see §1 |
| `call(fn, ...args)` | blocking; handles sync/promise/generator | same (`runner.ts:552-558`) | |
| `select(selector?)` | `selector(getState())`, full state if omitted | same against Zustand `getState` (`runner.ts:560-563`) | redux-saga passes extra `select(sel, ...args)`; here pass a closure |
| `fork(fn, ...args)` | non-blocking, attached; child errors bubble; cancel cascades | same (`runner.ts:565-582`) | |
| `spawn(fn, ...args)` | detached; errors don't bubble | same (`runner.ts:584-589`) | |
| `join(task)` | block on task; joined task's error routes to joiner | same; `joinedTasks` suppresses auto-bubble (`runner.ts:596-599, 572`) | |
| `cancel(task)` | cancel, runs `finally` via `return()` | same (`runner.ts` `finalizeGenerator`) | |
| `cancelled()` | `true` if current task was cancelled; for `finally` | same — returns `cancelFlag`; `finally`-yielded effects run during teardown (`runner.ts` `CANCELLED` + `finalizeGenerator`) | |
| `cps(fn, ...)` | node-style `(err, res)` callback | same (`runner.ts:606-613`) | |
| `delay(ms)` | `delay(ms, val)` returns `val` | `delay(ms)` returns `true` only — **no value arg** (`types.ts:175`) | |
| `actionChannel(pattern, buf?)` | queue matching actions | same, **default buffer differs** (see §5) | |
| `flush(channel)` | drain buffered items | same (`runner.ts:686-688`) | |
| `retry(maxTries, delay, fn, ...)` | blocking retry | same; **validates `maxTries` is integer ≥ 1, throws otherwise** (`effects.ts:207`) | |
| `race(effects)` | first winner, losers cancelled | same; closed-channel take in a branch terminates the saga (`runner.ts:792-795`) | |
| `all(effects)` | parallel, fail-fast | same; cancels remaining on failure (`runner.ts:805-822`) | |
| `takeEvery` | fork worker per action | same composition (`helpers.ts:4-14`) | |
| `takeLatest` | cancel previous, fork newest | same (`helpers.ts:16-30`) | |
| `takeLeading` | ignore while running | same (`helpers.ts:32-42`) | |
| `debounce` | settle then run | same (`helpers.ts:44-62`) | |
| `throttle` | run then ignore for `ms` | same (`helpers.ts:64-76`) | |

### Channels / buffers / testing (both)

`channel()`, `eventChannel()`, `multicastChannel()`, `buffers.{none,fixed,dropping,sliding,expanding}`,
`cloneableGenerator()`, `createMockTask()`, a saga monitor interface — all present in both.

---

## 3. In redux-saga, MISSING in zustand-sagas

| redux-saga API | What it does | zustand-sagas status / workaround |
|---|---|---|
| `setContext` / `getContext` | task-local context dictionary inherited by children | **Missing.** No saga-context mechanism. Use closures or the Zustand store. |
| `putResolve(action)` | blocking `put` that awaits dispatch + bubbles downstream errors | **Missing** — and largely N/A, since `put` here doesn't dispatch at all. |
| `apply(ctx, fn, args)` | `call` with explicit `this` | **Missing.** Use `call(() => obj.method(...))`. |
| `delay(ms, val)` 2nd arg | resolve with a value | **Missing** — `delay(ms)` resolves to `true`. |
| `runSaga(options, saga)` standalone | run a saga outside middleware with `{channel, dispatch, getState, onError, context, ...}` | Internal `runSaga` exists (`runner.ts:298`) but is **not the same public, options-rich entry point**. Public entry is `createSaga` / `sagas` middleware. |
| `stdChannel()` | the multicast std channel the middleware uses | **Not exposed.** The internal `ActionChannel` plays this role. |
| `Task.setContext` / `Task.error()` / `Task.isAborted()` | richer task introspection | zustand-sagas `Task` has `id, isRunning, isCancelled, result, toPromise, cancel` only (`task.ts`, `types.ts:321-328`) — **no `error()`, `isAborted()`, `setContext`**. |
| `onError` middleware option | top-level uncaught-saga error hook | **No dedicated `onError`.** Use the monitor's `onTaskError` or wrap the root saga. |
| `effectMiddlewares` | intercept/transform effects | **Missing.** |

---

## 4. In zustand-sagas, NOT in redux-saga (extensions)

| zustand-sagas API | What it does |
|---|---|
| `allSettled(effects)` | `Promise.allSettled` semantics — never fail-fast; returns `{status, value\|reason}[]` (`runner.ts:824-831`) |
| `until(predicate, timeout?)` | block until a Zustand state predicate becomes truthy (subscribe-based); `timeout` resolves to `END` (`runner.ts:719-772`). String form watches a top-level key. |
| `callWorker` / `forkWorker` / `spawnWorker` / `forkWorkerChannel` / `callWorkerGen` | run a **self-contained** function in a Web Worker / worker thread; fn is serialized via `toString()` so closures/imports/`this` are lost — pass everything via `args` (`effects.ts:219-273`) |
| `createAsyncSaga` | fetch-and-settle helper (`src/asyncSaga.ts`) |
| `createAsyncSlice` | state + action generator for async patterns (`src/asyncSlice.ts`) |
| First-class `yield*` typing | every effect is an `EffectDescriptor<Result>`, so `const x = yield* select(...)` is fully typed without a separate `typed-redux-saga` package (`types.ts:48-51`) |

---

## 5. Channels & buffers — default buffers (mostly matching)

Verified against redux-saga **source** (`internal/channel.js`, `internal/buffers.js`,
`internal/effectRunnerMap.js`), not just the prose docs. The defaults are:

| Factory | redux-saga default | zustand-sagas default | match? |
|---|---|---|---|
| `channel()` | `buffers.expanding()` — **unbounded** (doubles capacity) | `buffers.expanding()` (`channels.ts:178`) | ✅ |
| `actionChannel()` | `channel(buffer)` → `buffers.expanding()` — **unbounded** | `buffers.expanding()` (`effects.ts:188`) | ✅ |
| `eventChannel()` | `buffers.none()` — **drops if no taker registered** | `buffers.none()` (`channels.ts`) | ✅ |
| `multicastChannel()` / `stdChannel()` | no buffer (multicast) | no buffer (`channels.ts:181-188`) | ✅ |

So **all default buffers now match redux-saga**: `channel()`/`actionChannel()` are unbounded
(`expanding()`), and `eventChannel()` defaults to `buffers.none()` — events emitted while no
taker is waiting are dropped. Pass an explicit buffer to an `eventChannel` for bursty sources.

Buffer **strategies** match exactly: `none` (drop), `fixed` (throw on overflow, default limit
10), `dropping` (drop new on overflow), `sliding` (drop oldest on overflow), `expanding`
(grow). See `buffers.ts`.

**zustand-sagas-only safety extra:** because the unbounded default can leak when an
`actionChannel` is never drained, the runner logs a **one-time `console.warn`** once the
undrained backlog crosses 10,000 items (`runner.ts`). redux-saga has no such warning. The
warning is opt-out:

```ts
createSaga(store, rootSaga, { warnOnUnboundedActionChannel: false });
// or pass an explicit bounded buffer
yield* actionChannel('scroll', buffers.sliding(50));
```

`multicastChannel` note (`channels.ts:181-188`): all takers receive the **same object
reference** — treat delivered items as immutable.

---

## 6. Cancellation & error propagation (mostly matching)

These behave like redux-saga, confirmed in `runner.ts`:

- **Cooperative cancellation**, checked after each yielded effect; teardown runs the saga's
  `finally` blocks via `finalizeGenerator`, which also **processes effects yielded from
  `finally`** (e.g. `cancelled()`, cleanup `call`s) instead of discarding them.
- **`cancelled()`** returns `true` during a cancellation-triggered teardown and `false` during
  a normal END teardown — matching redux-saga.
- **`fork` errors bubble to the parent** and cancel sibling forks (`runner.ts:565-582`).
- **`spawn` is detached** — errors are swallowed at the boundary (`runner.ts:584-589`).
- **`join`ed task** routes its error to the joiner instead of auto-bubbling (`joinedTasks`,
  `runner.ts:572,597`).
- **Parent cancel cascades to forked children, not spawned** (`runner.ts:330-334`).

Caveat: avoid **blocking** effects (`take`, `delay`) inside a `finally` reached via
cancellation — in-flight cleanups are already flushed, so they cannot be force-resolved and
will hang (redux-saga gives the same "don't block in finally" guidance).

The remaining gap vs redux-saga: a slimmer `Task` (no `error()` / `isAborted()` /
`setContext`).

---

## 7. Quick migration cheatsheet (redux-saga → zustand-sagas)

| You wrote (redux-saga) | Write instead (zustand-sagas) |
|---|---|
| `yield put({type:'inc'})` to change state | `yield* call(() => store.getState().inc())` or `call(() => store.setState(...))` |
| `yield put({type:'evt'})` to signal other sagas | `yield* put('evt', ...args)` (no state change) |
| `const s = yield select(sel)` | `const s = yield* select(sel)` |
| `if (yield cancelled()) {...}` in `finally` | `if (yield* cancelled()) {...}` — same semantics |
| `yield getContext('x')` | use a closure / read from the store |
| `yield delay(200, 'done')` | `yield* delay(200)` (returns `true`, ignore value) |
| `apply(obj, obj.m, [a])` | `call(() => obj.m(a))` |
| `channel()` relying on bounded default | identical — both default to unbounded `expanding()` |
| `eventChannel(sub)` relying on `none()` default | identical — both default to `buffers.none()` (lossy without a taker) |

---

## Summary

zustand-sagas is a faithful re-implementation of redux-saga's effect vocabulary and
fork/cancel/error model, minus the Redux substrate. The one thing to internalize when
porting: **`take`/`put` ride store-action calls, not a dispatch stream, and `put` never
mutates state**. On buffers the two libraries now agree on every default —
`channel()`/`actionChannel()` are unbounded (`expanding()`) and `eventChannel()` is
`buffers.none()` in both — and zustand-sagas adds an opt-out 10k-undrained warning redux-saga
lacks. The extras — `until`, `allSettled`, worker effects, and built-in `yield*` typing — have
no redux-saga equivalent; the notable omissions are `setContext`/`getContext`, `putResolve`,
`apply`, and a richer standalone `runSaga`.
</content>
</invoke>
