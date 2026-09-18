import { CAPABILITY_IDS, type CapabilityId, type CapabilityInfo, type CapabilityMap } from '@sevenvid/core';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';

export type CapabilityReport = Omit<CapabilityInfo, 'id' | 'checkedAt'>;
export type CapabilitySource = () => Promise<Partial<CapabilityReport>> | Partial<CapabilityReport>;

function notImplemented(id: CapabilityId): CapabilityInfo {
  return {
    id,
    status: 'unavailable',
    reasonKey: 'capabilities.notImplemented',
    reasonParams: {},
    action: { type: 'none', target: null },
    providerId: null,
    external: false,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Single source of truth for what the application can do right now. Every UI control that depends on a
 * capability reads its status here, so nothing in the interface can pretend to work.
 */
export class CapabilityRegistry {
  private readonly sources = new Map<CapabilityId, CapabilitySource>();
  private map: CapabilityMap;

  constructor(private readonly bus: EventBus, private readonly logger: Logger) {
    this.map = Object.fromEntries(CAPABILITY_IDS.map((id) => [id, notImplemented(id)])) as CapabilityMap;
  }

  register(id: CapabilityId, source: CapabilitySource): void {
    this.sources.set(id, source);
  }

  get(): CapabilityMap {
    return this.map;
  }

  status(id: CapabilityId): CapabilityInfo {
    return this.map[id];
  }

  isAvailable(id: CapabilityId): boolean {
    return this.map[id]?.status === 'available';
  }

  async refresh(): Promise<CapabilityMap> {
    const next = { ...this.map };
    await Promise.all(
      CAPABILITY_IDS.map(async (id) => {
        const source = this.sources.get(id);
        if (!source) {
          next[id] = notImplemented(id);
          return;
        }
        try {
          const report = await source();
          next[id] = {
            ...notImplemented(id),
            ...report,
            id,
            reasonKey: report.status === 'available' ? '' : (report.reasonKey ?? 'capabilities.unavailable'),
            checkedAt: new Date().toISOString(),
          };
        } catch (err) {
          this.logger.warn({ module: 'capabilities', capability: id, err }, 'capability probe failed');
          next[id] = { ...notImplemented(id), reasonKey: 'capabilities.probeFailed' };
        }
      }),
    );
    this.map = next;
    this.bus.emit('capabilities.updated', next);
    return next;
  }
}
