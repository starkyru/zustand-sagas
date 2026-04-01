import {
  TAKE, CALL, SELECT, FORK, SPAWN, CANCEL, DELAY, RACE, ALL,
  type TakeEffect, type CallEffect, type SelectEffect,
  type ForkEffect, type SpawnEffect, type CancelEffect, type DelayEffect,
  type RaceEffect, type AllEffect,
  type ActionPattern, type Task, type SagaFn, type Effect,
} from './types';

export function take(pattern: ActionPattern): TakeEffect {
  return { type: TAKE, pattern };
}

export function call(fn: (...args: unknown[]) => unknown, ...args: unknown[]): CallEffect {
  return { type: CALL, fn, args };
}

export function select(selector?: (state: unknown) => unknown): SelectEffect {
  return { type: SELECT, selector };
}

export function fork(saga: SagaFn, ...args: unknown[]): ForkEffect {
  return { type: FORK, saga, args };
}

export function spawn(saga: SagaFn, ...args: unknown[]): SpawnEffect {
  return { type: SPAWN, saga, args };
}

export function cancel(task: Task<any>): CancelEffect {
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
