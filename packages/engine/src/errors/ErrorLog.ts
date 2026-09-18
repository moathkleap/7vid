import type { AppErrorInfo } from '@sevenvid/core';
import type { EventBus } from '../events/EventBus';

/** Keeps the most recent user-facing errors for the diagnostics panel. */
export class ErrorLog {
  private readonly ring: AppErrorInfo[] = [];
  constructor(bus: EventBus, private readonly size = 200) {
    bus.on('error', (info) => this.push(info));
  }
  push(info: AppErrorInfo): void {
    this.ring.push(info);
    if (this.ring.length > this.size) this.ring.shift();
  }
  recent(limit = 50): AppErrorInfo[] {
    return this.ring.slice(-limit).reverse();
  }
}
