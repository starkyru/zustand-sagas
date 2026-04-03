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
  type TakeEffect,
  type TakeMaybeEffect,
  type CallEffect,
  type SelectEffect,
  type ForkEffect,
  type SpawnEffect,
  type PutEffect,
  type JoinEffect,
  type CancelEffect,
  type CpsEffect,
  type DelayEffect,
  type RaceEffect,
  type AllEffect,
  type AllSettledEffect,
  type CallWorkerEffect,
  type ForkWorkerEffect,
  type SpawnWorkerEffect,
  type ForkWorkerChannelEffect,
  type CallWorkerGenEffect,
  type WorkerFn,
  type WorkerArgs,
  type ActionChannelEffect,
  type FlushEffect,
  type RetryEffect,
  type UntilEffect,
  type ActionEvent,
  type ActionPattern,
  type Task,
  type SagaFn,
  type Effect,
} from './types';
import { isChannel, type Channel } from './channels';
import type { Buffer } from './buffers';

function makeEffect<T extends object>(effect: T): T {
  Object.defineProperty(effect, Symbol.iterator, {
    enumerable: false,
    configurable: true,
    writable: false,
    value: function* effectIterator(): Generator<unknown, unknown, unknown> {
      return yield effect;
    },
  });
  return effect;
}

export function take<Value>(patternOrChannel: ActionPattern | Channel<Value>): TakeEffect<Value> {
  if (isChannel(patternOrChannel)) {
    return makeEffect({ type: TAKE, channel: patternOrChannel }) as TakeEffect<Value>;
  }
  return makeEffect({
    type: TAKE,
    pattern: patternOrChannel as ActionPattern,
  }) as TakeEffect<Value>;
}

export function takeMaybe<Value>(
  patternOrChannel: ActionPattern | Channel<Value>,
): TakeMaybeEffect<Value> {
  if (isChannel(patternOrChannel)) {
    return makeEffect({ type: TAKE_MAYBE, channel: patternOrChannel }) as TakeMaybeEffect<Value>;
  }
  return makeEffect({
    type: TAKE_MAYBE,
    pattern: patternOrChannel as ActionPattern,
  }) as TakeMaybeEffect<Value>;
}

export function call<Fn extends (...args: any[]) => any>(
  fn: Fn,
  ...args: Parameters<Fn>
): CallEffect<Fn> {
  return makeEffect({
    type: CALL,
    fn,
    args,
  }) as CallEffect<Fn>;
}

export function select<Result>(selector?: (state: any) => Result): SelectEffect<Result> {
  return makeEffect({ type: SELECT, selector }) as SelectEffect<Result>;
}

export function fork<Saga extends SagaFn>(saga: Saga, ...args: Parameters<Saga>): ForkEffect<Saga> {
  return makeEffect({
    type: FORK,
    saga,
    args,
  }) as ForkEffect<Saga>;
}

export function spawn<Saga extends SagaFn>(
  saga: Saga,
  ...args: Parameters<Saga>
): SpawnEffect<Saga> {
  return makeEffect({
    type: SPAWN,
    saga,
    args,
  }) as SpawnEffect<Saga>;
}

export function put(action: ActionEvent): PutEffect {
  return makeEffect({ type: PUT, action }) as PutEffect;
}

export function join<Result>(task: Task<Result>): JoinEffect<Result> {
  return makeEffect({ type: JOIN, task }) as JoinEffect<Result>;
}

export function cps<Fn extends (...args: any[]) => void>(
  fn: Fn,
  ...args: CpsEffect<Fn>['args']
): CpsEffect<Fn> {
  return makeEffect({
    type: CPS,
    fn,
    args,
  }) as CpsEffect<Fn>;
}

export function cancel<Result>(task: Task<Result>): CancelEffect<Result> {
  return makeEffect({ type: CANCEL, task }) as CancelEffect<Result>;
}

export function delay(ms: number): DelayEffect {
  return makeEffect({ type: DELAY, ms }) as DelayEffect;
}

export function race<Effects extends Record<string, Effect>>(
  effects: Effects,
): RaceEffect<Effects> {
  return makeEffect({
    type: RACE,
    effects,
  }) as RaceEffect<Effects>;
}

export function all<Effects extends readonly Effect[]>(effects: Effects): AllEffect<Effects> {
  return makeEffect({
    type: ALL,
    effects,
  }) as AllEffect<Effects>;
}

export function allSettled<Effects extends readonly Effect[]>(
  effects: Effects,
): AllSettledEffect<Effects> {
  return makeEffect({
    type: ALL_SETTLED,
    effects,
  }) as AllSettledEffect<Effects>;
}

export function actionChannel(
  pattern: ActionPattern,
  buffer?: Buffer<ActionEvent>,
): ActionChannelEffect {
  return makeEffect({ type: ACTION_CHANNEL, pattern, buffer }) as ActionChannelEffect;
}

export function flush<Value>(chan: Channel<Value>): FlushEffect<Value> {
  return makeEffect({ type: FLUSH, channel: chan }) as FlushEffect<Value>;
}

export function retry<Fn extends (...args: any[]) => any>(
  maxTries: number,
  delayMs: number,
  fn: Fn,
  ...args: Parameters<Fn>
): RetryEffect<Fn> {
  return makeEffect({
    type: RETRY,
    maxTries,
    delayMs,
    fn,
    args,
  }) as RetryEffect<Fn>;
}

export function callWorker<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): CallWorkerEffect<Fn> {
  return makeEffect({ type: CALL_WORKER, fn, args }) as CallWorkerEffect<Fn>;
}

export function forkWorker<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): ForkWorkerEffect<Fn> {
  return makeEffect({ type: FORK_WORKER, fn, args }) as ForkWorkerEffect<Fn>;
}

export function spawnWorker<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): SpawnWorkerEffect<Fn> {
  return makeEffect({ type: SPAWN_WORKER, fn, args }) as SpawnWorkerEffect<Fn>;
}

export function forkWorkerChannel<Fn extends WorkerFn>(
  fn: Fn,
  ...args: WorkerArgs<Fn>
): ForkWorkerChannelEffect<Fn> {
  return makeEffect({ type: FORK_WORKER_CHANNEL, fn, args }) as ForkWorkerChannelEffect<Fn>;
}

export function until(
  predicate: string | ((state: unknown) => unknown),
  timeout?: number,
): UntilEffect {
  return makeEffect({ type: UNTIL, predicate, timeout }) as UntilEffect;
}

export function callWorkerGen<Fn extends WorkerFn>(
  fn: Fn,
  handler: (...args: any[]) => Generator<Effect, any, any>,
  ...args: WorkerArgs<Fn>
): CallWorkerGenEffect<Fn> {
  return makeEffect({
    type: CALL_WORKER_GEN,
    fn,
    handler: handler as SagaFn,
    args,
  }) as CallWorkerGenEffect<Fn>;
}
