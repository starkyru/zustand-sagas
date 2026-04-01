import { describe, it, expect } from 'vitest';
import { take, call, select, fork, spawn, cancel, delay, race, all } from '../src/effects';
import { TAKE, CALL, SELECT, FORK, SPAWN, CANCEL, DELAY, RACE, ALL } from '../src/types';

describe('effect creators', () => {
  it('take creates a TakeEffect with string pattern', () => {
    const effect = take('increment');
    expect(effect).toEqual({ type: TAKE, pattern: 'increment' });
  });

  it('take creates a TakeEffect with predicate pattern', () => {
    const pred = (a: { type: string }) => a.type.startsWith('add');
    const effect = take(pred);
    expect(effect.type).toBe(TAKE);
    expect(effect.pattern).toBe(pred);
  });

  it('call creates a CallEffect', () => {
    const fn = (x: number) => x + 1;
    const effect = call(fn as (...args: unknown[]) => unknown, 5);
    expect(effect).toEqual({ type: CALL, fn, args: [5] });
  });

  it('select creates a SelectEffect with selector', () => {
    const selector = (s: { count: number }) => s.count;
    const effect = select(selector as (s: unknown) => unknown);
    expect(effect.type).toBe(SELECT);
    expect(effect.selector).toBe(selector);
  });

  it('select creates a SelectEffect without selector', () => {
    const effect = select();
    expect(effect).toEqual({ type: SELECT, selector: undefined });
  });

  it('fork creates a ForkEffect', () => {
    function* mySaga() { yield take('doSomething'); }
    const effect = fork(mySaga as any);
    expect(effect.type).toBe(FORK);
    expect(effect.saga).toBe(mySaga);
    expect(effect.args).toEqual([]);
  });

  it('spawn creates a SpawnEffect', () => {
    function* mySaga() { yield take('doSomething'); }
    const effect = spawn(mySaga as any);
    expect(effect.type).toBe(SPAWN);
    expect(effect.saga).toBe(mySaga);
  });

  it('cancel creates a CancelEffect', () => {
    const task = { id: 1, isRunning: () => true, isCancelled: () => false, result: () => undefined, toPromise: () => Promise.resolve(), cancel: () => {} };
    const effect = cancel(task);
    expect(effect).toEqual({ type: CANCEL, task });
  });

  it('delay creates a DelayEffect', () => {
    const effect = delay(1000);
    expect(effect).toEqual({ type: DELAY, ms: 1000 });
  });

  it('race creates a RaceEffect', () => {
    const effects = { a: take('actionA'), b: take('actionB') };
    const effect = race(effects);
    expect(effect.type).toBe(RACE);
    expect(effect.effects).toBe(effects);
  });

  it('all creates an AllEffect', () => {
    const effects = [take('actionA'), take('actionB')];
    const effect = all(effects);
    expect(effect.type).toBe(ALL);
    expect(effect.effects).toBe(effects);
  });
});
