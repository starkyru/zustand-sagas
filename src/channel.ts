import type { ActionPattern, ActionEvent } from './types';

interface Taker {
  id: number;
  pattern: ActionPattern;
  resolve: (action: ActionEvent) => void;
}

interface Subscription {
  id: number;
  pattern: ActionPattern;
  callback: (action: ActionEvent) => void;
}

export class ActionChannel {
  private takers: Taker[] = [];
  private nextTakerId = 0;
  private subscriptions: Subscription[] = [];
  private nextSubId = 0;

  emit(action: ActionEvent): void {
    // One-shot takers (existing behavior)
    const index = this.takers.findIndex((t) => this.matches(t.pattern, action));
    if (index !== -1) {
      const taker = this.takers[index];
      this.takers.splice(index, 1);
      taker.resolve(action);
    }

    // Persistent subscriptions (for actionChannel routing)
    for (const sub of this.subscriptions) {
      if (this.matches(sub.pattern, action)) {
        sub.callback(action);
      }
    }
  }

  take(pattern: ActionPattern): { promise: Promise<ActionEvent>; takerId: number } {
    const id = this.nextTakerId++;
    let resolve!: (action: ActionEvent) => void;
    const promise = new Promise<ActionEvent>((r) => {
      resolve = r;
    });
    this.takers.push({ id, pattern, resolve });
    return { promise, takerId: id };
  }

  removeTaker(id: number): void {
    const index = this.takers.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.takers.splice(index, 1);
    }
  }

  subscribe(pattern: ActionPattern, callback: (action: ActionEvent) => void): number {
    const id = this.nextSubId++;
    this.subscriptions.push({ id, pattern, callback });
    return id;
  }

  unsubscribe(id: number): void {
    const index = this.subscriptions.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.subscriptions.splice(index, 1);
    }
  }

  private matches(pattern: ActionPattern, action: ActionEvent): boolean {
    if (typeof pattern === 'string') {
      return action.type === pattern;
    }
    return pattern(action);
  }
}
