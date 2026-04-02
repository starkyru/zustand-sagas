/**
 * Factory that creates a saga watcher for an {@link AsyncSlice}.
 *
 * Given a resource name and an async fetch function, `createAsyncSaga` returns
 * a root saga that:
 *
 * 1. Watches for `fetchX` actions via `takeLatest` (auto-cancels stale calls).
 * 2. Calls `fetchFn` with the action payload.
 * 3. On success, calls `setX(data)` on the store.
 * 4. On failure, calls `setXError(message)` on the store.
 *
 * @example
 * ```ts
 * import { createAsyncSlice, createAsyncSaga, type AsyncSlice } from 'zustand-sagas';
 *
 * type Store = AsyncSlice<'user', User, [id: string]>;
 *
 * const store = createStore<Store>((set) => ({
 *   ...createAsyncSlice<'user', User, [id: string]>('user', set),
 * }));
 *
 * const userSaga = createAsyncSaga(store, 'user', fetchUser);
 * // Watches for `fetchUser` actions, calls fetchUser(id),
 * // then settles with setUser(data) or setUserError(message).
 * ```
 */
import type { StoreApi } from 'zustand';
import type { ActionNames, ActionPayload, Effect, TypedActionEvent } from './types';
import type { SagaApi } from './api';
import type { AsyncSlice } from './asyncSlice';

type FetchName<Name extends string> = `fetch${Capitalize<Name>}`;
type SetName<Name extends string> = `set${Capitalize<Name>}`;
type SetErrorName<Name extends string> = `set${Capitalize<Name>}Error`;

/**
 * Creates a saga that watches `fetchX` and resolves the matching
 * {@link AsyncSlice} via `setX` / `setXError`.
 *
 * @param store   - The Zustand store containing the async slice.
 * @param name    - The resource name (must match the name passed to {@link createAsyncSlice}).
 * @param fetchFn - An async function that fetches the resource.
 * @returns A root saga function ready to be passed to `createSaga`.
 */
export function createAsyncSaga<
  Name extends string,
  Fn extends (...args: any[]) => Promise<any>,
  State extends AsyncSlice<Name, Awaited<ReturnType<Fn>>, Parameters<Fn>>,
>(store: StoreApi<State>, name: Name, fetchFn: Fn) {
  type T = Awaited<ReturnType<Fn>>;
  type FKey = FetchName<Name> & ActionNames<State>;
  type Payload = ActionPayload<State, FKey>;

  const cap = (name.charAt(0).toUpperCase() + name.slice(1)) as Capitalize<Name>;
  const fetchKey = `fetch${cap}` as FKey;
  const setKey = `set${cap}` as SetName<Name> & keyof State;
  const setErrorKey = `set${cap}Error` as SetErrorName<Name> & keyof State;

  return function* (api: SagaApi<State>): Generator<Effect, void, unknown> {
    yield api.takeLatest(fetchKey, function* (action: TypedActionEvent<State, FKey>) {
      try {
        const payload = action.payload as Payload;
        const args = (Array.isArray(payload) ? payload : [payload]) as Parameters<Fn>;
        const data: T = yield api.call(fetchFn, ...args);
        (store.getState()[setKey] as (data: T) => void)(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        (store.getState()[setErrorKey] as (err: string) => void)(msg);
      }
    });
  };
}
