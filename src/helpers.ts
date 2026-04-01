import { take, fork, cancel, delay, call } from './effects';
import type { ActionPattern, Effect, SagaFn, Task, ActionEvent, SagaContext } from './types';

export function* takeEvery(
  pattern: ActionPattern,
  worker: (action: ActionEvent, ctx: SagaContext) => Generator<Effect, unknown, unknown>,
): Generator<Effect, never, unknown> {
  while (true) {
    const action = yield take(pattern);
    yield fork(
      (function* (a: unknown) {
        yield* worker(a as ActionEvent, {} as SagaContext);
      }) as SagaFn,
      action,
    );
  }
}

export function* takeLatest(
  pattern: ActionPattern,
  worker: (action: ActionEvent, ctx: SagaContext) => Generator<Effect, unknown, unknown>,
): Generator<Effect, never, unknown> {
  let lastTask: Task<any> | undefined;
  while (true) {
    const action = yield take(pattern);
    if (lastTask) {
      yield cancel(lastTask);
    }
    lastTask = (yield fork(
      (function* (a: unknown) {
        yield* worker(a as ActionEvent, {} as SagaContext);
      }) as SagaFn,
      action,
    )) as Task<any>;
  }
}

export function* takeLeading(
  pattern: ActionPattern,
  worker: (action: ActionEvent, ctx: SagaContext) => Generator<Effect, unknown, unknown>,
): Generator<Effect, never, unknown> {
  while (true) {
    const action = yield take(pattern);
    yield call(
      (function* (a: unknown) {
        yield* worker(a as ActionEvent, {} as SagaContext);
      }) as SagaFn,
      action,
    );
  }
}

export function* debounce(
  ms: number,
  pattern: ActionPattern,
  worker: (action: ActionEvent, ctx: SagaContext) => Generator<Effect, unknown, unknown>,
): Generator<Effect, never, unknown> {
  let lastTask: Task<any> | undefined;
  while (true) {
    const action = yield take(pattern);
    if (lastTask) {
      yield cancel(lastTask);
    }
    lastTask = (yield fork(
      (function* (a: unknown) {
        yield delay(ms);
        yield* worker(a as ActionEvent, {} as SagaContext);
      }) as SagaFn,
      action,
    )) as Task<any>;
  }
}
