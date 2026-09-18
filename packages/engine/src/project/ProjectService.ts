import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  createDocument,
  newId,
  PLATFORM_PRESETS,
  numberToFps,
  getDocumentDurationMs,
  type PlatformPresetId,
  type ProjectDocument,
  type ProjectKind,
  type SequenceSettings,
} from '@sevenvid/core';
import type { ProjectSummary, ProjectVersion } from '@sevenvid/ipc';
import type { AppDatabase } from '../db/database';
import { toSummary, type ProjectRow } from '../db/repos/projects';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { SearchService } from '../search/SearchService';

export interface CreateProjectInput {
  name: string;
  kind?: ProjectKind;
  templateId?: string | null;
  platformPreset?: string;
  width?: number;
  height?: number;
  fps?: number;
}

export const MIRROR_FILE = 'project.7vid.json';
export const JOURNAL_FILE = 'journal.ndjson';

export function hashDocument(json: string): string {
  return crypto.createHash('sha256').update(json).digest('hex');
}

/** Atomically writes a file (temp file + rename) so a crash never leaves a half-written project. */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export class ProjectService {
  constructor(
    private readonly db: AppDatabase,
    private readonly paths: AppPaths,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly search: SearchService,
  ) {}

  dataDirFor(projectId: string): string {
    return path.join(this.paths.projects, projectId);
  }

  create(input: CreateProjectInput): { summary: ProjectSummary; document: ProjectDocument } {
    const name = input.name.trim();
    if (!name) throw new AppError({ code: 'INVALID_INPUT', operation: 'projects.create', message: 'Project name is required' });
    const id = newId('prj');
    const dataDir = this.dataDirFor(id);
    let settings: Partial<SequenceSettings> = {};
    const preset = input.platformPreset && input.platformPreset !== 'custom' ? PLATFORM_PRESETS[input.platformPreset as Exclude<PlatformPresetId, 'custom'>] : undefined;
    if (preset) settings = { width: preset.width, height: preset.height, fps: preset.fps, aspectPreset: preset.aspect, platformPreset: preset.id };
    if (input.width && input.height) {
      settings.width = input.width;
      settings.height = input.height;
      if (!preset) {
        settings.platformPreset = 'custom';
        settings.aspectPreset = 'custom';
      }
    }
    if (input.fps) settings.fps = numberToFps(input.fps);
    if (input.templateId) {
      const template = this.db.templates.get(input.templateId);
      if (!template) throw new AppError({ code: 'INVALID_INPUT', operation: 'projects.create', message: `Template ${input.templateId} not found`, details: { templateId: input.templateId } });
      const t = template.template as { settings?: { width?: number; height?: number; fps?: number; aspectPreset?: string }; platformPreset?: string };
      if (t.settings?.width && t.settings?.height) {
        settings.width = t.settings.width;
        settings.height = t.settings.height;
        settings.aspectPreset = (t.settings.aspectPreset as SequenceSettings['aspectPreset']) ?? 'custom';
      }
      if (t.settings?.fps) settings.fps = numberToFps(t.settings.fps);
      if (t.platformPreset) settings.platformPreset = t.platformPreset as SequenceSettings['platformPreset'];
    }
    const document = createDocument({ id, name, kind: input.kind ?? 'editor', settings });
    if (input.templateId) document.meta.templateId = input.templateId;
    try {
      fs.mkdirSync(path.join(dataDir, 'cache'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'tracks'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'generated'), { recursive: true });
    } catch (err) {
      throw AppError.from(err, { code: 'PROJECT_SAVE_FAILED', operation: 'projects.create', details: { dataDir } });
    }
    const row = this.db.transaction(() => {
      const inserted = this.db.projects.insert({ id, name, kind: document.kind, settings: document.settings, dataDir, currentVersionId: null, thumbnailPath: null, durationMs: 0, createdAt: document.createdAt });
      const version = this.saveVersion(document, 'manual', 'Initial');
      this.db.projects.update(id, { currentVersionId: version.id });
      return inserted;
    });
    this.search.indexProject({ id, name, kind: document.kind });
    this.logger.info({ module: 'project', operation: 'create', projectId: id }, 'project created');
    this.bus.emit('projects.changed', { projectId: id, reason: 'created' });
    return { summary: toSummary(this.db.projects.get(row.id)!), document };
  }

  get(projectId: string): ProjectRow {
    const row = this.db.projects.get(projectId);
    if (!row) throw new AppError({ code: 'PROJECT_NOT_FOUND', operation: 'projects.get', message: `Project ${projectId} not found`, details: { projectId } });
    return row;
  }

  summary(projectId: string): ProjectSummary {
    return toSummary(this.get(projectId));
  }

  list(includeDeleted = false): ProjectSummary[] {
    return this.db.projects.list({ includeDeleted }).map(toSummary);
  }

  recent(limit = 8): ProjectSummary[] {
    return this.db.projects.recent(limit).map(toSummary);
  }

  rename(projectId: string, name: string): ProjectSummary {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError({ code: 'INVALID_INPUT', operation: 'projects.rename', message: 'Project name is required' });
    const row = this.db.projects.update(projectId, { name: trimmed });
    if (!row) throw new AppError({ code: 'PROJECT_NOT_FOUND', operation: 'projects.rename', message: `Project ${projectId} not found` });
    this.search.indexProject({ id: row.id, name: row.name, kind: row.kind });
    this.bus.emit('projects.changed', { projectId, reason: 'renamed' });
    return toSummary(row);
  }

  softDelete(projectId: string): void {
    const row = this.db.projects.update(projectId, { deletedAt: new Date().toISOString() });
    if (!row) throw new AppError({ code: 'PROJECT_NOT_FOUND', operation: 'projects.delete', message: `Project ${projectId} not found` });
    this.search.remove('project', projectId);
    this.bus.emit('projects.changed', { projectId, reason: 'deleted' });
  }

  restoreDeleted(projectId: string): ProjectSummary {
    const row = this.db.projects.update(projectId, { deletedAt: null });
    if (!row) throw new AppError({ code: 'PROJECT_NOT_FOUND', operation: 'projects.restoreDeleted', message: `Project ${projectId} not found` });
    this.search.indexProject({ id: row.id, name: row.name, kind: row.kind });
    this.bus.emit('projects.changed', { projectId, reason: 'restored' });
    return toSummary(row);
  }

  deletePermanently(projectId: string): void {
    const row = this.get(projectId);
    this.db.projects.deletePermanently(projectId);
    this.search.remove('project', projectId);
    try {
      if (row.dataDir.startsWith(this.paths.projects)) fs.rmSync(row.dataDir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn({ module: 'project', operation: 'deletePermanently', projectId, err }, 'failed to remove project data dir');
    }
    this.bus.emit('projects.changed', { projectId, reason: 'deleted-permanently' });
  }

  duplicate(projectId: string, name?: string): { summary: ProjectSummary; document: ProjectDocument } {
    const source = this.get(projectId);
    const doc = this.loadLatestDocument(projectId);
    const id = newId('prj');
    const copy: ProjectDocument = { ...doc, id, name: name?.trim() || `${source.name} (copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const dataDir = this.dataDirFor(id);
    fs.mkdirSync(path.join(dataDir, 'cache'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'tracks'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'generated'), { recursive: true });
    const sourceTracks = path.join(source.dataDir, 'tracks');
    if (fs.existsSync(sourceTracks)) fs.cpSync(sourceTracks, path.join(dataDir, 'tracks'), { recursive: true });
    this.db.transaction(() => {
      this.db.projects.insert({ id, name: copy.name, kind: copy.kind, settings: copy.settings, dataDir, currentVersionId: null, thumbnailPath: source.thumbnailPath, durationMs: getDocumentDurationMs(copy) });
      const v = this.saveVersion(copy, 'manual', 'Duplicated');
      this.db.projects.update(id, { currentVersionId: v.id });
    });
    for (const a of this.db.assets.list({ projectId })) {
      this.db.assets.insert({ ...a, id: a.id, projectId: id });
    }
    this.search.indexProject({ id, name: copy.name, kind: copy.kind });
    this.bus.emit('projects.changed', { projectId: id, reason: 'duplicated' });
    return { summary: toSummary(this.db.projects.get(id)!), document: copy };
  }

  /** Persists a full document snapshot as a new version and refreshes the mirror file. */
  saveVersion(doc: ProjectDocument, reason: ProjectVersion['reason'], label: string | null = null): ProjectVersion {
    const json = JSON.stringify(doc);
    const hash = hashDocument(json);
    const latest = this.db.versions.latest(doc.id);
    let version: ProjectVersion;
    if (latest && latest.hash === hash && reason === 'autosave') {
      version = latest;
    } else {
      version = this.db.versions.insert({ id: newId('ver'), projectId: doc.id, label, reason, documentJson: json, hash });
      if (reason === 'autosave') this.db.versions.prune(doc.id, 100);
    }
    this.db.projects.update(doc.id, { currentVersionId: version.id, durationMs: getDocumentDurationMs(doc), name: doc.name, settings: doc.settings });
    const row = this.db.projects.get(doc.id);
    if (row) {
      try {
        writeFileAtomic(path.join(row.dataDir, MIRROR_FILE), json);
      } catch (err) {
        throw AppError.from(err, { code: 'PROJECT_SAVE_FAILED', operation: 'projects.saveVersion', details: { projectId: doc.id } });
      }
    }
    return version;
  }

  listVersions(projectId: string): ProjectVersion[] {
    this.get(projectId);
    return this.db.versions.list(projectId);
  }

  loadVersionDocument(versionId: string): ProjectDocument {
    const json = this.db.versions.getDocumentJson(versionId);
    if (!json) throw new AppError({ code: 'VERSION_NOT_FOUND', operation: 'projects.loadVersion', message: `Version ${versionId} not found` });
    return this.parseDocument(json, versionId);
  }

  /** Loads the newest document: the current DB version, or the on-disk mirror when the DB has none. */
  loadLatestDocument(projectId: string): ProjectDocument {
    const row = this.get(projectId);
    const versionId = row.currentVersionId ?? this.db.versions.latest(projectId)?.id ?? null;
    if (versionId) {
      const json = this.db.versions.getDocumentJson(versionId);
      if (json) return this.parseDocument(json, versionId);
    }
    const mirror = path.join(row.dataDir, MIRROR_FILE);
    if (fs.existsSync(mirror)) return this.parseDocument(fs.readFileSync(mirror, 'utf8'), mirror);
    throw new AppError({ code: 'PROJECT_DATA_CORRUPT', operation: 'projects.load', message: `No document found for project ${projectId}`, details: { projectId } });
  }

  private parseDocument(json: string, ref: string): ProjectDocument {
    try {
      const doc = JSON.parse(json) as ProjectDocument;
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.tracks) || !doc.settings) throw new Error('invalid document shape');
      return doc;
    } catch (err) {
      throw AppError.from(err, { code: 'PROJECT_DATA_CORRUPT', operation: 'projects.parse', message: 'Project document is corrupt', details: { ref } });
    }
  }
}
