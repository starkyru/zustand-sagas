import { describe, it, expect } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createSaga } from '../src/createSaga';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { take, actionChannel, flush, delay } from '../src/effects';

describe('actionChannel effect', () => {
  it('buffers actions for sequential processing', async () => {
    const processed: string[] = [];

    const store = createStore<{
      request: (id: string) => void;
    }>(() => ({
      request: () => {},
    }));

    const useSaga = createSaga(store, function* ({ actionChannel, take, delay }) {
      const chan = yield actionChannel('request');

      while (true) {
        const action = yield take(chan);
        processed.push(action.payload);
        yield delay(20); // simulate async work
      }
    });

    // Fire 3 requests rapidly
    store.getState().request('a');
    store.getState().request('b');
    store.getState().request('c');

    // Wait for all to be processed sequentially
    await new Promise((r) => setTimeout(r, 100));

    expect(processed).toEqual(['a', 'b', 'c']);
    useSaga.task.cancel();
  });

  it('works with runner directly', async () => {
    const processed: string[] = [];

    const env: RunnerEnv = {
      channel: new ActionChannel(),
      getState: () => ({}),
    };

    function* saga() {
      const chan = yield actionChannel('DO');

      // Process first 2
      const a1 = yield take(chan);
      processed.push(a1.type);
      const a2 = yield take(chan);
      processed.push(a2.type);
    }

    runSaga(saga, env);

    env.channel.emit({ type: 'DO', payload: 1 });
    env.channel.emit({ type: 'DO', payload: 2 });

    await new Promise((r) => setTimeout(r, 20));
    expect(processed).toEqual(['DO', 'DO']);
  });

  it('cancellation unsubscribes actionChannel from the event bus', async () => {
    const env: RunnerEnv = {
      channel: new ActionChannel(),
      getState: () => ({}),
    };

    function* saga() {
      const chan = yield actionChannel('EVENT');
      // Block forever waiting for a take
      yield take(chan);
    }

    const task = runSaga(saga, env);
    await new Promise((r) => setTimeout(r, 10));

    // Subscription should be active
    expect((env.channel as any).subscriptions).toHaveLength(1);

    task.cancel();
    await new Promise((r) => setTimeout(r, 10));

    // Subscription should be cleaned up after cancellation
    expect((env.channel as any).subscriptions).toHaveLength(0);
  });

  it('normal completion unsubscribes actionChannel from the event bus', async () => {
    const env: RunnerEnv = {
      channel: new ActionChannel(),
      getState: () => ({}),
    };

    function* saga() {
      yield actionChannel('EVENT');
      return 'done';
    }

    const task = runSaga(saga, env);
    await expect(task.toPromise()).resolves.toBe('done');

    expect((env.channel as any).subscriptions).toHaveLength(0);
  });

  it('flush drains buffered actions', async () => {
    const env: RunnerEnv = {
      channel: new ActionChannel(),
      getState: () => ({}),
    };

    let flushed: unknown;

    function* saga() {
      const chan = yield actionChannel('EVENT');
      yield delay(10); // let events accumulate
      flushed = yield flush(chan);
    }

    runSaga(saga, env);

    env.channel.emit({ type: 'EVENT', payload: 1 });
    env.channel.emit({ type: 'EVENT', payload: 2 });
    env.channel.emit({ type: 'EVENT', payload: 3 });

    await new Promise((r) => setTimeout(r, 30));
    expect(flushed).toEqual([
      { type: 'EVENT', payload: 1 },
      { type: 'EVENT', payload: 2 },
      { type: 'EVENT', payload: 3 },
    ]);
  });
});
