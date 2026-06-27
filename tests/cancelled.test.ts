import { describe, it, expect, vi } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { take, call, cancelled } from '../src/effects';
import type { Effect } from '../src/types';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('cancelled() effect', () => {
  it('resolves true inside a finally block when the saga is cancelled', async () => {
    const env: RunnerEnv = { channel: new ActionChannel(), getState: () => ({}) };
    let observed: boolean | undefined;
    let cleanupRan = false;

    function* saga(): Generator<Effect, void, any> {
      try {
        yield take('never'); // park forever
      } finally {
        observed = yield cancelled();
        cleanupRan = true;
      }
    }

    const task = runSaga(saga, env);
    await tick();
    task.cancel();
    await tick();

    expect(cleanupRan).toBe(true);
    expect(observed).toBe(true);
  });

  it('resolves false inside a finally block on normal completion', async () => {
    const env: RunnerEnv = { channel: new ActionChannel(), getState: () => ({}) };
    let observed: boolean | undefined;

    function* saga(): Generator<Effect, void, any> {
      try {
        // completes immediately, no cancellation
      } finally {
        observed = yield cancelled();
      }
    }

    const task = runSaga(saga, env);
    await task.toPromise();

    expect(observed).toBe(false);
  });

  it('runs effects yielded from a finally block during cancellation', async () => {
    const env: RunnerEnv = { channel: new ActionChannel(), getState: () => ({}) };
    const cleanup = vi.fn();

    function* saga(): Generator<Effect, void, any> {
      try {
        yield take('never');
      } finally {
        yield call(cleanup);
      }
    }

    const task = runSaga(saga, env);
    await tick();
    task.cancel();
    await tick();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
