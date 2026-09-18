import fs from 'node:fs';
import path from 'node:path';
import type { ProjectDocument } from '@sevenvid/core';
import type { RecoveryInfo, SessionState } from '@sevenvid/ipc';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';
import type { SettingsService } from '../settings/SettingsService';
import { JOURNAL_FILE, type ProjectService } from './ProjectService';
import { ProjectSession, readJournal, replayJournal } from './ProjectSession';

const SESSION_OPEN_KEY = 'session_open';
const LAST_PROJECT_KEY = 'last_project_id';

export class SessionManager {
  private readonly sessions = new Map<string, ProjectSession>();

  constructor(
    private readonly db: AppDatabase,
    private readonly projects: ProjectService,
    private readonly settings: SettingsService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    settings.onChange((s) => {
      for (const session of this.sessions.values()) session.setAutosaveInterval(s.general.autosaveIntervalMs);
    });
  }

  /** Records that the app is running so the next start can detect an unclean shutdown. */
  markStarted(): boolean {
    const wasOpen = this.db.appState.get(SESSION_OPEN_KEY) === '1';
    this.db.appState.set(SESSION_OPEN_KEY, '1');
    return wasOpen;
  }

  markCleanShutdown(): void {
    this.db.appState.set(SESSION_OPEN_KEY, '0');
  }

  lastProjectId(): string | null {
    return this.db.appState.get(LAST_PROJECT_KEY) ?? null;
  }

  isOpen(projectId: string): boolean {
    return this.sessions.has(projectId);
  }

  get(projectId: string): ProjectSession {
    const s = this.sessions.get(projectId);
    if (!s) throw new AppError({ code: 'PROJECT_NOT_OPEN', operation: 'session', message: `Project ${projectId} is not open`, details: { projectId } });
    return s;
  }

  open(projectId: string): SessionState {
    const existing = this.sessions.get(projectId);
    if (existing) return existing.state();
    const row = this.projects.get(projectId);
    const doc = this.projects.loadLatestDocument(projectId);
    const session = new ProjectSession(projectId, doc, row.dataDir, this.projects, this.bus, this.logger, this.settings.get().general.autosaveIntervalMs);
    this.sessions.set(projectId, session);
    this.db.projects.touchOpened(projectId);
    this.db.appState.set(LAST_PROJECT_KEY, projectId);
    this.logger.info({ module: 'project', operation: 'open', projectId }, 'project opened');
    this.bus.emit('projects.changed', { projectId, reason: 'opened' });
    return session.state();
  }

  close(projectId: string): boolean {
    const session = this.sessions.get(projectId);
    if (!session) return false;
    try {
      session.flushIfDirty();
    } finally {
      session.dispose();
      this.sessions.delete(projectId);
      this.bus.emit('session.closed', { projectId });
    }
    return true;
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      try {
        this.close(id);
      } catch (err) {
        this.logger.error({ module: 'project', operation: 'closeAll', projectId: id, err }, 'failed to close session');
      }
    }
  }

  restoreVersion(projectId: string, versionId: string): SessionState {
    const session = this.get(projectId);
    const doc = this.projects.loadVersionDocument(versionId);
    return session.replaceDocument(doc, 'restore', { reason: 'restore', label: `Restored ${versionId}` });
  }

  /** Finds projects whose recovery journal is ahead of their last saved version. */
  checkRecovery(uncleanShutdown: boolean): RecoveryInfo[] {
    const infos: RecoveryInfo[] = [];
    for (const p of this.db.projects.list()) {
      // a project that is open right now is not stranded: its session owns the journal and can simply flush pending changes
      const open = this.sessions.get(p.id);
      if (open) {
        try {
          open.flushIfDirty();
        } catch (err) {
          this.logger.warn({ module: 'project', operation: 'recovery.check', projectId: p.id, err }, 'could not flush open session during recovery check');
        }
        continue;
      }
      const journal = path.join(p.dataDir, JOURNAL_FILE);
      const entries = readJournal(journal);
      if (entries.length === 0) continue;
      const latest = this.db.versions.latest(p.id);
      infos.push({
        projectId: p.id,
        projectName: p.name,
        versionId: latest?.id ?? null,
        journalEntries: entries.length,
        lastAutosaveAt: latest?.createdAt ?? null,
        reason: uncleanShutdown ? 'unclean-shutdown' : 'journal-ahead',
      });
    }
    if (infos.length) this.bus.emit('recovery.available', infos);
    return infos;
  }

  /** Applies (or discards) the journal of a project and returns the recovered session state. */
  applyRecovery(projectId: string, discard = false): SessionState | null {
    const row = this.projects.get(projectId);
    const journal = path.join(row.dataDir, JOURNAL_FILE);
    if (discard) {
      try {
        fs.writeFileSync(journal, '', 'utf8');
      } catch {
        /* ignore */
      }
      this.logger.info({ module: 'project', operation: 'recovery.discard', projectId }, 'recovery journal discarded');
      return this.sessions.get(projectId)?.state() ?? null;
    }
    const entries = readJournal(journal);
    const base: ProjectDocument = this.projects.loadLatestDocument(projectId);
    let recovered: ProjectDocument;
    try {
      recovered = replayJournal(base, entries);
    } catch (err) {
      throw AppError.from(err, { code: 'PROJECT_DATA_CORRUPT', operation: 'recovery.replay', message: 'Could not replay the recovery journal', details: { projectId, entries: entries.length } });
    }
    const wasOpen = this.sessions.has(projectId);
    if (!wasOpen) this.open(projectId);
    const session = this.get(projectId);
    const state = session.replaceDocument(recovered, 'restore', { reason: 'recovery', label: `Recovered ${entries.length} changes` });
    this.logger.info({ module: 'project', operation: 'recovery.apply', projectId, entries: entries.length }, 'project recovered from journal');
    return state;
  }
}
