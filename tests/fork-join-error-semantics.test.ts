import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { fork, join, call, delay } from '../src/effects';
import type { Effect } from '../src/types';

/**
 * Documents the fork/join error-handling contract (see README "join").
 *
 * - `join(task)` resolves to the joined task's outcome: if the task threw, the
 *   join rethrows it, so a try/catch around the join handles it.
 * - An attached `fork`'s error propagates to the parent as soon as it happens.
 *   If the child fails BEFORE the parent reaches its `join`, that propagation
 *   aborts the parent first — the later join is never reached (redux-saga's
 *   "join promptly, or the error bubbles" rule). Join promptly, `spawn` to
 *   detach, or handle the error inside the worker.
 *
 * (Originally filed as BUG-3; closed as works-as-documented — current `join`
 * already delivers errors to a parent that is joining, see the first test.)
 */
const mkEnv = (): RunnerEnv => ({ channel: new ActionChannel(), getState: () => ({}) });

describe('fork/join error semantics', () => {
  it('join rethrows the child error when the parent is already joining', async () => {
    let caught: string | undefined;
    function* saga(): Generator<Effect, void, any> {
      const child = yield fork(function* (): Generator<Effect, void, any> {
        yield delay(5);
        throw new Error('child-failed');
      });
      try {
        yield join(child); // parent is suspended here when the child fails
      } catch (e: any) {
        caught = e.message;
      }
    }
    await runSaga(saga, mkEnv()).toPromise();
    expect(caught).toBe('child-failed');
  });

  it('a late join cannot catch an already-failed child — the error propagates to the parent', async () => {
    let caughtViaJoin = false;
    let parentRejected = false;
    function* saga(): Generator<Effect, void, any> {
      const child = yield fork(function* (): Generator<Effect, void, any> {
        throw new Error('child boom'); // fails immediately, before the join below
      });
      yield call(() => new Promise((r) => setTimeout(r, 10))); // child dies during this gap
      try {
        yield join(child);
      } catch {
        caughtViaJoin = true;
      }
    }
    await runSaga(saga, mkEnv())
      .toPromise()
      .then(
        () => {},
        () => {
          parentRejected = true;
        },
      );
    // Documented behavior: the fork error aborts the parent before the join is
    // reached, so the join's try/catch never runs and the parent rejects.
    expect(caughtViaJoin).toBe(false);
    expect(parentRejected).toBe(true);
  });
});
