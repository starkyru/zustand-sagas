import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { race, all, call, take, delay } from '../src/effects';

// Fresh env per test so channel takers from one test never bleed into another.
function createEnv(): RunnerEnv {
  return {
    channel: new ActionChannel(),
    getState: () => ({}),
  };
}

// Yield to the macrotask queue once, with real timers.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('RACE/ALL parent-cancel branch cleanup (RO-1)', () => {
  it('RACE: parent cancel cancels a pending call-generator branch so its finally runs', async () => {
    let cleaned = false;

    function* child() {
      try {
        yield take('NEVER');
      } finally {
        cleaned = true;
      }
    }

    function* saga() {
      yield race({ a: call(child), b: delay(100000) });
    }

    const env = createEnv();
    const task = runSaga(saga, env);

    // Let the saga park inside the race (child registered its take, delay armed).
    await tick();
    expect(cleaned).toBe(false);

    task.cancel();

    // Give the cancelled branch's child generator a chance to run its finally.
    await tick();
    await tick();

    expect(cleaned).toBe(true);
  });

  it('ALL: parent cancel cancels a pending call-generator branch so its finally runs', async () => {
    let cleaned = false;

    function* child() {
      try {
        yield take('NEVER');
      } finally {
        cleaned = true;
      }
    }

    function* saga() {
      yield all([call(child), delay(100000)]);
    }

    const env = createEnv();
    const task = runSaga(saga, env);

    await tick();
    expect(cleaned).toBe(false);

    task.cancel();

    await tick();
    await tick();

    expect(cleaned).toBe(true);
  });

  it('RACE: a normal resolving race still settles correctly after the cleanup change', async () => {
    let result: Record<string, unknown> | undefined;

    function* saga() {
      result = yield race({
        v: call(() => Promise.resolve(42)),
        t: delay(1000),
      });
    }

    const env = createEnv();
    const task = runSaga(saga, env);

    await task.toPromise();

    expect(result).toEqual({ v: 42, t: undefined });
    expect(task.isRunning()).toBe(false);
  });
});
