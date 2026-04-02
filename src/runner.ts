import { ActionChannel } from './channel';
import { createTask } from './task';
import { END, channel as createChannel } from './channels';
import {
  getPlatform,
  getPlatformAsync,
  buildWorkerCode,
  type WorkerHandle,
} from './workerPlatform';
import {
  TAKE,
  TAKE_MAYBE,
  CALL,
  SELECT,
  FORK,
  SPAWN,
  PUT,
  JOIN,
  CANCEL,
  CPS,
  DELAY,
  CALL_WORKER,
  FORK_WORKER,
  SPAWN_WORKER,
  FORK_WORKER_CHANNEL,
  CALL_WORKER_GEN,
  RACE,
  ALL,
  ALL_SETTLED,
  ACTION_CHANNEL,
  FLUSH,
  UNTIL,
  type Effect,
  type Task,
  type SagaFn,
  type WorkerFn,
} from './types';

export interface RunnerEnv {
  channel: ActionChannel;
  getState: () => unknown;
  subscribe?: (listener: (state: unknown, prevState: unknown) => void) => () => void;
}

const TERMINATE = Symbol('TERMINATE');
const WORKER_GRACE_PERIOD_MS = 100;

interface Cancellable {
  promise: Promise<unknown>;
  cancel: () => void;
}

function createWorkerExecution(
  fn: WorkerFn,
  args: unknown[],
): { promise: Promise<unknown>; cancel: () => void } {
  let handle: WorkerHandle | null = null;
  let settled = false;
  let cancelRequested = false;

  const promise = (async () => {
    // Try sync platform first (browser), fall back to async (Node.js)
    let platform;
    try {
      platform = getPlatform();
    } catch {
      platform = await getPlatformAsync();
    }

    if (typeof fn === 'function') {
      const code = buildWorkerCode(fn.toString());
      handle = platform.createFromCode(code);
    } else {
      handle = platform.createFromURL(fn);
    }

    if (cancelRequested) {
      handle.terminate();
      return undefined;
    }

    return new Promise<unknown>((resolve, reject) => {
      handle!.onMessage((data: any) => {
        if (data.type === 'result') {
          settled = true;
          handle!.terminate();
          resolve(data.value);
        } else if (data.type === 'error') {
          settled = true;
          handle!.terminate();
          const err = new Error(data.message);
          if (data.stack) err.stack = data.stack;
          reject(err);
        }
      });

      handle!.onError((err) => {
        settled = true;
        handle!.terminate();
        reject(err);
      });

      handle!.postMessage({ type: 'exec', args });
    });
  })();

  const cancel = () => {
    if (settled) return;
    settled = true;
    cancelRequested = true;
    if (handle) {
      handle.postMessage({ type: 'cancel' });
      setTimeout(() => handle!.terminate(), WORKER_GRACE_PERIOD_MS);
    }
  };

  return { promise, cancel };
}

function createWorkerChannelExecution(
  fn: WorkerFn,
  args: unknown[],
): { promise: Promise<unknown>; cancel: () => void; channel: import('./channels').Channel<any> } {
  const chan = createChannel<any>();
  let handle: WorkerHandle | null = null;
  let settled = false;
  let cancelRequested = false;

  const promise = (async () => {
    let platform;
    try {
      platform = getPlatform();
    } catch {
      platform = await getPlatformAsync();
    }

    if (typeof fn === 'function') {
      const code = buildWorkerCode(fn.toString(), 'channel');
      handle = platform.createFromCode(code);
    } else {
      handle = platform.createFromURL(fn);
    }

    if (cancelRequested) {
      handle.terminate();
      chan.close();
      return undefined;
    }

    return new Promise<unknown>((resolve, reject) => {
      handle!.onMessage((data: any) => {
        if (data.type === 'emit') {
          chan.put(data.value);
        } else if (data.type === 'result') {
          settled = true;
          handle!.terminate();
          chan.close();
          resolve(data.value);
        } else if (data.type === 'error') {
          settled = true;
          handle!.terminate();
          chan.close();
          reject(new Error(data.message));
        }
      });

      handle!.onError((err) => {
        settled = true;
        handle!.terminate();
        chan.close();
        reject(err);
      });

      handle!.postMessage({ type: 'exec', args });
    });
  })();

  const cancel = () => {
    if (settled) return;
    settled = true;
    cancelRequested = true;
    chan.close();
    if (handle) {
      handle.postMessage({ type: 'cancel' });
      setTimeout(() => handle!.terminate(), WORKER_GRACE_PERIOD_MS);
    }
  };

  return { promise, cancel, channel: chan };
}

async function createWorkerGenExecution(
  fn: WorkerFn,
  handler: SagaFn,
  args: unknown[],
  runGenerator: (gen: SagaFn, genArgs: unknown[]) => Promise<unknown>,
): Promise<unknown> {
  let platform;
  try {
    platform = getPlatform();
  } catch {
    platform = await getPlatformAsync();
  }

  let handle: WorkerHandle;
  if (typeof fn === 'function') {
    const code = buildWorkerCode(fn.toString(), 'gen');
    handle = platform.createFromCode(code);
  } else {
    handle = platform.createFromURL(fn);
  }

  return new Promise<unknown>((resolve, reject) => {
    handle.onMessage(async (data: any) => {
      if (data.type === 'send') {
        try {
          const response = await runGenerator(handler, [data.value]);
          handle.postMessage({ type: 'response', value: response });
        } catch (e: any) {
          handle.terminate();
          reject(e);
        }
      } else if (data.type === 'result') {
        handle.terminate();
        resolve(data.value);
      } else if (data.type === 'error') {
        handle.terminate();
        reject(new Error(data.message));
      }
    });

    handle.onError((err) => {
      handle.terminate();
      reject(err);
    });

    handle.postMessage({ type: 'exec', args });
  });
}

export function runSaga(saga: SagaFn, env: RunnerEnv, ...args: unknown[]): Task {
  let cancelFlag = false;
  const children = new Set<Task>();
  const pendingCleanups = new Set<() => void>();
  const joinedTasks = new WeakSet<Task>();

  // Reject handle for propagating forked-child errors to the parent
  let rejectParent: ((error: unknown) => void) | undefined;

  const promise = new Promise<unknown>((resolve, reject) => {
    rejectParent = reject;
    runGenerator(saga, args).then(resolve, reject);
  });

  const task = createTask(promise, () => {
    cancelFlag = true;
    for (const cleanup of pendingCleanups) cleanup();
    pendingCleanups.clear();
    for (const child of children) {
      child.cancel();
    }
  });

  return task;

  function addCleanup(fn: () => void): () => void {
    pendingCleanups.add(fn);
    return () => pendingCleanups.delete(fn);
  }

  function trackChild(childTask: Task): void {
    children.add(childTask);
    childTask.toPromise().then(
      () => children.delete(childTask),
      () => children.delete(childTask),
    );
  }

  async function runGenerator(gen: SagaFn, genArgs: unknown[]): Promise<unknown> {
    const iterator = gen(...genArgs);
    let result = iterator.next();

    while (!result.done) {
      if (cancelFlag) {
        iterator.return(undefined);
        return undefined;
      }

      try {
        const value = await processEffect(result.value as Effect);
        if (cancelFlag) {
          iterator.return(undefined);
          return undefined;
        }
        if (value === TERMINATE) {
          iterator.return(undefined);
          return undefined;
        }
        result = iterator.next(value);
      } catch (error) {
        if (cancelFlag) {
          iterator.return(undefined);
          return undefined;
        }
        result = iterator.throw(error);
      }
    }

    return result.value;
  }

  /**
   * Returns a cancellable handle for an effect. Used by RACE to cancel
   * losing branches (TAKE, DELAY, CALL with generators, etc.).
   */
  function processEffectCancellable(effect: Effect): Cancellable {
    switch (effect.type) {
      case TAKE: {
        if (effect.channel) {
          const { promise: chanPromise, cancel: cancelTake } = effect.channel.take();
          return {
            promise: chanPromise.then((value) => (value === END ? TERMINATE : value)),
            cancel: cancelTake,
          };
        }
        const { promise: takePromise, takerId } = env.channel.take(effect.pattern!);
        return {
          promise: takePromise,
          cancel: () => env.channel.removeTaker(takerId),
        };
      }

      case TAKE_MAYBE: {
        if (effect.channel) {
          const { promise: chanPromise, cancel: cancelTake } = effect.channel.take();
          return { promise: chanPromise, cancel: cancelTake };
        }
        const { promise: takePromise, takerId } = env.channel.take(effect.pattern!);
        return {
          promise: takePromise,
          cancel: () => env.channel.removeTaker(takerId),
        };
      }

      case DELAY: {
        let timerId: ReturnType<typeof setTimeout>;
        const delayPromise = new Promise<unknown>((resolve) => {
          timerId = setTimeout(() => resolve(undefined), effect.ms);
        });
        return {
          promise: delayPromise,
          cancel: () => clearTimeout(timerId),
        };
      }

      case CALL: {
        const callResult = effect.fn(...effect.args);
        if (isGenerator(callResult)) {
          const childTask = runSaga(() => callResult as Generator<Effect, unknown, unknown>, env);
          return {
            promise: childTask.toPromise(),
            cancel: () => childTask.cancel(),
          };
        }
        return { promise: Promise.resolve(callResult), cancel: () => {} };
      }

      default:
        return { promise: processEffect(effect), cancel: () => {} };
    }
  }

  async function processEffect(effect: Effect): Promise<unknown> {
    switch (effect.type) {
      case TAKE: {
        if (effect.channel) {
          const { promise: chanPromise } = effect.channel.take();
          const value = await chanPromise;
          if (value === END) {
            return TERMINATE;
          }
          return value;
        }
        const { promise: takePromise } = env.channel.take(effect.pattern!);
        return takePromise;
      }

      case TAKE_MAYBE: {
        if (effect.channel) {
          const { promise: chanPromise } = effect.channel.take();
          return chanPromise;
        }
        const { promise: takePromise } = env.channel.take(effect.pattern!);
        return takePromise;
      }

      case CALL: {
        const result = effect.fn(...effect.args);
        if (isGenerator(result)) {
          return runGenerator(() => result as Generator<Effect, unknown, unknown>, []);
        }
        return result;
      }

      case SELECT: {
        const state = env.getState();
        return effect.selector ? effect.selector(state) : state;
      }

      case FORK: {
        const childTask = runSaga(effect.saga, env, ...effect.args);
        trackChild(childTask);
        // Propagate unhandled errors from forked children to the parent
        // (unless the child was joined, in which case the joiner handles the error)
        childTask.toPromise().catch((err) => {
          if (!childTask.isCancelled() && !joinedTasks.has(childTask) && rejectParent) {
            cancelFlag = true;
            for (const child of children) {
              if (child !== childTask) child.cancel();
            }
            rejectParent(err);
          }
        });
        return childTask;
      }

      case SPAWN: {
        const childTask = runSaga(effect.saga, env, ...effect.args);
        // Spawned tasks are detached — errors don't propagate
        childTask.toPromise().catch(() => {});
        return childTask;
      }

      case PUT: {
        env.channel.emit(effect.action);
        return effect.action;
      }

      case JOIN: {
        joinedTasks.add(effect.task);
        return effect.task.toPromise();
      }

      case CANCEL: {
        effect.task.cancel();
        return undefined;
      }

      case CPS: {
        return new Promise((resolve, reject) => {
          effect.fn(...effect.args, (error: unknown, result?: unknown) => {
            if (error) reject(error);
            else resolve(result);
          });
        });
      }

      case DELAY: {
        return new Promise((resolve) => {
          const timerId = setTimeout(() => {
            removeCleanup();
            resolve(undefined);
          }, effect.ms);
          const removeCleanup = addCleanup(() => {
            clearTimeout(timerId);
            resolve(undefined);
          });
        });
      }

      case CALL_WORKER: {
        const { promise: workerPromise } = createWorkerExecution(effect.fn, effect.args);
        return workerPromise;
      }

      case FORK_WORKER: {
        const execution = createWorkerExecution(effect.fn, effect.args);
        const childTask = createTask(execution.promise, execution.cancel);
        trackChild(childTask);
        childTask.toPromise().catch(() => {});
        return childTask;
      }

      case SPAWN_WORKER: {
        const execution = createWorkerExecution(effect.fn, effect.args);
        const childTask = createTask(execution.promise, execution.cancel);
        childTask.toPromise().catch(() => {});
        return childTask;
      }

      case FORK_WORKER_CHANNEL: {
        const channelExec = createWorkerChannelExecution(effect.fn, effect.args);
        const childTask = createTask(channelExec.promise, channelExec.cancel);
        trackChild(childTask);
        childTask.toPromise().catch(() => {});
        return { channel: channelExec.channel, task: childTask };
      }

      case CALL_WORKER_GEN: {
        return createWorkerGenExecution(effect.fn, effect.handler!, effect.args, runGenerator);
      }

      case ACTION_CHANNEL: {
        const chan = createChannel<import('./types').ActionEvent>(effect.buffer);
        const subId = env.channel.subscribe(effect.pattern, (action) => {
          chan.put(action);
        });
        addCleanup(() => env.channel.unsubscribe(subId));
        return chan;
      }

      case FLUSH: {
        return effect.channel.flush();
      }

      case UNTIL: {
        if (!env.subscribe) {
          throw new Error(
            'until effect requires a store subscription. Pass subscribe to RunnerEnv or use createSaga.',
          );
        }

        const selector =
          typeof effect.predicate === 'string'
            ? (state: unknown) => (state as Record<string, unknown>)[effect.predicate as string]
            : effect.predicate;

        // Check immediately
        if (selector(env.getState())) {
          return true;
        }

        return new Promise<true | typeof END>((resolve) => {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          let settled = false;

          const unsubscribe = env.subscribe!((state) => {
            if (!settled && selector(state)) {
              settled = true;
              if (timeoutId !== undefined) clearTimeout(timeoutId);
              removeCleanup();
              unsubscribe();
              resolve(true);
            }
          });

          if (effect.timeout !== undefined) {
            timeoutId = setTimeout(() => {
              if (!settled) {
                settled = true;
                removeCleanup();
                unsubscribe();
                resolve(END);
              }
            }, effect.timeout);
          }

          const removeCleanup = addCleanup(() => {
            if (!settled) {
              settled = true;
              if (timeoutId !== undefined) clearTimeout(timeoutId);
              unsubscribe();
              resolve(true);
            }
          });
        });
      }

      case RACE: {
        const entries = Object.entries(effect.effects);
        const branches: Cancellable[] = entries.map(([, eff]) => processEffectCancellable(eff));

        const racePromises = branches.map((branch, i) =>
          branch.promise.then((value) => ({ key: entries[i][0], value })),
        );

        const winner = await Promise.race(racePromises);

        // Cancel all losing branches
        for (let i = 0; i < branches.length; i++) {
          if (entries[i][0] !== winner.key) {
            branches[i].cancel();
          }
        }

        const result: Record<string, unknown> = {};
        for (const [key] of entries) {
          result[key] = key === winner.key ? winner.value : undefined;
        }
        return result;
      }

      case ALL: {
        const results = await Promise.all(effect.effects.map((eff) => processEffect(eff)));
        return results;
      }

      case ALL_SETTLED: {
        const results = await Promise.allSettled(effect.effects.map((eff) => processEffect(eff)));
        return results.map((r) =>
          r.status === 'fulfilled'
            ? { status: 'fulfilled' as const, value: r.value }
            : { status: 'rejected' as const, reason: r.reason },
        );
      }

      default:
        throw new Error(`Unknown effect type: ${String((effect as Effect).type)}`);
    }
  }
}

function isGenerator(obj: unknown): obj is Generator {
  return (
    obj != null &&
    typeof obj === 'object' &&
    typeof (obj as Generator).next === 'function' &&
    typeof (obj as Generator).throw === 'function'
  );
}
