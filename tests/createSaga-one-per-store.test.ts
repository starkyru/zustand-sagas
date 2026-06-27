import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createSaga } from '../src/createSaga';
import { take } from '../src/effects';
import type { Effect } from '../src/types';

/**
 * RO-2: a store hosts only one active saga at a time. A second concurrent
 * createSaga on the same store would stack setState interceptors and leak the
 * inner channel, so it is rejected. Sequential re-attach (cancel then create)
 * must still work.
 */
describe('createSaga — one active saga per store (RO-2)', () => {
  const makeStore = () => createStore<{ ping: () => void }>(() => ({ ping: () => {} }));
  const rootSaga = function* (): Generator<Effect, void, any> {
    yield take('never'); // park so the saga stays active
  };

  it('throws when a second saga is created on a store that already has one', () => {
    const store = makeStore();
    createSaga(store, rootSaga);
    expect(() => createSaga(store, rootSaga)).toThrow(/already has an active saga/);
  });

  it('allows re-attaching after the first saga is cancelled', () => {
    const store = makeStore();
    const first = createSaga(store, rootSaga);
    first.task.cancel();
    expect(() => createSaga(store, rootSaga)).not.toThrow();
  });
});
