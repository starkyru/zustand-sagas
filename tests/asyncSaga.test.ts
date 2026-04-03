import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createSaga } from '../src/createSaga';
import { createAsyncSlice, type AsyncSlice } from '../src/asyncSlice';
import { createAsyncSaga } from '../src/asyncSaga';

// --- Helpers ---

type UserSlice = AsyncSlice<'user', { name: string }, [id: string]>;

function createUserStore() {
  return createStore<UserSlice>((set) => ({
    ...createAsyncSlice<'user', { name: string }, [id: string]>('user', set as any),
  }));
}

function wait(ms = 30) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- AsyncSlice mode tests ---

describe('createAsyncSaga — AsyncSlice mode', () => {
  it('backwards-compatible: takeLatest, sets data on success', async () => {
    const store = createUserStore();
    const fetchUser = vi.fn(async (id: string) => ({ name: `User ${id}` }));

    const saga = createAsyncSaga(store, 'user', fetchUser);
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('42');
    await wait();

    expect(fetchUser).toHaveBeenCalledWith('42');
    expect(store.getState().user).toEqual({ name: 'User 42' });
    expect(store.getState().isUserSuccess).toBe(true);
    expect(store.getState().isUserLoading).toBe(false);
    useSaga.task.cancel();
  });

  it('backwards-compatible: sets error on failure', async () => {
    const store = createUserStore();
    const fetchUser = vi.fn(async () => {
      throw new Error('not found');
    });

    const saga = createAsyncSaga(store, 'user', fetchUser);
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('99');
    await wait();

    expect(store.getState().isUserError).toBe(true);
    expect(store.getState().userError).toBe('not found');
    useSaga.task.cancel();
  });

  it('strategy: takeLeading ignores concurrent dispatches', async () => {
    const store = createUserStore();
    let callCount = 0;
    const fetchUser = vi.fn(async (id: string) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return { name: `User ${id}` };
    });

    const saga = createAsyncSaga(store, 'user', fetchUser, { strategy: 'takeLeading' });
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('1');
    await wait(10);
    store.getState().fetchUser('2'); // should be ignored
    await wait(80);

    expect(callCount).toBe(1);
    expect(store.getState().user).toEqual({ name: 'User 1' });
    useSaga.task.cancel();
  });

  it('strategy: debounce waits before calling', async () => {
    const store = createUserStore();
    const fetchUser = vi.fn(async (id: string) => ({ name: `User ${id}` }));

    const saga = createAsyncSaga(store, 'user', fetchUser, {
      strategy: 'debounce',
      debounceMs: 50,
    });
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('1');
    await wait(10);
    // Not called yet — waiting for debounce
    expect(fetchUser).not.toHaveBeenCalled();

    await wait(80);
    expect(fetchUser).toHaveBeenCalledTimes(1);
    expect(store.getState().isUserSuccess).toBe(true);
    useSaga.task.cancel();
  });

  it('retries on failure then succeeds', async () => {
    const store = createUserStore();
    let attempt = 0;
    const fetchUser = vi.fn(async (id: string) => {
      attempt++;
      if (attempt < 3) throw new Error('transient');
      return { name: `User ${id}` };
    });

    const saga = createAsyncSaga(store, 'user', fetchUser, {
      retries: 3,
      retryDelay: 10,
    });
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('7');
    await wait(200);

    expect(attempt).toBe(3);
    expect(store.getState().user).toEqual({ name: 'User 7' });
    expect(store.getState().isUserSuccess).toBe(true);
    useSaga.task.cancel();
  });

  it('retries exhausted sets error', async () => {
    const store = createUserStore();
    const fetchUser = vi.fn(async () => {
      throw new Error('always fails');
    });

    const saga = createAsyncSaga(store, 'user', fetchUser, {
      retries: 2,
      retryDelay: 10,
    });
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('1');
    await wait(200);

    expect(fetchUser).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(store.getState().isUserError).toBe(true);
    expect(store.getState().userError).toBe('always fails');
    useSaga.task.cancel();
  });

  it('transform modifies data before setting', async () => {
    const store = createUserStore();
    const fetchUser = vi.fn(async () => ({ data: { name: 'Raw User' } }));

    const saga = createAsyncSaga(store, 'user', fetchUser as any, {
      transform: (raw: any) => raw.data,
    });
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('1');
    await wait();

    expect(store.getState().user).toEqual({ name: 'Raw User' });
    useSaga.task.cancel();
  });

  it('onSuccess generator runs after settlement', async () => {
    const store = createUserStore();
    const fetchUser = vi.fn(async (id: string) => ({ name: `User ${id}` }));
    const hookCalls: unknown[] = [];

    const saga = createAsyncSaga(store, 'user', fetchUser, {
      onSuccess: function* (data, _api) {
        hookCalls.push(data);
      },
    });
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('5');
    await wait();

    expect(hookCalls).toEqual([{ name: 'User 5' }]);
    useSaga.task.cancel();
  });

  it('onError generator runs after error settlement', async () => {
    const store = createUserStore();
    const fetchUser = vi.fn(async () => {
      throw new Error('boom');
    });
    const hookCalls: string[] = [];

    const saga = createAsyncSaga(store, 'user', fetchUser, {
      onError: function* (error, _api) {
        hookCalls.push(error.message);
      },
    });
    const useSaga = createSaga(store, saga);

    store.getState().fetchUser('1');
    await wait();

    expect(hookCalls).toEqual(['boom']);
    useSaga.task.cancel();
  });
});

// --- Standalone mode tests ---

describe('createAsyncSaga — Standalone mode', () => {
  it('watches trigger and calls string action on success', async () => {
    const store = createStore<{
      profile: { name: string } | null;
      loadProfile: (id: string) => void;
      setProfile: (data: { name: string }) => void;
      setProfileError: (msg: string) => void;
    }>((set) => ({
      profile: null,
      loadProfile: () => {},
      setProfile: (data) => set({ profile: data }),
      setProfileError: () => {},
    }));

    const fetchProfile = vi.fn(async (id: string) => ({ name: `Profile ${id}` }));

    const saga = createAsyncSaga(store, {
      trigger: 'loadProfile',
      fetch: fetchProfile,
      onSuccess: 'setProfile',
      onError: 'setProfileError',
    });
    const useSaga = createSaga(store, saga);

    store.getState().loadProfile('abc');
    await wait();

    expect(fetchProfile).toHaveBeenCalledWith('abc');
    expect(store.getState().profile).toEqual({ name: 'Profile abc' });
    useSaga.task.cancel();
  });

  it('calls string action on error', async () => {
    const store = createStore<{
      error: string | null;
      loadData: () => void;
      setError: (msg: string) => void;
    }>((set) => ({
      error: null,
      loadData: () => {},
      setError: (msg) => set({ error: msg }),
    }));

    const fetchData = vi.fn(async () => {
      throw new Error('server down');
    });

    const saga = createAsyncSaga(store, {
      trigger: 'loadData',
      fetch: fetchData,
      onError: 'setError',
    });
    const useSaga = createSaga(store, saga);

    store.getState().loadData();
    await wait();

    expect(store.getState().error).toBe('server down');
    useSaga.task.cancel();
  });

  it('supports generator onSuccess handler', async () => {
    const hookCalls: unknown[] = [];

    const store = createStore<{
      loadItem: (id: number) => void;
    }>((_set) => ({
      loadItem: () => {},
    }));

    const fetchItem = vi.fn(async (id: number) => ({ id, value: 'test' }));

    const saga = createAsyncSaga(store, {
      trigger: 'loadItem',
      fetch: fetchItem,
      onSuccess: function* (data, _api) {
        hookCalls.push(data);
      },
    });
    const useSaga = createSaga(store, saga);

    store.getState().loadItem(42);
    await wait();

    expect(hookCalls).toEqual([{ id: 42, value: 'test' }]);
    useSaga.task.cancel();
  });

  it('standalone with retries and transform', async () => {
    let attempts = 0;
    const store = createStore<{
      result: string | null;
      go: () => void;
      setResult: (v: string) => void;
    }>((set) => ({
      result: null,
      go: () => {},
      setResult: (v) => set({ result: v }),
    }));

    const fetchData = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw new Error('retry me');
      return { wrapped: 'hello' };
    });

    const saga = createAsyncSaga(store, {
      trigger: 'go',
      fetch: fetchData,
      onSuccess: 'setResult',
      retries: 2,
      retryDelay: 10,
      transform: (raw: any) => raw.wrapped,
    });
    const useSaga = createSaga(store, saga);

    store.getState().go();
    await wait(200);

    expect(attempts).toBe(2);
    expect(store.getState().result).toBe('hello');
    useSaga.task.cancel();
  });

  it('standalone with debounce strategy', async () => {
    const store = createStore<{
      data: string | null;
      search: (q: string) => void;
      setData: (v: string) => void;
    }>((set) => ({
      data: null,
      search: () => {},
      setData: (v) => set({ data: v }),
    }));

    const fetchData = vi.fn(async (q: string) => `result:${q}`);

    const saga = createAsyncSaga(store, {
      trigger: 'search',
      fetch: fetchData,
      onSuccess: 'setData',
      strategy: 'debounce',
      debounceMs: 40,
    });
    const useSaga = createSaga(store, saga);

    store.getState().search('abc');
    await wait(10);
    expect(fetchData).not.toHaveBeenCalled();

    await wait(80);
    expect(fetchData).toHaveBeenCalledTimes(1);
    expect(fetchData).toHaveBeenCalledWith('abc');
    expect(store.getState().data).toBe('result:abc');
    useSaga.task.cancel();
  });
});
