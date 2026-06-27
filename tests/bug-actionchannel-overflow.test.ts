import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createSaga } from '../src/createSaga';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { take, actionChannel } from '../src/effects';
import { buffers } from '../src/buffers';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('BUG-1: actionChannel bounded-buffer overflow must not crash the dispatcher', () => {
  it('low-level: ActionChannel.emit does not throw when a saga actionChannel buffer overflows', async () => {
    const env: RunnerEnv = {
      channel: new ActionChannel(),
      getState: () => ({}),
    };

    // Saga registers a bounded (fixed size 1) actionChannel subscription, then parks
    // forever on a take that never fires — so it never drains the buffer.
    function* saga() {
      yield actionChannel('ping', buffers.fixed<any>(1));
      yield take('never');
    }

    runSaga(saga, env);
    await tick(); // let the saga reach the parked take and register its subscription

    // The overflow must be surfaced (not silently swallowed) — capture it.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First emit fills the buffer (size 1) via the persistent subscription callback.
    env.channel.emit({ type: 'ping' });

    // Second emit overflows the bounded buffer. The overflow must NOT propagate
    // out of emit() into the caller (the dispatcher / wrapped store action)...
    expect(() => env.channel.emit({ type: 'ping' })).not.toThrow();

    // ...but it must still be reported, not swallowed.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const reported = errorSpy.mock.calls[0].find((a) => a instanceof Error) as Error | undefined;
    expect(reported?.message).toContain('Buffer overflow');

    errorSpy.mockRestore();
  });

  it('realistic: calling a wrapped store action twice does not throw when the saga actionChannel buffer is full', async () => {
    const store = createStore<{
      ping: () => void;
    }>(() => ({
      ping: () => {},
    }));

    // Root saga opens a bounded actionChannel for 'ping' and then parks on a take
    // that never fires, so the buffer is never drained.
    const useSaga = createSaga(store, function* ({ actionChannel, take }) {
      yield actionChannel('ping', buffers.fixed(1));
      yield take('never');
    });

    await tick(); // let the root saga register its actionChannel subscription

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First dispatch fills the size-1 buffer through the wrapped action -> emit -> put.
    store.getState().ping();

    // Second dispatch overflows the bounded buffer. The overflow inside emit() must
    // NOT propagate out of the wrapped store action call...
    expect(() => store.getState().ping()).not.toThrow();

    // ...and must be reported out-of-band rather than swallowed.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const reported = errorSpy.mock.calls[0].find((a) => a instanceof Error) as Error | undefined;
    expect(reported?.message).toContain('Buffer overflow');

    errorSpy.mockRestore();
    useSaga.task.cancel();
  });
});
