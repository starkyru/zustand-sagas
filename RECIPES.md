# Recipes

Common patterns for zustand-sagas, adapted from [redux-saga recipes](https://redux-saga.js.org/docs/recipes).

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
