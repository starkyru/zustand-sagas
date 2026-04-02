import type { Task } from './types';

export interface MockTask<Result = unknown> extends Task<Result> {
  setRunning(running: boolean): void;
  setResult(result: Result): void;
  setError(error: Error): void;
}

let nextMockId = 0;

/**
 * Creates a mock Task for testing sagas that use fork/cancel/join.
 *
 * ```ts
 * const task = createMockTask();
 *
 * // Simulate the task completing
 * task.setResult('done');
 * task.setRunning(false);
 *
 * // Pass to cancel effect in tests
 * expect(gen.next(task).value).toEqual(cancel(task));
 * ```
 */
export function createMockTask<Result = unknown>(): MockTask<Result> {
  const id = nextMockId++;
  let running = true;
  let cancelled = false;
  let taskResult: Result | undefined;
  let resolvePromise: ((value: Result) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;

  const promise = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    id,
    isRunning: () => running,
    isCancelled: () => cancelled,
    result: () => taskResult,
    toPromise: () => promise,
    cancel: () => {
      if (running) {
        cancelled = true;
        running = false;
      }
    },
    setRunning: (value: boolean) => {
      running = value;
    },
    setResult: (value: Result) => {
      taskResult = value;
      running = false;
      resolvePromise?.(value);
    },
    setError: (error: Error) => {
      running = false;
      rejectPromise?.(error);
    },
  };
}
