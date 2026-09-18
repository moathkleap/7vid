import { newId } from '@sevenvid/core';
import type { TemplateInfo } from '@sevenvid/ipc';
import type { AppDatabase } from '../db/database';
import type { TemplateRow } from '../db/repos/templates';
import { AppError } from '../errors';
import type { SearchService } from '../search/SearchService';
import type { ProjectService } from './ProjectService';

export function templateRowToInfo(row: TemplateRow): TemplateInfo {
  const t = row.template as Record<string, unknown>;
  const settings = t.settings as { width?: number; height?: number; fps?: number; aspectPreset?: string } | undefined;
  return {
    id: row.id,
    name: row.name,
    nameAr: typeof t.nameAr === 'string' ? t.nameAr : null,
    category: row.category,
    builtin: row.builtin,
    description: typeof t.description === 'string' ? t.description : null,
    descriptionAr: typeof t.descriptionAr === 'string' ? t.descriptionAr : null,
    platformPreset: typeof t.platformPreset === 'string' ? t.platformPreset : null,
    settings: settings && settings.width && settings.height ? { width: settings.width, height: settings.height, fps: settings.fps ?? 30, aspectPreset: settings.aspectPreset ?? 'custom' } : null,
    subtitleStyle: (t.subtitleStyle as Record<string, unknown>) ?? null,
    exportPresetId: typeof t.exportPresetId === 'string' ? t.exportPresetId : null,
    targetDurationMs: typeof t.targetDurationMs === 'number' ? t.targetDurationMs : null,
    createdAt: row.createdAt,
  };
}

export class TemplateService {
  constructor(private readonly db: AppDatabase, private readonly projects: ProjectService, private readonly search: SearchService) {}

  list(): TemplateInfo[] {
    return this.db.templates.list().map(templateRowToInfo);
  }

  get(id: string): TemplateInfo | undefined {
    const row = this.db.templates.get(id);
    return row ? templateRowToInfo(row) : undefined;
  }

  delete(id: string): boolean {
    const ok = this.db.templates.delete(id);
    if (ok) this.search.remove('template', id);
    return ok;
  }

  saveFromProject(projectId: string, name: string, category = 'custom'): TemplateInfo {
    const doc = this.projects.loadLatestDocument(projectId);
    const trimmed = name.trim();
    if (!trimmed) throw new AppError({ code: 'INVALID_INPUT', operation: 'templates.saveFromProject', message: 'Template name is required' });
    const id = newId('tpl');
    const subtitleStyle = doc.subtitles[0]?.style ?? null;
    const row = this.db.templates.upsert({
      id,
      name: trimmed,
      category,
      builtin: false,
      thumbnailPath: null,
      template: {
        id,
        name: trimmed,
        category,
        description: `Saved from project "${doc.name}"`,
        platformPreset: doc.settings.platformPreset,
        settings: { width: doc.settings.width, height: doc.settings.height, fps: doc.settings.fps.num / doc.settings.fps.den, aspectPreset: doc.settings.aspectPreset },
        subtitleStyle,
        exportPresetId: null,
        sourceProjectId: projectId,
      },
    });
    this.search.index({ type: 'template', id, projectId: null, title: trimmed, body: category });
    return templateRowToInfo(row);
  }
}
