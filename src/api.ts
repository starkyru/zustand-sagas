import { take as untypedTake, call, select, fork, spawn, cancel, delay, race, all } from './effects';
import { takeEvery as untypedTakeEvery, takeLatest as untypedTakeLatest, takeLeading as untypedTakeLeading, debounce as untypedDebounce } from './helpers';
import type { ActionNames, TypedActionEvent, TakeEffect, Effect, ActionEvent } from './types';

type TypedWorker<T, K extends ActionNames<T>> = (
  action: TypedActionEvent<T, K>,
) => Generator<Effect, unknown, unknown>;

export interface SagaApi<T> {
  take<K extends ActionNames<T>>(pattern: K): TakeEffect;
  take(pattern: (action: ActionEvent) => boolean): TakeEffect;

  takeEvery<K extends ActionNames<T>>(
    pattern: K,
    worker: TypedWorker<T, K>,
  ): Generator<Effect, never, unknown>;

  takeLatest<K extends ActionNames<T>>(
    pattern: K,
    worker: TypedWorker<T, K>,
  ): Generator<Effect, never, unknown>;

  takeLeading<K extends ActionNames<T>>(
    pattern: K,
    worker: TypedWorker<T, K>,
  ): Generator<Effect, never, unknown>;

  debounce<K extends ActionNames<T>>(
    ms: number,
    pattern: K,
    worker: TypedWorker<T, K>,
  ): Generator<Effect, never, unknown>;

  // Pass-through untyped effects (no action name involved)
  call: typeof call;
  select: typeof select;
  fork: typeof fork;
  spawn: typeof spawn;
  cancel: typeof cancel;
  delay: typeof delay;
  race: typeof race;
  all: typeof all;
}

/** Creates a typed saga API bound to a store state type. */
export function createSagaApi<T>(): SagaApi<T> {
  return {
    take: untypedTake as any,
    takeEvery: untypedTakeEvery as any,
    takeLatest: untypedTakeLatest as any,
    takeLeading: untypedTakeLeading as any,
    debounce: untypedDebounce as any,
    call,
    select,
    fork,
    spawn,
    cancel,
    delay,
    race,
    all,
  };
}
