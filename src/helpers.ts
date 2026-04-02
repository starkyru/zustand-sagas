import { take, fork, cancel, delay, call } from './effects';
import type { ActionPattern, Effect, ForkEffect, Task, ActionEvent } from './types';

export function takeEvery(
  pattern: ActionPattern,
  worker: (action: ActionEvent) => Generator<Effect, void, any>,
): ForkEffect {
  return fork(function* () {
    while (true) {
      const action: ActionEvent = yield take(pattern);
      yield fork(worker, action);
    }
  });
}

export function takeLatest(
  pattern: ActionPattern,
  worker: (action: ActionEvent) => Generator<Effect, void, any>,
): ForkEffect {
  return fork(function* () {
    let lastTask: Task | undefined;
    while (true) {
      const action: ActionEvent = yield take(pattern);
      if (lastTask) {
        yield cancel(lastTask);
      }
      lastTask = yield fork(worker, action);
    }
  });
}

export function takeLeading(
  pattern: ActionPattern,
  worker: (action: ActionEvent) => Generator<Effect, void, any>,
): ForkEffect {
  return fork(function* () {
    while (true) {
      const action: ActionEvent = yield take(pattern);
      yield call(worker, action);
    }
  });
}

export function debounce(
  ms: number,
  pattern: ActionPattern,
  worker: (action: ActionEvent) => Generator<Effect, void, any>,
): ForkEffect {
  return fork(function* () {
    let lastTask: Task | undefined;
    while (true) {
      const action: ActionEvent = yield take(pattern);
      if (lastTask) {
        yield cancel(lastTask);
      }
      lastTask = yield fork(function* () {
        yield delay(ms);
        yield* worker(action);
      });
    }
  });
}

export function throttle(
  ms: number,
  pattern: ActionPattern,
  worker: (action: ActionEvent) => Generator<Effect, void, any>,
): ForkEffect {
  return fork(function* () {
    while (true) {
      const action: ActionEvent = yield take(pattern);
      yield fork(worker, action);
      yield delay(ms);
    }
  });
}
