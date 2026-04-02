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
  type TakeEffect,
  type TakeMaybeEffect,
  type CallEffect,
  type SelectEffect,
  type ForkEffect,
  type SpawnEffect,
  type PutEffect,
  type PutResolveEffect,
  type JoinEffect,
  type CancelEffect,
  type CpsEffect,
  type DelayEffect,
  type RaceEffect,
  type AllEffect,
  type CallWorkerEffect,
  type ForkWorkerEffect,
  type SpawnWorkerEffect,
  type ForkWorkerChannelEffect,
  type CallWorkerGenEffect,
  type WorkerFn,
  type WorkerArgs,
  type ActionChannelEffect,
  type FlushEffect,
  type ActionEvent,
  type ActionPattern,
  type Task,
  type SagaFn,
  type Effect,
} from './types';
import { isChannel, type Channel } from './channels';
import type { Buffer } from './buffers';

export function take<Value>(patternOrChannel: ActionPattern | Channel<Value>): TakeEffect<Value> {
  if (isChannel(patternOrChannel)) {
    return { type: TAKE, channel: patternOrChannel };
  }
  return { type: TAKE, pattern: patternOrChannel as ActionPattern };
}

export function takeMaybe<Value>(
  patternOrChannel: ActionPattern | Channel<Value>,
): TakeMaybeEffect<Value> {
  if (isChannel(patternOrChannel)) {
    return { type: TAKE_MAYBE, channel: patternOrChannel };
  }
  return { type: TAKE_MAYBE, pattern: patternOrChannel as ActionPattern };
}

export function call<Fn extends (...args: any[]) => any>(
  fn: Fn,
  ...args: Parameters<Fn>
): CallEffect<Fn> {
  return { type: CALL, fn, args } as CallEffect<Fn>;
}

export function select(selector?: (state: unknown) => unknown): SelectEffect {
  return { type: SELECT, selector };
}

export function fork<Saga extends SagaFn>(saga: Saga, ...args: Parameters<Saga>): ForkEffect<Saga> {
  return { type: FORK, saga, args } as ForkEffect<Saga>;
}

export function spawn<Saga extends SagaFn>(
  saga: Saga,
  ...args: Parameters<Saga>
): SpawnEffect<Saga> {
  return { type: SPAWN, saga, args } as SpawnEffect<Saga>;
}

export function put(action: ActionEvent): PutEffect {
  return { type: PUT, action };
}

export function putResolve(action: ActionEvent): PutResolveEffect {
  return { type: PUT_RESOLVE, action };
}

export function join<Result>(task: Task<Result>): JoinEffect<Result> {
  return { type: JOIN, task };
}

export function cps<Fn extends (...args: any[]) => void>(
  fn: Fn,
  ...args: CpsEffect<Fn>['args']
): CpsEffect<Fn> {
  return { type: CPS, fn, args } as CpsEffect<Fn>;
}

export function cancel<Result>(task: Task<Result>): CancelEffect<Result> {
  return { type: CANCEL, task };
}

export function delay(ms: number): DelayEffect {
  return { type: DELAY, ms };
}

export function race(effects: Record<string, Effect>): RaceEffect {
  return { type: RACE, effects };
}

export function all(effects: Effect[]): AllEffect {
  return { type: ALL, effects };
}

export function actionChannel(
  pattern: ActionPattern,
  buffer?: Buffer<ActionEvent>,
): ActionChannelEffect {
  return { type: ACTION_CHANNEL, pattern, buffer };
}

export function flush<Value>(chan: Channel<Value>): FlushEffect<Value> {
  return { type: FLUSH, channel: chan };
}

export function retry<Args extends any[], Return>(
  maxTries: number,
  delayMs: number,
  fn: (...args: Args) => Return,
  ...args: Args
): CallEffect {
  return call(function* (): Generator<Effect> {
    for (let i = 0; i < maxTries; i++) {
      try {
        return yield call(fn, ...args);
      } catch (e) {
        if (i < maxTries - 1) {
          yield delay(delayMs);
        } else {
          throw e;
        }
      }
    }
  });
}

export function callWorker<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): CallWorkerEffect<Fn> {
  return { type: CALL_WORKER, fn, args } as CallWorkerEffect<Fn>;
}

export function forkWorker<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): ForkWorkerEffect<Fn> {
  return { type: FORK_WORKER, fn, args } as ForkWorkerEffect<Fn>;
}

export function spawnWorker<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): SpawnWorkerEffect<Fn> {
  return { type: SPAWN_WORKER, fn, args } as SpawnWorkerEffect<Fn>;
}

export function forkWorkerChannel<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): ForkWorkerChannelEffect<Fn> {
  return { type: FORK_WORKER_CHANNEL, fn, args } as ForkWorkerChannelEffect<Fn>;
}

export function callWorkerGen<Fn extends WorkerFn>(
  fn: Fn,
  handler: (...args: any[]) => Generator<Effect, any, any>,
  ...args: WorkerArgs<Fn>
): CallWorkerGenEffect<Fn> {
  return { type: CALL_WORKER_GEN, fn, handler: handler as SagaFn, args } as CallWorkerGenEffect<Fn>;
}
