import { type Buffer, buffers } from './buffers';

export const END: unique symbol = Symbol('END');
export type END = typeof END;

export interface Channel<Item> {
  take(): { promise: Promise<Item | END>; cancel: () => void };
  put(item: Item | END): void;
  close(): void;
  flush(): Item[];
  readonly __isChannel: true;
}

export function isChannel(obj: unknown): obj is Channel<unknown> {
  return obj != null && typeof obj === 'object' && '__isChannel' in obj && obj.__isChannel === true;
}

// --- BasicChannel: point-to-point, single taker per message ---

interface PendingTaker<Item> {
  resolve: (value: Item | END) => void;
  id: number;
}

let nextTakerId = 0;

class BasicChannel<Item> implements Channel<Item> {
  readonly __isChannel = true as const;
  private buffer: Buffer<Item>;
  private takers: PendingTaker<Item>[] = [];
  private closed = false;

  constructor(buffer: Buffer<Item>) {
    this.buffer = buffer;
  }

  take(): { promise: Promise<Item | END>; cancel: () => void } {
    // If buffer has items, resolve immediately
    if (!this.buffer.isEmpty()) {
      const item = this.buffer.take()!;
      return { promise: Promise.resolve(item), cancel: () => {} };
    }

    // If closed and buffer empty, resolve with END
    if (this.closed) {
      return { promise: Promise.resolve(END), cancel: () => {} };
    }

    // Otherwise, register a pending taker
    const id = nextTakerId++;
    let resolve!: (value: Item | END) => void;
    const promise = new Promise<Item | END>((r) => {
      resolve = r;
    });
    const taker: PendingTaker<Item> = { resolve, id };
    this.takers.push(taker);

    const cancel = () => {
      const idx = this.takers.indexOf(taker);
      if (idx !== -1) {
        this.takers.splice(idx, 1);
      }
    };

    return { promise, cancel };
  }

  put(item: Item | END): void {
    if (this.closed) return;

    if (item === END) {
      this.close();
      return;
    }

    // If there's a pending taker, deliver directly
    if (this.takers.length > 0) {
      const taker = this.takers.shift()!;
      taker.resolve(item);
      return;
    }

    // Otherwise buffer it
    this.buffer.put(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    // Resolve all pending takers with END
    for (const taker of this.takers) {
      taker.resolve(END);
    }
    this.takers = [];
  }

  flush(): Item[] {
    return this.buffer.flush();
  }
}

// --- MulticastChannel: all takers receive each message ---

class MulticastChannelImpl<Item> implements Channel<Item> {
  readonly __isChannel = true as const;
  private takers: PendingTaker<Item>[] = [];
  private closed = false;

  take(): { promise: Promise<Item | END>; cancel: () => void } {
    if (this.closed) {
      return { promise: Promise.resolve(END), cancel: () => {} };
    }

    const id = nextTakerId++;
    let resolve!: (value: Item | END) => void;
    const promise = new Promise<Item | END>((r) => {
      resolve = r;
    });
    const taker: PendingTaker<Item> = { resolve, id };
    this.takers.push(taker);

    const cancel = () => {
      const idx = this.takers.indexOf(taker);
      if (idx !== -1) {
        this.takers.splice(idx, 1);
      }
    };

    return { promise, cancel };
  }

  put(item: Item | END): void {
    if (this.closed) return;

    if (item === END) {
      this.close();
      return;
    }

    // Deliver to ALL takers, then clear
    const currentTakers = this.takers;
    this.takers = [];
    for (const taker of currentTakers) {
      taker.resolve(item);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const taker of this.takers) {
      taker.resolve(END);
    }
    this.takers = [];
  }

  flush(): Item[] {
    // Multicast has no buffer
    return [];
  }
}

// --- Factory functions ---

export function channel<Item>(buffer?: Buffer<Item>): Channel<Item> {
  return new BasicChannel<Item>(buffer ?? buffers.expanding<Item>());
}

export function multicastChannel<Item>(): Channel<Item> {
  return new MulticastChannelImpl<Item>();
}

class EventChannelImpl<Item> extends BasicChannel<Item> {
  private unsubscribe: () => void;

  constructor(
    subscribe: (emitter: (input: Item | END) => void) => () => void,
    buffer: Buffer<Item>,
  ) {
    super(buffer);
    this.unsubscribe = subscribe((input) => {
      this.put(input);
    });
  }

  close(): void {
    this.unsubscribe();
    super.close();
  }
}

export function eventChannel<Item>(
  subscribe: (emitter: (input: Item | END) => void) => () => void,
  buffer?: Buffer<Item>,
): Channel<Item> {
  return new EventChannelImpl<Item>(subscribe, buffer ?? buffers.expanding<Item>());
}
