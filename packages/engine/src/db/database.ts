import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import { openSqlite, type SqlDriver } from './driver';
import { migrate } from './migrations';
import { AppStateRepo } from './repos/appState';
import { AssetsRepo } from './repos/assets';
import { ExportsRepo } from './repos/exports';
import { ModelsRepo } from './repos/models';
import { NetworkLogRepo } from './repos/networkLog';
import { ProjectsRepo } from './repos/projects';
import { SearchRepo } from './repos/search';
import { SettingsRepo } from './repos/settings';
import { TasksRepo } from './repos/tasks';
import { TemplatesRepo } from './repos/templates';
import { TranscriptsRepo } from './repos/transcripts';
import { VersionsRepo } from './repos/versions';

export interface AppDatabase {
  driver: SqlDriver;
  projects: ProjectsRepo;
  versions: VersionsRepo;
  assets: AssetsRepo;
  settings: SettingsRepo;
  appState: AppStateRepo;
  tasks: TasksRepo;
  exports: ExportsRepo;
  models: ModelsRepo;
  templates: TemplatesRepo;
  networkLog: NetworkLogRepo;
  search: SearchRepo;
  transcripts: TranscriptsRepo;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export function openDatabase(file: string, logger?: Logger): AppDatabase {
  try {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const driver = openSqlite(file);
    const { from, to } = migrate(driver);
    logger?.info({ module: 'db', operation: 'open', from, to, file }, 'database ready');
    return {
      driver,
      projects: new ProjectsRepo(driver),
      versions: new VersionsRepo(driver),
      assets: new AssetsRepo(driver),
      settings: new SettingsRepo(driver),
      appState: new AppStateRepo(driver),
      tasks: new TasksRepo(driver),
      exports: new ExportsRepo(driver),
      models: new ModelsRepo(driver),
      templates: new TemplatesRepo(driver),
      networkLog: new NetworkLogRepo(driver),
      search: new SearchRepo(driver),
      transcripts: new TranscriptsRepo(driver),
      transaction: (fn) => driver.transaction(fn),
      close: () => driver.close(),
    };
  } catch (err) {
    throw AppError.from(err, { code: 'DB_OPEN_FAILED', operation: 'openDatabase', details: { file } });
  }
}
