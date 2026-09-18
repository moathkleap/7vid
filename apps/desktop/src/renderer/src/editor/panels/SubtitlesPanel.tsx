import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileUp, Mic, Plus, Trash2 } from 'lucide-react';
import { defaultSubtitleStyle, formatMs, newId, type Command, type ProjectDocument, type SubtitleStyle, type SubtitleTrack } from '@sevenvid/core';
import type { TranscribeResult } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { CapabilityGate } from '@/components/CapabilityGate';
import { FileBrowserDialog } from '@/components/dialogs/FileBrowserDialog';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Switch } from '@/components/ui/Input';
import { usePickFiles } from '@/hooks/usePickFiles';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useTaskRunner } from '@/hooks/useTaskRunner';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { Hint, NumberField, RangeField, SectionTitle, TaskStatus } from './shared';

type StylePreset = 'default' | 'tiktok' | 'minimal' | 'cinematic';

const STYLE_PRESETS: Record<StylePreset, Partial<SubtitleStyle>> = {
  default: defaultSubtitleStyle(),
  tiktok: { fontFamily: 'IBM Plex Sans Arabic', fontSize: 64, bold: true, color: '#FFFFFF', outlineColor: '#000000', outlineWidth: 4, backgroundColor: null, position: 'center', marginV: 48 },
  minimal: { fontFamily: 'Inter', fontSize: 36, bold: false, color: '#FFFFFF', outlineColor: '#000000', outlineWidth: 1, backgroundColor: null, position: 'bottom', marginV: 40 },
  cinematic: { fontFamily: 'Noto Naskh Arabic', fontSize: 44, bold: false, color: '#F5E6C8', outlineColor: '#1A1A1A', outlineWidth: 2, backgroundColor: '#000000', position: 'bottom', marginV: 72 },
};

function CueRow({ trackId, cue, onCommand }: { trackId: string; cue: SubtitleTrack['cues'][number]; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const [text, setText] = useSyncedState(cue.text);
  const commitText = () => text !== cue.text && void onCommand({ type: 'subtitle.updateCue', trackId, cueId: cue.id, patch: { text } });
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2" data-testid="cue-row">
      <div className="mb-1 flex items-center gap-1.5">
        <button type="button" data-action="subtitles.seekCue" className="font-mono text-[11px] text-muted hover:text-text" dir="ltr" onClick={() => setPlayhead(cue.startMs)} title={t('subtitlesPanel.seekTo')}>{formatMs(cue.startMs)} → {formatMs(cue.endMs)}</button>
        <NumberField action="cue.start" value={cue.startMs / 1000} min={0} step={0.1} onCommit={(v) => void onCommand({ type: 'subtitle.updateCue', trackId, cueId: cue.id, patch: { startMs: Math.round(v * 1000) } })} className="w-20" />
        <NumberField action="cue.end" value={cue.endMs / 1000} min={0} step={0.1} onCommit={(v) => void onCommand({ type: 'subtitle.updateCue', trackId, cueId: cue.id, patch: { endMs: Math.round(v * 1000) } })} className="w-20" />
        <IconButton action="cue.delete" label={t('subtitlesPanel.deleteCue')} size="sm" className="ms-auto" onClick={() => void onCommand({ type: 'subtitle.removeCue', trackId, cueId: cue.id })}><Trash2 /></IconButton>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={commitText} data-action="cue.text" rows={2} className="focus-ring w-full resize-none rounded-md border border-border bg-surface px-2 py-1 text-[13px]" dir="auto" />
    </div>
  );
}

export function SubtitlesPanel({ doc, clipId, onCommand }: { doc: ProjectDocument; clipId: string | null; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);
  const playhead = useEditorStore((s) => s.playheadMs);
  const { pick, browserOpen, onBrowserSelect, onBrowserClose } = usePickFiles();
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [language, setLanguage] = useState<'auto' | 'ar' | 'en'>('auto');
  const [scope, setScope] = useState<'timeline' | 'clip'>('timeline');
  const [format, setFormat] = useState<'srt' | 'vtt' | 'ass'>('srt');
  const transcribe = useTaskRunner<TranscribeResult>((r) => {
    setSelectedTrackId(r.trackId);
    pushToast({ level: 'success', titleKey: 'subtitlesPanel.transcribed', messageKey: null, params: { count: r.cues, language: r.language, model: r.modelId, device: r.device }, errorId: null, taskId: null });
  });
  const track = doc.subtitles.find((s) => s.id === selectedTrackId) ?? doc.subtitles[0];
  const clip = clipId ? doc.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) : undefined;
  const timelineEmpty = doc.tracks.every((tr) => tr.clips.length === 0);

  const doImport = async () => {
    const paths = await pick('subtitle', false);
    if (!paths[0]) return;
    try {
      const state = await getApi().invoke('subtitles.import', { projectId: doc.id, path: paths[0] });
      setSelectedTrackId(state.document.subtitles[state.document.subtitles.length - 1]?.id ?? null);
    } catch (err) {
      reportError(err);
    }
  };
  const doExport = async () => {
    if (!track) return;
    try {
      const save = await getApi().invoke('dialog.saveFile', { defaultPath: `${doc.name}-${track.language}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
      if (save.native && !save.path) return;
      const r = await getApi().invoke('subtitles.export', { projectId: doc.id, trackId: track.id, format, outputPath: save.path });
      pushToast({ level: 'success', titleKey: 'subtitlesPanel.exported', messageKey: null, params: { count: r.cues, path: r.path }, errorId: null, taskId: null });
    } catch (err) {
      reportError(err);
    }
  };
  const addCue = () => {
    if (!track) return;
    void onCommand({ type: 'subtitle.addCue', trackId: track.id, cue: { id: newId('cue'), startMs: Math.round(playhead), endMs: Math.round(playhead) + 2000, text: t('subtitlesPanel.newCue'), speaker: null } });
  };
  const setStyle = (patch: Partial<SubtitleStyle>) => track && void onCommand({ type: 'subtitle.updateTrack', trackId: track.id, patch: { style: { ...track.style, ...patch } } });
  const sourceLabel = (s: SubtitleTrack['source']) => t(`subtitlesPanel.source${s[0]!.toUpperCase()}${s.slice(1)}`);

  return (
    <div data-testid="subtitles-panel">
      <SectionTitle>{t('subtitlesPanel.transcribe')}</SectionTitle>
      <Hint>{t('subtitlesPanel.sttHint')}</Hint>
      <CapabilityGate id="stt" compact>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('subtitlesPanel.language')}>
            <Select value={language} data-action="subtitles.language" onChange={(e) => setLanguage(e.target.value as typeof language)}>
              <option value="auto">{t('subtitlesPanel.langAuto')}</option>
              <option value="ar">{t('subtitlesPanel.langAr')}</option>
              <option value="en">{t('subtitlesPanel.langEn')}</option>
            </Select>
          </Field>
          <Field label={t('subtitlesPanel.selectedClip')}>
            <Select value={scope} data-action="subtitles.scope" onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="timeline">{t('subtitlesPanel.wholeTimeline')}</option>
              <option value="clip" disabled={!clip}>{t('subtitlesPanel.selectedClip')}</option>
            </Select>
          </Field>
        </div>
        <Button action="subtitles.transcribe" size="sm" variant="primary" icon={<Mic />} disabled={timelineEmpty || transcribe.running} loading={transcribe.running} onClick={() => void transcribe.run(() => getApi().invoke('subtitles.transcribe', { projectId: doc.id, clipId: scope === 'clip' ? (clip?.id ?? null) : null, language }))} data-testid="subtitles-transcribe">{t('subtitlesPanel.transcribe')}</Button>
        <TaskStatus running={transcribe.running} progress={transcribe.progress} message={transcribe.message ?? t('subtitlesPanel.transcribing')} error={transcribe.error} />
      </CapabilityGate>

      <SectionTitle>{t('subtitlesPanel.tracks')}</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        <Button action="subtitles.import" size="sm" icon={<FileUp />} onClick={() => void doImport()} data-testid="subtitles-import">{t('subtitlesPanel.import')}</Button>
        <Button action="subtitles.addTrack" size="sm" icon={<Plus />} onClick={() => { const tr = { id: newId('sub'), name: `Subtitles (${doc.subtitles.length + 1})`, language: 'ar', cues: [], style: defaultSubtitleStyle(), enabled: true, burnIn: true, source: 'manual' as const }; void onCommand({ type: 'subtitle.addTrack', track: tr }).then(() => setSelectedTrackId(tr.id)); }}>{t('subtitlesPanel.addCue')}</Button>
      </div>
      {doc.subtitles.length === 0 ? <Hint>{t('subtitlesPanel.noTracks')}</Hint> : null}
      <div className="mt-2 flex flex-col gap-1.5" data-testid="subtitle-tracks">
        {doc.subtitles.map((s) => (
          <div key={s.id} className={`rounded-lg border px-2.5 py-2 text-[12.5px] ${track?.id === s.id ? 'border-accent bg-accent-soft/40' : 'border-border bg-surface-2'}`} data-testid="subtitle-track">
            <div className="flex items-center gap-2">
              <button type="button" data-action="subtitles.selectTrack" className="min-w-0 flex-1 truncate text-start font-medium" onClick={() => setSelectedTrackId(s.id)}>{s.name}</button>
              <Badge>{s.language}</Badge>
              <Badge tone="neutral">{sourceLabel(s.source)}</Badge>
              <span className="text-[11px] text-muted">{t('subtitlesPanel.cues', { count: s.cues.length })}</span>
              <IconButton action="subtitles.removeTrack" label={t('subtitlesPanel.removeTrack')} size="sm" onClick={() => void onCommand({ type: 'subtitle.removeTrack', trackId: s.id })}><Trash2 /></IconButton>
            </div>
            <div className="mt-1 flex items-center gap-4 text-[12px]">
              <label className="flex items-center gap-2 text-muted">{t('subtitlesPanel.enabled')}<Switch action="subtitles.enabled" checked={s.enabled} onCheckedChange={(v) => void onCommand({ type: 'subtitle.updateTrack', trackId: s.id, patch: { enabled: v } })} /></label>
              <label className="flex items-center gap-2 text-muted">{t('subtitlesPanel.burnIn')}<Switch action="subtitles.burnIn" checked={s.burnIn} onCheckedChange={(v) => void onCommand({ type: 'subtitle.updateTrack', trackId: s.id, patch: { burnIn: v } })} /></label>
            </div>
          </div>
        ))}
      </div>

      {track ? (
        <>
          <SectionTitle>{t('subtitlesPanel.export')}</SectionTitle>
          <div className="flex items-center gap-2">
            <Select value={format} data-action="subtitles.format" onChange={(e) => setFormat(e.target.value as typeof format)} className="w-28">
              <option value="srt">SRT</option>
              <option value="vtt">WebVTT</option>
              <option value="ass">ASS</option>
            </Select>
            <Button action="subtitles.export" size="sm" icon={<Download />} disabled={track.cues.length === 0} onClick={() => void doExport()} data-testid="subtitles-export">{t('subtitlesPanel.export')}</Button>
          </div>

          <SectionTitle>{t('subtitlesPanel.style')}</SectionTitle>
          <Field label={t('subtitlesPanel.stylePreset')}>
            <Select value="" data-action="subtitles.stylePreset" onChange={(e) => { const p = e.target.value as StylePreset | ''; if (p) setStyle(STYLE_PRESETS[p]); }}>
              <option value="">…</option>
              <option value="default">{t('subtitlesPanel.presetDefault')}</option>
              <option value="tiktok">{t('subtitlesPanel.presetTiktok')}</option>
              <option value="minimal">{t('subtitlesPanel.presetMinimal')}</option>
              <option value="cinematic">{t('subtitlesPanel.presetCinematic')}</option>
            </Select>
          </Field>
          <RangeField label={t('subtitlesPanel.fontSize')} value={track.style.fontSize} min={16} max={120} step={1} action="subtitles.fontSize" onCommit={(v) => setStyle({ fontSize: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('subtitlesPanel.position')}>
              <Select value={track.style.position} data-action="subtitles.position" onChange={(e) => setStyle({ position: e.target.value as SubtitleStyle['position'] })}>
                <option value="bottom">{t('subtitlesPanel.positionBottom')}</option>
                <option value="center">{t('subtitlesPanel.positionCenter')}</option>
                <option value="top">{t('subtitlesPanel.positionTop')}</option>
              </Select>
            </Field>
            <Field label={t('subtitlesPanel.color')}><Input type="color" value={track.style.color} data-action="subtitles.color" onChange={(e) => setStyle({ color: e.target.value })} className="h-9 p-1" /></Field>
          </div>
          <Field inline label={t('subtitlesPanel.background')}><Switch action="subtitles.background" checked={Boolean(track.style.backgroundColor)} onCheckedChange={(v) => setStyle({ backgroundColor: v ? '#000000' : null })} /></Field>
          <Field inline label={t('editor.clip') + ' · ' + t('subtitlesPanel.language')}>
            <Select value={track.language} data-action="subtitles.trackLanguage" onChange={(e) => void onCommand({ type: 'subtitle.updateTrack', trackId: track.id, patch: { language: e.target.value } })} className="w-24">
              <option value="ar">ar</option>
              <option value="en">en</option>
            </Select>
          </Field>

          <SectionTitle>{t('subtitlesPanel.cues', { count: track.cues.length })}</SectionTitle>
          <Button action="subtitles.addCue" size="sm" icon={<Plus />} onClick={addCue} data-testid="subtitles-add-cue">{t('subtitlesPanel.addCue')}</Button>
          <div className="mt-2 flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto pe-1" data-testid="cue-list">
            {[...track.cues].sort((a, b) => a.startMs - b.startMs).map((cue) => <CueRow key={cue.id} trackId={track.id} cue={cue} onCommand={onCommand} />)}
          </div>
        </>
      ) : null}
      <FileBrowserDialog open={browserOpen} onClose={onBrowserClose} onSelect={onBrowserSelect} />
    </div>
  );
}
