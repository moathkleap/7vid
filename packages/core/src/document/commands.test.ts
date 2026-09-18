import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError } from './commands';
import { createAssetRef, createClip, createDocument, createMarker, createSubtitleTrack } from './factory';
import { History } from './history';
import { allClips, getDocumentDurationMs, getTrack } from './queries';
import type { ProjectDocument } from './types';
import { validateDocument } from './validate';

const asset = createAssetRef({
  id: 'ast_1',
  kind: 'video',
  name: 'clip.mp4',
  sourcePath: '/tmp/clip.mp4',
  durationMs: 60_000,
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  hasVideo: true,
  hasAudio: true,
});

function baseDoc(): ProjectDocument {
  let doc = createDocument({ name: 'Test', now: '2026-01-01T00:00:00.000Z' });
  doc = applyCommand(doc, { type: 'asset.add', asset }).doc;
  const video = doc.tracks.find((t) => t.kind === 'video')!;
  const clip = createClip({ trackId: video.id, asset, startMs: 0, id: 'clp_a' });
  doc = applyCommand(doc, { type: 'clip.insert', clip, mode: 'overwrite' }).doc;
  return doc;
}

describe('commands', () => {
  it('inserts a clip spanning the asset duration', () => {
    const doc = baseDoc();
    expect(getDocumentDurationMs(doc)).toBe(60_000);
    expect(allClips(doc)).toHaveLength(1);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('trims the start and the end of the timeline', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'timeline.trimStart', ms: 20_000 }).doc;
    doc = applyCommand(doc, { type: 'timeline.trimEnd', ms: 15_000 }).doc;
    const [clip] = allClips(doc);
    expect(getDocumentDurationMs(doc)).toBe(25_000);
    expect(clip!.startMs).toBe(0);
    expect(clip!.sourceInMs).toBe(20_000);
    expect(clip!.sourceOutMs).toBe(45_000);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('cuts a middle range and ripples the rest', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'timeline.cutRange', startMs: 130_000 / 2, endMs: 165_000 / 2 }).doc; // 1:05 – 1:22.5
    const clips = allClips(doc);
    expect(clips).toHaveLength(1); // beyond duration -> untouched? No: 65s > 60s duration => range outside -> clip unchanged
    doc = applyCommand(doc, { type: 'timeline.cutRange', startMs: 10_000, endMs: 20_000 }).doc;
    const after = allClips(doc).sort((a, b) => a.startMs - b.startMs);
    expect(after).toHaveLength(2);
    expect(after[0]!.durationMs).toBe(10_000);
    expect(after[1]!.startMs).toBe(10_000);
    expect(after[1]!.sourceInMs).toBe(20_000);
    expect(getDocumentDurationMs(doc)).toBe(50_000);
  });

  it('cuts multiple ranges (silence removal) from last to first', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'timeline.cutRanges', ranges: [{ startMs: 1000, endMs: 2000 }, { startMs: 5000, endMs: 8000 }, { startMs: 50_000, endMs: 60_000 }] }).doc;
    expect(getDocumentDurationMs(doc)).toBe(46_000);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('splits and joins clips', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'clip.split', clipId: 'clp_a', atMs: 30_000, newClipId: 'clp_b' }).doc;
    const [a, b] = allClips(doc).sort((x, y) => x.startMs - y.startMs);
    expect(a!.durationMs).toBe(30_000);
    expect(b!.startMs).toBe(30_000);
    expect(b!.sourceInMs).toBe(30_000);
    doc = applyCommand(doc, { type: 'clip.join', clipIdA: 'clp_a', clipIdB: 'clp_b' }).doc;
    expect(allClips(doc)).toHaveLength(1);
    expect(allClips(doc)[0]!.durationMs).toBe(60_000);
  });

  it('changes speed and keeps source range', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'clip.setSpeed', clipId: 'clp_a', speed: 2, ripple: true }).doc;
    expect(allClips(doc)[0]!.durationMs).toBe(30_000);
    doc = applyCommand(doc, { type: 'clip.setSpeed', clipId: 'clp_a', speed: 0.5, ripple: true }).doc;
    expect(allClips(doc)[0]!.durationMs).toBe(120_000);
  });

  it('moves a clip and overwrites overlapping clips', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'clip.split', clipId: 'clp_a', atMs: 30_000, newClipId: 'clp_b' }).doc;
    doc = applyCommand(doc, { type: 'clip.move', clipId: 'clp_b', startMs: 10_000 }).doc;
    const clips = allClips(doc).sort((x, y) => x.startMs - y.startMs);
    expect(clips[0]!.durationMs).toBe(10_000);
    expect(clips[1]!.startMs).toBe(10_000);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('shifts subtitles and markers when cutting', () => {
    let doc = baseDoc();
    const sub = createSubtitleTrack({ language: 'ar', id: 'sub_1' });
    doc = applyCommand(doc, { type: 'subtitle.addTrack', track: sub }).doc;
    doc = applyCommand(doc, { type: 'subtitle.setCues', trackId: 'sub_1', cues: [{ id: 'c1', startMs: 1000, endMs: 3000, text: 'مرحبا', speaker: null }, { id: 'c2', startMs: 25_000, endMs: 27_000, text: 'hello', speaker: null }] }).doc;
    doc = applyCommand(doc, { type: 'marker.add', marker: { ...createMarker(26_000, 'm'), id: 'mrk_1' } }).doc;
    doc = applyCommand(doc, { type: 'timeline.cutRange', startMs: 10_000, endMs: 20_000 }).doc;
    expect(doc.subtitles[0]!.cues[1]!.startMs).toBe(15_000);
    expect(doc.markers[0]!.tMs).toBe(16_000);
  });

  it('sets duration by trimming or speeding', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'timeline.setDuration', targetMs: 30_000, strategy: 'trim-end' }).doc;
    expect(getDocumentDurationMs(doc)).toBe(30_000);
    doc = applyCommand(doc, { type: 'timeline.setDuration', targetMs: 15_000, strategy: 'speed' }).doc;
    expect(getDocumentDurationMs(doc)).toBe(15_000);
    expect(allClips(doc)[0]!.speed).toBe(2);
  });

  it('rejects invalid operations with CommandError', () => {
    const doc = baseDoc();
    expect(() => applyCommand(doc, { type: 'clip.split', clipId: 'nope', atMs: 1 })).toThrowError(CommandError);
    expect(() => applyCommand(doc, { type: 'timeline.trimStart', ms: 100_000 })).toThrowError(/whole project/);
    expect(() => applyCommand(doc, { type: 'clip.trim', clipId: 'clp_a', edge: 'end', toMs: 70_000, ripple: false })).toThrowError(/beyond/);
  });

  it('supports undo/redo through History', () => {
    const history = new History();
    let doc = baseDoc();
    ({ doc } = history.execute(doc, { type: 'timeline.trimStart', ms: 5000 }));
    expect(getDocumentDurationMs(doc)).toBe(55_000);
    const undone = history.undo(doc)!;
    expect(getDocumentDurationMs(undone.doc)).toBe(60_000);
    const redone = history.redo(undone.doc)!;
    expect(getDocumentDurationMs(redone.doc)).toBe(55_000);
    expect(history.state().canUndo).toBe(true);
    expect(history.state().canRedo).toBe(false);
  });

  it('removes an asset together with its clips', () => {
    let doc = baseDoc();
    doc = applyCommand(doc, { type: 'asset.remove', assetId: 'ast_1' }).doc;
    expect(allClips(doc)).toHaveLength(0);
    expect(doc.assets['ast_1']).toBeUndefined();
    expect(getTrack(doc, doc.tracks[0]!.id)!.clips).toHaveLength(0);
  });

  it('does not report a change for no-op commands', () => {
    const doc = baseDoc();
    const r = applyCommand(doc, { type: 'timeline.trimStart', ms: 0 });
    expect(r.changed).toBe(false);
    expect(r.doc).toBe(doc);
  });
});
