import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Columns2, Maximize2, Palette } from 'lucide-react';
import { newId, type Command, type ProjectDocument } from '@sevenvid/core';
import type { CompareRenderResult, UpscaleResult } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useCapability } from '@/components/CapabilityGate';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Select, Switch } from '@/components/ui/Input';
import { useTaskRunner } from '@/hooks/useTaskRunner';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { useMediaStore } from '@/store/mediaStore';
import { Hint, SectionTitle, TaskStatus } from './shared';

type Look = 'natural' | 'warm' | 'cool' | 'cinematic' | 'vivid' | 'mono';

const LOOKS: Record<Look, Record<string, number>> = {
  natural: { brightness: 0, contrast: 1, saturation: 1, exposure: 0, temperature: 6500, highlights: 0, shadows: 0, tint: 0 },
  warm: { brightness: 0.02, contrast: 1.05, saturation: 1.1, exposure: 0, temperature: 5200, highlights: 0, shadows: 0.1, tint: 0.02 },
  cool: { brightness: 0, contrast: 1.05, saturation: 0.95, exposure: 0, temperature: 8200, highlights: 0, shadows: 0, tint: -0.02 },
  cinematic: { brightness: -0.02, contrast: 1.15, saturation: 0.85, exposure: 0, temperature: 6000, highlights: -0.2, shadows: 0.15, tint: 0.03 },
  vivid: { brightness: 0.02, contrast: 1.12, saturation: 1.35, exposure: 0.1, temperature: 6500, highlights: 0, shadows: 0, tint: 0 },
  mono: { brightness: 0, contrast: 1.1, saturation: 0, exposure: 0, temperature: 6500, highlights: 0, shadows: 0, tint: 0 },
};

export function EnhancePanel({ doc, clipId, onCommand }: { doc: ProjectDocument; clipId: string | null; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const pushToast = useAppStore((s) => s.pushToast);
  const editor = useEditorStore();
  const ai = useCapability('upscale.ai');
  const clip = clipId ? doc.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) : undefined;
  const asset = clip ? doc.assets[clip.assetId] : undefined;
  const videoClip = clip && asset?.hasVideo ? clip : null;
  const [factor, setFactor] = useState<2 | 4>(2);
  const [method, setMethod] = useState<'lanczos' | 'ai'>('lanczos');
  const [replace, setReplace] = useState(true);
  const upscale = useTaskRunner<UpscaleResult>((r) => pushToast({ level: 'success', titleKey: 'enhancePanel.upscaleDone', messageKey: null, params: { width: r.width, height: r.height, method: r.method, replaced: r.replaced ? t('enhancePanel.replacedYes') : t('enhancePanel.replacedNo') }, errorId: null, taskId: null }));
  const compare = useTaskRunner<CompareRenderResult>((r) => {
    const urlFor = useMediaStore.getState().urlFor;
    void Promise.all([urlFor(r.beforePath), urlFor(r.afterPath)]).then(([beforeUrl, afterUrl]) => {
      if (beforeUrl && afterUrl) editor.setCompare({ startMs: r.startMs, endMs: r.endMs, beforeUrl, afterUrl, bypassed: r.bypassed });
    });
  });
  const applyLook = (look: Look) => {
    if (!videoClip) return;
    const existing = videoClip.effects.find((e) => e.type === 'color');
    const params = LOOKS[look];
    void onCommand(existing ? { type: 'effect.update', clipId: videoClip.id, effectId: existing.id, patch: { params } } : { type: 'effect.add', clipId: videoClip.id, effect: { id: newId('fx'), type: 'color', enabled: true, params } });
  };
  const compareRange = () => {
    const s = useEditorStore.getState();
    if (s.inMs != null && s.outMs != null && s.outMs > s.inMs) return { startMs: s.inMs, endMs: Math.min(s.outMs, s.inMs + 20000) };
    if (videoClip) return { startMs: videoClip.startMs, endMs: Math.min(videoClip.startMs + videoClip.durationMs, videoClip.startMs + 10000) };
    return { startMs: 0, endMs: Math.min(s.durationMs, 10000) };
  };
  const timelineEmpty = doc.tracks.every((tr) => tr.clips.length === 0);
  const target = videoClip && asset?.width && asset.height ? `${asset.width * factor}×${asset.height * factor}` : null;
  return (
    <div data-testid="enhance-panel">
      <SectionTitle>{t('enhancePanel.colorPresets')}</SectionTitle>
      {!videoClip ? <Hint>{t('tools.selectClip')}</Hint> : null}
      <div className="grid grid-cols-3 gap-1.5">
        {(Object.keys(LOOKS) as Look[]).map((l) => <Button key={l} action={`enhance.look.${l}`} size="sm" variant="outline" icon={<Palette />} disabled={!videoClip} onClick={() => applyLook(l)}>{t(`enhancePanel.preset${l[0]!.toUpperCase()}${l.slice(1)}`)}</Button>)}
      </div>

      <SectionTitle>{t('enhancePanel.upscale')}</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('enhancePanel.factor')}>
          <Select value={String(factor)} data-action="enhance.factor" onChange={(e) => setFactor(Number(e.target.value) as 2 | 4)}>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </Select>
        </Field>
        <Field label={t('enhancePanel.method')}>
          <Select value={method} data-action="enhance.method" onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="lanczos">{t('enhancePanel.methodLanczos')}</option>
            <option value="ai" disabled={ai?.status !== 'available'}>{t('enhancePanel.methodAi')}{ai?.status !== 'available' ? ` (${t(`capabilities.status.${ai?.status ?? 'unavailable'}`)})` : ''}</option>
          </Select>
        </Field>
      </div>
      {ai && ai.status !== 'available' ? <Hint>{t(ai.reasonKey || 'capabilities.unavailable', ai.reasonParams)}</Hint> : null}
      <Field inline label={t('enhancePanel.replaceClip')}><Switch action="enhance.replace" checked={replace} onCheckedChange={setReplace} /></Field>
      <div className="flex items-center gap-2">
        <Button action="enhance.upscale" size="sm" variant="primary" icon={<Maximize2 />} disabled={!videoClip || upscale.running} loading={upscale.running} onClick={() => videoClip && void upscale.run(() => getApi().invoke('enhance.upscale', { projectId: doc.id, clipId: videoClip.id, factor, method, replaceClip: replace }))} data-testid="enhance-upscale">{t('enhancePanel.upscale')}</Button>
        {target ? <Badge>{t('enhancePanel.output')}: <span dir="ltr">{target}</span></Badge> : null}
      </div>
      <TaskStatus running={upscale.running} progress={upscale.progress} message={upscale.message ?? t('enhancePanel.upscaling')} error={upscale.error} doneLabel={upscale.result ? t('enhancePanel.upscaleDone', { width: upscale.result.width, height: upscale.result.height, method: upscale.result.method, replaced: upscale.result.replaced ? t('enhancePanel.replacedYes') : t('enhancePanel.replacedNo') }) : null} />

      <SectionTitle>{t('enhancePanel.compare')}</SectionTitle>
      <Hint>{t('enhancePanel.compareHint')}</Hint>
      <Button action="enhance.compare" size="sm" icon={<Columns2 />} disabled={timelineEmpty || compare.running} loading={compare.running} onClick={() => void compare.run(() => getApi().invoke('render.compare', { projectId: doc.id, ...compareRange() }))} data-testid="enhance-compare">{t('enhancePanel.compare')}</Button>
      <TaskStatus running={compare.running} progress={compare.progress} message={compare.message ?? t('enhancePanel.comparing')} error={compare.error} doneLabel={compare.result ? t('enhancePanel.bypassed', { effects: compare.result.bypassed.effects, masks: compare.result.bypassed.masks, audio: compare.result.bypassed.audioEffects }) : null} />
    </div>
  );
}
