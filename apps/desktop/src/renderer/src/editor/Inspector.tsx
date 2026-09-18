import { useSyncedState } from '@/hooks/useSyncedState';
import { useTranslation } from 'react-i18next';
import { Copy, Image as ImageIcon, Trash2 } from 'lucide-react';
import { ASPECT_PRESETS, PLATFORM_PRESETS, findClip, formatMs, newId, numberToFps, type Clip, type Command, type Effect, type ProjectDocument } from '@sevenvid/core';
import { getApi } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch } from '@/components/ui/Input';
import { StatRow } from '@/components/ui/Misc';

function NumberField({ value, onCommit, min, max, step = 1, action, className }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; action: string; className?: string }) {
  const [draft, setDraft] = useSyncedState(String(value));
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n === value) return setDraft(String(value));
    onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
  };
  return <Input type="number" step={step} min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className={className ?? 'w-24'} data-action={action} dir="ltr" />;
}

function RangeField({ label, value, min, max, step, onCommit, action, format }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; action: string; format?: (v: number) => string }) {
  const [draft, setDraft] = useSyncedState(value);
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between text-[12.5px]"><span className="text-muted">{label}</span><span className="font-mono text-[11.5px]" dir="ltr">{format ? format(draft) : draft}</span></div>
      <input type="range" min={min} max={max} step={step} value={draft} data-action={action} onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={() => draft !== value && onCommit(draft)} onKeyUp={() => draft !== value && onCommit(draft)} onBlur={() => draft !== value && onCommit(draft)} className="w-full accent-[var(--accent)]" dir="ltr" />
    </div>
  );
}

export function Inspector({ doc, onCommand, embedded }: { doc: ProjectDocument; onCommand: (cmd: Command) => Promise<unknown>; embedded?: boolean }) {
  const { t } = useTranslation();
  const selection = useEditorStore((s) => s.selection);
  const found = selection[0] ? findClip(doc, selection[0]) : undefined;
  const body = found ? <ClipInspector doc={doc} clip={found.clip} onCommand={onCommand} /> : <SequenceInspector doc={doc} onCommand={onCommand} />;
  if (embedded) return <div className="px-4 pb-6" data-testid="inspector">{body}</div>;
  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-s border-border bg-surface" data-testid="inspector">
      <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">{t('editor.inspector')}</div>
      <div className="px-4 pb-6">{body}</div>
    </aside>
  );
}

function SequenceInspector({ doc, onCommand }: { doc: ProjectDocument; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const s = doc.settings;
  const [w, setW] = useSyncedState(s.width);
  const [h, setH] = useSyncedState(s.height);
  return (
    <div>
      <h3 className="mt-3 mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{t('editor.sequence')}</h3>
      <p className="mb-2 text-[12.5px] text-muted">{t('editor.noSelection')}</p>
      <Field label={t('editor.platform')}>
        <Select value={s.platformPreset} data-testid="inspector-platform" onChange={(e) => {
          const id = e.target.value as keyof typeof PLATFORM_PRESETS | 'custom';
          if (id === 'custom') return void onCommand({ type: 'sequence.update', settings: { platformPreset: 'custom' } });
          const p = PLATFORM_PRESETS[id];
          void onCommand({ type: 'sequence.update', settings: { width: p.width, height: p.height, fps: p.fps, aspectPreset: p.aspect, platformPreset: p.id } });
        }}>
          {Object.values(PLATFORM_PRESETS).map((p) => <option key={p.id} value={p.id}>{t(p.nameKey)}</option>)}
          <option value="custom">{t('presets.platform.custom')}</option>
        </Select>
      </Field>
      <Field label={t('editor.aspect')}>
        <div className="flex flex-wrap gap-1">
          {Object.values(ASPECT_PRESETS).map((a) => (
            <Button key={a.id} action={`sequence.aspect.${a.id}`} size="sm" variant={s.aspectPreset === a.id ? 'primary' : 'outline'} onClick={() => void onCommand({ type: 'sequence.update', settings: { width: a.width, height: a.height, aspectPreset: a.id, platformPreset: 'custom' } })}>{a.label}</Button>
          ))}
        </div>
      </Field>
      <Field label={t('editor.customSize')}>
        <div className="flex items-center gap-2">
          <NumberField action="sequence.width" value={w} min={16} max={7680} step={2} onCommit={setW} />
          <span className="text-faint">×</span>
          <NumberField action="sequence.height" value={h} min={16} max={7680} step={2} onCommit={setH} />
          <Button action="sequence.applySize" size="sm" onClick={() => void onCommand({ type: 'sequence.update', settings: { width: Math.round(w / 2) * 2, height: Math.round(h / 2) * 2, aspectPreset: 'custom', platformPreset: 'custom' } })}>{t('editor.applyPreset')}</Button>
        </div>
      </Field>
      <Field label={t('editor.fps')}>
        <Select value={String(s.fps.num / s.fps.den)} data-testid="inspector-fps" onChange={(e) => void onCommand({ type: 'sequence.update', settings: { fps: numberToFps(Number(e.target.value)) } })}>
          {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
      </Field>
      <div className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-1 text-[12.5px]">
        <StatRow label={t('editor.resolution')} value={`${s.width}×${s.height}`} mono />
        <StatRow label={t('editor.tracks')} value={doc.tracks.length} />
      </div>
    </div>
  );
}

function ClipInspector({ doc, clip, onCommand }: { doc: ProjectDocument; clip: Clip; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const asset = doc.assets[clip.assetId];
  const playhead = useEditorStore((s) => s.playheadMs);
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);
  const [name, setName] = useSyncedState(clip.name);
  const tr = clip.transform;
  const color = clip.effects.find((e) => e.type === 'color');
  const sharpen = clip.effects.find((e) => e.type === 'sharpen');
  const denoise = clip.effects.find((e) => e.type === 'denoise');
  const stabilize = clip.effects.find((e) => e.type === 'stabilize');
  const setTransform = (patch: Partial<Clip['transform']>) => void onCommand({ type: 'clip.setTransform', clipId: clip.id, transform: patch });
  const setAudio = (patch: Partial<Clip['audio']>) => void onCommand({ type: 'clip.setAudio', clipId: clip.id, audio: patch });
  const upsertEffect = (type: Effect['type'], params: Record<string, number | string | boolean>) => {
    const existing = clip.effects.find((e) => e.type === type);
    if (existing) return void onCommand({ type: 'effect.update', clipId: clip.id, effectId: existing.id, patch: { params } });
    return void onCommand({ type: 'effect.add', clipId: clip.id, effect: { id: newId('fx'), type, enabled: true, params } });
  };
  const removeEffect = (e: Effect | undefined) => e && void onCommand({ type: 'effect.remove', clipId: clip.id, effectId: e.id });
  const extractFrame = async () => {
    try {
      const task = await getApi().invoke('render.extractFrame', { projectId: doc.id, tMs: playhead });
      pushToast({ level: 'info', titleKey: 'editor.extractFrame', messageKey: null, params: {}, errorId: null, taskId: task.id });
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <div data-testid="clip-inspector">
      <h3 className="mt-3 mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{t('editor.clip')}</h3>
      <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== clip.name && void onCommand({ type: 'clip.update', clipId: clip.id, patch: { name: name.trim() } })} className="mb-2" data-testid="clip-name" />
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-1 text-[12px]">
        <StatRow label={t('editor.start')} value={formatMs(clip.startMs)} mono />
        <StatRow label={t('editor.end')} value={formatMs(clip.startMs + clip.durationMs)} mono />
        <StatRow label={t('editor.duration')} value={formatMs(clip.durationMs)} mono />
        <StatRow label={t('editor.sourceIn')} value={formatMs(clip.sourceInMs)} mono />
        <StatRow label={t('editor.sourceOut')} value={formatMs(clip.sourceOutMs)} mono />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button action="clip.duplicate" size="sm" icon={<Copy />} onClick={() => void onCommand({ type: 'clip.duplicate', clipId: clip.id })}>{t('editor.duplicate')}</Button>
        <Button action="clip.extractFrame" size="sm" icon={<ImageIcon />} onClick={() => void extractFrame()}>{t('editor.extractFrame')}</Button>
        <Button action="clip.delete" size="sm" variant="danger" icon={<Trash2 />} onClick={() => void onCommand({ type: 'clip.remove', clipIds: [clip.id], ripple: false })}>{t('editor.delete')}</Button>
      </div>
      {asset?.kind !== 'image' ? (
        <>
          <Field label={t('editor.speed')}>
            <div className="flex items-center gap-2">
              <Select value={String(clip.speed)} data-testid="clip-speed" onChange={(e) => void onCommand({ type: 'clip.setSpeed', clipId: clip.id, speed: Number(e.target.value), ripple: true })} className="w-28">
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map((v) => <option key={v} value={v}>{v}x</option>)}
              </Select>
              <NumberField action="clip.speedNumber" value={clip.speed} min={0.05} max={100} step={0.05} onCommit={(v) => void onCommand({ type: 'clip.setSpeed', clipId: clip.id, speed: v, ripple: true })} />
            </div>
          </Field>
          <Field inline label={t('editor.reverse')}><Switch action="clip.reverse" checked={clip.reverse} onCheckedChange={(v) => void onCommand({ type: 'clip.setReverse', clipId: clip.id, reverse: v })} /></Field>
          <Field inline label={t('editor.freeze')}><Switch action="clip.freeze" checked={Boolean(clip.freeze)} onCheckedChange={(v) => void onCommand({ type: 'clip.setFreeze', clipId: clip.id, freeze: v ? { atSourceMs: Math.max(clip.sourceInMs, Math.min(clip.sourceOutMs, clip.sourceInMs + (playhead - clip.startMs) * clip.speed)) } : null, durationMs: v ? clip.durationMs : undefined, ripple: true })} /></Field>
          {clip.freeze ? <Field label={t('editor.freezeDuration')}><NumberField action="clip.freezeDuration" value={Math.round(clip.durationMs / 100) / 10} min={0.1} max={600} step={0.1} onCommit={(v) => void onCommand({ type: 'clip.setFreeze', clipId: clip.id, freeze: clip.freeze, durationMs: Math.round(v * 1000), ripple: true })} /></Field> : null}
        </>
      ) : null}
      {asset?.hasVideo ? (
        <>
          <h3 className="mt-4 mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{t('editor.transform')}</h3>
          <Field label={t('editor.fit')}>
            <Select value={tr.fit} data-testid="clip-fit" onChange={(e) => setTransform({ fit: e.target.value as Clip['transform']['fit'] })}>
              <option value="contain">{t('editor.fitContain')}</option>
              <option value="cover">{t('editor.fitCover')}</option>
              <option value="stretch">{t('editor.fitStretch')}</option>
              <option value="blur-fill">{t('editor.fitBlur')}</option>
            </Select>
          </Field>
          <RangeField label={t('editor.scale')} value={tr.scale} min={0.1} max={3} step={0.01} action="clip.scale" onCommit={(v) => setTransform({ scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <RangeField label={t('editor.offsetX')} value={tr.offsetX} min={-1} max={1} step={0.01} action="clip.offsetX" onCommit={(v) => setTransform({ offsetX: v })} />
          <RangeField label={t('editor.offsetY')} value={tr.offsetY} min={-1} max={1} step={0.01} action="clip.offsetY" onCommit={(v) => setTransform({ offsetY: v })} />
          <Field label={t('editor.rotate')}>
            <div className="flex items-center gap-2">
              <Select value={String(tr.rotate)} data-testid="clip-rotate" onChange={(e) => setTransform({ rotate: Number(e.target.value) })} className="w-24">
                {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}
              </Select>
              <NumberField action="clip.rotateNumber" value={tr.rotate} min={-360} max={360} step={1} onCommit={(v) => setTransform({ rotate: v })} />
            </div>
          </Field>
          <Field inline label={t('editor.flipH')}><Switch action="clip.flipH" checked={tr.flipH} onCheckedChange={(v) => setTransform({ flipH: v })} /></Field>
          <Field inline label={t('editor.flipV')}><Switch action="clip.flipV" checked={tr.flipV} onCheckedChange={(v) => setTransform({ flipV: v })} /></Field>
          <div className="mt-1 text-[12px] text-muted">{t('editor.crop')}</div>
          <RangeField label={t('editor.cropLeft')} value={tr.cropLeft} min={0} max={0.9} step={0.01} action="clip.cropLeft" onCommit={(v) => setTransform({ cropLeft: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <RangeField label={t('editor.cropTop')} value={tr.cropTop} min={0} max={0.9} step={0.01} action="clip.cropTop" onCommit={(v) => setTransform({ cropTop: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <RangeField label={t('editor.cropRight')} value={tr.cropRight} min={0} max={0.9} step={0.01} action="clip.cropRight" onCommit={(v) => setTransform({ cropRight: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <RangeField label={t('editor.cropBottom')} value={tr.cropBottom} min={0} max={0.9} step={0.01} action="clip.cropBottom" onCommit={(v) => setTransform({ cropBottom: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <RangeField label={t('editor.opacity')} value={tr.opacity} min={0} max={1} step={0.01} action="clip.opacity" onCommit={(v) => setTransform({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <h3 className="mt-4 mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{t('editor.color')}</h3>
          {color ? (
            <>
              <RangeField label={t('editor.brightness')} value={Number(color.params.brightness ?? 0)} min={-0.5} max={0.5} step={0.01} action="fx.brightness" onCommit={(v) => upsertEffect('color', { brightness: v })} />
              <RangeField label={t('editor.contrast')} value={Number(color.params.contrast ?? 1)} min={0.5} max={2} step={0.01} action="fx.contrast" onCommit={(v) => upsertEffect('color', { contrast: v })} />
              <RangeField label={t('editor.saturation')} value={Number(color.params.saturation ?? 1)} min={0} max={3} step={0.01} action="fx.saturation" onCommit={(v) => upsertEffect('color', { saturation: v })} />
              <RangeField label={t('editor.exposure')} value={Number(color.params.exposure ?? 0)} min={-3} max={3} step={0.05} action="fx.exposure" onCommit={(v) => upsertEffect('color', { exposure: v })} />
              <RangeField label={t('editor.temperature')} value={Number(color.params.temperature ?? 6500)} min={2000} max={12000} step={100} action="fx.temperature" onCommit={(v) => upsertEffect('color', { temperature: v })} />
              <RangeField label={t('editor.highlights')} value={Number(color.params.highlights ?? 0)} min={-1} max={1} step={0.05} action="fx.highlights" onCommit={(v) => upsertEffect('color', { highlights: v })} />
              <RangeField label={t('editor.shadows')} value={Number(color.params.shadows ?? 0)} min={-1} max={1} step={0.05} action="fx.shadows" onCommit={(v) => upsertEffect('color', { shadows: v })} />
              <RangeField label={t('editor.tint')} value={Number(color.params.tint ?? 0)} min={-0.5} max={0.5} step={0.01} action="fx.tint" onCommit={(v) => upsertEffect('color', { tint: v })} />
              <Button action="fx.color.remove" size="sm" variant="ghost" onClick={() => removeEffect(color)}>{t('editor.removeEffect')}</Button>
            </>
          ) : (
            <Button action="fx.color.add" size="sm" onClick={() => upsertEffect('color', { brightness: 0, contrast: 1, saturation: 1, exposure: 0, temperature: 6500, highlights: 0, shadows: 0, tint: 0 })}>{t('editor.addEffect')} · {t('editor.color')}</Button>
          )}
          <Field inline label={t('editor.sharpen')}><Switch action="fx.sharpen" checked={Boolean(sharpen)} onCheckedChange={(v) => (v ? upsertEffect('sharpen', { amount: 0.6 }) : removeEffect(sharpen))} /></Field>
          {sharpen ? <RangeField label={t('editor.sharpen')} value={Number(sharpen.params.amount ?? 0.6)} min={0.1} max={2} step={0.05} action="fx.sharpenAmount" onCommit={(v) => upsertEffect('sharpen', { amount: v })} /> : null}
          <Field inline label={t('editor.denoise')}><Switch action="fx.denoise" checked={Boolean(denoise)} onCheckedChange={(v) => (v ? upsertEffect('denoise', { strength: 3 }) : removeEffect(denoise))} /></Field>
          {denoise ? <RangeField label={t('editor.denoise')} value={Number(denoise.params.strength ?? 3)} min={1} max={10} step={0.5} action="fx.denoiseStrength" onCommit={(v) => upsertEffect('denoise', { strength: v })} /> : null}
          <Field inline label={t('editor.stabilize')}><Switch action="fx.stabilize" checked={Boolean(stabilize)} onCheckedChange={(v) => (v ? upsertEffect('stabilize', { rx: 32, ry: 32 }) : removeEffect(stabilize))} /></Field>
        </>
      ) : null}
      {asset?.hasAudio ? (
        <>
          <h3 className="mt-4 mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{t('editor.audio')}</h3>
          <RangeField label={t('editor.gain')} value={clip.audio.gainDb} min={-60} max={12} step={0.5} action="clip.gain" onCommit={(v) => setAudio({ gainDb: v })} format={(v) => `${v.toFixed(1)} dB`} />
          <Field inline label={t('editor.mute')}><Switch action="clip.mute" checked={clip.audio.muted} onCheckedChange={(v) => setAudio({ muted: v })} /></Field>
          <div className="flex gap-2">
            <Field label={t('editor.fadeIn')}><NumberField action="clip.fadeIn" value={clip.audio.fadeInMs / 1000} min={0} max={60} step={0.1} onCommit={(v) => setAudio({ fadeInMs: Math.round(v * 1000) })} /></Field>
            <Field label={t('editor.fadeOut')}><NumberField action="clip.fadeOut" value={clip.audio.fadeOutMs / 1000} min={0} max={60} step={0.1} onCommit={(v) => setAudio({ fadeOutMs: Math.round(v * 1000) })} /></Field>
          </div>
        </>
      ) : null}
    </div>
  );
}
