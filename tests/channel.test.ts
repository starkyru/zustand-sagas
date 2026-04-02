import { describe, it, expect } from 'vitest';
import { ActionChannel } from '../src/channel';

describe('ActionChannel', () => {
  it('take resolves when matching action is emitted', async () => {
    const channel = new ActionChannel();
    const { promise } = channel.take('increment');
    channel.emit({ type: 'increment', payload: 1 });
    const action = await promise;
    expect(action).toEqual({ type: 'increment', payload: 1 });
  });

  it('drops actions when no taker is registered', () => {
    const channel = new ActionChannel();
    // Should not throw
    channel.emit({ type: 'nobodyListening' });
  });

  it('multicasts to all matching takers', async () => {
    const channel = new ActionChannel();
    const { promise: p1 } = channel.take('doSomething');
    const { promise: p2 } = channel.take('doSomething');

    channel.emit({ type: 'doSomething', payload: 1 });

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toEqual({ type: 'doSomething', payload: 1 });
    expect(r2).toEqual({ type: 'doSomething', payload: 1 });
  });

  it('does not deliver to non-matching takers', async () => {
    const channel = new ActionChannel();
    const { promise: p1 } = channel.take('a');
    const { promise: p2 } = channel.take('b');

    channel.emit({ type: 'a', payload: 1 });
    channel.emit({ type: 'b', payload: 2 });

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toEqual({ type: 'a', payload: 1 });
    expect(r2).toEqual({ type: 'b', payload: 2 });
  });

  it('supports predicate patterns', async () => {
    const channel = new ActionChannel();
    const { promise } = channel.take((a) => a.type.startsWith('fetch'));

    channel.emit({ type: 'update' });
    channel.emit({ type: 'fetchUsers' });

    const action = await promise;
    expect(action.type).toBe('fetchUsers');
  });

  it('removeTaker removes a pending taker', async () => {
    const channel = new ActionChannel();
    const { takerId } = channel.take('doSomething');
    channel.removeTaker(takerId);

    channel.emit({ type: 'doSomething' });

    const { promise } = channel.take('doSomething');
    channel.emit({ type: 'doSomething', payload: 2 });
    const action = await promise;
    expect(action).toEqual({ type: 'doSomething', payload: 2 });
  });

  it('removeTaker with invalid id does nothing', () => {
    const channel = new ActionChannel();
    channel.removeTaker(999); // should not throw
  });
});
