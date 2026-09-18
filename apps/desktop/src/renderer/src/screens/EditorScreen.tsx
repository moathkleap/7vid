import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { Clapperboard, FolderOpen, Plus, ShieldCheck } from 'lucide-react';
import { getDocumentDurationMs, type Command } from '@sevenvid/core';
import type { AssetInfo } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useEditorStore, startPlaybackClock } from '@/store/editorStore';
import { useMediaStore } from '@/store/mediaStore';
import { useSessionStore } from '@/store/sessionStore';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/Misc';
import { EditorToolbar } from '@/editor/EditorToolbar';
import { ToolsPanel } from '@/editor/ToolsPanel';
import { MediaPanel } from '@/editor/MediaPanel';
import { PreviewPlayer } from '@/editor/PreviewPlayer';
import { Timeline } from '@/editor/Timeline';
import { splitCommandAt, useEditorShortcuts } from '@/editor/useEditorShortcuts';

export function EditorScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const session = useSessionStore();
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);
  const editor = useEditorStore();
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(800);
  const [validation, setValidation] = useState<{ revision: number; ok: boolean; errors: number; warnings: number } | null>(null);
  const state = session.state;
  const doc = state?.document ?? null;

  useEffect(() => {
    if (projectId && session.projectId !== projectId) void session.open(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => startPlaybackClock(), []);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTimelineWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc?.id]);
  useEffect(() => {
    if (doc) editor.setContext(getDocumentDurationMs(doc), doc.settings.fps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  useEffect(() => {
    if (!doc) return;
    const ids = new Set(doc.tracks.flatMap((tr) => tr.clips.map((c) => c.id)));
    if (editor.selection.some((id) => !ids.has(id))) editor.select(editor.selection.filter((id) => ids.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  const docId = doc?.id;
  useEffect(() => {
    if (!docId) return;
    getApi().invoke('media.setPlaybackCapabilities', probePlayback()).catch(() => undefined);
  }, [docId]);
  useEvent('task.updated', (task) => {
    if (task.id !== editor.previewTaskId) return;
    if (task.status === 'done') {
      const r = task.result as { path: string; startMs: number; endMs: number; hash: string };
      editor.setPreviewTask(null);
      void useMediaStore.getState().urlFor(r.path).then((url) => url && editor.setRenderedPreview({ ...r, url }));
    } else if (task.status === 'failed' || task.status === 'cancelled') editor.setPreviewTask(null);
  });
  useEvent('session.updated', (e) => {
    if (e.projectId === doc?.id && e.origin !== 'save') editor.setRenderedPreview(null);
  });

  const onCommand = useCallback(async (cmd: Command) => session.execute(cmd), [session]);
  const actions = useMemo(() => ({
    split: () => {
      if (!doc) return;
      const cmd = splitCommandAt(doc, useEditorStore.getState().selection, useEditorStore.getState().playheadMs);
      if (cmd) void onCommand(cmd);
    },
    remove: (ripple: boolean) => {
      const sel = useEditorStore.getState().selection;
      if (sel.length) void onCommand({ type: 'clip.remove', clipIds: sel, ripple }).then(() => useEditorStore.getState().clearSelection());
    },
    duplicate: () => {
      const sel = useEditorStore.getState().selection;
      if (sel[0]) void onCommand({ type: 'clip.duplicate', clipId: sel[0] });
    },
    selectAll: () => doc && useEditorStore.getState().select(doc.tracks.flatMap((tr) => tr.clips.map((c) => c.id))),
    addMarker: () => void onCommand({ type: 'marker.add', marker: { id: `mrk_${Date.now()}`, tMs: useEditorStore.getState().playheadMs, label: '', color: '#7C5CFF' } }),
    zoomFit: () => useEditorStore.getState().zoomToFit(timelineWidth),
  }), [doc, onCommand, timelineWidth]);
  useEditorShortcuts(doc, actions);

  const addAsset = async (asset: AssetInfo, trackId: string | null = null, atMs: number | null = null) => {
    if (!doc) return;
    try {
      await getApi().invoke('media.addToTimeline', { projectId: doc.id, assetId: asset.id, trackId, atMs });
      await session.refresh();
    } catch (err) {
      reportError(err);
    }
  };
  const onDropAsset = (assetId: string, trackId: string | null, atMs: number) => {
    const asset = useMediaStore.getState().assets[assetId];
    if (asset) void addAsset(asset, trackId, atMs);
  };
  const renderPreview = async () => {
    if (!doc) return;
    const s = useEditorStore.getState();
    const startMs = s.inMs ?? 0;
    const endMs = s.outMs ?? s.durationMs;
    try {
      const task = await getApi().invoke('render.previewRange', { projectId: doc.id, startMs, endMs });
      editor.setPreviewTask(task.id);
    } catch (err) {
      reportError(err);
    }
  };
  const validate = async () => {
    if (!state) return;
    try {
      const r = await getApi().invoke('session.validate', { projectId: state.projectId });
      setValidation({ revision: state.revision, ok: r.ok, errors: r.errors, warnings: r.warnings });
      pushToast({ level: r.ok ? 'success' : 'warning', titleKey: r.ok && r.warnings === 0 ? 'editor.valid' : 'editor.issues', messageKey: null, params: { errors: r.errors, warnings: r.warnings }, errorId: null, taskId: null });
    } catch (err) {
      reportError(err);
    }
  };

  if (!projectId && !state) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16">
        <EmptyState icon={<Clapperboard />} title={t('editor.noProject')} description={t('editor.openOrCreate')} action={<Button action="editor.openProjects" variant="primary" icon={<FolderOpen />} onClick={() => navigate('/projects')}>{t('projects.title')}</Button>} />
      </div>
    );
  }
  if (!state || !doc) return <div className="grid h-full place-items-center"><Spinner /></div>;
  const currentValidation = validation && validation.revision === state.revision ? validation : null;
  return (
    <div className="flex h-full flex-col" data-testid="editor">
      <div className="flex min-h-0 flex-1">
        <MediaPanel projectId={doc.id} onAdd={(a) => void addAsset(a)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-3"><PreviewPlayer doc={doc} /></div>
          <EditorToolbar doc={doc} onCommand={onCommand} onSplit={actions.split} onDelete={actions.remove} onRenderPreview={() => void renderPreview()} timelineWidth={timelineWidth} />
        </div>
        <ToolsPanel doc={doc} onCommand={onCommand} />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border bg-surface px-3 text-[12px] text-muted">
        <span data-testid="editor-resolution">{doc.settings.width}×{doc.settings.height}</span>
        <span>·</span>
        <span>{doc.tracks.length} {t('editor.tracks').toLowerCase()}</span>
        <span>·</span>
        <span data-testid="editor-clip-count">{doc.tracks.reduce((n, tr) => n + tr.clips.length, 0)} {t('editor.clips')}</span>
        {currentValidation ? <span data-testid="editor-validation" className={currentValidation.ok ? 'text-success' : 'text-warning'}>· {currentValidation.ok && currentValidation.warnings === 0 ? t('editor.valid') : t('editor.issues', { errors: currentValidation.errors, warnings: currentValidation.warnings })}</span> : null}
        <div className="ms-auto flex items-center gap-1">
          <Button action="editor.addTrack.video" size="sm" variant="ghost" icon={<Plus />} onClick={() => void onCommand({ type: 'track.add', kind: 'video' })}>{t('editor.trackKind.video')}</Button>
          <Button action="editor.addTrack.audio" size="sm" variant="ghost" icon={<Plus />} onClick={() => void onCommand({ type: 'track.add', kind: 'audio' })}>{t('editor.trackKind.audio')}</Button>
          <Button action="editor.addTrack.overlay" size="sm" variant="ghost" icon={<Plus />} onClick={() => void onCommand({ type: 'track.add', kind: 'overlay' })}>{t('editor.trackKind.overlay')}</Button>
          <Button action="editor.validate" size="sm" variant="ghost" icon={<ShieldCheck />} onClick={() => void validate()}>{t('editor.validate')}</Button>
        </div>
      </div>
      <div ref={timelineRef} className="h-[280px] shrink-0 border-t border-border">
        <Timeline doc={doc} onCommand={onCommand} onDropAsset={onDropAsset} />
      </div>
    </div>
  );
}

/** Reports what this renderer can decode so the engine picks proxy formats correctly. */
function probePlayback() {
  const v = document.createElement('video');
  const can = (type: string) => v.canPlayType(type) !== '';
  return {
    h264: can('video/mp4; codecs="avc1.42E01E"'),
    hevc: can('video/mp4; codecs="hvc1.1.6.L93.B0"') || can('video/mp4; codecs="hev1.1.6.L93.B0"'),
    vp9: can('video/webm; codecs="vp9"'),
    av1: can('video/mp4; codecs="av01.0.05M.08"'),
    aac: can('audio/mp4; codecs="mp4a.40.2"'),
    opus: can('audio/webm; codecs="opus"'),
    mp3: can('audio/mpeg'),
  };
}
