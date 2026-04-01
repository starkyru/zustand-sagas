import type { StoreApi, StoreMutatorIdentifier } from 'zustand';

// --- Actions ---

export interface ActionEvent {
  type: string;
  payload?: unknown;
}

export type ActionPattern = string | ((action: ActionEvent) => boolean);

// --- Store type utilities ---

/** Extracts function-property keys from a store state type. */
export type ActionNames<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T] & string;

/** Derives the payload type for a given store action. */
export type ActionPayload<T, K extends ActionNames<T>> =
  T[K] extends (...args: infer A) => any
    ? A extends [] ? undefined
      : A extends [infer Single] ? Single
      : A
    : never;

/** A typed action event for a specific store action. */
export type TypedActionEvent<T, K extends ActionNames<T> = ActionNames<T>> = {
  type: K;
  payload: ActionPayload<T, K>;
};

// --- Effects ---

export const TAKE = 'TAKE' as const;
export const CALL = 'CALL' as const;
export const SELECT = 'SELECT' as const;
export const FORK = 'FORK' as const;
export const SPAWN = 'SPAWN' as const;
export const CANCEL = 'CANCEL' as const;
export const DELAY = 'DELAY' as const;
export const RACE = 'RACE' as const;
export const ALL = 'ALL' as const;

export interface TakeEffect {
  type: typeof TAKE;
  pattern: ActionPattern;
}

export interface CallEffect {
  type: typeof CALL;
  fn: (...args: unknown[]) => unknown;
  args: unknown[];
}

export interface SelectEffect {
  type: typeof SELECT;
  selector?: (state: unknown) => unknown;
}

export interface ForkEffect {
  type: typeof FORK;
  saga: SagaFn;
  args: unknown[];
}

export interface SpawnEffect {
  type: typeof SPAWN;
  saga: SagaFn;
  args: unknown[];
}

export interface CancelEffect {
  type: typeof CANCEL;
  task: Task<any>;
}

export interface DelayEffect {
  type: typeof DELAY;
  ms: number;
}

export interface RaceEffect {
  type: typeof RACE;
  effects: Record<string, Effect>;
}

export interface AllEffect {
  type: typeof ALL;
  effects: Effect[];
}

export type Effect =
  | TakeEffect
  | CallEffect
  | SelectEffect
  | ForkEffect
  | SpawnEffect
  | CancelEffect
  | DelayEffect
  | RaceEffect
  | AllEffect;

// --- Task ---

export interface Task<R = unknown> {
  id: number;
  isRunning(): boolean;
  isCancelled(): boolean;
  result(): R | undefined;
  toPromise(): Promise<R>;
  cancel(): void;
}

// --- Saga function ---

export type SagaFn = (...args: unknown[]) => Generator<Effect, unknown, unknown>;

// --- Runner context ---

export interface SagaContext {
  set: (...args: unknown[]) => void;
  get: () => unknown;
}

// --- Zustand integration ---

export type StoreSagas = {
  sagaTask: Task<void>;
};

type Write<T, U> = Omit<T, keyof U> & U;
type Cast<T, U> = T extends U ? T : U;

declare module 'zustand' {
  interface StoreMutators<S, A> {
    'zustand-sagas': Write<Cast<S, object>, StoreSagas>;
  }
}

// Note: Sagas type is defined in middleware.ts via RootSagaFn<T>
