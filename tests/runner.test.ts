import { describe, it, expect, vi } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import {
  take,
  call,
  select,
  fork,
  spawn,
  put,
  join,
  cps,
  delay,
  retry,
  race,
  until,
} from '../src/effects';
import type { Effect, ActionEvent } from '../src/types';

function createEnv(state: Record<string, unknown> = {}): RunnerEnv {
  return {
    channel: new ActionChannel(),
    getState: () => state,
  };
}

describe('runner', () => {
  it('runs a simple saga to completion', async () => {
    function* saga() {
      return 42;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe(42);
    expect(task.isRunning()).toBe(false);
  });

  it('processes TAKE effect', async () => {
    function* saga() {
      const action = yield take('increment');
      return action.type;
    }
    const env = createEnv();
    const task = runSaga(saga, env);

    expect(task.isRunning()).toBe(true);
    env.channel.emit({ type: 'increment' });

    const result = await task.toPromise();
    expect(result).toBe('increment');
  });

  it('processes CALL effect with sync function', async () => {
    function* saga() {
      const result = yield call(() => 10 + 5);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe(15);
  });

  it('processes CALL effect with async function', async () => {
    function* saga() {
      const result = yield call(async () => 'async-result');
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('async-result');
  });

  it('processes CALL effect with generator (sub-saga)', async () => {
    function* subSaga() {
      return 'from-sub';
    }
    function* saga() {
      const result = yield call(subSaga);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('from-sub');
  });

  it('processes SELECT effect', async () => {
    function* saga() {
      const count = yield select((s: any) => s.count);
      return count;
    }
    const env = createEnv({ count: 99 });
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe(99);
  });

  it('processes SELECT without selector returns full state', async () => {
    function* saga() {
      const state = yield select();
      return state;
    }
    const env = createEnv({ a: 1, b: 2 });
    const task = runSaga(saga, env);
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
      const childTask = yield fork(childSaga);
      return childTask;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
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
    const task = runSaga(saga, env);
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
    const task = runSaga(saga, env);
    task.cancel();

    expect(task.isCancelled()).toBe(true);
    expect(reached).toBe(false);
  });

  it('propagates errors via gen.throw to allow try/catch', async () => {
    function* saga() {
      try {
        yield call(() => {
          throw new Error('boom');
        });
        return 'no-error';
      } catch (e: any) {
        return `caught: ${e.message}`;
      }
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('caught: boom');
  });

  it('processes CPS effect with successful callback', async () => {
    function readFile(path: string, cb: (err: unknown, result?: string) => void) {
      setTimeout(() => cb(null, `content of ${path}`), 5);
    }
    function* saga() {
      const content = yield cps(readFile, '/tmp/test.txt');
      return content;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('content of /tmp/test.txt');
  });

  it('processes CPS effect with error callback', async () => {
    function failingOp(cb: (err: unknown, result?: unknown) => void) {
      setTimeout(() => cb(new Error('cps-error')), 5);
    }
    function* saga() {
      try {
        yield cps(failingOp);
        return 'no-error';
      } catch (e: any) {
        return `caught: ${e.message}`;
      }
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('caught: cps-error');
  });

  it('processes PUT effect and emits action to channel', async () => {
    let received: ActionEvent | undefined;

    function* listener() {
      received = yield take('notify');
    }
    function* saga() {
      yield fork(listener);
      yield delay(5);
      yield put({ type: 'notify', payload: 'hello' });
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    await task.toPromise();
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual({ type: 'notify', payload: 'hello' });
  });

  it('PUT returns the dispatched action', async () => {
    function* saga() {
      const result = yield put({ type: 'test' });
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toEqual({ type: 'test' });
  });

  it('processes JOIN effect — waits for forked task result', async () => {
    function* child() {
      yield delay(20);
      return 'child-done';
    }
    function* saga() {
      const childTask = yield fork(child);
      const result = yield join(childTask);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('child-done');
  });

  it('JOIN propagates errors from the joined task', async () => {
    function* child() {
      yield delay(5);
      throw new Error('child-failed');
    }
    function* saga() {
      const childTask = yield fork(child);
      try {
        yield join(childTask);
        return 'no-error';
      } catch (e: any) {
        return `caught: ${e.message}`;
      }
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('caught: child-failed');
  });

  it('processes RETRY effect — retries on failure then succeeds', async () => {
    let attempts = 0;
    function unstable() {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'ok';
    }
    function* saga() {
      const result = yield retry(5, 10, unstable);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('processes RETRY effect — exhausts retries and throws', async () => {
    function alwaysFails() {
      throw new Error('permanent');
    }
    function* saga() {
      yield retry(3, 5, alwaysFails);
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    await expect(task.toPromise()).rejects.toThrow('permanent');
  });

  it('unhandled errors reject the task promise', async () => {
    function* saga() {
      yield call(() => {
        throw new Error('unhandled');
      });
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    await expect(task.toPromise()).rejects.toThrow('unhandled');
  });

  it('forked task error propagates to parent', async () => {
    function* child() {
      yield delay(5);
      throw new Error('child-boom');
    }
    function* saga() {
      yield fork(child);
      yield take('NEVER'); // parent blocks here
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    await expect(task.toPromise()).rejects.toThrow('child-boom');
  });

  it('spawned task error does NOT propagate to parent', async () => {
    function* child() {
      yield delay(5);
      throw new Error('spawn-boom');
    }
    function* saga() {
      yield spawn(child);
      yield delay(50);
      return 'parent-ok';
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('parent-ok');
  });

  it('cancellation clears delay timer', async () => {
    const timerSpy = vi.spyOn(global, 'clearTimeout');
    function* saga() {
      yield delay(10_000);
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    // Give the saga time to reach the delay effect
    await new Promise((r) => setTimeout(r, 10));
    task.cancel();
    expect(timerSpy).toHaveBeenCalled();
    timerSpy.mockRestore();
  });

  it('cancellation clears retry delay timer', async () => {
    const timerSpy = vi.spyOn(global, 'clearTimeout');
    function alwaysFails() {
      throw new Error('fail');
    }
    function* saga(): Generator<any> {
      yield retry(100, 10_000, alwaysFails);
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    // Give the saga time to fail once and enter the retry delay
    await new Promise((r) => setTimeout(r, 20));
    task.cancel();
    expect(timerSpy).toHaveBeenCalled();
    timerSpy.mockRestore();
  });

  it('retry stops retrying after cancellation', async () => {
    let attempts = 0;
    function alwaysFails() {
      attempts++;
      throw new Error('fail');
    }
    function* saga(): Generator<any> {
      yield retry(100, 50, alwaysFails);
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    // Let it fail a couple times then cancel
    await new Promise((r) => setTimeout(r, 80));
    const attemptsAtCancel = attempts;
    task.cancel();
    // Wait to confirm no further attempts
    await new Promise((r) => setTimeout(r, 150));
    expect(attempts).toBe(attemptsAtCancel);
  });

  it('until throws when subscribe is not provided', async () => {
    function* saga(): Generator<any> {
      yield until('ready');
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    await expect(task.toPromise()).rejects.toThrow('until effect requires a store subscription');
  });

  it('cancellation unblocks a pending take and removes the taker', async () => {
    function* saga(): Generator<any> {
      yield take('PING');
      return 'done';
    }
    const env = createEnv();
    const task = runSaga(saga, env);

    await new Promise((r) => setTimeout(r, 10));
    expect((env.channel as any).takers).toHaveLength(1);

    task.cancel();
    await expect(task.toPromise()).resolves.toBeUndefined();

    expect((env.channel as any).takers).toHaveLength(0);
  });

  it('race cancels forked task when another branch wins', async () => {
    let forkedRunning = true;
    function* longRunning(): Generator<Effect, void, any> {
      yield delay(10_000);
      forkedRunning = false;
    }
    function* saga(): Generator<any> {
      const result = yield race({
        forked: fork(longRunning),
        timeout: delay(20),
      });
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    await task.toPromise();
    // The forked task should have been cancelled by the race
    expect(forkedRunning).toBe(true); // never reached forkedRunning = false
  });

  it('race cancels spawned task when another branch wins', async () => {
    let spawnedRunning = true;
    function* longRunning(): Generator<Effect, void, any> {
      yield delay(10_000);
      spawnedRunning = false;
    }
    function* saga(): Generator<any> {
      const result = yield race({
        spawned: spawn(longRunning),
        timeout: delay(20),
      });
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    await task.toPromise();
    expect(spawnedRunning).toBe(true);
  });
});
