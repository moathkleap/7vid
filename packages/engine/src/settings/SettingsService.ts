import { defaultSettings, mergeSettings, SettingsSchema, type AppSettings, type DeepPartial } from '@sevenvid/core';
import type { SettingsRepo } from '../db/repos/settings';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';

const KEY = 'app';

export class SettingsService {
  private current: AppSettings;

  constructor(private readonly repo: SettingsRepo, private readonly bus: EventBus, private readonly logger: Logger) {
    const stored = repo.get<DeepPartial<AppSettings>>(KEY);
    let settings = defaultSettings();
    if (stored) {
      try {
        settings = mergeSettings(settings, stored);
      } catch (err) {
        logger.warn({ module: 'settings', err }, 'stored settings invalid, using defaults');
      }
    }
    this.current = settings;
  }

  get(): AppSettings {
    return this.current;
  }

  update(patch: DeepPartial<AppSettings>): AppSettings {
    let next: AppSettings;
    try {
      next = mergeSettings(this.current, patch);
    } catch (err) {
      throw AppError.from(err, { code: 'INVALID_INPUT', operation: 'settings.update', message: 'Settings patch is invalid' });
    }
    this.current = next;
    this.repo.set(KEY, next);
    this.bus.emit('settings.updated', next);
    this.logger.info({ module: 'settings', operation: 'update', keys: Object.keys(patch) }, 'settings updated');
    return next;
  }

  reset(section: keyof AppSettings | null): AppSettings {
    const defaults = defaultSettings();
    const next = section ? SettingsSchema.parse({ ...this.current, [section]: defaults[section] }) : defaults;
    this.current = next;
    this.repo.set(KEY, next);
    this.bus.emit('settings.updated', next);
    return next;
  }

  onChange(handler: (s: AppSettings) => void): () => void {
    return this.bus.on('settings.updated', handler);
  }
}
