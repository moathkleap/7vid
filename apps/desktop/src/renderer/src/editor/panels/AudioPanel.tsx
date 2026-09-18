import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Scissors, Volume2, Waves } from 'lucide-react';
import { AUDIO_PRESETS, formatMs, isAudioEffect, type Command, type ProjectDocument } from '@sevenvid/core';
import type { EnhancePreviewResult, LoudnessResult, RemoveSilenceResult, SilenceDetectionResult } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useCapability } from '@/components/CapabilityGate';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Input';
import { StatRow } from '@/components/ui/Misc';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useTaskRunner } from '@/hooks/useTaskRunner';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { Hint, NumberField, SectionTitle, TaskStatus, fmtSec } from './shared';

function LoudnessTable({ r }: { r: LoudnessResult }) {
  const { t } = useTranslation();
  const f = (v: number | null, unit: string) => (v == null ? '—' : `${v.toFixed(1)} ${unit}`);
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-1 text-[12px]">
      <StatRow label={t('audioTools.integrated')} value={f(r.integratedLufs, 'LUFS')} mono />
      <StatRow label={t('audioTools.lra')} value={f(r.loudnessRangeLu, 'LU')} mono />
      <StatRow label={t('audioTools.truePeak')} value={f(r.truePeakDb, 'dBTP')} mono />
      <StatRow label={t('audioTools.meanVolume')} value={f(r.meanVolumeDb, 'dB')} mono />
      <StatRow label={t('audioTools.maxVolume')} value={f(r.maxVolumeDb, 'dB')} mono />
    </div>
  );
}

function AudioPlayer({ path, label }: { path: string; label: string }) {
  const url = useMediaUrl(path);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium">{label}</span>
      {url ? <audio controls src={url} className="w-full" preload="metadata" data-testid={`audio-${label}`} /> : null}
    </div>
  );
}

export function AudioPanel({ doc, clipId, onCommand }: { doc: ProjectDocument; clipId: string | null; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const pushToast = useAppStore((s) => s.pushToast);
  const vad = useCapability('audio.vad');
  const inMs = useEditorStore((s) => s.inMs);
  const outMs = useEditorStore((s) => s.outMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const clip = clipId ? doc.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) : undefined;
  const audioClip = clip && doc.assets[clip.assetId]?.hasAudio ? clip : null;
  const [method, setMethod] = useState<'auto' | 'vad' | 'silencedetect'>('auto');
  const [thresholdDb, setThresholdDb] = useState(-35);
  const [minSilenceMs, setMinSilenceMs] = useState(700);
  const [paddingMs, setPaddingMs] = useState(150);
  const detect = useTaskRunner<SilenceDetectionResult>();
  const remove = useTaskRunner<RemoveSilenceResult>((r) => pushToast({ level: r.verified === false ? 'warning' : 'success', titleKey: 'audioTools.removed', messageKey: null, params: { ms: fmtSec(r.removedMs), count: r.cutRanges.length, before: formatMs(r.beforeDurationMs), after: formatMs(r.afterDurationMs) }, errorId: null, taskId: null }));
  const measure = useTaskRunner<LoudnessResult>();
  const preview = useTaskRunner<EnhancePreviewResult>();
  const range = inMs != null && outMs != null && outMs > inMs ? { startMs: inMs, endMs: outMs } : {};
  const opts = { projectId: doc.id, ...range, thresholdDb, minSilenceMs, method };
  const methodLabel = (m: string) => (m === 'vad' ? t('audioTools.methodVad') : t('audioTools.methodSilencedetect'));
  const timelineEmpty = doc.tracks.every((tr) => tr.clips.length === 0);
  const audioEffects = audioClip?.effects.filter((e) => isAudioEffect(e)) ?? [];
  const applyPreset = async (presetId: string) => {
    if (!audioClip) return;
    try {
      await getApi().invoke('audio.applyPreset', { projectId: doc.id, clipIds: [audioClip.id], presetId });
    } catch (err) {
      useAppStore.getState().reportError(err);
    }
  };
  return (
    <div data-testid="audio-panel">
      <SectionTitle>{t('audioTools.title')}</SectionTitle>
      <Field label={t('audioTools.method')}>
        <Select value={method} data-action="audio.method" onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="auto">{t('audioTools.methodAuto')}</option>
          <option value="silencedetect">{t('audioTools.methodSilencedetect')}</option>
          <option value="vad" disabled={vad?.status !== 'available'}>{t('audioTools.methodVad')}{vad?.status !== 'available' ? ` (${t(`capabilities.status.${vad?.status ?? 'unavailable'}`)})` : ''}</option>
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('audioTools.threshold')}><NumberField action="audio.threshold" value={thresholdDb} min={-90} max={0} step={1} onCommit={setThresholdDb} className="w-full" /></Field>
        <Field label={t('audioTools.minSilence')}><NumberField action="audio.minSilence" value={minSilenceMs} min={100} max={10000} step={50} onCommit={setMinSilenceMs} className="w-full" /></Field>
        <Field label={t('audioTools.padding')}><NumberField action="audio.padding" value={paddingMs} min={0} max={2000} step={10} onCommit={setPaddingMs} className="w-full" /></Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button action="audio.detectSilence" size="sm" icon={<Waves />} disabled={timelineEmpty || detect.running} loading={detect.running} onClick={() => void detect.run(() => getApi().invoke('audio.detectSilence', opts))} data-testid="audio-detect-silence">{t('audioTools.detectSilence')}</Button>
        <Button action="audio.removeSilence" size="sm" variant="primary" icon={<Scissors />} disabled={timelineEmpty || remove.running} loading={remove.running} onClick={() => void remove.run(() => getApi().invoke('audio.removeSilence', { ...opts, paddingMs, verify: true }))} data-testid="audio-remove-silence">{t('audioTools.removeSilence')}</Button>
      </div>
      <TaskStatus running={detect.running} progress={detect.progress} message={detect.message ?? t('audioTools.analyzing')} error={detect.error} />
      {detect.result ? (
        <div className="mt-2 rounded-lg border border-border bg-surface-2 p-2 text-[12.5px]" data-testid="silence-result">
          <div className="flex items-center justify-between"><span>{detect.result.ranges.length === 0 ? t('audioTools.noSilence') : t('audioTools.silences', { count: detect.result.ranges.length, total: fmtSec(detect.result.totalSilenceMs) })}</span><Badge>{methodLabel(detect.result.method)}</Badge></div>
          <div className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto">
            {detect.result.ranges.map((r, i) => <button key={i} type="button" data-action="audio.seekSilence" className="rounded px-1.5 py-0.5 text-start font-mono text-[11.5px] text-muted hover:bg-surface-3" dir="ltr" onClick={() => setPlayhead(r.startMs)}>{formatMs(r.startMs)} → {formatMs(r.endMs)}</button>)}
          </div>
        </div>
      ) : null}
      <TaskStatus running={remove.running} progress={remove.progress} message={remove.message} error={remove.error} doneLabel={remove.result ? `${t('audioTools.removed', { ms: fmtSec(remove.result.removedMs), count: remove.result.cutRanges.length, before: formatMs(remove.result.beforeDurationMs), after: formatMs(remove.result.afterDurationMs) })} ${remove.result.verified === true ? t('audioTools.verified') : remove.result.verified === false ? t('audioTools.notVerified', { count: remove.result.remainingSilences.length }) : ''}` : null} />

      <SectionTitle>{t('audioTools.loudness')}</SectionTitle>
      <Button action="audio.measure" size="sm" icon={<Activity />} disabled={timelineEmpty || measure.running} loading={measure.running} onClick={() => void measure.run(() => getApi().invoke('audio.measure', { projectId: doc.id, ...range }))} data-testid="audio-measure">{t('audioTools.measure')}</Button>
      <TaskStatus running={measure.running} progress={measure.progress} message={measure.message} error={measure.error} />
      {measure.result ? <div className="mt-2"><LoudnessTable r={measure.result} /></div> : null}

      <SectionTitle>{t('audioTools.presets')}</SectionTitle>
      {!audioClip ? <Hint>{t('tools.selectAudioClip')}</Hint> : null}
      <div className="grid grid-cols-2 gap-1.5">
        {Object.values(AUDIO_PRESETS).map((p) => (
          <Button key={p.id} action={`audio.preset.${p.id}`} size="sm" variant="outline" disabled={!audioClip} onClick={() => void applyPreset(p.id)} title={t(p.descriptionKey)} data-testid={`audio-preset-${p.id}`}>{t(p.nameKey)}</Button>
        ))}
      </div>
      {audioClip ? (
        <div className="mt-2 text-[12px] text-muted">
          {audioEffects.length === 0 ? t('audioTools.noEffects') : (
            <div className="flex flex-wrap gap-1">
              {audioEffects.map((e) => <Badge key={e.id} tone="accent">{e.type.replace('audio-', '')}<button type="button" data-action="audio.removeEffect" className="ms-1 text-faint hover:text-text" onClick={() => void onCommand({ type: 'effect.remove', clipId: audioClip.id, effectId: e.id })}>×</button></Badge>)}
            </div>
          )}
        </div>
      ) : null}
      <div className="mt-2">
        <Button action="audio.previewEnhance" size="sm" icon={<Volume2 />} disabled={!audioClip || audioEffects.length === 0 || preview.running} loading={preview.running} onClick={() => audioClip && void preview.run(() => getApi().invoke('audio.previewEnhance', { projectId: doc.id, clipId: audioClip.id }))} data-testid="audio-compare">{t('audioTools.previewCompare')}</Button>
        <Hint>{t('audioTools.compareHint')}</Hint>
        <TaskStatus running={preview.running} progress={preview.progress} message={preview.message ?? t('audioTools.comparing')} error={preview.error} />
        {preview.result ? (
          <div className="mt-1 grid gap-3" data-testid="audio-compare-result">
            <AudioPlayer path={preview.result.beforePath} label={t('audioTools.before')} />
            <LoudnessTable r={preview.result.before} />
            <AudioPlayer path={preview.result.afterPath} label={t('audioTools.after')} />
            <LoudnessTable r={preview.result.after} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
