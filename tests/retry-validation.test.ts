import { describe, it, expect } from 'vitest';
import { retry } from '../src/effects';
import { RETRY } from '../src/types';

/**
 * RO-3: `retry(maxTries, ...)` with maxTries < 1 used to skip the runner's retry
 * loop entirely and resolve to `undefined` without ever calling `fn` — a silent
 * no-op. The effect creator now rejects invalid maxTries eagerly.
 */
describe('retry effect — maxTries validation (RO-3)', () => {
  const fn = async () => 1;

  it('throws on maxTries === 0 instead of silently no-op', () => {
    expect(() => retry(0, 10, fn)).toThrow(/maxTries must be an integer >= 1/);
  });

  it('throws on negative maxTries', () => {
    expect(() => retry(-3, 10, fn)).toThrow(/maxTries/);
  });

  it('throws on non-integer maxTries', () => {
    expect(() => retry(1.5, 10, fn)).toThrow(/maxTries/);
  });

  it('builds a valid RETRY effect when maxTries >= 1', () => {
    const effect = retry(2, 10, fn);
    expect(effect.type).toBe(RETRY);
    expect(effect.maxTries).toBe(2);
    expect(effect.fn).toBe(fn);
  });
});
