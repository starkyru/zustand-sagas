import { describe, it, expect } from 'vitest';
import { cloneableGenerator } from '../src/cloneableGenerator';
import { call, put, select } from '../src/effects';
import { CALL } from '../src/types';
import type { Effect } from '../src/types';

describe('cloneableGenerator', () => {
  function* saga(value: number): Generator<Effect, string, any> {
    const state = yield select();
    if (state > 0) {
      yield put({ type: 'positive' });
      return 'positive';
    } else {
      yield call(() => 'fallback');
      return 'non-positive';
    }
  }

  it('steps through like a normal generator', () => {
    const gen = cloneableGenerator(saga)(10);
    const step1 = gen.next();
    expect(step1.done).toBe(false);
    expect(step1.value).toEqual(select());

    const step2 = gen.next(5); // state > 0
    expect(step2.value).toEqual(put({ type: 'positive' }));

    const step3 = gen.next();
    expect(step3.done).toBe(true);
    expect(step3.value).toBe('positive');
  });

  it('clone diverges from the original at a branch point', () => {
    const gen = cloneableGenerator(saga)(10);
    gen.next(); // yield select()

    // Clone before the branch
    const positive = gen.clone();
    const nonPositive = gen.clone();

    // Branch: state > 0
    const posStep = positive.next(5);
    expect(posStep.value).toEqual(put({ type: 'positive' }));
    const posResult = positive.next();
    expect(posResult.value).toBe('positive');

    // Branch: state <= 0
    const negStep = nonPositive.next(-1);
    expect(negStep.value).toHaveProperty('type', CALL);
    const negResult = nonPositive.next();
    expect(negResult.value).toBe('non-positive');
  });

  it('clone does not affect the original', () => {
    const gen = cloneableGenerator(saga)(10);
    gen.next(); // yield select()

    const clone = gen.clone();
    clone.next(5); // advance clone
    clone.next(); // finish clone

    // Original is still at the branch point
    const step = gen.next(5);
    expect(step.value).toEqual(put({ type: 'positive' }));
  });

  it('supports multiple sequential clones', () => {
    function* counting(): Generator<Effect, number, any> {
      yield select();
      yield select();
      yield select();
      return 42;
    }

    const gen = cloneableGenerator(counting)();
    gen.next(); // step 1
    const afterStep1 = gen.clone();

    gen.next(); // step 2
    const afterStep2 = gen.clone();

    // afterStep1 still needs 2 more yields
    afterStep1.next();
    const r1 = afterStep1.next();
    expect(r1.done).toBe(false);

    // afterStep2 needs 1 more yield
    const r2 = afterStep2.next();
    expect(r2.done).toBe(false);
    const r3 = afterStep2.next();
    expect(r3.done).toBe(true);
    expect(r3.value).toBe(42);
  });
});
