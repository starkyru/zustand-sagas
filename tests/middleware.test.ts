import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { sagas } from '../src/middleware';
import type { ActionEvent } from '../src/types';

describe('sagas middleware', () => {
  it('creates a store with sagaTask', () => {
    const store = createStore(
      sagas(function* ({ take }) {
        yield take('neverCalled');
      }, (set) => ({
        count: 0,
        neverCalled: () => {},
      })),
    );

    expect(store.getState().count).toBe(0);
    expect(store.sagaTask).toBeDefined();
    expect(store.sagaTask.isRunning()).toBe(true);

    store.sagaTask.cancel();
  });

  it('store actions trigger sagas via take()', async () => {
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
  });

  it('select reads current store state', async () => {
    let selectedCount: number | undefined;

    const store = createStore(
      sagas(function* ({ take, select }) {
        yield take('readCount');
        selectedCount = yield select((s: any) => s.count);
      }, (set) => ({
        count: 42,
        readCount: () => {},
      })),
    );

    store.getState().readCount();
    await new Promise((r) => setTimeout(r, 10));
    expect(selectedCount).toBe(42);
  });

  it('call with set mutates store state from saga', async () => {
    const store = createStore(
      sagas(function* ({ take, select, call }) {
        yield take('triggerInc');
        const count: number = yield select((s: any) => s.count);
        yield call(() => store.setState((s) => ({ ...s, count: count + 10 })));
      }, (set) => ({
        count: 0,
        triggerInc: () => {},
      })),
    );

    store.getState().triggerInc();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getState().count).toBe(10);
  });
});
