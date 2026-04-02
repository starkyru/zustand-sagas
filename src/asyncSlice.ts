/**
 * Async slice helper — generates typed state, loaders, error slots, and
 * actions for a single async resource managed by a saga.
 *
 * @example
 * ```ts
 * import { createAsyncSlice, type AsyncSlice } from 'zustand-sagas';
 *
 * type UserSlice = AsyncSlice<'user', User, [id: string]>;
 *
 * const userSlice = createAsyncSlice<'user', User, [id: string]>('user', set);
 * // userSlice.user            — User | null
 * // userSlice.userLoading     — boolean
 * // userSlice.userError       — string | null
 * // userSlice.fetchUser(id)   — starts loading
 * // userSlice.setUser(data)   — sets data, clears loading
 * // userSlice.setUserError(e) — sets error, clears data & loading
 * // userSlice.resetUser()     — resets everything
 * ```
 */

/**
 * Mapped type that expands a single async resource `Name` into data, loading,
 * error, and action properties with fully typed keys.
 */
export type AsyncSlice<Name extends string, T, Args extends unknown[] = []> = {
  [K in Name]: T | null;
} & {
  [K in `${Name}Loading`]: boolean;
} & { [K in `${Name}Error`]: string | null } & {
  [K in `fetch${Capitalize<Name>}`]: (...args: Args) => void;
} & { [K in `set${Capitalize<Name>}`]: (data: T) => void } & {
  [K in `set${Capitalize<Name>}Error`]: (error: string) => void;
} & { [K in `reset${Capitalize<Name>}`]: () => void };

/**
 * Creates a slice of Zustand state for an async resource, providing data,
 * loading, error, and action properties keyed by `name`.
 *
 * Pair with a saga that calls `fetchX` to trigger loading and `setX` /
 * `setXError` to settle the result.
 *
 * @param name  - The resource name (e.g. `"user"`).
 * @param set   - The Zustand `set` function.
 * @returns An object spread-ready into your store's state creator.
 */
export function createAsyncSlice<Name extends string, T, Args extends unknown[] = []>(
  name: Name,
  set: (partial: Record<string, unknown>) => void,
) {
  const cap = (name.charAt(0).toUpperCase() + name.slice(1)) as Capitalize<Name>;

  return {
    [name]: null,
    [`${name}Loading`]: false,
    [`${name}Error`]: null,
    [`fetch${cap}`]: (..._args: Args) => {
      set({
        [`${name}Loading`]: true,
        [`${name}Error`]: null,
      });
    },
    [`set${cap}`]: (data: T) => {
      set({
        [name]: data,
        [`${name}Loading`]: false,
      });
    },
    [`set${cap}Error`]: (error: string) => {
      set({
        [name]: null,
        [`${name}Loading`]: false,
        [`${name}Error`]: error,
      });
    },
    [`reset${cap}`]: () => {
      set({
        [name]: null,
        [`${name}Loading`]: false,
        [`${name}Error`]: null,
      });
    },
  } as AsyncSlice<Name, T, Args>;
}
