import { newId } from '@sevenvid/core';
import type { NotificationInfo } from '@sevenvid/ipc';
import type { EventBus } from '../events/EventBus';
import type { SettingsService } from '../settings/SettingsService';

export class NotificationService {
  private readonly ring: NotificationInfo[] = [];

  constructor(private readonly bus: EventBus, private readonly settings: SettingsService) {
    bus.on('task.updated', (task) => {
      const prefs = settings.get().notifications;
      if (task.status === 'done' && prefs.onTaskComplete && !task.parentTaskId) {
        this.notify({ level: 'success', titleKey: 'notifications.taskDone', messageKey: null, params: { title: task.title }, taskId: task.id, errorId: null });
      } else if (task.status === 'failed' && prefs.onError) {
        this.notify({ level: 'error', titleKey: 'notifications.taskFailed', messageKey: task.error?.userMessageKey ?? null, params: { title: task.title, ...(task.error?.userMessageParams ?? {}) }, taskId: task.id, errorId: task.error?.errorId ?? null });
      }
    });
  }

  notify(n: Omit<NotificationInfo, 'id' | 'at'>): NotificationInfo {
    const info: NotificationInfo = { ...n, id: newId('ntf'), at: new Date().toISOString() };
    this.ring.push(info);
    if (this.ring.length > 200) this.ring.shift();
    this.bus.emit('notification', info);
    return info;
  }

  recent(limit = 50): NotificationInfo[] {
    return this.ring.slice(-limit).reverse();
  }
}
