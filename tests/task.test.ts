import { describe, it, expect } from 'vitest';
import { createTask } from '../src/task';

describe('Task', () => {
  it('reports running state correctly', async () => {
    let resolve!: (v: unknown) => void;
    const p = new Promise((r) => {
      resolve = r;
    });
    const task = createTask(p, () => {});

    expect(task.isRunning()).toBe(true);
    expect(task.isCancelled()).toBe(false);
    expect(task.result()).toBeUndefined();

    resolve('done');
    await task.toPromise();

    expect(task.isRunning()).toBe(false);
    expect(task.result()).toBe('done');
  });

  it('cancel sets flags and calls onCancel', () => {
    let cancelled = false;
    const p = new Promise(() => {}); // never resolves
    const task = createTask(p, () => {
      cancelled = true;
    });

    task.cancel();

    expect(task.isRunning()).toBe(false);
    expect(task.isCancelled()).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('cancel is idempotent', () => {
    let count = 0;
    const p = new Promise(() => {});
    const task = createTask(p, () => {
      count++;
    });

    task.cancel();
    task.cancel();

    expect(count).toBe(1);
  });

  it('toPromise rejects on error', async () => {
    const p = Promise.reject(new Error('fail'));
    const task = createTask(p, () => {});

    await expect(task.toPromise()).rejects.toThrow('fail');
    expect(task.isRunning()).toBe(false);
  });
});
