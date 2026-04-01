import { ActionChannel } from './channel';
import { createTask } from './task';
import {
  TAKE, CALL, SELECT, FORK, SPAWN, CANCEL, DELAY, RACE, ALL,
  type Effect, type Task, type SagaFn, type SagaContext,
} from './types';

export interface RunnerEnv {
  channel: ActionChannel;
  getState: () => unknown;
  context: SagaContext;
}

export function runSaga(
  saga: SagaFn,
  env: RunnerEnv,
  ...args: unknown[]
): Task {
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
        const { promise: takePromise } = env.channel.take(effect.pattern);
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
        // Attached: child error propagates to parent
        childTask.toPromise().catch(() => {
          // Error will propagate when parent awaits
        });
        return childTask;
      }

      case SPAWN: {
        const childTask = runSaga(effect.saga, env, ...effect.args);
        // Detached: no tracking, errors don't propagate
        childTask.toPromise().catch(() => {
          // Swallow — spawned tasks are independent
        });
        return childTask;
      }

      case CANCEL: {
        effect.task.cancel();
        return undefined;
      }

      case DELAY: {
        return new Promise((resolve) => setTimeout(resolve, effect.ms));
      }

      case RACE: {
        const entries = Object.entries(effect.effects);
        const takerIds: number[] = [];

        const racePromises = entries.map(([key, eff]) => {
          // Track taker IDs for cleanup
          if (eff.type === TAKE) {
            const { promise: takePromise, takerId } = env.channel.take(eff.pattern);
            takerIds.push(takerId);
            return takePromise.then((value) => ({ key, value }));
          }
          return processEffect(eff).then((value) => ({ key, value }));
        });

        const winner = await Promise.race(racePromises);

        // Cancel losing takers
        for (const takerId of takerIds) {
          env.channel.removeTaker(takerId);
        }

        const result: Record<string, unknown> = {};
        for (const [key] of entries) {
          result[key] = key === winner.key ? winner.value : undefined;
        }
        return result;
      }

      case ALL: {
        const results = await Promise.all(
          effect.effects.map((eff) => processEffect(eff)),
        );
        return results;
      }

      default:
        throw new Error(`Unknown effect type: ${(effect as Effect).type}`);
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
