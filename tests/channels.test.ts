import { describe, it, expect } from 'vitest';
import { channel, multicastChannel, eventChannel, END, isChannel } from '../src/channels';
import { buffers } from '../src/buffers';

describe('isChannel', () => {
  it('returns true for channels', () => {
    expect(isChannel(channel())).toBe(true);
    expect(isChannel(multicastChannel())).toBe(true);
  });

  it('returns false for non-channels', () => {
    expect(isChannel(null)).toBe(false);
    expect(isChannel('string')).toBe(false);
    expect(isChannel({ take: () => {} })).toBe(false);
  });
});

describe('BasicChannel (via channel())', () => {
  it('delivers put to pending taker', async () => {
    const chan = channel<number>();
    const { promise } = chan.take();
    chan.put(42);
    expect(await promise).toBe(42);
  });

  it('buffers items when no taker is waiting', async () => {
    const chan = channel<number>();
    chan.put(1);
    chan.put(2);
    const { promise: p1 } = chan.take();
    const { promise: p2 } = chan.take();
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
  });

  it('point-to-point: only one taker gets each message', async () => {
    const chan = channel<number>();
    const { promise: p1 } = chan.take();
    const { promise: p2 } = chan.take();
    chan.put(1);
    chan.put(2);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
  });

  it('close resolves pending takers with END', async () => {
    const chan = channel<number>();
    const { promise } = chan.take();
    chan.close();
    expect(await promise).toBe(END);
  });

  it('take after close returns END', async () => {
    const chan = channel<number>();
    chan.close();
    const { promise } = chan.take();
    expect(await promise).toBe(END);
  });

  it('put after close is ignored', async () => {
    const chan = channel<number>();
    chan.close();
    chan.put(1); // should not throw
    const { promise } = chan.take();
    expect(await promise).toBe(END);
  });

  it('put(END) closes the channel', async () => {
    const chan = channel<number>();
    const { promise } = chan.take();
    chan.put(END);
    expect(await promise).toBe(END);
  });

  it('buffered items can still be consumed after close', async () => {
    const chan = channel<number>();
    chan.put(1);
    chan.put(2);
    chan.close();
    const { promise: p1 } = chan.take();
    const { promise: p2 } = chan.take();
    const { promise: p3 } = chan.take();
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(await p3).toBe(END);
  });

  it('flush returns buffered items', () => {
    const chan = channel<number>();
    chan.put(1);
    chan.put(2);
    chan.put(3);
    expect(chan.flush()).toEqual([1, 2, 3]);
    expect(chan.flush()).toEqual([]);
  });

  it('cancel removes a pending taker', async () => {
    const chan = channel<number>();
    const { cancel: cancelTake } = chan.take();
    cancelTake();
    // Now put should go to the next taker, not the cancelled one
    const { promise } = chan.take();
    chan.put(42);
    expect(await promise).toBe(42);
  });

  it('works with dropping buffer', async () => {
    const chan = channel<number>(buffers.dropping(2));
    chan.put(1);
    chan.put(2);
    chan.put(3); // dropped
    expect(chan.flush()).toEqual([1, 2]);
  });

  it('works with sliding buffer', async () => {
    const chan = channel<number>(buffers.sliding(2));
    chan.put(1);
    chan.put(2);
    chan.put(3); // drops 1
    expect(chan.flush()).toEqual([2, 3]);
  });
});

describe('MulticastChannel', () => {
  it('delivers to all takers', async () => {
    const chan = multicastChannel<number>();
    const { promise: p1 } = chan.take();
    const { promise: p2 } = chan.take();
    chan.put(42);
    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
  });

  it('close resolves all takers with END', async () => {
    const chan = multicastChannel<number>();
    const { promise: p1 } = chan.take();
    const { promise: p2 } = chan.take();
    chan.close();
    expect(await p1).toBe(END);
    expect(await p2).toBe(END);
  });

  it('take after close returns END', async () => {
    const chan = multicastChannel<number>();
    chan.close();
    const { promise } = chan.take();
    expect(await promise).toBe(END);
  });

  it('flush returns empty (no buffer)', () => {
    const chan = multicastChannel<number>();
    expect(chan.flush()).toEqual([]);
  });
});

describe('eventChannel', () => {
  it('bridges external events into a channel', async () => {
    const chan = eventChannel<number>((emit) => {
      const id = setTimeout(() => {
        emit(1);
        emit(2);
      }, 10);
      return () => clearTimeout(id);
    });

    const { promise: p1 } = chan.take();
    const { promise: p2 } = chan.take();
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);

    chan.close();
  });

  it('emitting END closes the channel', async () => {
    const chan = eventChannel<number>((emit) => {
      setTimeout(() => {
        emit(1);
        emit(END);
      }, 10);
      return () => {};
    });

    const { promise: p1 } = chan.take();
    const { promise: p2 } = chan.take();
    expect(await p1).toBe(1);
    expect(await p2).toBe(END);
  });

  it('close calls unsubscribe', () => {
    let unsubscribed = false;
    const chan = eventChannel<number>((_emit) => {
      return () => {
        unsubscribed = true;
      };
    });

    expect(unsubscribed).toBe(false);
    chan.close();
    expect(unsubscribed).toBe(true);
  });
});
