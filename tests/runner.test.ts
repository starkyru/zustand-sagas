import { describe, it, expect, vi } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { take, call, select, fork, spawn, cancel, delay } from '../src/effects';
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

describe('runner', () => {
  it('runs a simple saga to completion', async () => {
    function* saga() {
      return 42;
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toBe(42);
    expect(task.isRunning()).toBe(false);
  });

  it('processes TAKE effect', async () => {
    function* saga() {
      const action: ActionEvent = yield take('increment');
      return action.type;
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);

    expect(task.isRunning()).toBe(true);
    env.channel.emit({ type: 'increment' });

    const result = await task.toPromise();
    expect(result).toBe('increment');
  });

  it('processes CALL effect with sync function', async () => {
    function* saga() {
      const result: number = yield call(() => 10 + 5);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toBe(15);
  });

  it('processes CALL effect with async function', async () => {
    function* saga() {
      const result: string = yield call(async () => 'async-result');
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toBe('async-result');
  });

  it('processes CALL effect with generator (sub-saga)', async () => {
    function* subSaga() {
      return 'from-sub';
    }
    function* saga() {
      const result: string = yield call(subSaga as any);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toBe('from-sub');
  });

  it('processes SELECT effect', async () => {
    function* saga() {
      const count: number = yield select((s: any) => s.count);
      return count;
    }
    const env = createEnv({ count: 99 });
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toBe(99);
  });

  it('processes SELECT without selector returns full state', async () => {
    function* saga() {
      const state: unknown = yield select();
      return state;
    }
    const env = createEnv({ a: 1, b: 2 });
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('processes FORK effect and returns a task', async () => {
    let forkedRan = false;
    function* childSaga() {
      forkedRan = true;
      return 'child';
    }
    function* saga() {
      const childTask: unknown = yield fork(childSaga as any);
      return childTask;
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    await task.toPromise();
    await new Promise((r) => setTimeout(r, 10));
    expect(forkedRan).toBe(true);
  });

  it('processes DELAY effect', async () => {
    function* saga() {
      yield delay(50);
      return 'delayed';
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toBe('delayed');
  });

  it('cancellation stops the saga', async () => {
    let reached = false;
    function* saga() {
      yield take('NEVER');
      reached = true;
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    task.cancel();

    expect(task.isCancelled()).toBe(true);
    expect(reached).toBe(false);
  });

  it('propagates errors via gen.throw to allow try/catch', async () => {
    function* saga() {
      try {
        yield call(() => { throw new Error('boom'); });
        return 'no-error';
      } catch (e: any) {
        return `caught: ${e.message}`;
      }
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    const result = await task.toPromise();
    expect(result).toBe('caught: boom');
  });

  it('unhandled errors reject the task promise', async () => {
    function* saga() {
      yield call(() => { throw new Error('unhandled'); });
    }
    const env = createEnv();
    const task = runSaga(saga as any, env);
    await expect(task.toPromise()).rejects.toThrow('unhandled');
  });
});
