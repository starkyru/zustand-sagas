import {
  take as untypedTake,
  takeMaybe as untypedTakeMaybe,
  call,
  select,
  fork,
  spawn,
  put,
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
  until as untypedUntil,
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
  SelectEffect,
  ForkEffect,
  ActionChannelEffect,
  FlushEffect,
  UntilEffect,
  Effect,
  ActionEvent,
} from './types';
import type { Channel } from './channels';
import type { Buffer } from './buffers';

type TypedWorker<State, Key extends ActionNames<State>> = (
  action: TypedActionEvent<State, Key>,
) => Generator<Effect, void, any>;

type UntypedWorker = (action: ActionEvent) => Generator<Effect, void, any>;
type PutAction<State, Key extends ActionNames<State>> = TypedActionEvent<State, Key>;

export interface SagaApi<State> {
  take<Key extends ActionNames<State>>(pattern: Key): TakeEffect<TypedActionEvent<State, Key>>;
  take<Keys extends ActionNames<State>>(
    pattern: readonly Keys[],
  ): TakeEffect<TypedActionEvent<State, Keys>>;
  take(pattern: (action: ActionEvent) => boolean): TakeEffect<ActionEvent>;
  take<Value>(channel: Channel<Value>): TakeEffect<Value>;

  takeMaybe<Key extends ActionNames<State>>(
    pattern: Key,
  ): TakeMaybeEffect<TypedActionEvent<State, Key>>;
  takeMaybe<Keys extends ActionNames<State>>(
    pattern: readonly Keys[],
  ): TakeMaybeEffect<TypedActionEvent<State, Keys>>;
  takeMaybe(pattern: (action: ActionEvent) => boolean): TakeMaybeEffect<ActionEvent>;
  takeMaybe<Value>(channel: Channel<Value>): TakeMaybeEffect<Value | import('./channels').END>;

  actionChannel<Key extends ActionNames<State>>(
    pattern: Key,
    buffer?: Buffer<TypedActionEvent<State, Key>>,
  ): ActionChannelEffect<TypedActionEvent<State, Key>>;
  actionChannel<Keys extends ActionNames<State>>(
    pattern: readonly Keys[],
    buffer?: Buffer<TypedActionEvent<State, Keys>>,
  ): ActionChannelEffect<TypedActionEvent<State, Keys>>;
  actionChannel(
    pattern: (action: ActionEvent) => boolean,
    buffer?: Buffer<ActionEvent>,
  ): ActionChannelEffect<ActionEvent>;

  flush<Value>(channel: Channel<Value>): FlushEffect;

  takeEvery<Key extends ActionNames<State>>(
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;
  takeEvery(pattern: ActionNames<State>[], worker: UntypedWorker): ForkEffect;
  takeEvery<A extends ActionEvent>(
    pattern: (action: ActionEvent) => boolean,
    worker: (action: A) => Generator<Effect, void, any>,
  ): ForkEffect;

  takeLatest<Key extends ActionNames<State>>(
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;
  takeLatest(pattern: ActionNames<State>[], worker: UntypedWorker): ForkEffect;
  takeLatest<A extends ActionEvent>(
    pattern: (action: ActionEvent) => boolean,
    worker: (action: A) => Generator<Effect, void, any>,
  ): ForkEffect;

  takeLeading<Key extends ActionNames<State>>(
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;
  takeLeading(pattern: ActionNames<State>[], worker: UntypedWorker): ForkEffect;
  takeLeading<A extends ActionEvent>(
    pattern: (action: ActionEvent) => boolean,
    worker: (action: A) => Generator<Effect, void, any>,
  ): ForkEffect;

  debounce<Key extends ActionNames<State>>(
    ms: number,
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;
  debounce(ms: number, pattern: ActionNames<State>[], worker: UntypedWorker): ForkEffect;
  debounce<A extends ActionEvent>(
    ms: number,
    pattern: (action: ActionEvent) => boolean,
    worker: (action: A) => Generator<Effect, void, any>,
  ): ForkEffect;

  throttle<Key extends ActionNames<State>>(
    ms: number,
    pattern: Key,
    worker: TypedWorker<State, Key>,
  ): ForkEffect;
  throttle(ms: number, pattern: ActionNames<State>[], worker: UntypedWorker): ForkEffect;
  throttle<A extends ActionEvent>(
    ms: number,
    pattern: (action: ActionEvent) => boolean,
    worker: (action: A) => Generator<Effect, void, any>,
  ): ForkEffect;

  put<Key extends ActionNames<State>>(
    type: Key,
    ...args: ActionArgs<State, Key>
  ): PutEffect<PutAction<State, Key>>;
  putApply<Key extends ActionNames<State>>(
    type: Key,
    args: ActionArgs<State, Key>,
  ): PutEffect<PutAction<State, Key>>;

  until<Key extends string & keyof State>(predicate: Key, timeout?: number): UntilEffect;
  until(predicate: (state: State) => unknown, timeout?: number): UntilEffect;

  // Pass-through effects (no action name involved)
  call: typeof call;
  select<Result>(selector: (state: State) => Result): SelectEffect<Result>;
  select(): SelectEffect<State>;
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
    until: untypedUntil as SagaApi<State>['until'],
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
