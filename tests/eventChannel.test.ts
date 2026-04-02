import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { take, takeMaybe, call, fork, delay } from '../src/effects';
import { eventChannel, channel, END } from '../src/channels';

function createEnv(): RunnerEnv {
  return {
    channel: new ActionChannel(),
    getState: () => ({}),
  };
}

describe('eventChannel in sagas', () => {
  it('saga can take from an eventChannel', async () => {
    const received: number[] = [];

    function* saga() {
      const chan = eventChannel<number>((emit) => {
        let n = 0;
        const id = setInterval(() => {
          n++;
          if (n <= 3) emit(n);
          else {
            emit(END);
            clearInterval(id);
          }
        }, 10);
        return () => clearInterval(id);
      });

      while (true) {
        const value = yield take(chan);
        received.push(value);
      }
    }

    const env = createEnv();
    const task = runSaga(saga, env);

    await new Promise((r) => setTimeout(r, 80));

    // take(channel) auto-terminates on END
    expect(received).toEqual([1, 2, 3]);
    expect(task.isRunning()).toBe(false);
  });

  it('takeMaybe receives END as a value', async () => {
    const received: unknown[] = [];

    function* saga() {
      const chan = eventChannel<number>((emit) => {
        setTimeout(() => {
          emit(1);
          emit(END);
        }, 10);
        return () => {};
      });

      const v1 = yield takeMaybe(chan);
      received.push(v1);
      const v2 = yield takeMaybe(chan);
      received.push(v2);
    }

    const env = createEnv();
    const task = runSaga(saga, env);

    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([1, END]);
  });

  it('take from a basic channel', async () => {
    const results: number[] = [];

    function* saga() {
      const chan = channel<number>();
      yield fork(function* () {
        yield delay(10);
        chan.put(1);
        chan.put(2);
        chan.put(3);
        chan.close();
      });

      while (true) {
        const value = yield take(chan);
        results.push(value);
      }
    }

    const env = createEnv();
    const task = runSaga(saga, env);

    await new Promise((r) => setTimeout(r, 50));

    expect(results).toEqual([1, 2, 3]);
    expect(task.isRunning()).toBe(false);
  });

  it('race with channel take', async () => {
    let result: Record<string, unknown> | undefined;

    function* saga() {
      const chan = channel<string>();

      yield fork(function* () {
        yield delay(10);
        chan.put('hello');
      });

      result = yield call(function* () {
        return yield {
          type: Symbol('RACE'), // Can't use RACE directly, use race effect
        };
      });
    }

    // Simpler approach: test race via the race effect
    const env = createEnv();
    const { race } = await import('../src/effects');

    let raceResult: Record<string, unknown> | undefined;

    function* saga2() {
      const chan = channel<string>();

      yield fork(function* () {
        yield delay(10);
        chan.put('hello');
      });

      raceResult = yield race({
        msg: take(chan),
        timeout: delay(500),
      });
    }

    const task = runSaga(saga2, env);
    await new Promise((r) => setTimeout(r, 50));

    expect(raceResult).toBeDefined();
    expect(raceResult!.msg).toBe('hello');
    expect(raceResult!.timeout).toBeUndefined();
  });
});
