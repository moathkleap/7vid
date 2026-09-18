import { useTranslation } from 'react-i18next';
import { Bookmark, ChevronFirst, ChevronLast, Magnet, Pause, Play, Scissors, SkipBack, SkipForward, Square, Trash2, ZoomIn, ZoomOut, Maximize2, MousePointer2, Slice, Clapperboard, Loader2 } from 'lucide-react';
import { formatTimecode, type Command, type ProjectDocument } from '@sevenvid/core';
import { useEditorStore } from '@/store/editorStore';
import { Button, IconButton } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Misc';

export function EditorToolbar({ doc, onCommand, onSplit, onDelete, onRenderPreview, timelineWidth }: { doc: ProjectDocument; onCommand: (cmd: Command) => Promise<unknown>; onSplit: () => void; onDelete: (ripple: boolean) => void; onRenderPreview: () => void; timelineWidth: number }) {
  const { t } = useTranslation();
  const s = useEditorStore();
  const tip = (label: string, key?: string) => <span className="flex items-center gap-2">{label}{key ? <Kbd>{key}</Kbd> : null}</span>;
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-y border-border bg-surface px-2" data-testid="editor-toolbar">
      <Tooltip content={tip(t('editor.goStart'), 'Home')}><IconButton action="playback.goStart" label={t('editor.goStart')} size="sm" onClick={() => s.setPlayhead(0)}><ChevronFirst /></IconButton></Tooltip>
      <Tooltip content={tip(t('editor.stepBack'), '←')}><IconButton action="playback.stepBack" label={t('editor.stepBack')} size="sm" onClick={() => s.stepFrames(-1)}><SkipBack /></IconButton></Tooltip>
      <Tooltip content={tip(s.playing ? t('editor.pause') : t('editor.play'), 'Space')}>
        <IconButton action="playback.toggle" label={s.playing ? t('editor.pause') : t('editor.play')} onClick={() => s.togglePlay()} active={s.playing} data-testid="playback-toggle">{s.playing ? <Pause /> : <Play />}</IconButton>
      </Tooltip>
      <Tooltip content={tip(t('editor.stop'), 'K')}><IconButton action="playback.stop" label={t('editor.stop')} size="sm" onClick={() => { s.stop(); s.setPlayhead(s.inMs ?? 0); }}><Square /></IconButton></Tooltip>
      <Tooltip content={tip(t('editor.stepForward'), '→')}><IconButton action="playback.stepForward" label={t('editor.stepForward')} size="sm" onClick={() => s.stepFrames(1)}><SkipForward /></IconButton></Tooltip>
      <Tooltip content={tip(t('editor.goEnd'), 'End')}><IconButton action="playback.goEnd" label={t('editor.goEnd')} size="sm" onClick={() => s.setPlayhead(s.durationMs)}><ChevronLast /></IconButton></Tooltip>
      <div className="mx-2 rounded-md bg-surface-2 px-2 py-1 font-mono text-[12.5px] tabular-nums" dir="ltr" data-testid="timecode">{formatTimecode(s.playheadMs, doc.settings.fps)} <span className="text-faint">/ {formatTimecode(s.durationMs, doc.settings.fps)}</span></div>
      {s.rate !== 1 && s.playing ? <span className="text-[11px] text-warning">{s.rate}x</span> : null}
      <div className="mx-1 h-6 w-px bg-border" />
      <Tooltip content={t('editor.toolSelect')}><IconButton action="tool.select" label={t('editor.toolSelect')} size="sm" active={s.tool === 'select'} onClick={() => s.setTool('select')}><MousePointer2 /></IconButton></Tooltip>
      <Tooltip content={t('editor.toolRazor')}><IconButton action="tool.razor" label={t('editor.toolRazor')} size="sm" active={s.tool === 'razor'} onClick={() => s.setTool('razor')}><Slice /></IconButton></Tooltip>
      <Tooltip content={tip(t('editor.split'), 'S')}><IconButton action="timeline.split" label={t('editor.split')} size="sm" onClick={onSplit}><Scissors /></IconButton></Tooltip>
      <Tooltip content={tip(t('editor.delete'), 'Del')}><IconButton action="timeline.delete" label={t('editor.delete')} size="sm" disabled={s.selection.length === 0} onClick={() => onDelete(false)}><Trash2 /></IconButton></Tooltip>
      <Tooltip content={tip(t('editor.rippleDelete'), 'Shift+Del')}><Button action="timeline.rippleDelete" size="sm" variant="ghost" disabled={s.selection.length === 0} onClick={() => onDelete(true)}>{t('editor.rippleDelete')}</Button></Tooltip>
      <div className="mx-1 h-6 w-px bg-border" />
      <Tooltip content={tip(t('editor.setIn'), 'I')}><Button action="timeline.setIn" size="sm" variant={s.inMs != null ? 'secondary' : 'ghost'} onClick={() => s.setInOut(s.playheadMs, s.outMs)}>I</Button></Tooltip>
      <Tooltip content={tip(t('editor.setOut'), 'O')}><Button action="timeline.setOut" size="sm" variant={s.outMs != null ? 'secondary' : 'ghost'} onClick={() => s.setInOut(s.inMs, s.playheadMs)}>O</Button></Tooltip>
      {s.inMs != null && s.outMs != null && s.outMs > s.inMs ? (
        <>
          <Button action="timeline.cutRange" size="sm" variant="outline" onClick={() => void onCommand({ type: 'timeline.cutRange', startMs: s.inMs!, endMs: s.outMs! }).then(() => s.setInOut(null, null))}>{t('editor.cutRange')}</Button>
          <Button action="timeline.clearInOut" size="sm" variant="ghost" onClick={() => s.setInOut(null, null)}>{t('editor.clearInOut')}</Button>
        </>
      ) : null}
      <Tooltip content={tip(t('editor.addMarker'), 'M')}><IconButton action="timeline.addMarker" label={t('editor.addMarker')} size="sm" onClick={() => void onCommand({ type: 'marker.add', marker: { id: `mrk_${Date.now()}`, tMs: s.playheadMs, label: '', color: '#7C5CFF' } })}><Bookmark /></IconButton></Tooltip>
      <div className="ms-auto flex items-center gap-1">
        <Tooltip content={s.previewTaskId ? t('editor.renderingPreview') : t('editor.renderPreview')}>
          <Button action="preview.render" size="sm" variant="outline" icon={s.previewTaskId ? <Loader2 className="animate-spin" /> : <Clapperboard />} disabled={Boolean(s.previewTaskId) || s.durationMs === 0} onClick={onRenderPreview}>{t('editor.renderPreview')}</Button>
        </Tooltip>
        {s.renderedPreview ? <Button action="preview.mode" size="sm" variant={s.previewMode === 'rendered' ? 'primary' : 'ghost'} onClick={() => s.setPreviewMode(s.previewMode === 'rendered' ? 'live' : 'rendered')}>{s.previewMode === 'rendered' ? t('editor.previewRendered') : t('editor.previewLive')}</Button> : null}
        <Tooltip content={tip(t('editor.snap'), 'N')}><IconButton action="timeline.snap" label={t('editor.snap')} size="sm" active={s.snap} onClick={() => s.toggleSnap()}><Magnet /></IconButton></Tooltip>
        <Tooltip content={tip(t('editor.zoomOut'), '-')}><IconButton action="timeline.zoomOut" label={t('editor.zoomOut')} size="sm" onClick={() => s.setZoom(s.pxPerMs / 1.4)}><ZoomOut /></IconButton></Tooltip>
        <Tooltip content={tip(t('editor.zoomIn'), '+')}><IconButton action="timeline.zoomIn" label={t('editor.zoomIn')} size="sm" onClick={() => s.setZoom(s.pxPerMs * 1.4)}><ZoomIn /></IconButton></Tooltip>
        <Tooltip content={tip(t('editor.zoomFit'), 'Shift+Z')}><IconButton action="timeline.zoomFit" label={t('editor.zoomFit')} size="sm" onClick={() => s.zoomToFit(timelineWidth)}><Maximize2 /></IconButton></Tooltip>
      </div>
    </div>
  );
}
