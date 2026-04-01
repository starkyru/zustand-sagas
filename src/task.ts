import type { Task } from './types';

let nextTaskId = 0;

export function createTask<R>(
  promise: Promise<R>,
  onCancel: () => void,
): Task<R> {
  const id = nextTaskId++;
  let running = true;
  let cancelled = false;
  let taskResult: R | undefined = undefined;

  const settled = promise.then(
    (value) => {
      running = false;
      taskResult = value;
      return value;
    },
    (error) => {
      running = false;
      throw error;
    },
  );

  return {
    id,
    isRunning: () => running,
    isCancelled: () => cancelled,
    result: () => taskResult,
    toPromise: () => settled,
    cancel: () => {
      if (running) {
        cancelled = true;
        running = false;
        onCancel();
      }
    },
  };
}
