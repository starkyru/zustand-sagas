import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { take, call, delay, fork, select } from '../src/effects';
import { createSagaMonitor } from '../src/monitor';
import type { Effect } from '../src/types';

function createEnv(
  monitor: ReturnType<typeof createSagaMonitor>,
  state: Record<string, unknown> = {},
): RunnerEnv {
  return {
    channel: new ActionChannel(),
    getState: () => state,
    monitor,
  };
}

describe('createSagaMonitor', () => {
  it('logs task start and done', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({ log: (...args: unknown[]) => lines.push(args.join(' ')) });

    function* saga() {
      yield delay(1);
    }

    const env = createEnv(monitor);
    const task = runSaga(saga, env);
    await task.toPromise();

    expect(lines.some((l) => l.includes('started') && l.includes('saga'))).toBe(true);
    expect(lines.some((l) => l.includes('done'))).toBe(true);
  });

  it('logs effect start and result with timing', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({ log: (...args: unknown[]) => lines.push(args.join(' ')) });

    function* saga() {
      yield delay(10);
    }

    const env = createEnv(monitor);
    const task = runSaga(saga, env);
    await task.toPromise();

    expect(lines.some((l) => l.includes('>> DELAY(10ms)'))).toBe(true);
    expect(lines.some((l) => l.includes('<< DELAY(10ms)') && l.includes('ms)'))).toBe(true);
  });

  it('logs effect errors', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({ log: (...args: unknown[]) => lines.push(args.join(' ')) });

    function* saga() {
      try {
        yield call(() => {
          throw new Error('boom');
        });
      } catch {
        // caught
      }
    }

    const env = createEnv(monitor);
    const task = runSaga(saga, env);
    await task.toPromise();

    expect(lines.some((l) => l.includes('!! CALL') && l.includes('boom'))).toBe(true);
  });

  it('logs task cancellation', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({ log: (...args: unknown[]) => lines.push(args.join(' ')) });

    function* saga() {
      yield delay(10_000);
    }

    const env = createEnv(monitor);
    const task = runSaga(saga, env);
    await new Promise((r) => setTimeout(r, 5));
    task.cancel();

    expect(lines.some((l) => l.includes('cancel'))).toBe(true);
  });

  it('filters by effect type', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({
      log: (...args: unknown[]) => lines.push(args.join(' ')),
      filter: ['DELAY'],
    });

    function* saga() {
      yield select();
      yield delay(1);
    }

    const env = createEnv(monitor);
    const task = runSaga(saga, env);
    await task.toPromise();

    const effectLines = lines.filter((l) => l.includes('>>') || l.includes('<<'));
    expect(effectLines.every((l) => l.includes('DELAY'))).toBe(true);
    expect(effectLines.some((l) => l.includes('SELECT'))).toBe(false);
  });

  it('verbose mode includes results', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({
      log: (...args: unknown[]) => lines.push(args.join(' ')),
      verbose: true,
    });

    function* saga() {
      yield select((s: any) => s.count);
    }

    const env = createEnv(monitor, { count: 42 });
    const task = runSaga(saga, env);
    await task.toPromise();

    const selectResult = lines.find((l) => l.includes('<< SELECT'));
    expect(selectResult).toBeDefined();
    expect(selectResult).toContain('42');
  });

  it('logs forked child tasks', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({ log: (...args: unknown[]) => lines.push(args.join(' ')) });

    function* child(): Generator<Effect, void, any> {
      yield delay(1);
    }
    function* saga() {
      yield fork(child);
      yield delay(10);
    }

    const env = createEnv(monitor);
    const task = runSaga(saga, env);
    await task.toPromise();

    expect(lines.some((l) => l.includes('>> FORK(child)'))).toBe(true);
    // The forked child should also get its own task start
    expect(lines.filter((l) => l.includes('started')).length).toBeGreaterThanOrEqual(2);
  });

  it('logs task errors', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({ log: (...args: unknown[]) => lines.push(args.join(' ')) });

    function* saga() {
      yield call(() => {
        throw new Error('unhandled');
      });
    }

    const env = createEnv(monitor);
    const task = runSaga(saga, env);
    await task.toPromise().catch(() => {});

    expect(lines.some((l) => l.includes('error') && l.includes('unhandled'))).toBe(true);
  });

  it('logs take with pattern', async () => {
    const lines: string[] = [];
    const monitor = createSagaMonitor({ log: (...args: unknown[]) => lines.push(args.join(' ')) });

    function* saga() {
      yield take('myAction');
    }

    const env = createEnv(monitor);
    runSaga(saga, env);

    await new Promise((r) => setTimeout(r, 5));
    env.channel.emit({ type: 'myAction', payload: 'hello' });
    await new Promise((r) => setTimeout(r, 5));

    expect(lines.some((l) => l.includes(">> TAKE('myAction')"))).toBe(true);
    expect(lines.some((l) => l.includes("<< TAKE('myAction')"))).toBe(true);
  });
});
