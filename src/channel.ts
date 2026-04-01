import type { ActionPattern, ActionEvent } from './types';

interface Taker {
  id: number;
  pattern: ActionPattern;
  resolve: (action: ActionEvent) => void;
}

export class ActionChannel {
  private takers: Taker[] = [];
  private nextTakerId = 0;

  emit(action: ActionEvent): void {
    const index = this.takers.findIndex((t) => this.matches(t.pattern, action));
    if (index !== -1) {
      const taker = this.takers[index];
      this.takers.splice(index, 1);
      taker.resolve(action);
    }
    // No matching taker — action is dropped (no buffering in v1)
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

  private matches(pattern: ActionPattern, action: ActionEvent): boolean {
    if (typeof pattern === 'string') {
      return action.type === pattern;
    }
    return pattern(action);
  }
}
