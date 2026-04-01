import type { StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand';
import { ActionChannel } from './channel';
import { createSagaApi, type SagaApi } from './api';
import { runSaga } from './runner';
import type { SagaFn, StoreSagas, Task, Effect } from './types';

function wrapActions<T extends object>(
  state: T,
  channel: ActionChannel,
  wrapped: WeakSet<Function>,
): T {
  const result = { ...state } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === 'function' && !wrapped.has(value as Function)) {
      const original = value as Function;
      const wrapper = (...args: unknown[]) => {
        channel.emit({
          type: key,
          payload: args.length === 0 ? undefined : args.length === 1 ? args[0] : args,
        });
        return original(...args);
      };
      wrapped.add(wrapper);
      result[key] = wrapper;
    }
  }
  return result as T;
}

type RootSagaFn<T> = (api: SagaApi<T>) => Generator<Effect, unknown, unknown>;

type SagasImpl = <T>(
  rootSaga: RootSagaFn<T>,
  stateCreator: StateCreator<T, [], []>,
) => StateCreator<T, [], [['zustand-sagas', never]]>;

const sagasImpl: SagasImpl = (rootSaga, stateCreator) => (set, get, api) => {
  const channel = new ActionChannel();
  const wrapped = new WeakSet<Function>();

  const sagaApi = api as unknown as StoreApi<unknown> & StoreSagas;

  // Wrap set so any new functions added via setState also get wrapped
  const originalSetState = api.setState.bind(api) as typeof api.setState;
  api.setState = ((...args: any[]) => {
    const [partial, replace] = args;
    if (typeof partial === 'function') {
      const updater = partial;
      originalSetState(((prev: any) => {
        const next = updater(prev);
        return typeof next === 'object' && next !== null
          ? wrapActions(next as object, channel, wrapped)
          : next;
      }) as any, replace);
    } else if (typeof partial === 'object' && partial !== null) {
      originalSetState(wrapActions(partial as object, channel, wrapped) as any, replace);
    } else {
      originalSetState(partial as any, replace);
    }
  }) as typeof api.setState;

  // Also wrap the set passed to the state creator
  const wrappedSet = ((partial: unknown, replace?: boolean) => {
    api.setState(partial as any, replace as any);
  }) as typeof set;

  const initialState = stateCreator(wrappedSet, get, api);

  // Wrap functions in the initial state
  const wrappedState = typeof initialState === 'object' && initialState !== null
    ? wrapActions(initialState as object, channel, wrapped) as typeof initialState
    : initialState;

  const env = {
    channel,
    getState: get as () => unknown,
    context: {
      set: wrappedSet as (...args: unknown[]) => void,
      get: get as () => unknown,
    },
  };

  const typedApi = createSagaApi();

  sagaApi.sagaTask = runSaga(
    (() => rootSaga(typedApi)) as SagaFn,
    env,
  ) as Task<void>;

  return wrappedState;
};

export const sagas = sagasImpl as unknown as <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  rootSaga: RootSagaFn<T>,
  stateCreator: StateCreator<T, Mps, Mcs>,
) => StateCreator<T, Mps, [['zustand-sagas', never], ...Mcs]>;
