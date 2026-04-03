import type { StoreApi } from 'zustand';
import { ActionChannel } from './channel';
import { createSagaApi, type SagaApi } from './api';
import { runSaga } from './runner';
import type { SagaFn, Task, Effect, SagaMonitor } from './types';

function wrapActions<State extends object>(
  state: State,
  channel: ActionChannel,
  wrapperToOriginal: WeakMap<(...args: any[]) => any, (...args: any[]) => any>,
): State {
  const raw = state as Record<string, unknown>;
  // Fast path: skip cloning if there are no unwrapped functions
  let needsWrap = false;
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (typeof value === 'function' && !wrapperToOriginal.has(value as (...args: any[]) => any)) {
      needsWrap = true;
      break;
    }
  }
  if (!needsWrap) return state;

  const result = { ...raw };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === 'function' && !wrapperToOriginal.has(value as (...args: any[]) => any)) {
      const original = value as (...args: any[]) => any;
      const wrapper = (...args: unknown[]) => {
        // Run the original action first so state is updated,
        // then emit so sagas always see fresh state via select().
        const result = original(...args);
        channel.emit({
          type: key,
          payload: args.length === 0 ? undefined : args.length === 1 ? args[0] : args,
        });
        return result;
      };
      wrapperToOriginal.set(wrapper, original);
      result[key] = wrapper;
    }
  }
  return result as State;
}

function unwrapActions<State extends object>(
  state: State,
  wrapperToOriginal: WeakMap<(...args: any[]) => any, (...args: any[]) => any>,
): State {
  const raw = state as Record<string, unknown>;
  let needsUnwrap = false;
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (typeof value === 'function' && wrapperToOriginal.has(value as (...args: any[]) => any)) {
      needsUnwrap = true;
      break;
    }
  }
  if (!needsUnwrap) return state;

  const result = { ...raw };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === 'function' && wrapperToOriginal.has(value as (...args: any[]) => any)) {
      result[key] = wrapperToOriginal.get(value as (...args: any[]) => any);
    }
  }
  return result as State;
}

function interceptSetState<State>(
  store: StoreApi<State>,
  channel: ActionChannel,
  wrapperToOriginal: WeakMap<(...args: any[]) => any, (...args: any[]) => any>,
): () => void {
  const originalSetState = store.setState;
  const wrappedSetState = ((
    partial: State | Partial<State> | ((state: State) => State | Partial<State>),
    replace?: boolean,
  ) => {
    if (typeof partial === 'function') {
      const updater = partial as (state: State) => State | Partial<State>;
      originalSetState(
        ((prev: State) => {
          const next = updater(prev);
          return typeof next === 'object' && next !== null
            ? wrapActions(next as State & object, channel, wrapperToOriginal)
            : next;
        }) as (state: State) => State | Partial<State>,
        replace as false,
      );
    } else if (typeof partial === 'object' && partial !== null) {
      originalSetState(
        wrapActions(partial as State & object, channel, wrapperToOriginal) as Partial<State>,
        replace as false,
      );
    } else {
      originalSetState(partial as State, replace as false);
    }
  }) as typeof store.setState;

  store.setState = wrappedSetState;

  return () => {
    if (store.setState === wrappedSetState) {
      store.setState = originalSetState;
    }
  };
}

export type RootSagaFn<State> = (api: SagaApi<State>) => Generator<Effect, unknown, unknown>;

export interface UseSaga<State> {
  (): SagaApi<State>;
  task: Task<void>;
}

export interface CreateSagaOptions {
  monitor?: SagaMonitor;
}

export function createSaga<State>(
  store: StoreApi<State>,
  rootSaga: RootSagaFn<State>,
  options?: CreateSagaOptions,
): UseSaga<State> {
  const channel = new ActionChannel();
  const wrapperToOriginal = new WeakMap<(...args: any[]) => any, (...args: any[]) => any>();

  // Intercept setState to wrap new functions
  const restoreSetState = interceptSetState(store, channel, wrapperToOriginal);

  // Wrap functions already in the store
  const currentState = store.getState();
  if (typeof currentState === 'object' && currentState !== null) {
    store.setState(wrapActions(currentState as object, channel, wrapperToOriginal) as State, true);
  }

  const api = createSagaApi<State>();

  const env = {
    channel,
    getState: store.getState as () => unknown,
    subscribe: store.subscribe as (
      listener: (state: unknown, prevState: unknown) => void,
    ) => () => void,
    monitor: options?.monitor,
  };

  const task = runSaga((() => rootSaga(api)) as SagaFn, env) as Task<void>;
  task
    .toPromise()
    .finally(restoreSetState)
    .catch(() => {});

  // Wrap cancel to also unwrap action functions so the old channel can be
  // GC'd and re-attaching sagas won't stack wrappers on wrappers.
  const originalCancel = task.cancel.bind(task);
  task.cancel = () => {
    originalCancel();
    restoreSetState();
    const teardownState = store.getState();
    if (typeof teardownState === 'object' && teardownState !== null) {
      store.setState(
        unwrapActions(teardownState as State & object, wrapperToOriginal) as State,
        true,
      );
    }
  };

  const useSaga = (() => api) as UseSaga<State>;
  useSaga.task = task;

  return useSaga;
}
