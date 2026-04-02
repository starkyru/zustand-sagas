export interface Buffer<Item> {
  isEmpty(): boolean;
  put(item: Item): void;
  take(): Item | undefined;
  flush(): Item[];
}

class NoneBuffer<Item> implements Buffer<Item> {
  isEmpty(): boolean {
    return true;
  }
  put(_item: Item): void {
    // No capacity — item is dropped
  }
  take(): Item | undefined {
    return undefined;
  }
  flush(): Item[] {
    return [];
  }
}

class FixedBuffer<Item> implements Buffer<Item> {
  private items: Item[] = [];
  constructor(private limit: number) {}

  isEmpty(): boolean {
    return this.items.length === 0;
  }
  put(item: Item): void {
    if (this.items.length >= this.limit) {
      throw new Error(`Buffer overflow: limit is ${this.limit}`);
    }
    this.items.push(item);
  }
  take(): Item | undefined {
    return this.items.shift();
  }
  flush(): Item[] {
    const result = this.items;
    this.items = [];
    return result;
  }
}

class DroppingBuffer<Item> implements Buffer<Item> {
  private items: Item[] = [];
  constructor(private limit: number) {}

  isEmpty(): boolean {
    return this.items.length === 0;
  }
  put(item: Item): void {
    if (this.items.length < this.limit) {
      this.items.push(item);
    }
    // Silently drop if full
  }
  take(): Item | undefined {
    return this.items.shift();
  }
  flush(): Item[] {
    const result = this.items;
    this.items = [];
    return result;
  }
}

class SlidingBuffer<Item> implements Buffer<Item> {
  private items: Item[] = [];
  constructor(private limit: number) {}

  isEmpty(): boolean {
    return this.items.length === 0;
  }
  put(item: Item): void {
    if (this.items.length >= this.limit) {
      this.items.shift(); // Drop oldest
    }
    this.items.push(item);
  }
  take(): Item | undefined {
    return this.items.shift();
  }
  flush(): Item[] {
    const result = this.items;
    this.items = [];
    return result;
  }
}

class ExpandingBuffer<Item> implements Buffer<Item> {
  private items: Item[] = [];

  isEmpty(): boolean {
    return this.items.length === 0;
  }
  put(item: Item): void {
    this.items.push(item);
  }
  take(): Item | undefined {
    return this.items.shift();
  }
  flush(): Item[] {
    const result = this.items;
    this.items = [];
    return result;
  }
}

export const buffers = {
  none: <Item>(): Buffer<Item> => new NoneBuffer<Item>(),
  fixed: <Item>(limit = 10): Buffer<Item> => new FixedBuffer<Item>(limit),
  dropping: <Item>(limit: number): Buffer<Item> => new DroppingBuffer<Item>(limit),
  sliding: <Item>(limit: number): Buffer<Item> => new SlidingBuffer<Item>(limit),
  expanding: <Item>(): Buffer<Item> => new ExpandingBuffer<Item>(),
};
