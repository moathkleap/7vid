import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from './database';
import { cleanup, tempDir } from '../test/helpers';

let dir: string;
let db: AppDatabase;

afterEach(() => {
  db?.close();
  cleanup(dir);
});

describe('database', () => {
  it('migrates and round-trips projects, versions, tasks and settings', () => {
    dir = tempDir();
    db = openDatabase(path.join(dir, 'test.db'));
    const p = db.projects.insert({ id: 'prj_1', name: 'مشروع', kind: 'editor', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, sampleRate: 48000, channels: 2, aspectPreset: '16:9', platformPreset: 'youtube' }, dataDir: dir, currentVersionId: null, thumbnailPath: null, durationMs: 0 });
    expect(p.name).toBe('مشروع');
    const v = db.versions.insert({ id: 'ver_1', projectId: 'prj_1', label: null, reason: 'manual', documentJson: '{"a":1}', hash: 'h' });
    expect(v.seq).toBe(1);
    expect(db.versions.getDocumentJson('ver_1')).toBe('{"a":1}');
    db.settings.set('app', { general: { language: 'ar' } });
    expect(db.settings.get<{ general: { language: string } }>('app')?.general.language).toBe('ar');
    db.tasks.upsert({ id: 'tsk_1', kind: 'x', title: 'X', projectId: 'prj_1', parentTaskId: null, status: 'running', priority: 0, progress: 0.5, progressMessage: null, etaMs: null, params: {}, result: null, error: null, attempts: 1, cancellable: true, pausable: false, createdAt: 'a', startedAt: 'b', finishedAt: null });
    expect(db.tasks.markInterrupted()).toEqual(['tsk_1']);
    expect(db.tasks.get('tsk_1')?.status).toBe('interrupted');
  });

  it('prunes autosave versions but keeps manual ones', () => {
    dir = tempDir();
    db = openDatabase(path.join(dir, 'test.db'));
    db.projects.insert({ id: 'prj_2', name: 'P', kind: 'editor', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, sampleRate: 48000, channels: 2, aspectPreset: '16:9', platformPreset: 'youtube' }, dataDir: dir, currentVersionId: null, thumbnailPath: null, durationMs: 0 });
    for (let i = 0; i < 10; i++) db.versions.insert({ id: `v${i}`, projectId: 'prj_2', label: null, reason: i === 0 ? 'manual' : 'autosave', documentJson: '{}', hash: String(i) });
    expect(db.versions.prune('prj_2', 3)).toBe(6);
    const left = db.versions.list('prj_2');
    expect(left).toHaveLength(4);
    expect(left.some((v) => v.reason === 'manual')).toBe(true);
  });

  it('searches Arabic and English text with normalization', () => {
    dir = tempDir();
    db = openDatabase(path.join(dir, 'test.db'));
    db.search.index({ type: 'project', id: 'a', projectId: 'a', title: 'إعلان غسيل السيارات', body: 'editor' });
    db.search.index({ type: 'project', id: 'b', projectId: 'b', title: 'Car wash promo', body: 'creator' });
    expect(db.search.query('غسيل').map((r) => r.id)).toEqual(['a']);
    expect(db.search.query('اعلان').map((r) => r.id)).toEqual(['a']);
    expect(db.search.query('car').map((r) => r.id)).toEqual(['b']);
    expect(db.search.query('wash', { types: ['asset'] })).toEqual([]);
    db.search.remove('project', 'a');
    expect(db.search.query('غسيل')).toEqual([]);
  });
});
