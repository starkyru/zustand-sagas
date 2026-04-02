import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import {
  callWorker,
  forkWorker,
  spawnWorker,
  forkWorkerChannel,
  callWorkerGen,
  delay,
  fork,
  cancel,
  join,
  take,
  takeMaybe,
  call,
  select,
} from '../src/effects';
import { END } from '../src/channels';
import type { Effect } from '../src/types';

function createEnv(): RunnerEnv {
  return {
    channel: new ActionChannel(),
    getState: () => ({}),
  };
}

describe('callWorker', () => {
  it('runs a sync function in a worker and returns the result', async () => {
    function* saga() {
      const result = yield callWorker((a: number, b: number) => a + b, 10, 20);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe(30);
  });

  it('runs an async function in a worker', async () => {
    function* saga() {
      const result = yield callWorker(async (x: number) => {
        return x * 2;
      }, 21);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe(42);
  });

  it('propagates errors from worker to saga try/catch', async () => {
    function* saga() {
      try {
        yield callWorker(() => {
          throw new Error('worker-boom');
        });
        return 'no-error';
      } catch (e: any) {
        return `caught: ${e.message}`;
      }
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('caught: worker-boom');
  });

  it('handles complex data structures', async () => {
    function* saga() {
      const result = yield callWorker(
        (items: number[]) => items.filter((n) => n > 2),
        [1, 2, 3, 4, 5],
      );
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toEqual([3, 4, 5]);
  });
});

describe('forkWorker', () => {
  it('returns a Task and runs in background', async () => {
    function* saga() {
      const workerTask = yield forkWorker((x: number) => x * 3, 7);
      // Task returned immediately
      return workerTask;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const workerTask: any = await task.toPromise();
    expect(workerTask).toBeDefined();
    expect(typeof workerTask.toPromise).toBe('function');
    const result = await workerTask.toPromise();
    expect(result).toBe(21);
  });

  it('can be joined to get the result', async () => {
    function* saga() {
      const workerTask = yield forkWorker((a: number, b: number) => a + b, 5, 3);
      const result = yield join(workerTask);
      return result;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe(8);
  });

  it('is cancelled when parent is cancelled', async () => {
    function* child(): Generator<Effect, void, any> {
      // Fork a long-running worker
      const workerTask = yield forkWorker(() => {
        // Simulate long work
        let sum = 0;
        for (let i = 0; i < 1e8; i++) sum += i;
        return sum;
      });
      yield join(workerTask);
    }

    function* saga() {
      const childTask = yield fork(child);
      yield delay(10);
      yield cancel(childTask);
      return 'cancelled';
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('cancelled');
  });
});

describe('spawnWorker', () => {
  it('returns a Task that runs independently', async () => {
    function* saga() {
      const workerTask = yield spawnWorker((x: number) => x + 1, 99);
      return workerTask;
    }
    const env = createEnv();
    const task = runSaga(saga, env);
    const workerTask: any = await task.toPromise();
    const result = await workerTask.toPromise();
    expect(result).toBe(100);
  });

  it('is NOT cancelled when parent is cancelled', async () => {
    let spawnedTask: any;

    function* saga() {
      spawnedTask = yield spawnWorker((x: number) => x * 2, 25);
      // Wait forever — parent will be cancelled
      yield delay(999999);
    }
    const env = createEnv();
    const task = runSaga(saga, env);

    // Let the spawn happen
    await new Promise((r) => setTimeout(r, 10));
    task.cancel();

    // Spawned worker should still complete
    const result = await spawnedTask.toPromise();
    expect(result).toBe(50);
  });
});

describe('forkWorkerChannel', () => {
  it('streams emitted values through a channel', async () => {
    const received: number[] = [];
    let workerResult: any;

    function* saga() {
      const { channel: chan, task: workerTask } = yield forkWorkerChannel(
        (emit: (v: number) => void) => {
          emit(1);
          emit(2);
          emit(3);
          return 'done';
        },
      );

      // takeMaybe doesn't auto-terminate on END
      while (true) {
        const value = yield takeMaybe(chan);
        if (value === END) break;
        received.push(value as number);
      }

      workerResult = yield join(workerTask);
    }

    const env = createEnv();
    const task = runSaga(saga, env);
    await task.toPromise();
    expect(received).toEqual([1, 2, 3]);
    expect(workerResult).toBe('done');
  });

  it('streams async emitted values', async () => {
    const received: string[] = [];

    function* saga() {
      const { channel: chan } = yield forkWorkerChannel(
        async (emit: (v: string) => void, prefix: string) => {
          emit(`${prefix}-a`);
          emit(`${prefix}-b`);
          return 'finished';
        },
        'item',
      );

      const v1 = yield take(chan);
      received.push(v1 as string);
      const v2 = yield take(chan);
      received.push(v2 as string);
    }

    const env = createEnv();
    const task = runSaga(saga, env);
    await task.toPromise();
    expect(received).toEqual(['item-a', 'item-b']);
  });

  it('propagates worker errors', async () => {
    function* saga() {
      try {
        const { task: workerTask } = yield forkWorkerChannel((emit: (v: number) => void) => {
          emit(1);
          throw new Error('channel-worker-error');
        });
        yield join(workerTask);
        return 'no-error';
      } catch (e: any) {
        return `caught: ${e.message}`;
      }
    }

    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('caught: channel-worker-error');
  });
});

describe('callWorkerGen', () => {
  it('bidirectional: worker sends, handler responds', async () => {
    function* saga() {
      const result = yield callWorkerGen(
        // Worker: sends values, receives responses
        async (send: (v: any) => Promise<any>, x: number) => {
          const doubled = await send({ type: 'double', value: x });
          const tripled = await send({ type: 'triple', value: doubled });
          return tripled;
        },
        // Handler: processes each send
        function* (msg: any) {
          if (msg.type === 'double') return msg.value * 2;
          if (msg.type === 'triple') return msg.value * 3;
          return msg.value;
        },
        5,
      );
      return result;
    }

    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    // 5 -> double -> 10 -> triple -> 30
    expect(result).toBe(30);
  });

  it('handler can use saga effects', async () => {
    const state = { multiplier: 4 };
    const env: RunnerEnv = {
      channel: new ActionChannel(),
      getState: () => state,
    };

    function* saga() {
      const result = yield callWorkerGen(
        async (send: (v: any) => Promise<any>, x: number) => {
          const multiplied = await send(x);
          return multiplied;
        },
        // Handler uses select() to read state
        function* (value: number) {
          const s: any = yield select();
          return value * s.multiplier;
        },
        7,
      );
      return result;
    }

    const task = runSaga(saga, env);
    const result = await task.toPromise();
    // 7 * 4 = 28
    expect(result).toBe(28);
  });

  it('propagates worker errors through try/catch', async () => {
    function* saga() {
      try {
        yield callWorkerGen(
          async (send: (v: any) => Promise<any>) => {
            await send('hello');
            throw new Error('gen-worker-error');
          },
          function* () {
            return 'response';
          },
        );
        return 'no-error';
      } catch (e: any) {
        return `caught: ${e.message}`;
      }
    }

    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe('caught: gen-worker-error');
  });

  it('multiple round-trips with accumulation', async () => {
    function* saga() {
      const result = yield callWorkerGen(
        async (send: (v: any) => Promise<any>) => {
          let total = 0;
          total += await send(10); // handler returns 10 * 2 = 20
          total += await send(20); // handler returns 20 * 2 = 40
          total += await send(30); // handler returns 30 * 2 = 60
          return total; // 20 + 40 + 60 = 120
        },
        function* (value: number) {
          return value * 2;
        },
      );
      return result;
    }

    const env = createEnv();
    const task = runSaga(saga, env);
    const result = await task.toPromise();
    expect(result).toBe(120);
  });
});
