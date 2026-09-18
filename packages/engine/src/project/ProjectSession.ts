import fs from 'node:fs';
import path from 'node:path';
import { applyDocumentPatches, History, validateDocument, type Command, type Patch, type ProjectDocument } from '@sevenvid/core';
import type { SessionState } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';
import { JOURNAL_FILE, type ProjectService } from './ProjectService';

export interface JournalEntry {
  seq: number;
  at: string;
  label: string;
  patches: Patch[];
}

type Origin = 'command' | 'undo' | 'redo' | 'ai' | 'restore' | 'save' | 'external';

/**
 * In-memory editing session for one open project: owns the document, undo history, autosave and the
 * crash-recovery journal. All document mutations go through `execute` so every consumer stays in sync.
 */
export class ProjectSession {
  private doc: ProjectDocument;
  private readonly history = new History();
  private revision = 0;
  private dirty = false;
  private saving = false;
  private lastSavedAt: string | null = null;
  private lastError: AppError | null = null;
  private autosaveTimer: NodeJS.Timeout | null = null;
  private journalSeq = 0;
  private commandsSinceSave = 0;
  private disposed = false;

  constructor(
    readonly projectId: string,
    initialDoc: ProjectDocument,
    private readonly dataDir: string,
    private readonly projects: ProjectService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private autosaveIntervalMs: number,
  ) {
    this.doc = initialDoc;
    this.lastSavedAt = new Date().toISOString();
  }

  get document(): ProjectDocument {
    return this.doc;
  }

  setAutosaveInterval(ms: number): void {
    this.autosaveIntervalMs = ms;
  }

  state(): SessionState {
    return {
      projectId: this.projectId,
      document: this.doc,
      history: this.history.state(),
      save: { dirty: this.dirty, lastSavedAt: this.lastSavedAt, saving: this.saving, lastError: this.lastError?.info ?? null },
      revision: this.revision,
    };
  }

  execute(command: Command, origin: Origin = 'command'): SessionState {
    this.assertOpen();
    let result;
    try {
      result = this.history.execute(this.doc, command);
    } catch (err) {
      throw AppError.from(err, { code: 'COMMAND_FAILED', operation: `session.command:${command.type}`, details: { command: command.type, ...(err && typeof err === 'object' && 'details' in err ? (err as { details: Record<string, unknown> }).details : {}) } });
    }
    if (result.entry) {
      this.doc = result.doc;
      this.afterChange(result.entry.label, result.entry.patches, origin);
    }
    return this.state();
  }

  /** Executes several commands as one undoable step. */
  executeBatch(commands: Command[], label: string, origin: Origin = 'command'): SessionState {
    return this.execute({ type: 'batch', commands, label }, origin);
  }

  undo(): SessionState {
    this.assertOpen();
    const r = this.history.undo(this.doc);
    if (r) {
      this.doc = r.doc;
      this.afterChange(`undo:${r.entry.label}`, r.entry.inversePatches, 'undo');
    }
    return this.state();
  }

  redo(): SessionState {
    this.assertOpen();
    const r = this.history.redo(this.doc);
    if (r) {
      this.doc = r.doc;
      this.afterChange(`redo:${r.entry.label}`, r.entry.patches, 'redo');
    }
    return this.state();
  }

  /** Replaces the whole document (version restore / recovery). History is cleared. */
  replaceDocument(doc: ProjectDocument, origin: Origin, save: { reason: 'restore' | 'recovery' | 'manual'; label: string | null } | null): SessionState {
    this.assertOpen();
    this.doc = { ...doc, id: this.projectId };
    this.history.clear();
    this.revision++;
    this.dirty = true;
    if (save) this.save(save.reason, save.label);
    else this.scheduleAutosave();
    this.bus.emit('session.updated', { projectId: this.projectId, state: this.state(), origin });
    return this.state();
  }

  validate() {
    return validateDocument(this.doc);
  }

  save(reason: 'autosave' | 'manual' | 'ai' | 'restore' | 'recovery' | 'creator' = 'manual', label: string | null = null): SessionState {
    this.assertOpen();
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.saving = true;
    try {
      this.projects.saveVersion(this.doc, reason, label);
      this.truncateJournal();
      this.dirty = false;
      this.commandsSinceSave = 0;
      this.lastSavedAt = new Date().toISOString();
      this.lastError = null;
    } catch (err) {
      const appErr = AppError.from(err, { code: 'PROJECT_SAVE_FAILED', operation: 'session.save' });
      this.lastError = appErr;
      this.logger.error({ module: 'project', operation: 'save', projectId: this.projectId, err: appErr.info }, 'save failed');
      this.bus.emit('error', appErr.info);
      this.saving = false;
      this.bus.emit('session.updated', { projectId: this.projectId, state: this.state(), origin: 'save' });
      throw appErr;
    }
    this.saving = false;
    this.bus.emit('session.updated', { projectId: this.projectId, state: this.state(), origin: 'save' });
    return this.state();
  }

  flushIfDirty(): void {
    if (this.dirty && !this.disposed) this.save('autosave');
  }

  dispose(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.disposed = true;
  }

  private afterChange(label: string, patches: Patch[], origin: Origin): void {
    this.revision++;
    this.dirty = true;
    this.commandsSinceSave++;
    this.appendJournal(label, patches);
    this.bus.emit('session.updated', { projectId: this.projectId, state: this.state(), origin });
    if (this.commandsSinceSave >= 25) this.save('autosave');
    else this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      if (!this.dirty || this.disposed) return;
      try {
        this.save('autosave');
      } catch {
        /* already reported */
      }
    }, this.autosaveIntervalMs);
    this.autosaveTimer.unref?.();
  }

  private journalPath(): string {
    return path.join(this.dataDir, JOURNAL_FILE);
  }

  private appendJournal(label: string, patches: Patch[]): void {
    const entry: JournalEntry = { seq: ++this.journalSeq, at: new Date().toISOString(), label, patches };
    try {
      fs.appendFileSync(this.journalPath(), JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      this.logger.warn({ module: 'project', operation: 'journal', projectId: this.projectId, err }, 'journal append failed');
    }
  }

  private truncateJournal(): void {
    try {
      fs.writeFileSync(this.journalPath(), '', 'utf8');
    } catch {
      /* ignore */
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new AppError({ code: 'PROJECT_NOT_OPEN', operation: 'session', message: `Project ${this.projectId} is not open` });
  }
}

/** Reads a journal file, ignoring a trailing partial line (crash during append). */
export function readJournal(file: string): JournalEntry[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const entries: JournalEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as JournalEntry;
      if (Array.isArray(e.patches)) entries.push(e);
    } catch {
      /* partial line */
    }
  }
  return entries;
}

export function replayJournal(doc: ProjectDocument, entries: JournalEntry[]): ProjectDocument {
  let current = doc;
  for (const e of entries) current = applyDocumentPatches(current, e.patches);
  return current;
}
