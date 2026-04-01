import { describe, it, expect, vi } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { takeEvery, takeLatest, takeLeading, debounce } from '../src/helpers';
import { delay, select, call } from '../src/effects';
import type { Effect, ActionEvent, SagaContext } from '../src/types';

function createEnv(state: Record<string, unknown> = {}): RunnerEnv {
  return {
    channel: new ActionChannel(),
    getState: () => state,
    context: {
      set: (partial: unknown) => Object.assign(state, partial),
      get: () => state,
    },
  };
}

describe('takeEvery', () => {
  it('forks worker for each matching action', async () => {
    const calls: string[] = [];

    function* worker(action: ActionEvent) {
      calls.push(action.type);
    }

    function* rootSaga() {
      yield* takeEvery('increment', worker as any);
    }

    const env = createEnv();
    const task = runSaga(rootSaga as any, env);

    env.channel.emit({ type: 'increment' });
    await new Promise((r) => setTimeout(r, 10));
    env.channel.emit({ type: 'increment' });
    await new Promise((r) => setTimeout(r, 10));

    expect(calls).toEqual(['increment', 'increment']);
    task.cancel();
  });
});

describe('takeLatest', () => {
  it('cancels previous worker when new action arrives', async () => {
    const results: number[] = [];

    function* worker(action: ActionEvent) {
      yield delay(50);
      results.push(action.payload as number);
    }

    function* rootSaga() {
      yield* takeLatest('search', worker as any);
    }

    const env = createEnv();
    const task = runSaga(rootSaga as any, env);

    env.channel.emit({ type: 'search', payload: 1 });
    await new Promise((r) => setTimeout(r, 10));
    env.channel.emit({ type: 'search', payload: 2 });
    await new Promise((r) => setTimeout(r, 100));

    expect(results).toEqual([2]);
    task.cancel();
  });
});

describe('takeLeading', () => {
  it('blocks until worker completes before taking next', async () => {
    const results: number[] = [];

    function* worker(action: ActionEvent) {
      yield delay(30);
      results.push(action.payload as number);
    }

    function* rootSaga() {
      yield* takeLeading('submit', worker as any);
    }

    const env = createEnv();
    const task = runSaga(rootSaga as any, env);

    env.channel.emit({ type: 'submit', payload: 1 });
    await new Promise((r) => setTimeout(r, 10));
    env.channel.emit({ type: 'submit', payload: 2 });
    await new Promise((r) => setTimeout(r, 50));

    expect(results).toEqual([1]);

    env.channel.emit({ type: 'submit', payload: 3 });
    await new Promise((r) => setTimeout(r, 50));
    expect(results).toEqual([1, 3]);

    task.cancel();
  });
});

describe('debounce', () => {
  it('waits for delay before running worker', async () => {
    const results: number[] = [];

    function* worker(action: ActionEvent) {
      results.push(action.payload as number);
    }

    function* rootSaga() {
      yield* debounce(50, 'search', worker as any);
    }

    const env = createEnv();
    const task = runSaga(rootSaga as any, env);

    env.channel.emit({ type: 'search', payload: 1 });
    await new Promise((r) => setTimeout(r, 20));
    env.channel.emit({ type: 'search', payload: 2 });
    await new Promise((r) => setTimeout(r, 20));
    env.channel.emit({ type: 'search', payload: 3 });
    await new Promise((r) => setTimeout(r, 100));

    expect(results).toEqual([3]);
    task.cancel();
  });
});
