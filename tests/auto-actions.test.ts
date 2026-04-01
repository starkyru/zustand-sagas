import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { sagas } from '../src/middleware';
import type { ActionEvent } from '../src/types';

describe('auto-actions: store functions emit actions on the saga channel', () => {
  it('calling a store action triggers a saga via take()', async () => {
    let received: ActionEvent | undefined;

    const store = createStore(
      sagas(function* ({ take }) {
        received = yield take('increment');
      }, (set) => ({
        count: 0,
        increment: () => set((s) => ({ ...s, count: s.count + 1 })),
      })),
    );

    store.getState().increment();

    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBeDefined();
    expect(received!.type).toBe('increment');
    expect(store.getState().count).toBe(1);

    store.sagaTask.cancel();
  });

  it('action payload is passed through', async () => {
    let received: ActionEvent | undefined;

    const store = createStore(
      sagas(function* ({ take }) {
        received = yield take('addTodo');
      }, (set) => ({
        todos: [] as string[],
        addTodo: (text: string) =>
          set((s) => ({ ...s, todos: [...s.todos, text] })),
      })),
    );

    store.getState().addTodo('buy milk');

    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBeDefined();
    expect(received!.type).toBe('addTodo');
    expect(received!.payload).toBe('buy milk');
    expect(store.getState().todos).toEqual(['buy milk']);

    store.sagaTask.cancel();
  });

  it('multiple args become array payload', async () => {
    let received: ActionEvent | undefined;

    const store = createStore(
      sagas(function* ({ take }) {
        received = yield take('setPosition');
      }, (set) => ({
        x: 0,
        y: 0,
        setPosition: (x: number, y: number) => set({ x, y }),
      })),
    );

    store.getState().setPosition(10, 20);

    await new Promise((r) => setTimeout(r, 10));
    expect(received!.payload).toEqual([10, 20]);

    store.sagaTask.cancel();
  });

  it('no-arg action has undefined payload', async () => {
    let received: ActionEvent | undefined;

    const store = createStore(
      sagas(function* ({ take }) {
        received = yield take('reset');
      }, (set) => ({
        count: 5,
        reset: () => set({ count: 0 }),
      })),
    );

    store.getState().reset();

    await new Promise((r) => setTimeout(r, 10));
    expect(received!.type).toBe('reset');
    expect(received!.payload).toBeUndefined();

    store.sagaTask.cancel();
  });

  it('works with takeEvery helper', async () => {
    const log: number[] = [];

    const store = createStore(
      sagas(function* ({ takeEvery, select }) {
        yield* takeEvery('increment', function* () {
          const count: number = yield select((s: any) => s.count);
          log.push(count);
        });
      }, (set) => ({
        count: 0,
        increment: () => set((s) => ({ ...s, count: s.count + 1 })),
      })),
    );

    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));
    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));

    expect(log).toEqual([1, 2]);
    expect(store.getState().count).toBe(2);

    store.sagaTask.cancel();
  });

  it('saga can react to action and perform async side effect', async () => {
    const store = createStore(
      sagas(function* ({ takeEvery, delay, call }) {
        yield* takeEvery('search', function* (action) {
          yield delay(10);
          const query = action.payload as string;
          yield call(() =>
            store.setState((s) => ({ ...s, results: [`result for ${query}`] })),
          );
        });
      }, (set) => ({
        query: '',
        results: [] as string[],
        search: (q: string) => set((s) => ({ ...s, query: q })),
      })),
    );

    store.getState().search('zustand');

    await new Promise((r) => setTimeout(r, 50));
    expect(store.getState().query).toBe('zustand');
    expect(store.getState().results).toEqual(['result for zustand']);

    store.sagaTask.cancel();
  });

  it('predicate pattern works with auto-actions', async () => {
    let received: ActionEvent | undefined;

    const store = createStore(
      sagas(function* ({ take }) {
        received = yield take((action: ActionEvent) => action.type.startsWith('add'));
      }, (set) => ({
        items: [] as string[],
        addItem: (item: string) =>
          set((s) => ({ ...s, items: [...s.items, item] })),
      })),
    );

    store.getState().addItem('test');

    await new Promise((r) => setTimeout(r, 10));
    expect(received!.type).toBe('addItem');
    expect(received!.payload).toBe('test');

    store.sagaTask.cancel();
  });
});
