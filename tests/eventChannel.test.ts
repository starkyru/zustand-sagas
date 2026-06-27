import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { take, takeMaybe, fork, delay } from '../src/effects';
import { eventChannel, channel, END } from '../src/channels';
import { buffers } from '../src/buffers';

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

  it('default buffer is buffers.none(): events emitted before a taker registers are dropped', async () => {
    const received: number[] = [];

    function* saga() {
      // subscribe runs synchronously here, before the first `take` below —
      // so 1 and 2 are emitted with no waiting taker.
      const chan = eventChannel<number>((emit) => {
        emit(1); // dropped — none() has no capacity and no taker is waiting
        emit(2); // dropped
        setTimeout(() => {
          emit(3); // delivered — a taker is waiting by now
          emit(END);
        }, 10);
        return () => {};
      });

      while (true) {
        const value = yield take(chan);
        received.push(value);
      }
    }

    runSaga(saga, createEnv());
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([3]);
  });

  it('an explicit buffer retains events emitted before a taker registers', async () => {
    const received: number[] = [];

    function* saga() {
      const chan = eventChannel<number>((emit) => {
        emit(1); // buffered
        emit(2); // buffered
        setTimeout(() => {
          emit(3);
          emit(END);
        }, 10);
        return () => {};
      }, buffers.expanding<number>());

      while (true) {
        const value = yield take(chan);
        received.push(value);
      }
    }

    runSaga(saga, createEnv());
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([1, 2, 3]);
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
    runSaga(saga, env);

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

    runSaga(saga2, env);
    await new Promise((r) => setTimeout(r, 50));

    expect(raceResult).toBeDefined();
    expect(raceResult!.msg).toBe('hello');
    expect(raceResult!.timeout).toBeUndefined();
  });
});
