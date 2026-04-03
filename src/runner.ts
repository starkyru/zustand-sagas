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
  RETRY,
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
  monitor?: import('./types').SagaMonitor;
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
  let graceTimerId: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    settled = true;
    if (graceTimerId !== undefined) {
      clearTimeout(graceTimerId);
      graceTimerId = undefined;
    }
  };

  const promise = (async () => {
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
          settle();
          handle!.terminate();
          resolve(data.value);
        } else if (data.type === 'error') {
          settle();
          handle!.terminate();
          const err = new Error(data.message);
          if (data.stack) err.stack = data.stack;
          reject(err);
        }
      });

      handle!.onError((err) => {
        settle();
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
      graceTimerId = setTimeout(() => handle!.terminate(), WORKER_GRACE_PERIOD_MS);
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
  let graceTimerId: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    settled = true;
    if (graceTimerId !== undefined) {
      clearTimeout(graceTimerId);
      graceTimerId = undefined;
    }
  };

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
          settle();
          handle!.terminate();
          chan.close();
          resolve(data.value);
        } else if (data.type === 'error') {
          settle();
          handle!.terminate();
          chan.close();
          reject(new Error(data.message));
        }
      });

      handle!.onError((err) => {
        settle();
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
      graceTimerId = setTimeout(() => handle!.terminate(), WORKER_GRACE_PERIOD_MS);
    }
  };

  return { promise, cancel, channel: chan };
}

function createWorkerGenExecution(
  fn: WorkerFn,
  handler: SagaFn,
  args: unknown[],
  runGenerator: (gen: SagaFn, genArgs: unknown[]) => Promise<unknown>,
): { promise: Promise<unknown>; cancel: () => void } {
  let handle: WorkerHandle | null = null;
  let settled = false;
  let cancelRequested = false;
  let graceTimerId: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    settled = true;
    if (graceTimerId !== undefined) {
      clearTimeout(graceTimerId);
      graceTimerId = undefined;
    }
  };

  const promise = (async () => {
    let platform;
    try {
      platform = getPlatform();
    } catch {
      platform = await getPlatformAsync();
    }

    if (typeof fn === 'function') {
      const code = buildWorkerCode(fn.toString(), 'gen');
      handle = platform.createFromCode(code);
    } else {
      handle = platform.createFromURL(fn);
    }

    if (cancelRequested) {
      handle.terminate();
      return undefined;
    }

    return new Promise<unknown>((resolve, reject) => {
      handle!.onMessage(async (data: any) => {
        if (data.type === 'send') {
          try {
            const response = await runGenerator(handler, [data.value]);
            handle!.postMessage({ type: 'response', value: response });
          } catch (e: any) {
            settle();
            handle!.terminate();
            reject(e);
          }
        } else if (data.type === 'result') {
          settle();
          handle!.terminate();
          resolve(data.value);
        } else if (data.type === 'error') {
          settle();
          handle!.terminate();
          reject(new Error(data.message));
        }
      });

      handle!.onError((err) => {
        settle();
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
      graceTimerId = setTimeout(() => handle!.terminate(), WORKER_GRACE_PERIOD_MS);
    }
  };

  return { promise, cancel };
}

export function runSaga(saga: SagaFn, env: RunnerEnv, ...args: unknown[]): Task {
  let cancelFlag = false;
  const children = new Set<Task>();
  const pendingCleanups = new Set<() => void>();
  const joinedTasks = new WeakSet<Task>();
  let finalized = false;

  // Reject handle for propagating forked-child errors to the parent
  let rejectParent: ((error: unknown) => void) | undefined;

  const monitor = env.monitor;

  const promise = new Promise<unknown>((resolve, reject) => {
    rejectParent = reject;
    runGenerator(saga, args).then(resolve, reject);
  }).finally(() => {
    finalize();
  });

  const task = createTask(promise, () => {
    cancelFlag = true;
    monitor?.onTaskCancel?.(task);
    finalize();
    for (const child of children) {
      child.cancel();
    }
  });

  monitor?.onTaskStart?.(task, saga, args);
  task.toPromise().then(
    (result) => monitor?.onTaskResult?.(task, result),
    (error) => {
      if (!task.isCancelled()) monitor?.onTaskError?.(task, error);
    },
  );

  return task;

  function addCleanup(fn: () => void): () => void {
    pendingCleanups.add(fn);
    return () => pendingCleanups.delete(fn);
  }

  function finalize(): void {
    if (finalized) return;
    finalized = true;
    for (const cleanup of pendingCleanups) cleanup();
    pendingCleanups.clear();
  }

  function trackChild(childTask: Task): void {
    children.add(childTask);
    childTask.toPromise().then(
      () => children.delete(childTask),
      () => children.delete(childTask),
    );
  }

  async function runGenerator(gen: SagaFn, genArgs: unknown[]): Promise<unknown> {
    // Yield to microtask queue so `task` is assigned before we start
    // processing effects (monitor callbacks need the task reference).
    if (monitor) await Promise.resolve();

    const iterator = gen(...genArgs);
    let result = iterator.next();

    while (!result.done) {
      if (cancelFlag) {
        iterator.return(undefined);
        return undefined;
      }

      const effect = result.value as Effect;
      monitor?.onEffectStart?.(task, effect);
      try {
        const value = await processEffect(effect);
        if (cancelFlag) {
          iterator.return(undefined);
          return undefined;
        }
        if (value === TERMINATE) {
          iterator.return(undefined);
          return undefined;
        }
        monitor?.onEffectResult?.(task, effect, value);
        result = iterator.next(value);
      } catch (error) {
        if (cancelFlag) {
          iterator.return(undefined);
          return undefined;
        }
        monitor?.onEffectError?.(task, effect, error);
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
        let callResult: unknown;
        try {
          callResult = effect.fn(...effect.args);
        } catch (err) {
          return { promise: Promise.reject(err), cancel: () => {} };
        }
        if (isGenerator(callResult)) {
          const childTask = runSaga(() => callResult as Generator<Effect, unknown, unknown>, env);
          return {
            promise: childTask.toPromise(),
            cancel: () => childTask.cancel(),
          };
        }
        return { promise: Promise.resolve(callResult), cancel: () => {} };
      }

      case FORK: {
        const childTask = runSaga(effect.saga, env, ...effect.args);
        trackChild(childTask);
        return {
          promise: Promise.resolve(childTask),
          cancel: () => childTask.cancel(),
        };
      }

      case SPAWN: {
        const childTask = runSaga(effect.saga, env, ...effect.args);
        childTask.toPromise().catch(() => {});
        return {
          promise: Promise.resolve(childTask),
          cancel: () => childTask.cancel(),
        };
      }

      default:
        return { promise: processEffect(effect), cancel: () => {} };
    }
  }

  async function processEffect(effect: Effect): Promise<unknown> {
    switch (effect.type) {
      case TAKE: {
        if (effect.channel) {
          const { promise: chanPromise, cancel: cancelTake } = effect.channel.take();
          const value = await new Promise<unknown>((resolve) => {
            const removeCleanup = addCleanup(() => {
              cancelTake();
              resolve(TERMINATE);
            });
            chanPromise.then((result) => {
              removeCleanup();
              resolve(result);
            });
          });
          if (value === END) {
            return TERMINATE;
          }
          return value;
        }
        const { promise: takePromise, takerId } = env.channel.take(effect.pattern!);
        return new Promise<unknown>((resolve) => {
          const removeCleanup = addCleanup(() => {
            env.channel.removeTaker(takerId);
            resolve(TERMINATE);
          });
          takePromise.then((result) => {
            removeCleanup();
            resolve(result);
          });
        });
      }

      case TAKE_MAYBE: {
        if (effect.channel) {
          const { promise: chanPromise, cancel: cancelTake } = effect.channel.take();
          return new Promise<unknown>((resolve) => {
            const removeCleanup = addCleanup(() => {
              cancelTake();
              resolve(TERMINATE);
            });
            chanPromise.then((result) => {
              removeCleanup();
              resolve(result);
            });
          });
        }
        const { promise: takePromise, takerId } = env.channel.take(effect.pattern!);
        return new Promise<unknown>((resolve) => {
          const removeCleanup = addCleanup(() => {
            env.channel.removeTaker(takerId);
            resolve(TERMINATE);
          });
          takePromise.then((result) => {
            removeCleanup();
            resolve(result);
          });
        });
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
        children.add(childTask);
        childTask.toPromise().then(
          () => children.delete(childTask),
          (err) => {
            children.delete(childTask);
            if (!childTask.isCancelled() && !joinedTasks.has(childTask) && rejectParent) {
              cancelFlag = true;
              for (const child of children) {
                if (child !== childTask) child.cancel();
              }
              rejectParent(err);
            }
          },
        );
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
        const execution = createWorkerExecution(effect.fn, effect.args);
        const removeCleanup = addCleanup(execution.cancel);
        return execution.promise.finally(removeCleanup);
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
        const execution = createWorkerGenExecution(
          effect.fn,
          effect.handler!,
          effect.args,
          runGenerator,
        );
        const removeCleanup = addCleanup(execution.cancel);
        return execution.promise.finally(removeCleanup);
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

      case RETRY: {
        for (let i = 0; i < effect.maxTries; i++) {
          try {
            const result = effect.fn(...effect.args);
            if (isGenerator(result)) {
              return await runGenerator(() => result as Generator<Effect, unknown, unknown>, []);
            }
            return await result;
          } catch (e) {
            if (i < effect.maxTries - 1) {
              await new Promise<void>((resolve) => {
                const timerId = setTimeout(() => {
                  removeCleanup();
                  resolve();
                }, effect.delayMs);
                const removeCleanup = addCleanup(() => {
                  clearTimeout(timerId);
                  resolve();
                });
              });
              if (cancelFlag) return undefined;
            } else {
              throw e;
            }
          }
        }
        break;
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
        const branches = effect.effects.map((eff) => {
          try {
            return processEffectCancellable(eff);
          } catch (err) {
            return { promise: Promise.reject(err), cancel: () => {} } as Cancellable;
          }
        });

        try {
          const results = await Promise.all(branches.map((b) => b.promise));
          return results;
        } catch (err) {
          // Cancel remaining effects when one fails
          for (const branch of branches) branch.cancel();
          throw err;
        }
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
