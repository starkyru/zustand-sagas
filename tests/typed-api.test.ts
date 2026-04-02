import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { sagas, createSagaApi } from '../src';
import type { TypedActionEvent } from '../src';

type StoreState = {
  count: number;
  query: string;
  increment: () => void;
  search: (q: string) => void;
  setPosition: (x: number, y: number) => void;
};

// --- Type-level tests using standalone createSagaApi (compile-time) ---
const standaloneApi = createSagaApi<StoreState>();

// @ts-expect-error — 'typo' is not a store action
const _badTake = standaloneApi.take('typo');

// @ts-expect-error — 'count' is not a function property
const _badTakeData = standaloneApi.take('count');

// @ts-expect-error — 'query' is not a function property
const _badTakeData2 = standaloneApi.take('query');

// Valid calls — should compile fine
const _goodTake = standaloneApi.take('increment');
const _goodTake2 = standaloneApi.take('search');
const _goodTake3 = standaloneApi.take((a) => a.type === 'increment');

describe('DI: typed effects injected into root saga', () => {
  it('take only accepts valid store action names', async () => {
    let received: TypedActionEvent<StoreState, 'increment'> | undefined;

    const store = createStore(
      sagas(
        function* ({ take }) {
          received = yield take('increment');
        },
        (set) => ({
          count: 0,
          query: '',
          increment: () => set((s) => ({ ...s, count: s.count + 1 })),
          search: (q: string) => set((s) => ({ ...s, query: q })),
          setPosition: (x: number, y: number) => set({ x, y } as any),
        }),
      ),
    );

    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toBeDefined();
    expect(received!.type).toBe('increment');
  });

  it('takeEvery with typed worker receives typed payload', async () => {
    const queries: string[] = [];

    const store = createStore(
      sagas(
        function* ({ takeEvery }) {
          yield takeEvery('search', function* (action) {
            queries.push(action.payload);
          });
        },
        (set) => ({
          count: 0,
          query: '',
          increment: () => set((s) => ({ ...s, count: s.count + 1 })),
          search: (q: string) => set((s) => ({ ...s, query: q })),
          setPosition: (x: number, y: number) => set({ x, y } as any),
        }),
      ),
    );

    store.getState().search('hello');
    await new Promise((r) => setTimeout(r, 10));
    store.getState().search('world');
    await new Promise((r) => setTimeout(r, 10));

    expect(queries).toEqual(['hello', 'world']);
    store.sagaTask.cancel();
  });

  it('takeLatest with typed worker', async () => {
    const results: string[] = [];

    const store = createStore(
      sagas(
        function* ({ takeLatest, delay }) {
          yield takeLatest('search', function* (action) {
            yield delay(50);
            results.push(action.payload);
          });
        },
        (set) => ({
          count: 0,
          query: '',
          increment: () => set((s) => ({ ...s, count: s.count + 1 })),
          search: (q: string) => set((s) => ({ ...s, query: q })),
          setPosition: (x: number, y: number) => set({ x, y } as any),
        }),
      ),
    );

    store.getState().search('first');
    await new Promise((r) => setTimeout(r, 10));
    store.getState().search('second');
    await new Promise((r) => setTimeout(r, 100));

    expect(results).toEqual(['second']);
    store.sagaTask.cancel();
  });

  it('multi-arg actions have tuple payload type', async () => {
    let received: TypedActionEvent<StoreState, 'setPosition'> | undefined;

    const store = createStore(
      sagas(
        function* ({ take }) {
          received = yield take('setPosition');
        },
        (set) => ({
          count: 0,
          query: '',
          increment: () => set((s) => ({ ...s, count: s.count + 1 })),
          search: (q: string) => set((s) => ({ ...s, query: q })),
          setPosition: (x: number, y: number) => set({ x, y } as any),
        }),
      ),
    );

    store.getState().setPosition(10, 20);
    await new Promise((r) => setTimeout(r, 10));

    expect(received!.type).toBe('setPosition');
    expect(received!.payload).toEqual([10, 20]);
  });

  it('predicate pattern still works', async () => {
    let received: any;

    const store = createStore(
      sagas(
        function* ({ take }) {
          received = yield take((a) => a.type.startsWith('inc'));
        },
        (set) => ({
          count: 0,
          query: '',
          increment: () => set((s) => ({ ...s, count: s.count + 1 })),
          search: (q: string) => set((s) => ({ ...s, query: q })),
          setPosition: (x: number, y: number) => set({ x, y } as any),
        }),
      ),
    );

    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));
    expect(received.type).toBe('increment');

    store.sagaTask.cancel();
  });
});

describe('createSagaApi — standalone typed API', () => {
  it('still works for sagas defined outside the middleware', async () => {
    const { takeEvery } = createSagaApi<StoreState>();
    const queries: string[] = [];

    function* onSearch(action: TypedActionEvent<StoreState, 'search'>) {
      queries.push(action.payload);
    }

    const store = createStore(
      sagas(
        function* () {
          yield takeEvery('search', onSearch);
        },
        (set) => ({
          count: 0,
          query: '',
          increment: () => set((s) => ({ ...s, count: s.count + 1 })),
          search: (q: string) => set((s) => ({ ...s, query: q })),
          setPosition: (x: number, y: number) => set({ x, y } as any),
        }),
      ),
    );

    store.getState().search('test');
    await new Promise((r) => setTimeout(r, 10));

    expect(queries).toEqual(['test']);
    store.sagaTask.cancel();
  });
});
