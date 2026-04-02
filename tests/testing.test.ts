import { describe, it, expect } from 'vitest';
import { createMockTask } from '../src/testing';
import { cancel, fork, join } from '../src/effects';

describe('createMockTask', () => {
  it('starts in running state', () => {
    const task = createMockTask();
    expect(task.isRunning()).toBe(true);
    expect(task.isCancelled()).toBe(false);
    expect(task.result()).toBeUndefined();
  });

  it('has a unique id', () => {
    const t1 = createMockTask();
    const t2 = createMockTask();
    expect(t1.id).not.toBe(t2.id);
  });

  it('cancel sets cancelled state', () => {
    const task = createMockTask();
    task.cancel();
    expect(task.isRunning()).toBe(false);
    expect(task.isCancelled()).toBe(true);
  });

  it('setResult sets result and stops running', () => {
    const task = createMockTask<string>();
    task.setResult('done');
    expect(task.isRunning()).toBe(false);
    expect(task.result()).toBe('done');
  });

  it('setResult resolves the promise', async () => {
    const task = createMockTask<number>();
    task.setResult(42);
    const value = await task.toPromise();
    expect(value).toBe(42);
  });

  it('setError rejects the promise', async () => {
    const task = createMockTask();
    task.setError(new Error('boom'));
    expect(task.isRunning()).toBe(false);
    await expect(task.toPromise()).rejects.toThrow('boom');
  });

  it('setRunning controls running state', () => {
    const task = createMockTask();
    task.setRunning(false);
    expect(task.isRunning()).toBe(false);
    task.setRunning(true);
    expect(task.isRunning()).toBe(true);
  });

  it('works with cancel effect in saga testing', () => {
    const task = createMockTask();

    function* saga() {
      const t = yield fork(function* () {});
      yield cancel(t);
    }

    const gen = saga();
    gen.next(); // yield fork(...)
    const cancelEffect = gen.next(task).value; // yield cancel(task)
    expect(cancelEffect).toEqual(cancel(task));
  });

  it('works with join effect in saga testing', () => {
    const task = createMockTask();

    function* saga() {
      const t = yield fork(function* () {});
      const result = yield join(t);
      return result;
    }

    const gen = saga();
    gen.next(); // yield fork(...)
    const joinEffect = gen.next(task).value; // yield join(task)
    expect(joinEffect).toEqual(join(task));
  });
});
