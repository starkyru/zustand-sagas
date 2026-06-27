import { describe, it, expect } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { channel } from '../src/channels';
import { race, take, delay } from '../src/effects';

// Regression for BUG-2: `race` over a closed-channel `take` leaks the runner's
// private TERMINATE symbol into user saga code.
//
// A closed channel inside `race` must behave identically to a bare
// `yield* take(closedChannel)`: the saga terminates and the statement after
// the `race` never runs. No value of type `symbol` may ever reach user code.
//
// We must NOT import or reference the private TERMINATE symbol (it is not
// exported). The leak is detected generically: the post-race body must not run
// (`bodyRan`), and any captured branch value must not be a `symbol`.

function makeEnv(): RunnerEnv {
  return {
    channel: new ActionChannel(),
    getState: () => ({}),
  };
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('BUG-2: race + closed channel must not leak TERMINATE', () => {
  it('case A: post-race body does not run and no symbol reaches user code', async () => {
    const ch = channel<number>();

    let bodyRan = false;
    let afterRace: { msg?: unknown; timer?: unknown } | undefined;

    function* saga(): Generator<unknown, void, any> {
      const result = yield race({ msg: take(ch), timer: delay(10000) });
      // Everything below this line must NOT execute when the only resolved
      // branch is a closed-channel take — the saga must terminate instead.
      afterRace = result;
      bodyRan = true;
    }

    const env = makeEnv();
    const task = runSaga(saga, env);

    // Let the saga register its takers, then close the channel so the take
    // branch resolves via END.
    await tick(0);
    ch.close();
    await tick(20);

    task.cancel();

    // The saga must terminate: the line after `yield race(...)` must not run.
    expect(bodyRan).toBe(false);

    // And if the body somehow captured a value, the resolved branch must never
    // be a raw symbol (the leaked private TERMINATE sentinel).
    expect(typeof afterRace?.msg).not.toBe('symbol');
  });

  it('case B: bare take on a closed channel also does not run the next line', async () => {
    const ch = channel<number>();

    let bodyRan = false;

    function* saga(): Generator<unknown, void, any> {
      yield take(ch);
      // Must not execute: a closed channel terminates the saga.
      bodyRan = true;
    }

    const env = makeEnv();
    const task = runSaga(saga, env);

    await tick(0);
    ch.close();
    await tick(20);

    task.cancel();

    expect(bodyRan).toBe(false);
  });
});
