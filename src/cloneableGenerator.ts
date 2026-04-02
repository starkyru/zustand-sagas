import type { Effect } from './types';

export interface CloneableGenerator<Result = unknown> extends Generator<Effect, Result, any> {
  clone(): CloneableGenerator<Result>;
}

interface HistoryEntry {
  type: 'next' | 'throw' | 'return';
  value: any;
}

export function cloneableGenerator<Args extends any[], Result>(
  fn: (...args: Args) => Generator<Effect, Result, any>,
): (...args: Args) => CloneableGenerator<Result> {
  return (...args: Args) => makeCloneable(fn, args, []);
}

function makeCloneable<Args extends any[], Result>(
  fn: (...args: Args) => Generator<Effect, Result, any>,
  args: Args,
  history: HistoryEntry[],
): CloneableGenerator<Result> {
  const gen = fn(...args);

  // Replay history to reach the same state
  for (const entry of history) {
    gen[entry.type](entry.value);
  }

  const localHistory = [...history];

  const cloneable: CloneableGenerator<Result> = Object.assign(
    Object.create(Object.getPrototypeOf(gen)),
    {
      next(value?: any) {
        localHistory.push({ type: 'next', value });
        return gen.next(value);
      },
      throw(error?: any) {
        localHistory.push({ type: 'throw', value: error });
        return gen.throw(error);
      },
      return(value: Result) {
        localHistory.push({ type: 'return', value });
        return gen.return(value);
      },
      clone() {
        return makeCloneable(fn, args, localHistory);
      },
      [Symbol.iterator]() {
        return cloneable;
      },
    },
  );

  return cloneable;
}
