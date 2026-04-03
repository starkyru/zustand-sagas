/**
 * Factory that creates saga watchers for async operations.
 *
 * Two modes:
 *
 * **1. AsyncSlice mode** (pairs with {@link createAsyncSlice}):
 * ```ts
 * createAsyncSaga(store, 'user', fetchUser);
 * createAsyncSaga(store, 'user', fetchUser, { retries: 3, strategy: 'debounce', debounceMs: 300 });
 * ```
 *
 * **2. Standalone mode** (works with any store actions):
 * ```ts
 * createAsyncSaga(store, {
 *   trigger: 'loadProfile',
 *   fetch: fetchProfile,
 *   onSuccess: 'setProfile',
 *   onError: 'setProfileError',
 * });
 * ```
 */
import type { StoreApi } from 'zustand';
import type { ActionNames, Effect } from './types';
import type { SagaApi } from './api';
import type { AsyncSlice } from './asyncSlice';

// --- Types ---

export type AsyncSagaStrategy =
  | 'takeLatest'
  | 'takeEvery'
  | 'takeLeading'
  | 'debounce'
  | 'throttle';

export interface AsyncSagaOptions<T = unknown, State = unknown> {
  /** Watcher strategy. Default: `'takeLatest'`. */
  strategy?: AsyncSagaStrategy;
  /** Milliseconds for `'debounce'` and `'throttle'` strategies. Required when using those strategies. */
  debounceMs?: number;
  /** Number of retry attempts on failure (0 = no retry). Default: `0`. */
  retries?: number;
  /** Delay between retries in ms. Default: `1000`. */
  retryDelay?: number;
  /** Transform the raw fetch result before settling. */
  transform?: (raw: unknown) => T;
  /** Generator to run after successful settlement. */
  onSuccess?: (data: T, api: SagaApi<State>) => Generator<Effect, void, unknown>;
  /** Generator to run after error settlement. */
  onError?: (error: Error, api: SagaApi<State>) => Generator<Effect, void, unknown>;
}

export interface StandaloneAsyncSagaConfig<
  State = unknown,
  Fn extends (...args: any[]) => Promise<any> = (...args: any[]) => Promise<any>,
> {
  /** Action name that triggers the fetch. */
  trigger: ActionNames<State>;
  /** Async function to call when triggered. */
  fetch: Fn;
  /** Action name to call with the result on success, or a generator for custom handling. */
  onSuccess?:
    | ActionNames<State>
    | ((data: Awaited<ReturnType<Fn>>, api: SagaApi<State>) => Generator<Effect, void, unknown>);
  /** Action name to call with the error message on failure, or a generator for custom handling. */
  onError?:
    | ActionNames<State>
    | ((error: Error, api: SagaApi<State>) => Generator<Effect, void, unknown>);
  /** Watcher strategy. Default: `'takeLatest'`. */
  strategy?: AsyncSagaStrategy;
  /** Milliseconds for `'debounce'` and `'throttle'` strategies. */
  debounceMs?: number;
  /** Number of retry attempts (0 = no retry). Default: `0`. */
  retries?: number;
  /** Delay between retries in ms. Default: `1000`. */
  retryDelay?: number;
  /** Transform the raw fetch result before settling. */
  transform?: (raw: unknown) => Awaited<ReturnType<Fn>>;
}

// --- Internals ---

function applyStrategy<State>(
  api: SagaApi<State>,
  pattern: ActionNames<State>,
  worker: (action: any) => Generator<Effect, void, any>,
  strategy: AsyncSagaStrategy = 'takeLatest',
  debounceMs?: number,
): Effect {
  switch (strategy) {
    case 'takeEvery':
      return api.takeEvery(pattern, worker as any);
    case 'takeLeading':
      return api.takeLeading(pattern, worker as any);
    case 'debounce':
      if (debounceMs == null) throw new Error('debounceMs is required for debounce strategy');
      return api.debounce(debounceMs, pattern, worker as any);
    case 'throttle':
      if (debounceMs == null) throw new Error('debounceMs is required for throttle strategy');
      return api.throttle(debounceMs, pattern, worker as any);
    case 'takeLatest':
    default:
      return api.takeLatest(pattern, worker as any);
  }
}

// --- Overloads ---

/** AsyncSlice mode (backwards-compatible). */
export function createAsyncSaga<
  Name extends string,
  Fn extends (...args: any[]) => Promise<any>,
  State extends AsyncSlice<Name, Awaited<ReturnType<Fn>>, Parameters<Fn>>,
>(
  store: StoreApi<State>,
  name: Name,
  fetchFn: Fn,
  options?: AsyncSagaOptions<Awaited<ReturnType<Fn>>, State>,
): (api: SagaApi<State>) => Generator<Effect, void, unknown>;

/** Standalone mode (no AsyncSlice dependency). */
export function createAsyncSaga<State, Fn extends (...args: any[]) => Promise<any>>(
  store: StoreApi<State>,
  config: StandaloneAsyncSagaConfig<State, Fn>,
): (api: SagaApi<State>) => Generator<Effect, void, unknown>;

/** Implementation. */
export function createAsyncSaga(
  store: StoreApi<any>,
  nameOrConfig: string | StandaloneAsyncSagaConfig,
  fetchFn?: (...args: any[]) => Promise<any>,
  options?: AsyncSagaOptions,
) {
  if (typeof nameOrConfig === 'string') {
    return createSliceAsyncSaga(store, nameOrConfig, fetchFn!, options ?? {});
  }
  return createStandaloneAsyncSaga(store, nameOrConfig);
}

// --- AsyncSlice mode ---

function createSliceAsyncSaga(
  store: StoreApi<any>,
  name: string,
  fetchFn: (...args: any[]) => Promise<any>,
  options: AsyncSagaOptions,
) {
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  const fetchKey = `fetch${cap}`;
  const setKey = `set${cap}`;
  const setErrorKey = `set${cap}Error`;

  return function* (api: SagaApi<any>): Generator<Effect, void, unknown> {
    yield applyStrategy(
      api,
      fetchKey as any,
      function* (action: any) {
        try {
          const payload = action.payload;
          const args = Array.isArray(payload) ? payload : payload !== undefined ? [payload] : [];
          let data: unknown;
          if (options.retries && options.retries > 0) {
            data = yield api.retry(
              options.retries + 1,
              options.retryDelay ?? 1000,
              fetchFn,
              ...args,
            );
          } else {
            data = yield api.call(fetchFn, ...args);
          }
          if (options.transform) data = options.transform(data);
          yield api.call(() => (store.getState()[setKey] as (d: any) => void)(data));
          if (options.onSuccess) yield* options.onSuccess(data, api);
        } catch (e) {
          const error = e instanceof Error ? e : new Error('Unknown error');
          yield api.call(() =>
            (store.getState()[setErrorKey] as (msg: string) => void)(error.message),
          );
          if (options.onError) yield* options.onError(error, api);
        }
      },
      options.strategy,
      options.debounceMs,
    );
  };
}

// --- Standalone mode ---

function createStandaloneAsyncSaga(store: StoreApi<any>, config: StandaloneAsyncSagaConfig) {
  return function* (api: SagaApi<any>): Generator<Effect, void, unknown> {
    yield applyStrategy(
      api,
      config.trigger as any,
      function* (action: any) {
        try {
          const payload = action.payload;
          const args = Array.isArray(payload) ? payload : payload !== undefined ? [payload] : [];
          let data: unknown;
          if (config.retries && config.retries > 0) {
            data = yield api.retry(
              config.retries + 1,
              config.retryDelay ?? 1000,
              config.fetch,
              ...args,
            );
          } else {
            data = yield api.call(config.fetch, ...args);
          }
          if (config.transform) data = config.transform(data);

          // Settle success
          if (typeof config.onSuccess === 'string') {
            const key = config.onSuccess;
            yield api.call(() => (store.getState()[key] as (d: any) => void)(data));
          } else if (typeof config.onSuccess === 'function') {
            yield* config.onSuccess(data, api);
          }
        } catch (e) {
          const error = e instanceof Error ? e : new Error('Unknown error');

          // Settle error
          if (typeof config.onError === 'string') {
            const key = config.onError;
            yield api.call(() => (store.getState()[key] as (msg: string) => void)(error.message));
          } else if (typeof config.onError === 'function') {
            yield* config.onError(error, api);
          }
        }
      },
      config.strategy,
      config.debounceMs,
    );
  };
}
