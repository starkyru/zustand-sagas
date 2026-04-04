# zustand-sagas

Generator-based side effect management for Zustand. Inspired by redux-saga, redesigned for Zustand's function-based actions.

## Architecture

- `src/types.ts` — all effect types, `EffectDescriptor<Result>` marker for `yield*`, `Saga`, `SagaFn`, `Task`
- `src/effects.ts` — effect creator functions (`take`, `call`, `fork`, etc.). Every effect goes through `makeEffect()` which attaches `Symbol.iterator` for `yield*` support
- `src/api.ts` — `SagaApi<State>` typed interface + `createSagaApi()` factory. Wraps untyped effects with store-aware type overloads
- `src/runner.ts` — the saga runner. Processes effects via `iterator.next(value)`. Does NOT use `Symbol.iterator` on effects — that's only for `yield*` in user code
- `src/helpers.ts` — `takeEvery`, `takeLatest`, `takeLeading`, `debounce`, `throttle` — composed from core effects
- `src/channels.ts` — `channel()`, `multicastChannel()`, `eventChannel()`, `END`
- `src/buffers.ts` — buffer strategies (none, fixed, dropping, sliding, expanding)
- `src/middleware.ts` — `sagas()` Zustand middleware
- `src/createSaga.ts` — `createSaga()` primary API
- `src/asyncSaga.ts` — `createAsyncSaga()` helper for fetch-and-settle patterns
- `src/asyncSlice.ts` — `createAsyncSlice()` state/action generator
- `src/workerPlatform.ts` — Web Worker / worker thread abstraction
- `src/monitor.ts` — `createSagaMonitor()` for debugging
- `src/testing.ts` — `createMockTask()`
- `src/cloneableGenerator.ts` — `cloneableGenerator()` for testing branches

## Key patterns

### `yield*` for typed results

All effects support `yield*` which gives TypeScript full type inference on the resolved value:

```ts
const action = yield* take('increment');   // TypedActionEvent<State, 'increment'>
const count = yield* select((s) => s.count); // number
const task = yield* fork(mySaga);          // Task<Result>
```

Plain `yield` still works at runtime but returns `unknown` at the type level.

### How effects work

1. Effect creators return plain objects with a `type` symbol
2. `makeEffect()` attaches a non-enumerable `Symbol.iterator` that does `return yield effect`
3. The runner calls `iterator.next()` / `iterator.next(value)` on the saga generator
4. `yield*` delegates to the effect's iterator, which yields the effect to the runner and returns the resolved value

### Store action interception

`createSaga` wraps every function in the store. When called:
1. Original function runs (state updates via `set()`)
2. `ActionEvent` emitted on internal channel
3. Sagas listening via `take` receive the event

### Cancellation

Cooperative — checked after each yielded effect. Parent cancellation cascades to forked children but not spawned tasks.

## Conventions

- State mutations happen in store actions, not in sagas
- Sagas are for side effects: API calls, async flows, coordination
- Use `call(() => store.setState(...))` to update state from sagas
- `put('actionName', ...args)` emits to the saga channel (does NOT call the store action)
- Effect types use `EffectDescriptor<Result>` for `yield*` support
- All effect types have sensible defaults so unparameterized usage works

## Testing

```bash
npx vitest run          # run all tests
npx tsc --noEmit        # type-check
```

## Commits

- Don't mention AI tools in commit messages
- Don't add Co-Authored-By lines
