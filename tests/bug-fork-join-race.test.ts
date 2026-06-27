import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { fork, join, call } from '../src/effects';

/**
 * BUG-3 (MEDIUM): A forked child's error cannot be caught by a later `join`.
 *
 * In src/runner.ts FORK (runner.ts:562-579), when a forked child rejects, the
 * parent decides propagation immediately based on `joinedTasks.has(child)`.
 * `joinedTasks` is only populated when the JOIN effect actually runs
 * (runner.ts:593-596). So if a forked child throws BEFORE the parent reaches
 * `yield join(child)`, the parent is force-rejected (and siblings cancelled),
 * and the parent's `try { yield join(child) } catch {}` never runs.
 *
 * Desired behavior (the fix target): a parent that wraps `yield join(child)` in
 * try/catch should be able to catch the child's error, and the parent should
 * settle normally (NOT be force-rejected), even when the child throws before
 * the parent reaches the join.
 *
 * STATUS (see TODO.md BUG-3): NOT fixed this cycle. A fix attempt proved the
 * desired behavior is mutually exclusive with an existing contract — another
 * test parks an un-joined parent on `take('NEVER')` and requires that an
 * un-joined child error reject the parent immediately (it never reaches a
 * join), while this case requires a late join to catch. A deterministic runner
 * cannot satisfy both without knowing the future, so this stays a documented,
 * tripwired known bug rather than a hard-red test.
 *
 * The single `it.fails(...)` below is the executable contract: it PASSES today
 * (the desired assertions currently fail) and will START FAILING the moment the
 * bug is fixed — at which point convert it to a normal `it(...)`.
 */

const env: RunnerEnv = {
  channel: new ActionChannel(),
  getState: () => ({}),
};

describe('BUG-3: fast-failing forked child error should be catchable via join', () => {
  it.fails('KNOWN BUG-3: fork error before join is NOT catchable (remove when fixed)', async () => {
    let caughtViaJoin = false;
    let parentRejected = false;

    function* parent() {
      const child = yield fork(function* () {
        throw new Error('child boom');
      });

      yield call(() => new Promise((r) => setTimeout(r, 10)));

      try {
        yield join(child);
      } catch {
        caughtViaJoin = true;
      }
    }

    const task = runSaga(parent, env);

    await task.toPromise().then(
      () => {},
      () => {
        parentRejected = true;
      },
    );

    // Documents the desired behavior. On current buggy code these assertions
    // fail (caughtViaJoin stays false, parentRejected is true), so `it.fails`
    // makes this case PASS today and start failing once the bug is fixed.
    expect(caughtViaJoin).toBe(true);
    expect(parentRejected).toBe(false);
  });
});
