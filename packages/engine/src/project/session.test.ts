import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAssetRef, createClip, getDocumentDurationMs } from '@sevenvid/core';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';
import { JOURNAL_FILE } from './ProjectService';

let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

const asset = createAssetRef({ id: 'ast_x', kind: 'video', name: 'x.mp4', sourcePath: '/nonexistent/x.mp4', durationMs: 30_000, width: 1280, height: 720, fps: { num: 30, den: 1 }, hasVideo: true, hasAudio: true });

function makeEngine(userData: string): Engine {
  return createEngine({ host: testHost(), paths: { userData, resources: path.join(userData, 'res') }, logLevel: 'debug' });
}

describe('project sessions', () => {
  it('creates, opens, edits, saves versions, undoes and restores', async () => {
    dir = tempDir();
    engine = makeEngine(dir);
    await engine.start();
    const summary = await engine.invoke('projects.create', { name: 'فيديو تجريبي', platformPreset: 'tiktok' });
    expect(summary.width).toBe(1080);
    expect(summary.height).toBe(1920);
    const state = await engine.invoke('projects.open', { projectId: summary.id });
    expect(state.document.tracks.length).toBe(3);
    const video = state.document.tracks.find((t) => t.kind === 'video')!;
    await engine.invoke('session.command', { projectId: summary.id, command: { type: 'asset.add', asset } });
    let s = await engine.invoke('session.command', { projectId: summary.id, command: { type: 'clip.insert', clip: createClip({ trackId: video.id, asset, startMs: 0, id: 'clp_1' }), mode: 'overwrite' } });
    expect(getDocumentDurationMs(s.document)).toBe(30_000);
    expect(s.save.dirty).toBe(true);
    s = await engine.invoke('session.command', { projectId: summary.id, command: { type: 'timeline.trimStart', ms: 5000 } });
    expect(getDocumentDurationMs(s.document)).toBe(25_000);
    s = await engine.invoke('session.undo', { projectId: summary.id });
    expect(getDocumentDurationMs(s.document)).toBe(30_000);
    s = await engine.invoke('session.redo', { projectId: summary.id });
    expect(getDocumentDurationMs(s.document)).toBe(25_000);
    s = await engine.invoke('session.save', { projectId: summary.id, label: 'after trim' });
    expect(s.save.dirty).toBe(false);
    const versions = await engine.invoke('projects.versions.list', { projectId: summary.id });
    expect(versions[0]!.label).toBe('after trim');
    const initial = versions[versions.length - 1]!;
    s = await engine.invoke('projects.versions.restore', { projectId: summary.id, versionId: initial.id });
    expect(getDocumentDurationMs(s.document)).toBe(0);
    const mirror = JSON.parse(fs.readFileSync(path.join(summary.dataDir, 'project.7vid.json'), 'utf8'));
    expect(mirror.id).toBe(summary.id);
    const list = await engine.invoke('projects.list');
    expect(list.map((p) => p.id)).toContain(summary.id);
    const found = await engine.invoke('search.query', { q: 'تجريبي' });
    expect(found[0]?.id).toBe(summary.id);
  });

  it('recovers unsaved changes from the journal after a simulated crash', async () => {
    dir = tempDir();
    engine = makeEngine(dir);
    await engine.start();
    const summary = await engine.invoke('projects.create', { name: 'crash test' });
    const state = await engine.invoke('projects.open', { projectId: summary.id });
    const video = state.document.tracks.find((t) => t.kind === 'video')!;
    await engine.invoke('session.command', { projectId: summary.id, command: { type: 'asset.add', asset } });
    await engine.invoke('session.command', { projectId: summary.id, command: { type: 'clip.insert', clip: createClip({ trackId: video.id, asset, startMs: 0, id: 'clp_1' }), mode: 'overwrite' } });
    await engine.invoke('session.command', { projectId: summary.id, command: { type: 'marker.add', marker: { id: 'mrk_1', tMs: 1000, label: 'here', color: '#fff' } } });
    const journal = fs.readFileSync(path.join(summary.dataDir, JOURNAL_FILE), 'utf8');
    expect(journal.trim().split('\n')).toHaveLength(3);
    // Simulate a crash: drop the engine without disposing (no autosave flush, no clean-shutdown flag).
    engine.hardware.stop();
    engine.db.close();
    const engine2 = makeEngine(dir);
    engine = engine2;
    await engine2.start();
    const recovery = await engine2.invoke('projects.recovery.check');
    expect(recovery).toHaveLength(1);
    expect(recovery[0]!.projectId).toBe(summary.id);
    expect(recovery[0]!.journalEntries).toBe(3);
    const recovered = await engine2.invoke('projects.recovery.apply', { projectId: summary.id });
    expect(recovered).not.toBeNull();
    expect(getDocumentDurationMs(recovered!.document)).toBe(30_000);
    expect(recovered!.document.markers[0]!.label).toBe('here');
    expect(fs.readFileSync(path.join(summary.dataDir, JOURNAL_FILE), 'utf8')).toBe('');
    const versions = await engine2.invoke('projects.versions.list', { projectId: summary.id });
    expect(versions[0]!.reason).toBe('recovery');
  });

  it('does not report a project that is open right now as needing recovery (it flushes it instead)', async () => {
    dir = tempDir();
    engine = makeEngine(dir);
    await engine.start();
    const summary = await engine.invoke('projects.create', { name: 'open while checking' });
    await engine.invoke('projects.open', { projectId: summary.id });
    await engine.invoke('session.command', { projectId: summary.id, command: { type: 'marker.add', marker: { id: 'mrk_1', tMs: 500, label: 'pending', color: '#fff' } } });
    expect(fs.readFileSync(path.join(summary.dataDir, JOURNAL_FILE), 'utf8').trim()).not.toBe('');
    // the renderer re-checks recovery on every boot; an open session with unsaved changes must not trigger the recovery dialog
    const recovery = await engine.invoke('projects.recovery.check');
    expect(recovery).toHaveLength(0);
    const s = await engine.invoke('session.state', { projectId: summary.id });
    expect(s.save.dirty).toBe(false);
    expect(fs.readFileSync(path.join(summary.dataDir, JOURNAL_FILE), 'utf8')).toBe('');
  });

  it('autosaves after the configured interval and duplicates/deletes projects', async () => {
    dir = tempDir();
    engine = makeEngine(dir);
    await engine.start();
    await engine.invoke('settings.update', { patch: { general: { autosaveIntervalMs: 1000 } } });
    const summary = await engine.invoke('projects.create', { name: 'autosave' });
    await engine.invoke('projects.open', { projectId: summary.id });
    await engine.invoke('session.command', { projectId: summary.id, command: { type: 'project.rename', name: 'renamed by command' } });
    await new Promise((r) => setTimeout(r, 1400));
    const s = await engine.invoke('session.state', { projectId: summary.id });
    expect(s.save.dirty).toBe(false);
    expect((await engine.invoke('projects.get', { projectId: summary.id })).name).toBe('renamed by command');
    const copy = await engine.invoke('projects.duplicate', { projectId: summary.id });
    expect(copy.name).toContain('(copy)');
    await engine.invoke('projects.delete', { projectId: copy.id });
    expect((await engine.invoke('projects.list')).some((p) => p.id === copy.id)).toBe(false);
    expect((await engine.invoke('projects.list', { includeDeleted: true })).some((p) => p.id === copy.id)).toBe(true);
    await engine.invoke('projects.restoreDeleted', { projectId: copy.id });
    await engine.invoke('projects.delete', { projectId: copy.id, permanent: true });
    expect(fs.existsSync(copy.dataDir)).toBe(false);
    await expect(engine.invoke('projects.get', { projectId: copy.id })).rejects.toMatchObject({ info: { code: 'PROJECT_NOT_FOUND' } });
    await expect(engine.invoke('projects.create', { name: '' })).rejects.toMatchObject({ info: { code: 'INVALID_INPUT' } });
  });
});
