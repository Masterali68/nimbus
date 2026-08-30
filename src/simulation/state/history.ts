import type { IslandState } from "../types";

/** Bounded ring buffer of past snapshots, so a long multi-day demo doesn't grow memory unboundedly. */
export class History {
  private buffer: IslandState[] = [];

  constructor(private readonly maxLength: number) {}

  push(state: IslandState): void {
    this.buffer.push(state);
    if (this.buffer.length > this.maxLength) {
      this.buffer.shift();
    }
  }

  /** Returns the most recent `window` snapshots, or all retained snapshots if `window` is omitted. */
  getHistory(window?: number): IslandState[] {
    if (window === undefined) return this.buffer.slice();
    return this.buffer.slice(Math.max(0, this.buffer.length - window));
  }

  getLatest(): IslandState | undefined {
    return this.buffer[this.buffer.length - 1];
  }
}
