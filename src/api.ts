import {
  take as untypedTake,
  takeMaybe as untypedTakeMaybe,
  call,
  select,
  fork,
  spawn,
  put,
  putResolve,
  join,
  cancel,
  cps,
  delay,
  retry,
  race,
  all,
  callWorker,
  forkWorker,
  spawnWorker,
  forkWorkerChannel,
  callWorkerGen,
  actionChannel as untypedActionChannel,
  flush,
  allSettled,
} from './effects';
import {
  takeEvery as untypedTakeEvery,
  takeLatest as untypedTakeLatest,
  takeLeading as untypedTakeLeading,
  debounce as untypedDebounce,
  throttle as untypedThrottle,
} from './helpers';
import type {
  ActionNames,
  ActionArgs,
  TypedActionEvent,
  TakeEffect,
  TakeMaybeEffect,
  PutEffect,
  PutResolveEffect,
  SelectEffect,
  ForkEffect,
  ActionChannelEffect,
  FlushEffect,
  Effect,
  ActionEvent,
} from './types';
import type { Channel } from './channels';
import type { Buffer } from './buffers';

type TypedWorker<State, Key extends ActionNames<State>> = (
  action: TypedActionEvent<State, Key>,
) => Generator<Effect, void, any>;

export interface SagaApi<State> {
  take<Key extends ActionNames<State>>(pattern: Key): TakeEffect;
  take(pattern: (action: ActionEvent) => boolean): TakeEffect;
  take<Value>(channel: Channel<Value>): TakeEffect;

  takeMaybe<Key extends ActionNames<State>>(pattern: Key): TakeMaybeEffect;
  takeMaybe(pattern: (action: ActionEvent) => boolean): TakeMaybeEffect;
  takeMaybe<Value>(channel: Channel<Value>): TakeMaybeEffect;

  actionChannel<Key extends ActionNames<State>>(
    pattern: Key,
    buffer?: Buffer<TypedActionEvent<State, Key>>,
  ): ActionChannelEffect;
  actionChannel(
    pattern: (action: ActionEvent) => boolean,
    buffer?: Buffer<ActionEvent>,
  ): ActionChannelEffect;

  flush<Value>(channel: Channel<Value>): FlushEffect;

  takeEvery<Key extends ActionNames<State>>(
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;

  takeLatest<Key extends ActionNames<State>>(
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;

  takeLeading<Key extends ActionNames<State>>(
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;

  debounce<Key extends ActionNames<State>>(
    ms: number,
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;

  throttle<Key extends ActionNames<State>>(
    ms: number,
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;

  put<Key extends ActionNames<State>>(type: Key, ...args: ActionArgs<State, Key>): PutEffect;
  putApply<Key extends ActionNames<State>>(type: Key, args: ActionArgs<State, Key>): PutEffect;

  putResolve<Key extends ActionNames<State>>(
    type: Key,
    ...args: ActionArgs<State, Key>
  ): PutResolveEffect;
  putResolveApply<Key extends ActionNames<State>>(
    type: Key,
    args: ActionArgs<State, Key>,
  ): PutResolveEffect;

  // Pass-through effects (no action name involved)
  call: typeof call;
  select<Result>(selector: (state: State) => Result): SelectEffect;
  select(): SelectEffect;
  fork: typeof fork;
  spawn: typeof spawn;
  join: typeof join;
  cancel: typeof cancel;
  cps: typeof cps;
  delay: typeof delay;
  retry: typeof retry;
  race: typeof race;
  all: typeof all;
  allSettled: typeof allSettled;
  callWorker: typeof callWorker;
  forkWorker: typeof forkWorker;
  spawnWorker: typeof spawnWorker;
  forkWorkerChannel: typeof forkWorkerChannel;
  callWorkerGen: typeof callWorkerGen;
}

function argsToAction(type: string, args: unknown[]): ActionEvent {
  const payload = args.length === 0 ? undefined : args.length === 1 ? args[0] : args;
  return payload === undefined ? { type } : { type, payload };
}

/** Creates a typed saga API bound to a store state type. */
export function createSagaApi<State>(): SagaApi<State> {
  return {
    take: untypedTake as SagaApi<State>['take'],
    takeMaybe: untypedTakeMaybe as SagaApi<State>['takeMaybe'],
    actionChannel: untypedActionChannel as SagaApi<State>['actionChannel'],
    flush,
    takeEvery: untypedTakeEvery as SagaApi<State>['takeEvery'],
    takeLatest: untypedTakeLatest as SagaApi<State>['takeLatest'],
    takeLeading: untypedTakeLeading as SagaApi<State>['takeLeading'],
    debounce: untypedDebounce as SagaApi<State>['debounce'],
    throttle: untypedThrottle as SagaApi<State>['throttle'],
    put: (<Key extends ActionNames<State>>(type: Key, ...args: ActionArgs<State, Key>) =>
      put(argsToAction(type, args))) as SagaApi<State>['put'],
    putApply: (<Key extends ActionNames<State>>(type: Key, args: ActionArgs<State, Key>) =>
      put(argsToAction(type, args as unknown[]))) as SagaApi<State>['putApply'],
    putResolve: (<Key extends ActionNames<State>>(type: Key, ...args: ActionArgs<State, Key>) =>
      putResolve(argsToAction(type, args))) as SagaApi<State>['putResolve'],
    putResolveApply: (<Key extends ActionNames<State>>(type: Key, args: ActionArgs<State, Key>) =>
      putResolve(argsToAction(type, args as unknown[]))) as SagaApi<State>['putResolveApply'],
    call,
    select: select as SagaApi<State>['select'],
    fork,
    spawn,
    join,
    cancel,
    cps,
    delay,
    retry,
    race,
    all,
    allSettled,
    callWorker,
    forkWorker,
    spawnWorker,
    forkWorkerChannel,
    callWorkerGen,
  };
}
