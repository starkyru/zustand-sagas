import { describe, it, expect } from 'vitest';
import { buffers } from '../src/buffers';

describe('buffers.none', () => {
  it('is always empty', () => {
    const buf = buffers.none<number>();
    expect(buf.isEmpty()).toBe(true);
    buf.put(1);
    expect(buf.isEmpty()).toBe(true); // dropped
    expect(buf.take()).toBeUndefined();
  });

  it('flush returns empty array', () => {
    const buf = buffers.none<number>();
    buf.put(1);
    expect(buf.flush()).toEqual([]);
  });
});

describe('buffers.fixed', () => {
  it('buffers up to limit', () => {
    const buf = buffers.fixed<number>(3);
    buf.put(1);
    buf.put(2);
    buf.put(3);
    expect(buf.isEmpty()).toBe(false);
    expect(buf.take()).toBe(1);
    expect(buf.take()).toBe(2);
    expect(buf.take()).toBe(3);
    expect(buf.isEmpty()).toBe(true);
  });

  it('throws on overflow', () => {
    const buf = buffers.fixed<number>(2);
    buf.put(1);
    buf.put(2);
    expect(() => buf.put(3)).toThrow('Buffer overflow');
  });

  it('flush returns all items and empties', () => {
    const buf = buffers.fixed<number>(5);
    buf.put(1);
    buf.put(2);
    buf.put(3);
    expect(buf.flush()).toEqual([1, 2, 3]);
    expect(buf.isEmpty()).toBe(true);
  });

  it('defaults to limit 10', () => {
    const buf = buffers.fixed<number>();
    for (let i = 0; i < 10; i++) buf.put(i);
    expect(() => buf.put(10)).toThrow('Buffer overflow');
  });
});

describe('buffers.dropping', () => {
  it('drops new items when full', () => {
    const buf = buffers.dropping<number>(2);
    buf.put(1);
    buf.put(2);
    buf.put(3); // silently dropped
    expect(buf.take()).toBe(1);
    expect(buf.take()).toBe(2);
    expect(buf.take()).toBeUndefined();
  });
});

describe('buffers.sliding', () => {
  it('drops oldest when full', () => {
    const buf = buffers.sliding<number>(2);
    buf.put(1);
    buf.put(2);
    buf.put(3); // drops 1
    expect(buf.take()).toBe(2);
    expect(buf.take()).toBe(3);
    expect(buf.take()).toBeUndefined();
  });
});

describe('buffers.expanding', () => {
  it('never drops items', () => {
    const buf = buffers.expanding<number>();
    for (let i = 0; i < 100; i++) buf.put(i);
    expect(buf.flush().length).toBe(100);
  });
});
