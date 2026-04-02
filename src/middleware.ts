import type { StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand';
import { createSaga, type RootSagaFn } from './createSaga';
import type { StoreSagas } from './types';

type SagasImpl = <State>(
  rootSaga: RootSagaFn<State>,
  stateCreator: StateCreator<State, [], []>,
) => StateCreator<State, [], [['zustand-sagas', never]]>;

const sagasImpl: SagasImpl = (rootSaga, stateCreator) => (set, get, api) => {
  const initialState = stateCreator(set, get, api);

  // Zustand hasn't committed the initial state yet (the middleware return does that).
  // Force-set it so createSaga can read/wrap it.
  api.setState(initialState, true);

  const useSaga = createSaga(api as StoreApi<typeof initialState>, rootSaga);
  (api as StoreApi<typeof initialState> & StoreSagas).sagaTask = useSaga.task;

  // Return the now-wrapped state from the store
  return api.getState();
};

export const sagas = sagasImpl as unknown as <
  State,
  MutatorsIn extends [StoreMutatorIdentifier, unknown][] = [],
  MutatorsOut extends [StoreMutatorIdentifier, unknown][] = [],
>(
  rootSaga: RootSagaFn<State>,
  stateCreator: StateCreator<State, MutatorsIn, MutatorsOut>,
) => StateCreator<State, MutatorsIn, [['zustand-sagas', never], ...MutatorsOut]>;
