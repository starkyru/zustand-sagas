import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { sagas } from '../src/middleware';
import { END } from '../src/channels';
import type { ActionEvent } from '../src/types';

describe('integration', () => {
  it('async counter: action → saga delays → state updates', async () => {
    const store = createStore(
      sagas(
        function* ({ takeEvery, delay, select, call }) {
          yield takeEvery('incrementAsync', function* () {
            yield delay(30);
            const count: number = yield select((s: any) => s.count);
            yield call(() => store.setState((s) => ({ ...s, count: count + 1 })));
          });
        },
        (set) => ({
          count: 0,
          incrementAsync: () => {},
        }),
      ),
    );

    store.getState().incrementAsync();
    await new Promise((r) => setTimeout(r, 60));
    store.getState().incrementAsync();

    await new Promise((r) => setTimeout(r, 60));
    expect(store.getState().count).toBe(2);

    store.sagaTask.cancel();
  });

  it('race: timeout wins over slow action', async () => {
    let result: Record<string, unknown> | undefined;

    const store = createStore(
      sagas(
        function* ({ take, race, delay }) {
          result = yield race({
            action: take('slowAction'),
            timeout: delay(30),
          });
        },
        (set) => ({
          slowAction: () => {},
        }),
      ),
    );

    // Don't call slowAction — timeout should win
    await new Promise((r) => setTimeout(r, 80));

    expect(result).toBeDefined();
    expect(result!.timeout).toBeUndefined();
    expect(result!.action).toBeUndefined();
    expect('timeout' in result!).toBe(true);
  });

  it('race: action wins over timeout', async () => {
    let result: Record<string, unknown> | undefined;

    const store = createStore(
      sagas(
        function* ({ take, race, delay }) {
          result = yield race({
            action: take('fastAction'),
            timeout: delay(500),
          });
        },
        (set) => ({
          fastAction: () => {},
        }),
      ),
    );

    store.getState().fastAction();
    await new Promise((r) => setTimeout(r, 50));

    expect(result).toBeDefined();
    expect(result!.action).toEqual({ type: 'fastAction', payload: undefined });
    expect(result!.timeout).toBeUndefined();
  });

  it('saga-to-saga communication via store actions', async () => {
    const log: string[] = [];

    const store = createStore(
      sagas(
        function* ({ take, fork, delay, call }) {
          function* producer() {
            yield delay(10);
            yield call(() => store.getState().dataReady('hello'));
          }

          function* consumer() {
            const action: ActionEvent = yield take('dataReady');
            log.push(`received: ${action.payload}`);
          }

          yield fork(consumer);
          yield fork(producer);
        },
        (set) => ({
          data: null as string | null,
          dataReady: (value: string) => set((s) => ({ ...s, data: value })),
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(log).toEqual(['received: hello']);
    expect(store.getState().data).toBe('hello');
  });

  it('nested forks', async () => {
    const log: string[] = [];

    const store = createStore(
      sagas(
        function* ({ fork, delay }) {
          function* child2() {
            log.push('child2');
          }

          function* child1() {
            log.push('child1-start');
            yield fork(child2);
            log.push('child1-end');
          }

          yield fork(child1);
          yield delay(20);
        },
        () => ({}),
      ),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(log).toContain('child1-start');
    expect(log).toContain('child1-end');
    expect(log).toContain('child2');
  });

  it('all: waits for multiple effects', async () => {
    let result: unknown;

    const store = createStore(
      sagas(
        function* ({ take, delay, select, all }) {
          yield take('go');
          result = yield all([delay(10), delay(20), select((s: any) => s.value)]);
        },
        (set) => ({
          value: 'test',
          go: () => {},
        }),
      ),
    );

    store.getState().go();
    await new Promise((r) => setTimeout(r, 50));
    expect(result).toEqual([undefined, undefined, 'test']);
    store.sagaTask.cancel();
  });

  it('allSettled: waits for all effects, captures successes and failures', async () => {
    let result: unknown;

    const store = createStore(
      sagas(
        function* ({ take, call, delay, allSettled }) {
          yield take('go');
          result = yield allSettled([
            delay(10),
            call(() => 'ok'),
            call(() => {
              throw new Error('boom');
            }),
          ]);
        },
        (set) => ({
          go: () => {},
        }),
      ),
    );

    store.getState().go();
    await new Promise((r) => setTimeout(r, 50));
    expect(result).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: 'ok' },
      { status: 'rejected', reason: new Error('boom') },
    ]);
    store.sagaTask.cancel();
  });

  it('until: resolves immediately when predicate is already true (string key)', async () => {
    let resolved = false;

    const store = createStore(
      sagas(
        function* ({ until }) {
          yield until('ready');
          resolved = true;
        },
        (set) => ({
          ready: true,
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(true);
    store.sagaTask.cancel();
  });

  it('until: waits for state change with string key', async () => {
    let resolved = false;

    const store = createStore(
      sagas(
        function* ({ until }) {
          yield until('ready');
          resolved = true;
        },
        (set) => ({
          ready: false,
          setReady: () => set((s) => ({ ...s, ready: true })),
        }),
      ),
    );

    expect(resolved).toBe(false);
    store.getState().setReady();
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(true);
    store.sagaTask.cancel();
  });

  it('until: waits for state change with selector function', async () => {
    let resolved = false;

    const store = createStore(
      sagas(
        function* ({ until }) {
          yield until((s: any) => s.count >= 3);
          resolved = true;
        },
        (set) => ({
          count: 0,
          increment: () => set((s) => ({ ...s, count: s.count + 1 })),
        }),
      ),
    );

    expect(resolved).toBe(false);
    store.getState().increment();
    store.getState().increment();
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    store.getState().increment();
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(true);
    store.sagaTask.cancel();
  });

  it('until: returns END on timeout', async () => {
    let result: unknown;

    const store = createStore(
      sagas(
        function* ({ until }) {
          result = yield until('ready', 30);
        },
        (set) => ({
          ready: false,
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 60));
    expect(result).toBe(END);
    store.sagaTask.cancel();
  });

  it('until: resolves before timeout when predicate becomes true', async () => {
    let result: unknown;

    const store = createStore(
      sagas(
        function* ({ until }) {
          result = yield until('ready', 500);
        },
        (set) => ({
          ready: false,
          setReady: () => set((s) => ({ ...s, ready: true })),
        }),
      ),
    );

    store.getState().setReady();
    await new Promise((r) => setTimeout(r, 20));
    expect(result).toBe(true);
    store.sagaTask.cancel();
  });

  it('error handling in saga with try/catch', async () => {
    const store = createStore(
      sagas(
        function* ({ call }) {
          function* failingWorker() {
            throw new Error('oops');
          }

          try {
            yield call(failingWorker);
          } catch (e: any) {
            yield call(() => store.setState((s) => ({ ...s, error: e.message })));
          }
        },
        (set) => ({
          error: null as string | null,
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().error).toBe('oops');
  });
});
