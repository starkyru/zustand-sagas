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
  PUT_RESOLVE,
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
  ACTION_CHANNEL,
  FLUSH,
  type Effect,
  type Task,
  type SagaFn,
  type WorkerFn,
} from './types';

export interface RunnerEnv {
  channel: ActionChannel;
  getState: () => unknown;
}

const TERMINATE = Symbol('TERMINATE');
const WORKER_GRACE_PERIOD_MS = 100;

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
  const children: Task[] = [];

  const promise = runGenerator(saga, args);

  const task = createTask(promise, () => {
    cancelFlag = true;
    for (const child of children) {
      child.cancel();
    }
  });

  return task;

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
        children.push(childTask);
        childTask.toPromise().catch(() => {});
        return childTask;
      }

      case SPAWN: {
        const childTask = runSaga(effect.saga, env, ...effect.args);
        childTask.toPromise().catch(() => {});
        return childTask;
      }

      case PUT: {
        env.channel.emit(effect.action);
        return effect.action;
      }

      case PUT_RESOLVE: {
        env.channel.emit(effect.action);
        return effect.action;
      }

      case JOIN: {
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
        return new Promise((resolve) => setTimeout(resolve, effect.ms));
      }

      case CALL_WORKER: {
        const { promise: workerPromise } = createWorkerExecution(effect.fn, effect.args);
        return workerPromise;
      }

      case FORK_WORKER: {
        const execution = createWorkerExecution(effect.fn, effect.args);
        const childTask = createTask(execution.promise, execution.cancel);
        children.push(childTask);
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
        children.push(childTask);
        childTask.toPromise().catch(() => {});
        return { channel: channelExec.channel, task: childTask };
      }

      case CALL_WORKER_GEN: {
        return createWorkerGenExecution(effect.fn, effect.handler!, effect.args, runGenerator);
      }

      case ACTION_CHANNEL: {
        const chan = createChannel<import('./types').ActionEvent>(effect.buffer);
        env.channel.subscribe(effect.pattern, (action) => {
          chan.put(action);
        });
        return chan;
      }

      case FLUSH: {
        return effect.channel.flush();
      }

      case RACE: {
        const entries = Object.entries(effect.effects);
        const cleanups: (() => void)[] = [];

        const racePromises = entries.map(([key, eff]) => {
          if (eff.type === TAKE) {
            if (eff.channel) {
              const { promise: chanPromise, cancel: cancelTake } = eff.channel.take();
              cleanups.push(cancelTake);
              return chanPromise.then((value) => ({
                key,
                value: value === END ? TERMINATE : value,
              }));
            }
            const { promise: takePromise, takerId } = env.channel.take(eff.pattern!);
            cleanups.push(() => env.channel.removeTaker(takerId));
            return takePromise.then((value) => ({ key, value }));
          }
          if (eff.type === TAKE_MAYBE) {
            if (eff.channel) {
              const { promise: chanPromise, cancel: cancelTake } = eff.channel.take();
              cleanups.push(cancelTake);
              return chanPromise.then((value) => ({ key, value }));
            }
            const { promise: takePromise, takerId } = env.channel.take(eff.pattern!);
            cleanups.push(() => env.channel.removeTaker(takerId));
            return takePromise.then((value) => ({ key, value }));
          }
          return processEffect(eff).then((value) => ({ key, value }));
        });

        const winner = await Promise.race(racePromises);

        for (const cleanup of cleanups) {
          cleanup();
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
