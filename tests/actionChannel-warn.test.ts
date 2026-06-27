import { describe, it, expect, vi } from 'vitest';
import { runSaga, type RunnerEnv } from '../src/runner';
import { ActionChannel } from '../src/channel';
import { channel } from '../src/channels';
import { buffers } from '../src/buffers';
import { actionChannel, take } from '../src/effects';
import type { Effect } from '../src/types';

/**
 * RO-6: an actionChannel with the default (unbounded `expanding`) buffer that is
 * never drained grows without limit. Kept non-breaking; the runner now logs a
 * one-time warning once the undrained backlog crosses a safety threshold.
 */
describe('actionChannel unbounded-buffer growth warning (RO-6)', () => {
  it('Channel.size() reflects the undrained backlog', () => {
    const ch = channel<number>(buffers.expanding<number>());
    expect(ch.size?.()).toBe(0);
    ch.put(1);
    ch.put(2);
    ch.put(3);
    expect(ch.size?.()).toBe(3);
  });

  it('warns exactly once when an undrained actionChannel crosses the threshold, not before', async () => {
    const THRESHOLD = 10_000;
    const env: RunnerEnv = { channel: new ActionChannel(), getState: () => ({}) };

    function* saga(): Generator<Effect, void, any> {
      yield actionChannel('ping'); // default expanding buffer, never drained
      yield take('never'); // park forever so the channel is never taken from
    }
    runSaga(saga, env);
    await new Promise((r) => setTimeout(r, 0));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Fill exactly to the threshold — size == THRESHOLD is not yet over it.
    for (let i = 0; i < THRESHOLD; i++) env.channel.emit({ type: 'ping' });
    expect(warnSpy).not.toHaveBeenCalled();

    // One more crosses the threshold — warn fires once.
    env.channel.emit({ type: 'ping' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('actionChannel buffer exceeded');

    // Continued overflow must not re-warn.
    env.channel.emit({ type: 'ping' });
    env.channel.emit({ type: 'ping' });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
