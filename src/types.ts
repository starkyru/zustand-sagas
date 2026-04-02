// --- Actions ---

export interface ActionEvent {
  type: string;
  payload?: unknown;
}

export type ActionPattern = string | ((action: ActionEvent) => boolean);

// --- Store type utilities ---

/** Extracts function-property keys from a store state type. */
export type ActionNames<State> = {
  [Key in keyof State]: State[Key] extends (...args: any[]) => any ? Key : never;
}[keyof State] &
  string;

/** Derives the payload type for a given store action. */
export type ActionPayload<State, Key extends ActionNames<State>> = State[Key] extends (
  ...args: infer Params
) => any
  ? Params extends []
    ? undefined
    : Params extends [infer Single]
      ? Single
      : Params
  : never;

/** Extracts the raw parameter tuple for a given store action. */
export type ActionArgs<State, Key extends ActionNames<State>> = State[Key] extends (
  ...args: infer Params
) => any
  ? Params
  : [];

/** A typed action event for a specific store action. */
export type TypedActionEvent<State, Key extends ActionNames<State> = ActionNames<State>> = {
  type: Key;
  payload: ActionPayload<State, Key>;
};

// --- Effects ---

export const TAKE: unique symbol = Symbol('TAKE');
export const CALL: unique symbol = Symbol('CALL');
export const SELECT: unique symbol = Symbol('SELECT');
export const FORK: unique symbol = Symbol('FORK');
export const SPAWN: unique symbol = Symbol('SPAWN');
export const PUT: unique symbol = Symbol('PUT');
export const CANCEL: unique symbol = Symbol('CANCEL');
export const JOIN: unique symbol = Symbol('JOIN');
export const CPS: unique symbol = Symbol('CPS');
export const DELAY: unique symbol = Symbol('DELAY');
export const ACTION_CHANNEL: unique symbol = Symbol('ACTION_CHANNEL');
export const TAKE_MAYBE: unique symbol = Symbol('TAKE_MAYBE');
export const FLUSH: unique symbol = Symbol('FLUSH');
export const CALL_WORKER: unique symbol = Symbol('CALL_WORKER');
export const FORK_WORKER: unique symbol = Symbol('FORK_WORKER');
export const SPAWN_WORKER: unique symbol = Symbol('SPAWN_WORKER');
export const FORK_WORKER_CHANNEL: unique symbol = Symbol('FORK_WORKER_CHANNEL');
export const CALL_WORKER_GEN: unique symbol = Symbol('CALL_WORKER_GEN');
export const RACE: unique symbol = Symbol('RACE');
export const ALL: unique symbol = Symbol('ALL');
export const ALL_SETTLED: unique symbol = Symbol('ALL_SETTLED');
export const UNTIL: unique symbol = Symbol('UNTIL');

export type TakeEffect<Value = any> =
  | { type: typeof TAKE; pattern: ActionPattern; channel?: undefined }
  | { type: typeof TAKE; pattern?: undefined; channel: import('./channels').Channel<Value> };

export type TakeMaybeEffect<Value = any> =
  | { type: typeof TAKE_MAYBE; pattern: ActionPattern; channel?: undefined }
  | { type: typeof TAKE_MAYBE; pattern?: undefined; channel: import('./channels').Channel<Value> };

export interface ActionChannelEffect {
  type: typeof ACTION_CHANNEL;
  pattern: ActionPattern;
  buffer?: import('./buffers').Buffer<ActionEvent>;
}

export interface FlushEffect<Value = unknown> {
  type: typeof FLUSH;
  channel: import('./channels').Channel<Value>;
}

export interface CallEffect<Fn extends (...args: any[]) => any = (...args: any[]) => any> {
  type: typeof CALL;
  fn: Fn;
  args: Parameters<Fn>;
}

export interface SelectEffect<Result = unknown> {
  type: typeof SELECT;
  selector?: (state: any) => Result;
}

export interface ForkEffect<Saga extends SagaFn = SagaFn> {
  type: typeof FORK;
  saga: Saga;
  args: Parameters<Saga>;
}

export interface SpawnEffect<Saga extends SagaFn = SagaFn> {
  type: typeof SPAWN;
  saga: Saga;
  args: Parameters<Saga>;
}

export interface PutEffect {
  type: typeof PUT;
  action: ActionEvent;
}

export interface JoinEffect<Result = unknown> {
  type: typeof JOIN;
  task: Task<Result>;
}

export interface CancelEffect<Result = unknown> {
  type: typeof CANCEL;
  task: Task<Result>;
}

export type CpsCallback<Result = unknown> = (error: unknown, result?: Result) => void;

export interface CpsEffect<Fn extends (...args: any[]) => void = (...args: any[]) => void> {
  type: typeof CPS;
  fn: Fn;
  args: Parameters<Fn> extends [...infer Init, CpsCallback] ? Init : Parameters<Fn>;
}

export interface DelayEffect {
  type: typeof DELAY;
  ms: number;
}

export type WorkerFn = ((...args: any[]) => any) | string | URL;

type WorkerEffectType =
  | typeof CALL_WORKER
  | typeof FORK_WORKER
  | typeof SPAWN_WORKER
  | typeof FORK_WORKER_CHANNEL
  | typeof CALL_WORKER_GEN;

/** Extracts args from WorkerFn: Parameters<Fn> when Fn is a function, unknown[] otherwise. */
export type WorkerArgs<Fn extends WorkerFn> = Fn extends (...args: infer Args) => any
  ? Args
  : unknown[];

export interface WorkerEffect<
  Type extends WorkerEffectType = WorkerEffectType,
  Fn extends WorkerFn = WorkerFn,
> {
  type: Type;
  fn: Fn;
  args: WorkerArgs<Fn>;
  handler?: SagaFn;
}

export type CallWorkerEffect<Fn extends WorkerFn = WorkerFn> = WorkerEffect<typeof CALL_WORKER, Fn>;
export type ForkWorkerEffect<Fn extends WorkerFn = WorkerFn> = WorkerEffect<typeof FORK_WORKER, Fn>;
export type SpawnWorkerEffect<Fn extends WorkerFn = WorkerFn> = WorkerEffect<
  typeof SPAWN_WORKER,
  Fn
>;
export type ForkWorkerChannelEffect<Fn extends WorkerFn = WorkerFn> = WorkerEffect<
  typeof FORK_WORKER_CHANNEL,
  Fn
>;
export type CallWorkerGenEffect<Fn extends WorkerFn = WorkerFn> = WorkerEffect<
  typeof CALL_WORKER_GEN,
  Fn
>;

export interface RaceEffect {
  type: typeof RACE;
  effects: Record<string, Effect>;
}

export interface AllEffect {
  type: typeof ALL;
  effects: Effect[];
}

export interface AllSettledEffect {
  type: typeof ALL_SETTLED;
  effects: Effect[];
}

export interface SettledFulfilled<T = unknown> {
  status: 'fulfilled';
  value: T;
}

export interface SettledRejected {
  status: 'rejected';
  reason: unknown;
}

export type SettledResult<T = unknown> = SettledFulfilled<T> | SettledRejected;

export interface UntilEffect {
  type: typeof UNTIL;
  predicate: string | ((state: unknown) => unknown);
  timeout?: number;
}

export type Effect =
  | TakeEffect
  | TakeMaybeEffect
  | CallEffect
  | SelectEffect
  | ForkEffect
  | SpawnEffect
  | PutEffect
  | JoinEffect
  | CancelEffect
  | CpsEffect
  | DelayEffect
  | RaceEffect
  | AllEffect
  | AllSettledEffect
  | CallWorkerEffect
  | ForkWorkerEffect
  | SpawnWorkerEffect
  | ForkWorkerChannelEffect
  | CallWorkerGenEffect
  | ActionChannelEffect
  | FlushEffect
  | UntilEffect;

// --- Task ---

export interface Task<Result = unknown> {
  id: number;
  isRunning(): boolean;
  isCancelled(): boolean;
  result(): Result | undefined;
  toPromise(): Promise<Result>;
  cancel(): void;
}

// --- Saga function ---

/** Internal saga function type — accepts any generator that yields Effects. */
export type SagaFn = (...args: any[]) => Generator<Effect, unknown, any>;

/** User-facing saga generator type. Yields return `any` so fork/take results need no casts. */
export type Saga<Result = void> = Generator<Effect, Result, any>;

// --- Zustand integration ---

export type StoreSagas = {
  sagaTask: Task<void>;
};

type Write<Base, Extension> = Omit<Base, keyof Extension> & Extension;
type Cast<Source, Target> = Source extends Target ? Source : Target;

declare module 'zustand' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface StoreMutators<S, A> {
    'zustand-sagas': Write<Cast<S, object>, StoreSagas>;
  }
}

// Note: Sagas type is defined in middleware.ts via RootSagaFn<State>
