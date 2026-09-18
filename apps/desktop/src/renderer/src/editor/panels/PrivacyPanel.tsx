import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Eye, EyeOff, ScanFace, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { formatMs, type Command, type MaskTrack, type ProjectDocument } from '@sevenvid/core';
import type { BlurFacesResult, DetectFacesResult, MaskVerificationResult, TrackTargetResult } from '@sevenvid/ipc';
import { getApi } from '@/api/client';
import { useEvent } from '@/api/hooks';
import { useCapability, CapabilityGate } from '@/components/CapabilityGate';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Select, Switch } from '@/components/ui/Input';
import { useTaskRunner } from '@/hooks/useTaskRunner';
import { useAppStore } from '@/store/appStore';
import { useEditorStore } from '@/store/editorStore';
import { ChoiceRow, Hint, RangeField, SectionTitle, TaskStatus } from './shared';

type Selector = 'all' | 'largest' | 'leftmost' | 'rightmost' | 'center' | number;

export function PrivacyPanel({ doc, clipId, onCommand }: { doc: ProjectDocument; clipId: string | null; onCommand: (cmd: Command) => Promise<unknown> }) {
  const { t } = useTranslation();
  const pushToast = useAppStore((s) => s.pushToast);
  const editor = useEditorStore();
  const faces = useCapability('vision.faces');
  const tracking = useCapability('vision.tracking');
  const clip = clipId ? doc.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) : undefined;
  const asset = clip ? doc.assets[clip.assetId] : undefined;
  const videoClip = clip && asset?.hasVideo ? clip : null;
  const [kind, setKind] = useState<MaskTrack['kind']>('blur');
  const [shape, setShape] = useState<MaskTrack['shape']>('ellipse');
  const [strength, setStrength] = useState(30);
  const [selector, setSelector] = useState<Selector>('all');
  const [withDetector, setWithDetector] = useState(true);
  const [analysis, setAnalysis] = useState<DetectFacesResult | null>(null);
  const detect = useTaskRunner<DetectFacesResult>((r) => setAnalysis(r));
  const blur = useTaskRunner<BlurFacesResult>((r) => pushToast({ level: 'success', titleKey: 'privacy.blurred', messageKey: null, params: { count: r.masks.length, faces: r.facesDetected }, errorId: null, taskId: null }));
  const track = useTaskRunner<TrackTargetResult>((r) => {
    editor.setMaskDraw({ active: false, box: null });
    editor.selectMask(r.maskId);
  });
  const verify = useTaskRunner<MaskVerificationResult>();
  const loadAnalysis = useCallback((id: string) => {
    getApi().invoke('analysis.get', { projectId: doc.id, clipId: id, kind: 'faces' }).then((r) => setAnalysis((r as DetectFacesResult | null) ?? null)).catch(() => setAnalysis(null));
  }, [doc.id]);
  useEffect(() => {
    if (videoClip) loadAnalysis(videoClip.id);
  }, [videoClip?.id, loadAnalysis, videoClip]);
  useEvent('task.updated', useCallback((task) => {
    if (task.kind === 'vision.blurFaces' && task.status === 'done' && videoClip && task.params.clipId === videoClip.id) loadAnalysis(videoClip.id);
  }, [videoClip, loadAnalysis]));

  const masks = doc.masks.filter((m) => !videoClip || m.clipId === videoClip.id);
  const maskKindLabel = (k: MaskTrack['kind']) => (k === 'pixelate' ? t('privacy.kindPixelate') : k === 'box' ? t('privacy.kindBox') : t('privacy.kindBlur'));

  const startDetect = () => videoClip && void detect.run(() => getApi().invoke('vision.detectFaces', { projectId: doc.id, clipId: videoClip.id, sampleFps: 6 }));
  const startBlur = () => videoClip && void blur.run(() => getApi().invoke('vision.blurFaces', { projectId: doc.id, clipId: videoClip.id, kind, shape, strength, selector }));
  const startTrack = () => {
    const box = editor.maskDraw.box;
    if (!videoClip || !box) return;
    void track.run(() => getApi().invoke('vision.trackTarget', { projectId: doc.id, clipId: videoClip.id, box, startMs: Math.max(videoClip.startMs, Math.min(videoClip.startMs + videoClip.durationMs - 1, editor.playheadMs)), kind, shape, strength, detector: withDetector ? 'face' : null }));
  };
  const startVerify = (maskId: string) => void verify.run(() => getApi().invoke('vision.verifyMask', { projectId: doc.id, maskId }));

  return (
    <div data-testid="privacy-panel">
      <SectionTitle>{t('privacy.title')}</SectionTitle>
      <Hint>{t('privacy.previewHint')}</Hint>
      {!videoClip ? <Hint>{t('tools.selectClip')}</Hint> : null}
      <Field label={t('privacy.kind')}>
        <ChoiceRow action="privacy.kind" value={kind} onChange={setKind} options={[{ id: 'blur', label: t('privacy.kindBlur') }, { id: 'pixelate', label: t('privacy.kindPixelate') }, { id: 'box', label: t('privacy.kindBox') }]} />
      </Field>
      <Field label={t('privacy.shape')}>
        <ChoiceRow action="privacy.shape" value={shape} onChange={setShape} options={[{ id: 'ellipse', label: t('privacy.shapeEllipse') }, { id: 'rect', label: t('privacy.shapeRect') }]} />
      </Field>
      <RangeField label={t('privacy.strength')} value={strength} min={4} max={80} step={1} action="privacy.strength" onCommit={setStrength} />

      <SectionTitle>{t('privacy.detectFaces')}</SectionTitle>
      <CapabilityGate id="vision.faces" compact>
        <div className="flex flex-wrap gap-1.5">
          <Button action="privacy.detectFaces" size="sm" icon={<ScanFace />} disabled={!videoClip || detect.running} loading={detect.running} onClick={startDetect} data-testid="privacy-detect">{t('privacy.detectFaces')}</Button>
          <Button action="privacy.blurFaces" size="sm" variant="primary" icon={<ShieldCheck />} disabled={!videoClip || blur.running || tracking?.status !== 'available'} loading={blur.running} onClick={startBlur} data-testid="privacy-blur">{selector === 'all' ? t('privacy.blurAll') : t('privacy.blurSelected')}</Button>
        </div>
        <TaskStatus running={detect.running} progress={detect.progress} message={detect.message ?? t('privacy.detecting')} error={detect.error} />
        <TaskStatus running={blur.running} progress={blur.progress} message={blur.message} error={blur.error} doneLabel={blur.result ? t('privacy.blurred', { count: blur.result.masks.length, faces: blur.result.facesDetected }) : null} />
        {analysis && analysis.clipId === videoClip?.id ? (
          <div className="mt-2 rounded-lg border border-border bg-surface-2 p-2 text-[12.5px]" data-testid="privacy-analysis">
            <div className="text-muted">{analysis.totalDetections === 0 ? t('privacy.noFaces') : t('privacy.facesFound', { count: analysis.totalDetections, frames: analysis.framesAnalyzed, tracks: analysis.tracks.length })}</div>
            {analysis.tracks.length > 0 ? (
              <div className="mt-2">
                <div className="mb-1 text-[12px] text-muted">{t('privacy.selector')}</div>
                <Select value={String(selector)} data-action="privacy.selector" onChange={(e) => { const v = e.target.value; setSelector(/^\d+$/.test(v) ? Number(v) : (v as Selector)); }}>
                  <option value="all">{t('privacy.selectorAll')}</option>
                  <option value="largest">{t('privacy.selectorLargest')}</option>
                  <option value="leftmost">{t('privacy.selectorLeftmost')}</option>
                  <option value="rightmost">{t('privacy.selectorRightmost')}</option>
                  <option value="center">{t('privacy.selectorCenter')}</option>
                  {analysis.tracks.map((tr) => <option key={tr.index} value={tr.index}>{t('privacy.faceLabel', { n: tr.index + 1 })} · {t('privacy.trackSpan', { start: formatMs(tr.startMs), end: formatMs(tr.endMs) })}</option>)}
                </Select>
              </div>
            ) : null}
          </div>
        ) : videoClip && !detect.running ? <div className="mt-1 text-[12px] text-faint">{t('privacy.notDetected')}</div> : null}
      </CapabilityGate>

      <SectionTitle>{t('privacy.drawRegion')}</SectionTitle>
      <Hint>{t('privacy.drawHint')}</Hint>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button action="privacy.drawRegion" size="sm" variant={editor.maskDraw.active ? 'primary' : 'secondary'} icon={<Crosshair />} disabled={!videoClip} onClick={() => editor.setMaskDraw({ active: !editor.maskDraw.active, box: editor.maskDraw.box })} data-testid="privacy-draw">{editor.maskDraw.active ? t('editor.cancelDraw') : t('privacy.drawRegion')}</Button>
        <Button action="privacy.trackRegion" size="sm" variant="primary" disabled={!videoClip || !editor.maskDraw.box || track.running || tracking?.status !== 'available'} loading={track.running} onClick={startTrack} data-testid="privacy-track">{t('privacy.trackRegion')}</Button>
      </div>
      {editor.maskDraw.box ? <div className="mt-1 font-mono text-[11px] text-faint" dir="ltr">{Math.round(editor.maskDraw.box.x * 100)}%, {Math.round(editor.maskDraw.box.y * 100)}% · {Math.round(editor.maskDraw.box.w * 100)}×{Math.round(editor.maskDraw.box.h * 100)}%</div> : null}
      {faces?.status === 'available' ? <Field inline label={t('privacy.withFaceDetector')}><Switch action="privacy.withDetector" checked={withDetector} onCheckedChange={setWithDetector} /></Field> : null}
      {tracking && tracking.status !== 'available' ? <CapabilityGate id="vision.tracking" compact><span /></CapabilityGate> : null}
      <TaskStatus running={track.running} progress={track.progress} message={track.message ?? t('privacy.tracking')} error={track.error} doneLabel={track.result ? (track.result.status === 'lost' ? t('privacy.trackLost', { end: formatMs(track.result.coveredEndMs) }) : t('privacy.tracked', { keyframes: track.result.keyframes, end: formatMs(track.result.coveredEndMs) })) : null} />

      <SectionTitle>{t('privacy.masks')} <span className="ms-1 rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{masks.length}</span></SectionTitle>
      <TaskStatus running={verify.running} progress={verify.progress} message={t('privacy.verifying')} error={verify.error} />
      {masks.length === 0 ? <Hint>{t('privacy.noMasks')}</Hint> : null}
      <div className="flex flex-col gap-1.5" data-testid="mask-list">
        {masks.map((m) => {
          const selected = editor.selectedMaskId === m.id;
          const v = m.verification;
          return (
            <div key={m.id} className={`rounded-lg border px-2.5 py-2 text-[12.5px] ${selected ? 'border-accent bg-accent-soft/40' : 'border-border bg-surface-2'}`} data-testid="mask-item" data-mask-id={m.id}>
              <div className="flex items-center gap-2">
                <button type="button" data-action="mask.select" className="min-w-0 flex-1 truncate text-start font-medium" onClick={() => { editor.selectMask(m.id); editor.setPlayhead(m.startMs + 1); }}>{t('privacy.maskTitle', { label: m.label, kind: maskKindLabel(m.kind) })}</button>
                <Badge tone={m.status === 'ok' ? 'success' : m.status === 'partial' ? 'warning' : 'danger'} dot>{m.status === 'ok' ? t('privacy.statusOk') : m.status === 'partial' ? t('privacy.statusPartial') : t('privacy.statusLost')}</Badge>
                <IconButton action="mask.toggle" label={m.enabled ? t('privacy.statusOk') : t('common.off')} size="sm" onClick={() => void onCommand({ type: 'mask.update', maskId: m.id, patch: { enabled: !m.enabled } })}>{m.enabled ? <Eye /> : <EyeOff />}</IconButton>
                <IconButton action="mask.remove" label={t('privacy.remove')} size="sm" onClick={() => void onCommand({ type: 'mask.remove', maskId: m.id }).then(() => selected && editor.selectMask(null))}><Trash2 /></IconButton>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                <span className="font-mono" dir="ltr">{formatMs(m.startMs)} – {formatMs(m.endMs)}</span>
                <span>{m.keyframes.length} kf</span>
                {m.lostRanges && m.lostRanges.length > 0 ? <span className="text-warning">{t('privacy.lostRanges', { count: m.lostRanges.length })}</span> : null}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {v ? (
                  <span className={`flex items-center gap-1 text-[11.5px] ${v.ok ? 'text-success' : 'text-danger'}`} data-testid="mask-verification" data-ok={String(v.ok)}>{v.ok ? <ShieldCheck className="size-3.5" /> : <XCircle className="size-3.5" />}{v.ok ? t('privacy.verified', { ratio: Math.round((v.before > 0 ? v.after / v.before : 0) * 100) }) : t('privacy.verifyFailed', { ratio: Math.round((v.before > 0 ? v.after / v.before : 1) * 100) })}</span>
                ) : <span className="text-[11.5px] text-faint">{t('privacy.notVerified')}</span>}
                <Button action="mask.verify" size="sm" variant="ghost" className="ms-auto" disabled={verify.running} onClick={() => startVerify(m.id)} data-testid="mask-verify">{t('privacy.verify')}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
