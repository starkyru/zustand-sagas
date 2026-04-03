import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createSaga } from '../src/createSaga';
import type { ActionEvent } from '../src/types';

describe('createSaga', () => {
  it('attaches sagas to an existing store', async () => {
    const store = createStore<{
      count: number;
      increment: () => void;
    }>((set) => ({
      count: 0,
      increment: () => set((s) => ({ ...s, count: s.count + 1 })),
    }));

    let received: ActionEvent | undefined;

    const useSaga = createSaga(store, function* ({ take }) {
      received = yield take('increment');
    });

    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toBeDefined();
    expect(received!.type).toBe('increment');
    expect(store.getState().count).toBe(1);

    useSaga.task.cancel();
  });

  it('child sagas use injected api via closure', async () => {
    const store = createStore<{
      count: number;
      increment: () => void;
      decrement: () => void;
    }>((set) => ({
      count: 0,
      increment: () => set((s) => ({ ...s, count: s.count + 1 })),
      decrement: () => set((s) => ({ ...s, count: s.count - 1 })),
    }));

    const log: string[] = [];

    // Child sagas use the injected api from the root saga's closure
    const useSaga = createSaga(store, function* ({ take, fork }) {
      function* watchIncrement() {
        while (true) {
          yield take('increment');
          log.push('inc');
        }
      }

      function* watchDecrement() {
        while (true) {
          yield take('decrement');
          log.push('dec');
        }
      }

      yield fork(watchIncrement);
      yield fork(watchDecrement);
    });

    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));
    store.getState().decrement();
    await new Promise((r) => setTimeout(r, 10));
    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));

    expect(log).toEqual(['inc', 'dec', 'inc']);
    expect(store.getState().count).toBe(1);

    useSaga.task.cancel();
  });

  it('useSaga() works in separate worker sagas triggered later', async () => {
    const store = createStore<{
      count: number;
      increment: () => void;
    }>((set) => ({
      count: 0,
      increment: () => set((s) => ({ ...s, count: s.count + 1 })),
    }));

    const counts: number[] = [];

    // useSaga is assigned before any worker runs (workers run on action trigger)
    let useSaga: ReturnType<
      typeof createSaga<typeof store extends { getState: () => infer T } ? T : never>
    >;

    useSaga = createSaga(store, function* ({ takeEvery }) {
      yield takeEvery('increment', function* () {
        // useSaga is initialized by now — this runs on action dispatch, not during createSaga
        const { select } = useSaga();
        const count: number = yield select((s) => s.count);
        counts.push(count);
      });
    });

    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));
    store.getState().increment();
    await new Promise((r) => setTimeout(r, 10));

    expect(counts).toEqual([1, 2]);

    useSaga.task.cancel();
  });

  it('exposes task for lifecycle control', async () => {
    const store = createStore<{
      startPolling: () => void;
    }>(() => ({
      startPolling: () => {},
    }));

    const useSaga = createSaga(store, function* ({ take }) {
      yield take('startPolling');
    });

    expect(useSaga.task.isRunning()).toBe(true);
    useSaga.task.cancel();
    expect(useSaga.task.isCancelled()).toBe(true);
  });

  it('restores store.setState after saga cancellation', async () => {
    const store = createStore<{
      count: number;
      increment: () => void;
    }>((set) => ({
      count: 0,
      increment: () => set((s) => ({ ...s, count: s.count + 1 })),
    }));

    const originalSetState = store.setState;
    const useSaga = createSaga(store, function* ({ take }) {
      yield take('increment');
    });

    expect(store.setState).not.toBe(originalSetState);

    useSaga.task.cancel();
    await useSaga.task.toPromise();

    expect(store.setState).toBe(originalSetState);
  });

  it('works with async side effects', async () => {
    const store = createStore<{
      data: string | null;
      fetchData: () => void;
    }>((_set) => ({
      data: null,
      fetchData: () => {},
    }));

    const useSaga = createSaga(store, function* ({ takeEvery, delay, call }) {
      yield takeEvery('fetchData', function* () {
        yield delay(10);
        yield call(() => store.setState({ data: 'loaded' }));
      });
    });

    store.getState().fetchData();
    await new Promise((r) => setTimeout(r, 50));

    expect(store.getState().data).toBe('loaded');

    useSaga.task.cancel();
  });

  it('saga can trigger store actions via call', async () => {
    const store = createStore<{
      result: string | null;
      startProcess: () => void;
      processComplete: (value: string) => void;
    }>((set) => ({
      result: null,
      startProcess: () => {},
      processComplete: (value: string) => set({ result: value }),
    }));

    const useSaga = createSaga(store, function* ({ take, call, delay }) {
      yield take('startProcess');
      yield delay(10);
      yield call(() => store.getState().processComplete('done'));
    });

    store.getState().startProcess();
    await new Promise((r) => setTimeout(r, 50));

    expect(store.getState().result).toBe('done');

    useSaga.task.cancel();
  });
});
